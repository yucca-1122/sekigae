// 画面の検査と写真: ヘッドレスの Edge（なければ Chrome）で sekigae.html を開き、押して確かめて撮る
// - 公開するページと同じ形（<!doctype>・charset と viewport の meta・小さなリセット・:root の上下の安全領域）で包んで配る
// - このフォルダだけを配る小さなサーバーを 127.0.0.1 に立てる。外への通信は Google Fonts だけ許し、ほかは数えて報告する
// - 写真は shots/ に保存（スマホ幅 390px とパソコン幅 1280px、ライトとダーク）
// 使い方: node tools/test_ui.mjs   （sekigae フォルダで実行。全部通ると終了コード 0）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SHOTS = path.join(ROOT, 'shots');
const KEY = 'sekigae:v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) pass++; else fails.push(name + (detail ? ' … ' + detail : ''));
  console.log((cond ? '  通った   ' : '  通らない ') + name + (!cond && detail ? ' … ' + detail : ''));
}
function section(t) { console.log('\n■ ' + t); }

/* ---------- ページの包み方 ---------- */
const SKELETON_HEAD = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
function serve() {
  const srv = http.createServer((req, res) => {
    const p = (req.url || '/').split('?')[0];
    if (p === '/favicon.ico') { res.writeHead(204).end(); return; }   // ブラウザが勝手に取りに来るだけ（ページの通信ではない）
    if (p === '/' || p === '/preview.html') {
      const body = SKELETON_HEAD + fs.readFileSync(path.join(ROOT, 'sekigae.html'), 'utf8') + '</body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/* ---------- ブラウザ ---------- */
function findBrowser() {
  const pf86 = process.env['ProgramFiles(x86)'], pf = process.env.ProgramFiles, local = process.env.LOCALAPPDATA;
  return [process.env.BROWSER_PATH,
    pf86 && path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    pf && path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    pf && path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')]
    .filter(Boolean).find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}
async function launch(browser, profile) {
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try {
      const lines = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
      if (Number(lines[0]) && lines[1]) return { proc, port: Number(lines[0]), browserPath: lines[1] };
    } catch (e) { /* まだ */ }
    await sleep(150);
  }
  stopTree(proc);
  throw new Error('ブラウザが起動しなかった');
}
function stopTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGKILL');
}
async function closeBrowser(proc, port, browserPath) {
  try {
    const ws = new WebSocket('ws://127.0.0.1:' + port + browserPath);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(rej, 2000); });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } catch (e) { /* 下で止める */ }
  for (let i = 0; i < 30 && proc.exitCode === null; i++) await sleep(100);
  stopTree(proc);
}
class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = []; this.mobile = true; }
  static async open(port) {
    const info = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const p = new Page(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && p.waiting.has(msg.id)) { p.waiting.get(msg.id)(msg); p.waiting.delete(msg.id); } else if (msg.method) p.handlers.forEach((h) => h(msg));
    };
    return p;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.handlers.push(fn); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('ページの中でエラー: ' + JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result && r.result.value;
  }
  async waitFor(expr, timeout = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (await this.eval('!!(' + expr + ')')) return true; await sleep(40); }
    return false;
  }
  async viewport(w, h, mobile, dark, reduce) {
    this.mobile = mobile;
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  }
  async load(url) {
    await this.send('Page.navigate', { url });
    await sleep(300);
    await this.waitFor("document.readyState === 'complete' && !!window.SekigaeEngine && !!document.querySelector('.desk')", 8000);
    await this.eval('document.fonts.ready.then(() => true)');
    await sleep(300);
  }
  async press(x, y) {
    if (this.mobile) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(30);
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    await sleep(60);
  }
  async pressEl(sel) {
    const b = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
    if (!b || !b.w) throw new Error('押すものが見えない: ' + sel);
    await sleep(80);
    await this.press(b.x, b.y);
  }
  // full: ページ全体を撮る（画面の高さをページの高さまで伸ばして撮る。下に固定したバーは一番下に写る）
  async shot(name, full) {
    fs.mkdirSync(SHOTS, { recursive: true });
    let restore = null;
    if (full) {
      const m = await this.eval('({ w: window.innerWidth, h: window.innerHeight, full: Math.ceil(document.documentElement.scrollHeight) })');
      if (m.full > m.h) {
        await this.send('Emulation.setDeviceMetricsOverride', { width: m.w, height: m.full, deviceScaleFactor: this.mobile ? 2 : 1, mobile: this.mobile });
        await sleep(250);
        restore = m;
      }
    }
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    if (restore) { await this.send('Emulation.setDeviceMetricsOverride', { width: restore.w, height: restore.h, deviceScaleFactor: this.mobile ? 2 : 1, mobile: this.mobile }); await sleep(150); }
    console.log('  撮影     shots/' + name);
  }
}

/* ---------- ページの様子 ---------- */
const OVERFLOW = `(() => { const de = document.documentElement, b = document.body; return Math.max(de.scrollWidth - de.clientWidth, b.scrollWidth - b.clientWidth); })()`;
const VIEW = `(() => { const v = document.getElementById('view');
  return { open: !v.hidden && v.classList.contains('is-in'), title: document.getElementById('view-title').textContent,
    face: (document.querySelector('#view-teacher svg') || { dataset: {} }).dataset.face, seat: document.getElementById('scene').dataset.seat,
    clock: document.getElementById('view-clock').hidden ? 0 : Number(document.getElementById('view-clock').dataset.size),
    bubbles: document.querySelectorAll('#scene .q-bubble').length, voices: document.querySelectorAll('#view-voices li').length,
    ask: document.getElementById('view-ask').textContent, blur: document.querySelectorAll('#view-chalk .m-blur').length,
    chips: document.querySelectorAll('#view-chips button').length, overflowX: v.scrollWidth - v.clientWidth }; })()`;

/* ---------- 本番 ---------- */
const browser = findBrowser();
if (!browser) { console.error('Edge か Chrome が見つからない（BROWSER_PATH で場所を指定できる）'); process.exit(2); }
const srv = await serve();
const base = 'http://127.0.0.1:' + srv.address().port + '/preview.html';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sekigae-ui-'));
const { proc, port, browserPath } = await launch(browser, profile);
const page = await Page.open(port);
const errors = [], outside = [];
page.on((m) => {
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) errors.push('console.' + m.params.type + ': ' + JSON.stringify(m.params.args.map((a) => a.value || a.description)));
  if (m.method === 'Runtime.exceptionThrown') errors.push('例外: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('ログ: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url;
    if (!u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('about:') && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) outside.push(u);
  }
});
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Log.enable');
await page.send('Network.enable');
let fontsOk = null;

const VARIANTS = [
  { tag: '390_light', w: 390, h: 844, mobile: true, dark: false },
  { tag: '390_dark', w: 390, h: 844, mobile: true, dark: true },
  { tag: '1280_light', w: 1280, h: 800, mobile: false, dark: false },
  { tag: '1280_dark', w: 1280, h: 800, mobile: false, dark: true }
];
try {
  for (const V of VARIANTS) {
    section('画面 ' + V.tag);
    await page.viewport(V.w, V.h, V.mobile, V.dark, false);
    await page.load(base);
    await page.eval('localStorage.clear(); true');
    await page.load(base);
    // 日本語のフォントは文字の範囲ごとに分かれて届くので、実際に読み込まれた面があるかで見る
    if (fontsOk === null) fontsOk = await page.eval(`(() => { const fams = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
      return fams.indexOf('Klee One') >= 0 && fams.indexOf('Zen Maru Gothic') >= 0; })()`);
    const desks = await page.eval(`[...document.querySelectorAll('button.desk')].map((d) => [d.dataset.sid, d.closest('.row').dataset.seat])`);
    ok('最初に見本の生徒2人（はじめて＝後ろ・慣れた＝前）と見本の黒板', JSON.stringify(desks) === JSON.stringify([['ex-s2', 'front'], ['ex-s1', 'back']]) &&
      (await page.eval(`document.getElementById('room-chalk').textContent`)) === 'これ、簡単にまとめておいて。なるはやで！', JSON.stringify(desks));
    ok('教室: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0, String(await page.eval(OVERFLOW)));
    const bg = await page.eval(`getComputedStyle(document.body).backgroundColor`);
    ok('body に背景色（' + (V.dark ? 'ダーク' : 'ライト') + '）', V.dark ? bg === 'rgb(18, 24, 21)' : bg === 'rgb(238, 242, 239)', bg);
    await page.shot('01_教室_' + V.tag + '.png', true);

    // 生徒の目線（見本の「はじめての生徒」）
    await page.pressEl('button.desk[data-sid="ex-s1"]');
    await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
    await sleep(500);
    let v = await page.eval(VIEW);
    ok('机を押すと、その生徒の目線にふわっと切り替わる', v.open && v.title === 'はじめての生徒さんの目線', JSON.stringify(v));
    ok('はじめての生徒: 後ろの席・先生は忙しそう・時計は大・吹き出し7・心の声4・にじむ言葉2', v.seat === 'back' && v.face === 'busy' && v.clock === 2 && v.bubbles === 7 && v.voices === 4 && v.blur === 2, JSON.stringify(v));
    ok('本人に聞くなら「『簡単に』って…」', v.ask === '「簡単に」って、どれくらいのつもりで受け取った？', v.ask);
    ok('生徒の目線: 横にはみ出さない', v.overflowX <= 0 && (await page.eval(OVERFLOW)) <= 0, String(v.overflowX));
    ok('教室は裏でぼけて薄くなっている・触れない（inert）', await page.eval(`document.getElementById('app').classList.contains('is-away') && document.getElementById('app').inert`));
    await page.shot('02_生徒の目線_はじめての生徒_' + V.tag + '.png');
    await page.eval(`document.getElementById('view').scrollTop = document.querySelector('.view-body').offsetTop - 12; true`);
    await sleep(200);
    await page.shot('02b_生徒の目線_心の声_' + V.tag + '.png');
    if (V.tag === '390_light') {
      // 「黒板に足すとよいもの」を押すと、黒板の最後にひな形が入り、その吹き出しが消える
      await page.pressEl('#view-chips button');
      await sleep(250);
      const after = await page.eval(`({ text: document.getElementById('view-chalk').textContent, bubbles: document.querySelectorAll('#scene .q-bubble').length })`);
      ok('足すとよいもの（完成の目安）を押すと、黒板の末尾に入って「どこまで？」が消える', /完成の目安：◯◯/.test(after.text) && after.bubbles === 6, JSON.stringify(after));
      await page.pressEl('#view-ask-copy');
      await sleep(200);
      ok('「この一言をコピー」で落ちない（だめなら文字を選んで知らせる）', await page.eval(`document.getElementById('toast').classList.contains('is-on')`));
      await page.eval(`localStorage.clear(); true`);
    }
    await page.pressEl('#view-back');
    await page.waitFor(`document.getElementById('view').hidden`, 2000);
    ok('「先生にもどる」で教室に戻る', await page.eval(`document.getElementById('view').hidden && !document.getElementById('app').classList.contains('is-away') && !document.getElementById('app').inert`));
    if (V.tag === '390_light') await page.load(base);   // ひな形を足した分を見本に戻す

    // 慣れた生徒の目線（写真は 390 ライトだけ）
    if (V.tag === '390_light' || V.tag === '1280_light') {
      await page.pressEl('button.desk[data-sid="ex-s2"]');
      await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
      await sleep(400);
      v = await page.eval(VIEW);
      ok('慣れた生徒: 前の席・ふつうの顔・時計は小・心の声3・「何に使う」を聞く', v.seat === 'front' && v.face === 'normal' && v.clock === 1 && v.voices === 3 && v.ask === 'これ、何に使うものだと思った？', JSON.stringify(v));
      await page.shot('02c_生徒の目線_慣れた生徒_' + V.tag + '.png');
      await page.pressEl('#view-back');
      await page.waitFor(`document.getElementById('view').hidden`, 2000);
    }

    // 提出物：2人ともずれた → 何人もずれた・まず疑う
    await page.pressEl('#tab-subs');
    await sleep(150);
    await page.pressEl('#res-ex-b1-ex-s1-direction');
    await sleep(120);
    await page.pressEl('#res-ex-b1-ex-s2-amount');
    await sleep(120);
    await page.eval(`(() => { const m = document.getElementById('memo-ex-b1-ex-s1'); m.value = '目次だけ出てきた'; m.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await page.pressEl('#ack-ex-b1-ex-s2');
    await sleep(400);
    const subs = await page.eval(`({ crowd: (document.querySelector('.crowd') || {}).textContent || '', hypo: document.querySelectorAll('.hypo').length,
      saved: JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || 'null') })`);
    const r = subs.saved && subs.saved.boards[0].results;
    ok('提出物: 2人ずれると「2人がずれた → まず黒板を見直そう」・まず疑う特徴が2人分', /2人がずれた/.test(subs.crowd) && subs.hypo === 2, JSON.stringify(subs.crowd));
    ok('提出物の記録が保存される（ずれ・メモ・認める一言）', !!r && r['ex-s1'].kind === 'direction' && r['ex-s1'].memo === '目次だけ出てきた' && r['ex-s2'].ack === true, JSON.stringify(r));
    ok('提出物: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
    await page.eval('window.scrollTo(0, 0); true');
    await page.shot('03_提出物_' + V.tag + '.png', true);

    // 先生の通知表
    await page.pressEl('#tab-report');
    await sleep(200);
    const rep = await page.eval(`({ pos: (document.querySelector('.pos b') || {}).textContent, dots: document.querySelectorAll('.map .pt').length, words: [...document.querySelectorAll('.word')].map((w) => w.textContent) })`);
    ok('通知表: 見本の黒板が点1つ・位置は「やさしいだけ」（認める一言を送ったので）・あいまいな言葉2つ', rep.pos === 'やさしいだけ' && rep.dots === 1 && rep.words.length === 2, JSON.stringify(rep));
    ok('通知表: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
    await page.shot('04_通知表_' + V.tag + '.png', true);

    // 生徒カード（見本の「はじめての生徒」を開く）
    await page.pressEl('#tab-room');
    await sleep(150);
    await page.pressEl('button.desk[data-sid="ex-s1"]');
    await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
    await page.eval(`document.getElementById('view-edit-card').scrollIntoView({ block: 'center' }); true`);
    await page.pressEl('#view-edit-card');
    await page.waitFor(`!document.getElementById('sheet-card').hidden`, 2000);
    await sleep(500);
    const card = await page.eval(`({ title: document.getElementById('card-title').textContent, name: document.getElementById('card-name').value,
      checked: ['q1','q2','q3','q4','q5'].map((q) => (document.querySelector('input[name="card-' + q + '"]:checked') || {}).value).join(''),
      pre: document.getElementById('card-preface').textContent })`);
    ok('生徒カード: 見本の答え（A・C・B・C・C）が入っていて、前置きに名前が入る', card.title === '生徒カード' && card.checked === 'ACBCC' && card.pre.indexOf('いまのはじめての生徒さん') >= 0, JSON.stringify(card));
    ok('生徒カード: 横にはみ出さない', (await page.eval(`document.getElementById('sheet-card').scrollWidth - document.getElementById('sheet-card').clientWidth`)) <= 0);
    await page.shot('05_生徒カード_' + V.tag + '.png');
    // Q1 を B に直して保存 → 履歴に残り、席が中ほどへ
    await page.eval(`document.getElementById('card-q1-b').click(); true`);
    await page.eval(`document.getElementById('card-submit').click(); true`);
    await sleep(300);
    const after = await page.eval(`({ seat: document.querySelector('button.desk[data-sid="ex-s1"]').closest('.row').dataset.seat,
      hist: JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).students.find((s) => s.id === 'ex-s1').history })`);
    ok('カードの Q1 を B に直すと中ほどの席へ・前の答えは履歴に残る', after.seat === 'middle' && after.hist.length === 1 && after.hist[0].answers.q1 === 'A', JSON.stringify(after));

    // 書き出す
    await page.pressEl('#tab-export');
    await sleep(200);
    const md = await page.eval(`document.getElementById('export-text').value`);
    ok('書き出す: 自分の癖と生徒ごとの記録が入る', md.indexOf('## 自分の癖') >= 0 && md.indexOf('### 見本：はじめての生徒') >= 0 && md.indexOf('カードの書き直し') >= 0, md.slice(0, 120));
    ok('書き出す: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
    await page.shot('06_書き出す_' + V.tag + '.png', true);
    await page.pressEl('#tab-room');
  }

  section('そのほか');
  // 黒板に書く（新しく書く → 教室の黒板に映る・提出物に増える）
  await page.viewport(390, 844, true, false, false);
  await page.load(base);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = 'また雑。明日10時までにA4 1枚で直して'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const live = await page.eval(`document.getElementById('room-chalk').textContent`);
  ok('書いている字が、そのまま教室の黒板に映る', live === 'また雑。明日10時までにA4 1枚で直して', live);
  await page.shot('07_黒板に書く_390_light.png');
  await page.eval(`document.getElementById('first-ex-s2').click(); document.getElementById('write-submit').click(); true`);
  await sleep(300);
  const nb = await page.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
  ok('黒板に書くと保存され、いまの黒板になる（「初めての作業」も保存）', nb.boards.length === 2 && nb.currentId === nb.boards[1].id && nb.boards[1].firstTime['ex-s2'] === true, JSON.stringify(nb.boards.map((b) => b.text)));
  await page.pressEl('button.desk[data-sid="ex-s2"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(400);
  const vb = await page.eval(VIEW);
  ok('「初めての作業」にした慣れた生徒は、この黒板では後ろの席から見える', vb.seat === 'back', JSON.stringify(vb));
  ok('責める言葉 → 先生の顔がかたい', vb.face === 'stiff', vb.face);
  await page.shot('08_生徒の目線_責める言葉_390_light.png');
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);

  // ---- 2026-10-17 追加：左右ばらばらの席・席替え・いちばん強い選択肢・提出と「これまでの提出物」 ----
  const seatIdx = await page.eval(`(() => { const idx = (seat, sid) => [...document.querySelectorAll('.row[data-seat="' + seat + '"] .row-desks > *')].findIndex((el) => el.dataset && el.dataset.sid === sid);
    return [idx('front', 'ex-s2'), idx('back', 'ex-s1')]; })()`);
  ok('席: 見本の生徒は左右ばらばら（慣れた生徒＝前の2番目・はじめての生徒＝後ろの3番目）', seatIdx[0] === 1 && seatIdx[1] === 2, JSON.stringify(seatIdx));
  await page.eval(`document.getElementById('room-shuffle').click(); true`);
  await sleep(250);
  const sh = await page.eval(`({ n: document.querySelectorAll('button.desk').length, cols: JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).students.map((s) => s.col),
    toast: document.getElementById('toast').classList.contains('is-on') })`);
  ok('席替え: 生徒は2人のまま、左右の席（0〜4）が決まり直す', sh.n === 2 && sh.cols.every((c) => Number.isInteger(c) && c >= 0 && c < 5) && sh.toast, JSON.stringify(sh));
  await page.eval(`document.getElementById('btn-add-student').click(); true`);
  await page.waitFor(`!document.getElementById('sheet-card').hidden`, 2000);
  await sleep(300);
  const eopts = await page.eval(`({ n: ['q1','q2','q3','q4','q5'].map((q) => document.querySelectorAll('input[name="card-' + q + '"]').length),
    q2e: document.getElementById('card-q2-e') ? document.getElementById('card-q2-e').closest('label').textContent : '' })`);
  ok('生徒カード: Q1 は4択、Q2〜Q5 はいちばん強い段つきの5択', JSON.stringify(eopts.n) === '[4,5,5,5,5]' && eopts.q2e.indexOf('こちらから聞くまで') >= 0, JSON.stringify(eopts));
  await page.eval(`document.querySelector('#sheet-card [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-card').hidden`, 2000);
  await page.pressEl('#tab-subs');
  await sleep(200);
  await page.eval(`document.getElementById('res-ex-b1-ex-s1-direction').click(); true`);
  await sleep(150);
  const en = await page.eval(`!document.getElementById('submit-ex-b1-ex-s1').disabled`);
  await page.eval(`document.getElementById('submit-ex-b1-ex-s1').click(); true`);
  await sleep(250);
  const p1 = await page.eval(`({ done: !!document.querySelector('.sub-card[data-bid="ex-b1"] .sub-row.is-done'),
    tag: [...document.querySelectorAll('.sub-card[data-bid="ex-b1"] .sub-date .tag')].map((t) => t.textContent).join('|') })`);
  ok('提出物: 返ってきたものを選ぶと「提出」が押せて、押すと「提出済み」・提出 1/2', en && p1.done && p1.tag.indexOf('提出 1/2') >= 0, JSON.stringify(p1));
  await page.eval(`document.getElementById('res-ex-b1-ex-s2-amount').click(); true`);
  await sleep(150);
  await page.eval(`document.getElementById('submit-ex-b1-ex-s2').click(); true`);
  await sleep(300);
  const p2 = await page.eval(`({ arc: document.querySelectorAll('.arc-card').length, arcB1: !!document.querySelector('.arc-card[data-bid="ex-b1"]'),
    closed: JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).boards.find((b) => b.id === 'ex-b1').closedAt > 0 })`);
  ok('全員の提出がそろうと、その黒板は「これまでの提出物」に完結した形で入る', p2.arc === 1 && p2.arcB1 && p2.closed, JSON.stringify(p2));
  const nbid = await page.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).boards.find((b) => b.id !== 'ex-b1').id`);
  await page.eval(`document.querySelector('.sub-card[data-bid="${nbid}"] [data-act="close"]').click(); true`);
  await page.waitFor(`!document.getElementById('confirm').hidden`, 2000);
  await page.eval(`document.getElementById('confirm-yes').click(); true`);
  await sleep(300);
  const p3 = await page.eval(`({ arc: document.querySelectorAll('.arc-card').length, unsent: document.querySelectorAll('.arc-card .unsent').length })`);
  ok('「締める」で、未提出の人は「未提出のまま締めた」と残して「これまでの提出物」へ', p3.arc === 2 && p3.unsent === 2, JSON.stringify(p3));
  ok('提出物（これまでの提出物つき）: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.eval(`document.querySelector('.arc').scrollIntoView(); true`);
  await sleep(200);
  await page.shot('09_これまでの提出物_390_light.png');
  await page.eval(`document.querySelector('.arc-card[data-bid="ex-b1"] [data-act="reopen"]').click(); true`);
  await sleep(300);
  const p4 = await page.eval(`({ arc: document.querySelectorAll('.arc-card').length, open: !!document.querySelector('.sub-card:not(.arc-card)[data-bid="ex-b1"]') })`);
  ok('「開き直す」で記録の途中に戻る', p4.arc === 1 && p4.open, JSON.stringify(p4));

  // 動きを減らす設定：ふわっと → 短いフェード
  await page.viewport(390, 844, true, false, true);
  await page.load(base);
  const rm = await page.eval(`(() => { const s = getComputedStyle(document.getElementById('view')); return { d: s.transitionDuration, f: s.filter }; })()`);
  ok('動きを減らす設定では、切り替えは 0.15 秒のフェードだけ（ぼかしなし）', /^0\.15s/.test(rm.d) && rm.f === 'none', JSON.stringify(rm));
  // ライトの端末でも data-theme="dark" ならダーク
  await page.viewport(1280, 800, false, false, false);
  await page.load(base);
  const forced = await page.eval(`(() => { document.documentElement.dataset.theme = 'dark'; return getComputedStyle(document.body).backgroundColor; })()`);
  ok('data-theme="dark" をつけるとダークになる（端末がライトでも）', forced === 'rgb(18, 24, 21)', forced);
  const forcedL = await page.eval(`(() => { document.documentElement.dataset.theme = 'light'; return getComputedStyle(document.body).backgroundColor; })()`);
  ok('data-theme="light" をつけるとライトになる', forcedL === 'rgb(238, 242, 239)', forcedL);
  // localStorage が使えなくても見本で動く
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });` });
  await page.load(base);
  ok('localStorage が使えなくても、見本の教室が出る', (await page.eval(`document.querySelectorAll('button.desk').length`)) === 2);
} catch (e) {
  ok('検査が最後まで走る', false, e.message);
} finally {
  await closeBrowser(proc, port, browserPath);
  srv.close();
  for (let i = 0; i < 20; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (e) { await sleep(250); } }
}

section('まとめ');
ok('コンソールのエラー・例外が 0 件', errors.length === 0, errors.slice(0, 5).join(' / '));
ok('Google Fonts 以外への通信が 0 件', outside.length === 0, outside.slice(0, 5).join(' / '));
console.log('  フォント（Klee One・Zen Maru Gothic）の読み込み: ' + (fontsOk ? 'できた' : 'できなかった（代わりのフォントで表示）'));
console.log('\n' + (fails.length ? '通らなかった: ' + fails.length + ' 件 ／ 通った: ' + pass + ' 件' : 'すべて通った: ' + pass + ' 件'));
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
