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
/* v0.3：時間割・教室の伝え方（黒板の注記・プリント・スピーカー）・伝え方ごとの生徒の目線 */
const TT = `(() => ({ title: document.getElementById('tt-title').textContent,
  rows: [...document.querySelectorAll('#tt-list .tt-row')].map((r) => r.querySelector('.tt-p').textContent + ' ' + r.querySelector('.tt-s').textContent + '・' + r.querySelector('.tt-ch').textContent),
  now: [...document.querySelectorAll('#tt-list .tt-row.is-now')].map((r) => r.dataset.bid),
  empty: document.getElementById('tt-empty').hidden ? '' : document.getElementById('tt-empty').textContent,
  prev: !document.getElementById('tt-prev').disabled, next: !document.getElementById('tt-next').disabled }))()`;
const ROOM = `(() => { const say = document.getElementById('room-say'), pr = document.getElementById('room-print'), st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || 'null');
  return { chalk: document.getElementById('room-chalk').textContent, print: pr.hidden ? '' : document.getElementById('room-print-text').textContent,
    printHead: pr.hidden ? '' : pr.querySelector('.print-head').textContent,
    say: say.hidden ? '' : document.getElementById('room-say-text').textContent, sayK: document.getElementById('room-say-k').textContent,
    sayOp: say.hidden ? 0 : Number(getComputedStyle(say).opacity), speaker: !document.getElementById('room-speaker').disabled, cur: st && st.currentId }; })()`;
const LAYOUT = `(() => { const b = document.getElementById('room-board').getBoundingClientRect(), t = document.getElementById('room-tt').getBoundingClientRect(), s = document.getElementById('room-speaker').getBoundingClientRect();
  return { right: t.left >= b.right - 1 && t.top < b.bottom, below: t.top >= b.bottom - 1, speakerAbove: s.bottom <= b.top + 1 }; })()`;
const VIEW2 = `(() => { const q = (s) => document.querySelector(s), blur = q('#view-pa-text .m-blur, #view-papers .paper.is-top .m-blur, #view-chalk .m-blur');
  return { ch: document.getElementById('scene').dataset.ch, desk: !document.getElementById('view-desk').hidden,
    papers: document.querySelectorAll('#view-papers .paper').length, under: document.querySelectorAll('#view-papers .paper.is-under').length,
    paper: (q('#view-papers .paper.is-top .paper-text') || {}).textContent || '', cap: document.getElementById('view-desk-cap').hidden ? '' : document.getElementById('view-desk-cap').textContent,
    deskBubbles: document.querySelectorAll('#bub-c .q-bubble, #bub-d .q-bubble').length, boardBubbles: document.querySelectorAll('#bub-a .q-bubble, #bub-b .q-bubble').length,
    pa: !document.getElementById('view-pa').hidden, paText: document.getElementById('view-pa-text').textContent, paOp: Number(getComputedStyle(q('#view-pa .pa-text')).opacity),
    chalk: document.getElementById('view-chalk').textContent, myDesk: !!q('#view-floor .my-desk'),
    voices: [...document.querySelectorAll('#view-voices li')].map((x) => x.textContent), day: [...document.querySelectorAll('#view-day-voices li')].map((x) => x.dataset.key),
    ask: document.getElementById('view-ask').textContent, chips: [...document.querySelectorAll('#view-chips button')].map((b) => b.textContent.trim()),
    vtt: [...document.querySelectorAll('#view-tt-list .tt-row')].map((r) => r.dataset.bid + (r.classList.contains('is-now') ? '*' : '')), vttK: document.getElementById('view-tt-k').textContent,
    blur: blur ? blur.style.getPropertyValue('--b') : '', overflowX: document.getElementById('view').scrollWidth - document.getElementById('view').clientWidth }; })()`;
const SAVED = `JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`;
/* 2026-10-18 調整 K：先生の中心と大きい黒板の中心の差（px）・生徒の目線の時計と黒板の日付の四角 */
const TEACHER = `(() => { const t = document.getElementById('room-teacher').getBoundingClientRect(), b = document.getElementById('room-board').getBoundingClientRect();
  return Math.round((t.left + t.width / 2) - (b.left + b.width / 2)); })()`;
const CLOCKDATE = `(() => { const c = document.getElementById('view-clock'), r = c.getBoundingClientRect(), d = document.getElementById('view-date').getBoundingClientRect();
  return { shown: !c.hidden, size: c.dataset.size, clock: [r.left, r.top, r.right, r.bottom].map(Math.round), date: [d.left, d.top, d.right, d.bottom].map(Math.round),
    overlap: !c.hidden && !(r.right <= d.left || d.right <= r.left || r.bottom <= d.top || d.bottom <= r.top) }; })()`;
/* 頼みごとを出すシート：伝え方・科目名・相手・初めての作業・文・元の放送の文 */
const SHEET = `(() => ({ open: !document.getElementById('sheet-write').hidden, title: document.getElementById('write-title').textContent,
  ch: (document.querySelector('input[name="write-ch"]:checked') || {}).value, subj: (document.querySelector('input[name="write-subj"]:checked') || {}).value || '',
  free: document.getElementById('write-subject').value, text: document.getElementById('write-text').value,
  tgt: [...document.querySelectorAll('#write-targets input[data-kind="tgt"]')].map((x) => x.dataset.sid + (x.checked ? '+' : '-')),
  first: [...document.querySelectorAll('#write-targets input[data-kind="first"]:checked')].map((x) => x.dataset.sid),
  cast: document.getElementById('write-cast').hidden ? '' : document.getElementById('write-cast').textContent }))()`;

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
    // 2026-10-18 調整 K: 先生と教卓は、大きい黒板の真ん中の下（パソコンでは右に時間割があっても）
    const dxT = await page.eval(TEACHER);
    ok('先生と教卓は大きい黒板の真ん中の下（中心の差 ' + dxT + 'px・±8px 以内）', Math.abs(dxT) <= 8, String(dxT));

    // 生徒の目線（見本の「はじめての生徒」）
    await page.pressEl('button.desk[data-sid="ex-s1"]');
    await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
    await sleep(500);
    let v = await page.eval(VIEW);
    ok('机を押すと、その生徒の目線にふわっと切り替わる', v.open && v.title === 'はじめての生徒さんの目線', JSON.stringify(v));
    ok('はじめての生徒: 後ろの席・先生は忙しそう・時計は大・吹き出し7・心の声4・にじむ言葉2', v.seat === 'back' && v.face === 'busy' && v.clock === 2 && v.bubbles === 7 && v.voices === 4 && v.blur === 2, JSON.stringify(v));
    ok('本人に聞くなら「『簡単に』って…」', v.ask === '「簡単に」って、どれくらいのつもりで受け取った？', v.ask);
    ok('生徒の目線: 横にはみ出さない', v.overflowX <= 0 && (await page.eval(OVERFLOW)) <= 0, String(v.overflowX));
    const cd = await page.eval(CLOCKDATE);
    ok('生徒の目線: 大きい時計と黒板の日付の四角が重ならない', cd.shown && cd.size === '2' && !cd.overlap, JSON.stringify(cd));
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
    // v0.3 から見本の頼みごとは3つ（1限 黒板・2限 お便り・3限 放送）なので、点は3つ
    ok('通知表: 見本の頼みごと3つが点3つ・位置は「やさしいだけ」（認める一言を送ったので）・あいまいな言葉2つ', rep.pos === 'やさしいだけ' && rep.dots === 3 && rep.words.length === 2, JSON.stringify(rep));
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

    // ---- v0.3 第1段：時間割と3つの伝え方（見本に戻してから） ----
    await page.eval('localStorage.clear(); true');
    await page.load(base);
    const tt = await page.eval(TT), lay = await page.eval(LAYOUT);
    ok('時間割: 見本の3つ（1限 授業・黒板／2限 手伝い・お便り／3限 雑務・放送）が出した順に並び、いまの1限が強調', tt.title === '今日の時間割' &&
      JSON.stringify(tt.rows) === JSON.stringify(['1限 授業・黒板', '2限 手伝い・お便り', '3限 雑務・放送']) && JSON.stringify(tt.now) === '["ex-b1"]' && !tt.prev && !tt.next, JSON.stringify(tt));
    ok('時間割の小黒板は ' + (V.w >= 760 ? '大きい黒板の右' : '大きい黒板の下（横長）') + '・スピーカーは黒板の上', (V.w >= 760 ? lay.right : lay.below) && lay.speakerAbove, JSON.stringify(lay));
    await page.eval('window.scrollTo(0, 0); true');
    await sleep(150);
    await page.shot('10_時間割のある教室_' + V.tag + '.png');
    // お便り：時間割の2限を押す → 大きい黒板は「（お便りで配った）」、教卓の前に白いプリント
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b2"]');
    await sleep(250);
    let rm = await page.eval(ROOM);
    ok('時間割の行（2限）を押すと、大きい黒板がその頼みに切り替わる（いまの黒板＝2限・強調も移る）', rm.cur === 'ex-b2' && JSON.stringify((await page.eval(TT)).now) === '["ex-b2"]', JSON.stringify(rm));
    ok('お便り: 大きい黒板には「（お便りで配った）」と小さく、教卓の前に「おたより」のプリント（本文は頼みの文）', /（お便りで配った）/.test(rm.chalk) && /^おたより/.test(rm.printHead) &&
      rm.print === '来週の準備で、資料の印刷を手伝ってもらえると助かります' && !rm.speaker, JSON.stringify(rm));
    ok('お便り: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
    await page.shot('11_お便り_' + V.tag + '.png', true);
    // 放送：3限を押す → スピーカーから文字が吹き出しで出て、3秒ほどで薄れて消える
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b3"]');
    await page.eval('window.scrollTo(0, 0); true');
    await sleep(550);
    rm = await page.eval(ROOM);
    ok('放送: 時間割の3限を押すと、スピーカーから文字が吹き出しで出る（放送中…）', rm.cur === 'ex-b3' && rm.say === 'あとで部屋の片づけ、お願いね' && rm.sayK === '放送中…' && rm.sayOp > 0.6 && rm.speaker, JSON.stringify(rm));
    await page.shot('12_放送_' + V.tag + '.png');
    const gone = await page.waitFor(`document.getElementById('room-say').hidden`, 4500);
    rm = await page.eval(ROOM);
    ok('放送: 3秒ほどで薄れて消え、大きい黒板には「（放送で伝えた）」だけが残る', gone && rm.say === '' && /（放送で伝えた）/.test(rm.chalk) && rm.print === '', JSON.stringify(rm));
    await page.pressEl('#room-speaker');
    await sleep(300);
    ok('放送: スピーカーを押すと、もう一度流れる', (await page.eval(ROOM)).say === 'あとで部屋の片づけ、お願いね');
    ok('放送: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
    // お便りの生徒の目線：机の上の紙
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b2"]');
    await sleep(150);
    await page.pressEl('button.desk[data-sid="ex-s1"]');
    await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
    await sleep(300);
    let v2 = await page.eval(VIEW2);
    ok('お便りの目線: 頼みは机の上の紙（1枚）に見え、「？」の吹き出しは紙のまわり・黒板には「（お便りで配った）」', v2.ch === 'letter' && v2.desk && v2.papers === 1 && v2.under === 0 &&
      v2.paper === '来週の準備で、資料の印刷を手伝ってもらえると助かります' && v2.deskBubbles === 6 && v2.boardBubbles === 0 && /（お便りで配った）/.test(v2.chalk) && !v2.myDesk && !v2.pa, JSON.stringify(v2));
    ok('目線の上に「今日この生徒に降ってきた頼み」の小さな時間割（3つ・いま見ている2限を強調）', v2.vttK === '今日この生徒に降ってきた頼み' && JSON.stringify(v2.vtt) === '["ex-b1","ex-b2*","ex-b3"]', JSON.stringify(v2.vtt));
    // 2026-10-18 調整: その日の心の声は 放送だけ → 3本以上 → 割り込み → 黒板とお便り の順で3つまで（見本は1限・2限とも提出の前なので割り込みが入り、4つ目の黒板とお便りは出ない）
    ok('その日の頼みから足す心の声: 放送だけ（3限）・3本以上・割り込み の3つ（4つ目は出さない）', JSON.stringify(v2.day) === '["castOnly","many","interrupt"]', JSON.stringify(v2.day));
    ok('… その日の足すとよいものは頼みごとのもの（5つ）の後ろに足して、全部で6つまで（6つ目に「今日の順番」）', v2.chips.length === 6 &&
      v2.chips[5] === '＋ 今日の順番：先に◯◯、◯◯は明日でいいよ', JSON.stringify(v2.chips));
    ok('お便りの目線: 横にはみ出さない', v2.overflowX <= 0 && (await page.eval(OVERFLOW)) <= 0);
    if (V.tag === '390_light') {
      await page.eval(`(() => { const v = document.getElementById('view'); v.scrollTop = document.getElementById('voices-h').getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - 12; return true; })()`);
      await sleep(200);
      await page.shot('19_その日の心の声_390_light.png');
    }
    await page.eval(`(() => { const v = document.getElementById('view'); v.scrollTop = ${V.w >= 760 ? 0 : `document.getElementById('view-desk').offsetTop - 170`}; return true; })()`);
    await sleep(200);
    await page.shot('13_お便りの生徒の目線_' + V.tag + '.png');
    // 放送の生徒の目線：小さな時間割の3限を押すと切り替わる
    await page.eval(`document.getElementById('view').scrollTop = 0; true`);
    await page.pressEl('#view-tt-list .tt-row[data-bid="ex-b3"]');
    await sleep(250);
    await page.eval(`document.getElementById('view').scrollTop = 0; true`);
    v2 = await page.eval(VIEW2);
    ok('小さな時間割の3限を押すと、放送の目線に切り替わる（強調も3限へ）', v2.ch === 'broadcast' && JSON.stringify(v2.vtt) === '["ex-b1","ex-b2","ex-b3*"]', JSON.stringify(v2));
    ok('放送の目線: スピーカーの文字が薄れたあと（文字はうすい）・黒板には「（放送で伝えた）」', v2.pa && v2.paText.indexOf('あとで部屋の片づけ、お願いね') === 0 && v2.paOp < 0.6 && /（放送で伝えた）/.test(v2.chalk) && !v2.desk, JSON.stringify(v2));
    // 2026-10-18 調整: はじめての生徒（Q1 A）への放送は「慣れていない生徒に放送」の聞く一言（やり方）が先。足すものは「要点をお便りでも送る」
    ok('放送の目線: 心の声「さっき何て言ってた…？」・本人に聞くなら「やり方で…」（慣れていない生徒）・足すとよいもの「要点をお便りでも送る」', v2.voices[0] === 'さっき何て言ってた…？ メモしてないと忘れるかも' &&
      v2.ask === 'やり方で、分からないところある？' && v2.chips[0] === '要点をお便りでも送る', JSON.stringify([v2.voices, v2.ask, v2.chips]));
    ok('放送の目線: その日の心の声は、見ている放送を「放送だけ」に数えない（3本以上・割り込み・黒板とお便り）', JSON.stringify(v2.day) === '["many","interrupt","boardLetter"]', JSON.stringify(v2.day));
    ok('放送の目線: 横にはみ出さない', v2.overflowX <= 0 && (await page.eval(OVERFLOW)) <= 0);
    await page.shot('14_放送の生徒の目線_' + V.tag + '.png');
    await page.pressEl('#view-back');
    await page.waitFor(`document.getElementById('view').hidden`, 2000);
    // 頼みごとを出すシート（伝え方3つ・科目名のチップと自由記述）
    await page.pressEl('#btn-write');
    await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
    await sleep(300);
    const sh = await page.eval(`({ title: document.getElementById('write-title').textContent, chs: [...document.querySelectorAll('input[name="write-ch"]')].map((x) => x.value + (x.checked ? '*' : '')),
      subj: [...document.querySelectorAll('input[name="write-subj"]')].map((x) => x.value + (x.checked ? '*' : '')), free: !!document.getElementById('write-subject'),
      ow: document.getElementById('sheet-write').scrollWidth - document.getElementById('sheet-write').clientWidth })`);
    ok('頼みごとを出すシート: 伝え方3つ（初めは黒板）・科目名5つのチップ（初めは授業）と自分で書く欄', sh.title === '頼みごとを出す' && JSON.stringify(sh.chs) === '["board*","letter","broadcast"]' &&
      JSON.stringify(sh.subj) === '["ゼミ","授業*","雑務","手伝い","その他"]' && sh.free && sh.ow <= 0, JSON.stringify(sh));
    await page.eval(`(() => { document.getElementById('write-ch-letter').click(); document.getElementById('write-subj-0').click(); const t = document.getElementById('write-text');
      t.value = '金曜の会議の資料を、A4 1枚にまとめてもらえると助かります'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(200);
    ok('シートでお便りを選ぶと、書いている文が教卓の前のプリントに映る', (await page.eval(ROOM)).print === '金曜の会議の資料を、A4 1枚にまとめてもらえると助かります');
    await page.shot('15_頼みごとを出すシート_' + V.tag + '.png');
    await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
    await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
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
  ok('頼みごとを出すと保存され、いまの黒板になる（「初めての作業」も保存。見本3つの次の4つ目）', nb.boards.length === 4 && nb.currentId === nb.boards[3].id && nb.boards[3].firstTime['ex-s2'] === true, JSON.stringify(nb.boards.map((b) => b.text)));
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
  const nbid = await page.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).boards.find((b) => !/^ex-/.test(b.id)).id`);
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

  // ---- v0.3 第1段：頼みごとを出す（伝え方・自分で書く科目名）・直す・「お便り（文字）でも送る」・重なるお便り ----
  await page.viewport(390, 844, true, false, false);
  await page.load(base);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { document.getElementById('write-ch-letter').click(); const s = document.getElementById('write-subject'); s.value = '読書会'; s.dispatchEvent(new Event('input', { bubbles: true }));
    const t = document.getElementById('write-text'); t.value = 'これ、ざっと読んでおいて。金曜までに'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const wst = await page.eval(`({ checked: document.querySelectorAll('input[name="write-subj"]:checked').length, slate: document.getElementById('write-slate').dataset.ch, lbl: document.getElementById('write-text-lbl').textContent })`);
  ok('科目名を自分で書くとチップの選択は外れる・お便りを選ぶと書く欄が白い紙になる', wst.checked === 0 && wst.slate === 'letter' && /お便り/.test(wst.lbl), JSON.stringify(wst));
  await page.eval(`document.getElementById('write-submit').click(); true`);
  await sleep(300);
  let st3 = await page.eval(SAVED);
  const nl = st3.boards[st3.boards.length - 1];
  ok('お便り・自分で書いた科目名「読書会」で出すと保存され、時間割の4限に入って強調される', nl.channel === 'letter' && nl.subject === '読書会' && st3.currentId === nl.id &&
    (await page.eval(TT)).rows[3] === '4限 読書会・お便り' && (await page.eval(TT)).now[0] === nl.id, JSON.stringify(nl));
  await page.pressEl('#room-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  const ed = await page.eval(`({ title: document.getElementById('write-title').textContent, ch: document.querySelector('input[name="write-ch"]:checked').value,
    free: document.getElementById('write-subject').value, chip: document.querySelectorAll('input[name="write-subj"]:checked').length, text: document.getElementById('write-text').value })`);
  ok('「直す」で開くと、伝え方・科目名（自分で書いた名前）・文がそのまま入っている', ed.title === '頼みごとを直す' && ed.ch === 'letter' && ed.free === '読書会' && ed.chip === 0 && ed.text === 'これ、ざっと読んでおいて。金曜までに', JSON.stringify(ed));
  await page.eval(`(() => { document.getElementById('write-ch-broadcast').click(); document.getElementById('write-subj-0').click(); return true; })()`);
  await sleep(100);
  ok('直す途中でチップ（ゼミ）を選ぶと、自分で書いた欄は空になる', (await page.eval(`document.getElementById('write-subject').value`)) === '');
  await page.eval(`(() => { document.getElementById('first-ex-s2').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(400);
  st3 = await page.eval(SAVED);
  const eb = st3.boards.find((b) => b.id === nl.id);
  ok('「直す」で伝え方（お便り→放送）と科目名（読書会→ゼミ）を書き換えられる（時限は4限のまま）', eb.channel === 'broadcast' && eb.subject === 'ゼミ' && st3.boards.length === 4 &&
    (await page.eval(TT)).rows[3] === '4限 ゼミ・放送', JSON.stringify(eb));
  ok('放送に直すと、スピーカーから流れる', (await page.eval(ROOM)).say === 'これ、ざっと読んでおいて。金曜までに');
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(300);
  const vb2 = await page.eval(VIEW2);
  // 2026-10-18 調整: はじめての生徒（Q1 A）への放送は ×1.5 に＋0.3 で ×1.8。足すものは「要点をお便りでも送る」
  ok('放送の目線: あいまいな言葉のにじみは強め（はじめての生徒は慣れていない生徒への放送なので 3.6px × 1.8 → 6.5px）', vb2.ch === 'broadcast' && vb2.blur === '6.5px', JSON.stringify(vb2));
  ok('放送の目線: お便りのない放送（3限）があるので「放送で聞いたことは、忘れるかも」、この放送にもお便りがないので「要点をお便りでも送る」が出る', vb2.day.indexOf('castOnly') >= 0 && vb2.chips[0] === '要点をお便りでも送る', JSON.stringify([vb2.day, vb2.chips]));
  // 要点をお便りでも送る → 生徒の目線を閉じて、要点の下書きでお便りのシートを開く
  const POINT = '（さっきの放送の要点）\n何を：◯◯\nいつまで：◯◯';
  const sheetUp = `!document.getElementById('sheet-write').hidden && document.getElementById('view').hidden`;
  await page.pressEl('#view-chips [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(350);
  const sp = await page.eval(SHEET);
  ok('「要点をお便りでも送る」で、生徒の目線を閉じてシートが開く（伝え方はお便り・科目名と相手と初めての作業は元の放送と同じ）', sp.open && sp.title === '頼みごとを出す' && sp.ch === 'letter' &&
    sp.subj === 'ゼミ' && sp.free === '' && JSON.stringify(sp.tgt) === '["ex-s1+","ex-s2+"]' && JSON.stringify(sp.first) === '["ex-s2"]', JSON.stringify(sp));
  ok('… 文は要点の下書き（何を・いつまで）。書く欄の下に元の放送の文と「要点だけ書くと残りやすい」', sp.text === POINT &&
    sp.cast === 'さっきの放送：「これ、ざっと読んでおいて。金曜までに」要点だけ書くと残りやすい', JSON.stringify([sp.text, sp.cast]));
  await page.shot('18_要点のお便りシート_390_light.png');
  await page.eval(`document.getElementById('write-ch-board').click(); true`);
  const hid = await page.eval(SHEET);
  await page.eval(`document.getElementById('write-ch-letter').click(); true`);
  ok('伝え方をお便り以外（黒板）に変えると元の放送の文は隠れ、お便りに戻すとまた出る', hid.cast === '' && (await page.eval(SHEET)).cast !== '', JSON.stringify(hid));
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = '何を：資料を読む\\nいつまで：金曜まで'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-submit').click(); return true; })()`);
  await sleep(400);
  st3 = await page.eval(SAVED);
  const pl = st3.boards[st3.boards.length - 1];
  ok('出すと、元の放送の id（fromCast）つきのお便りが時間割の5限に入る（同じ文の書き写しは作らない）', st3.boards.length === 5 && pl.channel === 'letter' && pl.fromCast === eb.id &&
    pl.subject === 'ゼミ' && pl.text === '何を：資料を読む\nいつまで：金曜まで' && JSON.stringify(pl.targets) === JSON.stringify(eb.targets) && pl.firstTime['ex-s2'] === true &&
    (await page.eval(TT)).rows[4] === '5限 ゼミ・お便り', JSON.stringify(pl));
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await page.pressEl('#view-tt-list .tt-row[data-bid="' + eb.id + '"]');
  await sleep(250);
  const v4 = await page.eval(VIEW2);
  ok('… 4限の放送の目線から「要点をお便りでも送る」は消える（3限の放送はまだお便りがないので「放送で聞いたことは、忘れるかも」は残る）', v4.ch === 'broadcast' &&
    v4.chips.indexOf('要点をお便りでも送る') < 0 && v4.day.indexOf('castOnly') >= 0, JSON.stringify([v4.day, v4.chips]));
  // 書きかけの頼みがあるときは上書きしない
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = '書きかけのメモ'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sheet-write [data-close]').click(); return true; })()`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b3"]');
  await sleep(200);
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await page.pressEl('#view-chips [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(200);
  const sd = await page.eval(SHEET), tmsg = await page.eval(`document.getElementById('toast-msg').textContent`);
  ok('書きかけの頼みがあるときは上書きしない（書きかけのまま開いて「書きかけの頼みごとがあるよ…」と知らせる）', sd.text === '書きかけのメモ' && sd.cast === '' &&
    tmsg === '書きかけの頼みごとがあるよ。出すか消してから、もう一度押してね', JSON.stringify([sd, tmsg]));
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sheet-write [data-close]').click(); return true; })()`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await page.pressEl('#view-chips [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(200);
  const s3 = await page.eval(SHEET);
  ok('書きかけを消してからもう一度押すと、要点の下書きで開く（3限 雑務・元の放送の文）', s3.text === POINT && s3.subj === '雑務' && s3.cast.indexOf('あとで部屋の片づけ、お願いね') >= 0, JSON.stringify(s3));
  // 要点の下書きに手をつけずに閉じたら、書きかけは残さない（次の「要点をお便りでも送る」を止めないため）
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  const sx = await page.eval(SHEET);
  ok('要点の下書きに手をつけずに閉じると、書きかけは残らない（「頼みごとを出す」は空・黒板・元の放送の文なしで開く）', sx.text === '' && sx.ch === 'board' && sx.cast === '', JSON.stringify(sx));
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await page.pressEl('#view-chips [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(200);
  ok('… もう一度押すと、止められずに要点の下書きで開く', (await page.eval(SHEET)).text === POINT);
  await page.eval(`document.getElementById('write-submit').click(); true`);
  await sleep(400);
  st3 = await page.eval(SAVED);
  const pl3 = st3.boards[st3.boards.length - 1];
  ok('… 出すと fromCast＝3限のお便りが6限に入る', pl3.fromCast === 'ex-b3' && pl3.channel === 'letter' && pl3.subject === '雑務' && (await page.eval(TT)).rows[5] === '6限 雑務・お便り', JSON.stringify(pl3));
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(200);
  const vz = await page.eval(VIEW2);
  ok('どの放送にも要点のお便りがあるので、その日の「放送で聞いたことは、忘れるかも」が消える（6限を見る: 3本以上・割り込み・黒板とお便り）', vz.ch === 'letter' &&
    JSON.stringify(vz.day) === '["many","interrupt","boardLetter"]', JSON.stringify(vz.day));
  await page.pressEl('#view-tt-list .tt-row[data-bid="ex-b2"]');
  await sleep(250);
  const vs = await page.eval(VIEW2);
  ok('その日のお便りが2枚以上なら、机の上で紙が重なる（2限を上に、下の紙は端だけ見える・「3 枚」と出る）', vs.ch === 'letter' && vs.papers === 3 && vs.under === 2 &&
    vs.paper === '来週の準備で、資料の印刷を手伝ってもらえると助かります' && /お便り 3 枚/.test(vs.cap), JSON.stringify(vs));
  await page.eval(`(() => { const v = document.getElementById('view'); v.scrollTop = document.getElementById('view-desk').offsetTop - 170; return true; })()`);
  await sleep(200);
  await page.shot('16_お便りが重なる_390_light.png');
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  await page.pressEl('#tab-subs');
  await sleep(200);
  const lessons = await page.eval(`[...document.querySelectorAll('.sub-card .sub-date .lesson')].map((x) => x.textContent)`);
  ok('提出物のカードに時限・科目・伝え方（「2限 手伝い（お便り）」「4限 ゼミ（放送）」など）', ['1限 授業（黒板）', '2限 手伝い（お便り）', '3限 雑務（放送）', '4限 ゼミ（放送）', '5限 ゼミ（お便り）', '6限 雑務（お便り）'].every((x) => lessons.indexOf(x) >= 0), JSON.stringify(lessons));
  ok('提出物（伝え方つき）: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.pressEl('#tab-report');
  await sleep(200);
  const RCH = `({ ch: [...document.querySelectorAll('#report-ch li')].map((x) => x.textContent.replace(/\\s+/g, '')), cast: document.getElementById('report-cast').textContent.replace(/\\s+/g, ''),
    hint: (document.getElementById('report-cast-hint') || {}).textContent || '', day: ((document.getElementById('report-day') || {}).textContent || '').replace(/\\s+/g, '') })`;
  const today = await page.eval(`SekigaeEngine.ymd(Date.now())`), todayJa = today.split('-').map(Number).slice(1).join('/').replace(/^(\d+)\/(\d+)$/, '$1月$2日');
  const rch = await page.eval(RCH);
  // 2026-10-18 調整: 要点のお便りは「頼みごとを出す」から出すので見本ではなく自分の頼み（4限の放送・5限と6限のお便りの3つ）
  ok('通知表に伝え方の内訳（自分の頼み3つ: 黒板 0・お便り 2・放送 1）と「放送だけで終わった頼み 0」（0なので要点の一言は出ない）', JSON.stringify(rch.ch) === '["黒板0","お便り2","放送1"]' &&
    rch.cast === '放送だけで終わった頼み0' && rch.hint === '', JSON.stringify(rch));
  ok('通知表に「1日の頼み（いちばん多い日）3 本（' + todayJa + '）」', rch.day === '1日の頼み（いちばん多い日）3本（' + todayJa + '）', JSON.stringify(rch.day));
  await page.pressEl('#tab-export');
  await sleep(200);
  const md3 = await page.eval(`document.getElementById('export-text').value`);
  ok('書き出しに時限・科目・伝え方（「4限 ゼミ（放送）」「5限 ゼミ（お便り）」「1限 授業（黒板）（見本）」と内訳）', md3.indexOf(' 4限 ゼミ（放送）「これ、ざっと読んでおいて。金曜までに」') >= 0 &&
    md3.indexOf(' 5限 ゼミ（お便り）「') >= 0 && md3.indexOf(' 1限 授業（黒板）（見本）「') >= 0 && md3.indexOf('- 伝え方の内訳: 黒板 0・お便り 2・放送 1（放送だけで終わった頼み 0）') >= 0, md3.slice(0, 600));
  ok('書き出しに「- 1日の頼み: いちばん多い日 3 本（' + today + '）」', md3.indexOf('- 1日の頼み: いちばん多い日 3 本（' + today + '）') >= 0, md3.slice(0, 600));
  // 見本だけのとき（放送だけで終わった頼み 1）は、要点の一言が出る
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.pressEl('#tab-report');
  await sleep(200);
  const rch0 = await page.eval(RCH);
  ok('見本だけ（3限の放送にお便りがない）: 「放送だけで終わった頼み 1」の下に「要点（何を・いつまで）をお便りでも送ると、残りやすい」・1日の頼み 3 本', rch0.cast === '放送だけで終わった頼み1' &&
    rch0.hint === '要点（何を・いつまで）をお便りでも送ると、残りやすい' && rch0.day === '1日の頼み（いちばん多い日）3本（' + todayJa + '）', JSON.stringify(rch0));
  ok('通知表（新しい行つき）: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.pressEl('#tab-room');

  // 古いデータ（v0.2 までの保存。伝え方と科目名がない）も読み込める。時間割は前の日・次の日で行き来できる
  await page.eval(`(() => { const d = (back, h) => { const x = new Date(); x.setDate(x.getDate() - back); x.setHours(h, 0, 0, 0); return x.getTime(); };
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ v: 1, students: [{ id: 's1', name: '生徒A', color: 1, col: 1, answers: { q1: 'B' }, notes: {}, history: [], createdAt: d(8, 9) }],
      boards: [{ id: 'o1', text: '資料を3枚にまとめて', createdAt: d(8, 9), targets: ['s1'], firstTime: {}, results: {} }, { id: 'o2', text: '図を直して', createdAt: d(8, 15), targets: ['s1'], firstTime: {}, results: {} },
        { id: 'o3', text: '明日までに見ておいて', createdAt: d(6, 10), targets: ['s1'], firstTime: {}, results: {} }], currentId: 'o2', ui: { tab: 'room' } })); return true; })()`);
  await page.load(base);
  const old = await page.eval(`({ saved: ${SAVED}.boards.map((b) => b.id + ':' + b.channel + ':' + b.subject), tt: ${TT}, chalk: document.getElementById('room-chalk').textContent })`);
  ok('古いデータ（伝え方・科目名なし）も読み込み、黒板・授業として保存し直す', JSON.stringify(old.saved) === '["o1:board:授業","o2:board:授業","o3:board:授業"]' && old.chalk === '図を直して', JSON.stringify(old));
  ok('今日がまだ空なら「今日の時間割は、まだ空いています」（前の日へは行ける・次の日はない）', old.tt.empty === '今日の時間割は、まだ空いています' && old.tt.rows.length === 0 && old.tt.prev && !old.tt.next, JSON.stringify(old.tt));
  await page.pressEl('#tt-prev');
  const d1 = await page.eval(TT);
  await page.pressEl('#tt-prev');
  const d2 = await page.eval(TT);
  ok('「← 前の日」で頼みのある日へ（6日前: 1限 授業・黒板 → 8日前: 2つ・いまの黒板の2限を強調）', d1.title === 'この日の時間割' && JSON.stringify(d1.rows) === '["1限 授業・黒板"]' && d1.prev && d1.next &&
    JSON.stringify(d2.rows) === '["1限 授業・黒板","2限 授業・黒板"]' && JSON.stringify(d2.now) === '["o2"]' && !d2.prev && d2.next, JSON.stringify([d1, d2]));
  await page.pressEl('#tt-next');
  await page.pressEl('#tt-next');
  const d3 = await page.eval(TT);
  ok('「次の日 →」で今日に戻る', d3.title === '今日の時間割' && d3.rows.length === 0 && !d3.next, JSON.stringify(d3));
  ok('古いデータの教室: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);

  // 動きを減らす設定：ふわっと → 短いフェード
  await page.viewport(390, 844, true, false, true);
  await page.load(base);
  const rm = await page.eval(`(() => { const s = getComputedStyle(document.getElementById('view')); return { d: s.transitionDuration, f: s.filter }; })()`);
  ok('動きを減らす設定では、切り替えは 0.15 秒のフェードだけ（ぼかしなし）', /^0\.15s/.test(rm.d) && rm.f === 'none', JSON.stringify(rm));
  // 動きを減らす設定の放送：吹き出しは薄れずに「放送で伝えた」と出したまま（黒板には重ねない）
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b3"]');
  await sleep(3800);
  const rms = await page.eval(`(() => { const r = ${ROOM}, s = document.getElementById('room-say').getBoundingClientRect(), b = document.getElementById('room-board').getBoundingClientRect(); return Object.assign(r, { overBoard: s.bottom > b.top + 1 }); })()`);
  ok('動きを減らす設定の放送: 3秒たっても薄れず「放送で伝えた」と出したまま（黒板に重ねない）', rms.say === 'あとで部屋の片づけ、お願いね' && rms.sayK === '放送で伝えた' && rms.sayOp === 1 && !rms.overBoard, JSON.stringify(rms));
  ok('動きを減らす設定の放送: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.eval('window.scrollTo(0, 0); true');
  await page.shot('17_放送_動きを減らす設定_390_light.png');
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
