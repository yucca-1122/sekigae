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
// 2026-10-18 枠: rows は頼みの入っている時限だけ。slots は枠の行（いつも8）。empty は空いている時限（＋は押せる・－は押せない）
const TT = `(() => ({ title: document.getElementById('tt-title').textContent,
  rows: [...document.querySelectorAll('#tt-list .tt-row[data-bid]')].map((r) => r.querySelector('.tt-p').textContent + ' ' + r.querySelector('.tt-s').textContent + '・' + r.querySelector('.tt-ch').textContent),
  now: [...document.querySelectorAll('#tt-list .tt-row.is-now')].map((r) => r.dataset.bid),
  slots: [...document.querySelectorAll('#tt-list > li')].map((li) => li.querySelector('.tt-p') ? li.querySelector('.tt-p').textContent : li.textContent.trim()),
  empty: [...document.querySelectorAll('#tt-list .tt-row.is-empty')].map((r) => r.querySelector('.tt-p').textContent + (r.tagName === 'BUTTON' ? '+' : '-')),
  more: document.getElementById('tt-more').hidden ? '' : document.getElementById('tt-more').textContent,
  prev: !document.getElementById('tt-prev').disabled, next: !document.getElementById('tt-next').disabled }))()`;
/* 掃除の時間のようす */
const SWEEP = `(() => ({ open: !document.getElementById('sheet-sweep').hidden, pos: document.getElementById('sweep-pos').textContent,
  rows: document.querySelectorAll('#sweep-body .sw-row').length, next: !document.getElementById('sweep-next').disabled, nextText: document.getElementById('sweep-next').textContent,
  note: document.getElementById('room-note').textContent, chalk: document.getElementById('room-chalk').textContent, memos: [...document.querySelectorAll('#room-memos .board-memo')].map((x) => x.textContent),
  voices: [...document.querySelectorAll('#sweep-body .voice')].map((x) => x.textContent), asks: [...document.querySelectorAll('#sweep-body .sw-ask-q')].map((x) => x.textContent),
  fields: [...document.querySelectorAll('#sweep-body input[data-next]')].map((x) => (x.labels[0] || {}).textContent || ''), tips: [...document.querySelectorAll('#sweep-body .sw-tip')].map((x) => x.textContent),
  prev: [...document.querySelectorAll('#sweep-body .sw-prev')].map((x) => x.textContent), carryTag: !!document.querySelector('#sweep-pos .tag-carry'),
  marked: [...document.querySelectorAll('#tt-list .tt-row.is-sweep')].map((r) => r.dataset.bid), wiping: document.getElementById('room-board').classList.contains('is-wiping'),
  ow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.getElementById('sheet-sweep').scrollWidth - document.getElementById('sheet-sweep').clientWidth) }))()`;
const SW_ROW = (i) => `document.querySelectorAll('#sweep-body .sw-row')[${i}]`;
/* 昼休みのようす */
const LUNCH = `(() => ({ on: !document.getElementById('room-lunch').hidden, chalk: document.getElementById('room-chalk').textContent,
  groups: [...document.querySelectorAll('#room-lunch .lunch-group')].map((g) => g.dataset.n), kids: document.querySelectorAll('#room-lunch .lunch-kid').length,
  desks: document.querySelectorAll('#room-rows button.desk').length, row: (document.getElementById('tt-lunch') || {}).textContent || '', tea: !document.getElementById('room-tea').hidden,
  writeOff: document.getElementById('btn-write').getAttribute('aria-disabled') === 'true', badges: document.querySelectorAll('#room-lunch .lk-talk').length,
  saved: JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).lunch, ow: document.documentElement.scrollWidth - document.documentElement.clientWidth }))()`;
const TALK = `(() => ({ open: !document.getElementById('sheet-talk').hidden, title: document.getElementById('talk-title').textContent, who: document.getElementById('talk-who').textContent,
  topic: document.getElementById('talk-topic').value, listened: document.getElementById('talk-listened').checked, submit: document.getElementById('talk-submit').textContent,
  del: !document.getElementById('talk-del-wrap').hidden, state: document.getElementById('talk-state').hidden ? '' : document.getElementById('talk-state').textContent }))()`;
/* 前の日からの続き（時間割の下の付箋） */
const CARRY = `(() => ({ shown: !document.getElementById('tt-carry').hidden, rows: [...document.querySelectorAll('#tt-carry .tt-carry-row')].map((r) => r.textContent),
  sweep: !!document.getElementById('tt-sweep') && !document.getElementById('tt-sweep').disabled }))()`;
/* 保存データの日付を1日前にずらす（「次の日」に開いたことにする） */
const SHIFT_DAY = `(() => { const DAY = 86400000, st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})), E = SekigaeEngine;
  const back = (d) => E.dayKey(new Date(d + 'T12:00:00').getTime() - DAY);
  st.boards.forEach((b) => { b.createdAt -= DAY; b.updatedAt -= DAY; if (b.closedAt) b.closedAt -= DAY;
    Object.keys(b.results || {}).forEach((k) => { if (b.results[k].at) b.results[k].at -= DAY; });
    Object.keys(b.sweep || {}).forEach((k) => { const e = b.sweep[k]; e.at -= DAY; e.log.forEach((l) => { l.day = back(l.day); }); }); });
  st.students.forEach((s) => { s.createdAt -= DAY; s.updatedAt -= DAY; });
  localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`;
/* 大きい黒板と時間割の高さ（px） */
const HEIGHTS = `(() => ({ board: Math.round(document.getElementById('room-board').getBoundingClientRect().height), tt: Math.round(document.getElementById('room-tt').getBoundingClientRect().height),
  slots: document.querySelectorAll('#tt-list > li').length }))()`;
/* 今日の頼みを n 個（1限から）にした保存データ（いまの黒板はどれも同じ 1限の頼み） */
// 日の区切りは午前3時なので、「今日」の9時は今から3時間前の日の9時（0時〜2時台に回しても今日の頼みになる）
const todayBoards = (n) => `(() => { const t = new Date(Date.now() - 3 * 3600000); t.setHours(9, 0, 0, 0); const s = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || 'null') || {};
  const st = { v: 1, students: s.students || [], boards: [], currentId: 'n1', ui: { tab: 'room' } };
  for (let i = 1; i <= ${n}; i++) st.boards.push({ id: 'n' + i, text: i === 1 ? '資料を3枚にまとめて。明日の朝までに' : '頼み' + i, channel: 'board', subject: '授業', period: i,
    createdAt: t.getTime() + i * 60000, updatedAt: t.getTime(), targets: (s.students || []).map((x) => x.id), firstTime: {}, results: {} });
  localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`;
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
/* 先生の中心と、教室（席の列）の中心の差（px）・教卓の前のプリントの中心との差。生徒の目線の時計と黒板の日付の四角
   （2026-10-18 使ってみての指摘「教卓と先生が少し左に寄っている。真ん中に」で、大きい黒板の中心から席の列の中心に変えた） */
const TEACHER = `(() => { const t = document.getElementById('room-teacher').getBoundingClientRect(), r = document.getElementById('room-rows').getBoundingClientRect();
  return Math.round((t.left + t.width / 2) - (r.left + r.width / 2)); })()`;
const PRINTX = `(() => { const p = document.getElementById('room-print').getBoundingClientRect(), r = document.getElementById('room-rows').getBoundingClientRect();
  return Math.round((p.left + p.width / 2) - (r.left + r.width / 2)); })()`;
const CLOCKDATE = `(() => { const c = document.getElementById('view-clock'), r = c.getBoundingClientRect(), d = document.getElementById('view-date').getBoundingClientRect();
  return { shown: !c.hidden, size: c.dataset.size, clock: [r.left, r.top, r.right, r.bottom].map(Math.round), date: [d.left, d.top, d.right, d.bottom].map(Math.round),
    overlap: !c.hidden && !(r.right <= d.left || d.right <= r.left || r.bottom <= d.top || d.bottom <= r.top) }; })()`;
/* 頼みごとを出すシート：伝え方・科目名・相手・初めての作業・文・元の放送の文 */
const SHEET = `(() => ({ open: !document.getElementById('sheet-write').hidden, title: document.getElementById('write-title').textContent,
  ch: (document.querySelector('input[name="write-ch"]:checked') || {}).value, subj: (document.querySelector('input[name="write-subj"]:checked') || {}).value || '',
  free: document.getElementById('write-subject').value, text: document.getElementById('write-text').value,
  tgt: [...document.querySelectorAll('#write-targets input[data-kind="tgt"]')].map((x) => x.dataset.sid + (x.checked ? '+' : '-')),
  first: [...document.querySelectorAll('#write-targets input[data-kind="first"]:checked')].map((x) => x.dataset.sid),
  cast: document.getElementById('write-cast').hidden ? '' : document.getElementById('write-cast').textContent,
  period: Number((document.querySelector('input[name="write-period"]:checked') || {}).value || 0),
  pdis: [...document.querySelectorAll('input[name="write-period"]:disabled')].map((x) => Number(x.value)),
  pn: document.querySelectorAll('input[name="write-period"]').length }))()`;

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

/* 掃除の時間の操作 */
async function sweepPick(i, st) { await page.eval(`${SW_ROW(i)}.querySelector('input[value="${st}"]').click(); true`); await sleep(120); }
async function sweepType(i, text) {
  await page.eval(`(() => { const f = ${SW_ROW(i)}.querySelector('input[data-next]'); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
}
async function sweepNext() {
  await page.eval(`document.getElementById('sweep-next').click(); true`);
  await sleep(60);
  await page.waitFor(`!document.getElementById('room-board').classList.contains('is-wiping')`, 3000);
  await sleep(200);
}
async function openSweepSheet() {
  await page.eval(`document.getElementById('tt-sweep').click(); true`);
  await page.waitFor(`!document.getElementById('sheet-sweep').hidden`, 2000);
  await sleep(350);
}
/* 見本の3つを決まった選び方で最後まで：1限 はじめて＝途中（一言あり）・慣れた＝終わった（うまくいった）／2限 2人ともまだ／3限 はじめて＝まだ・慣れた＝終わった */
async function sweepAll(onMid) {
  await sweepPick(0, 'mid');
  await sweepType(0, '明日の1限のあと、表の3行目から');
  if (onMid) await onMid();
  await sweepPick(1, 'done');
  await page.eval(`${SW_ROW(1)}.querySelector('input[data-good]').click(); true`);
  await sweepNext();
  await sweepPick(0, 'not');
  await sweepPick(1, 'not');
  await sweepNext();
  await sweepPick(0, 'not');
  await sweepPick(1, 'done');
  await sweepNext();
}
const SUMMARY = `(() => ({ counts: [...document.querySelectorAll('#sweep-counts li')].map((x) => x.textContent.replace(/\\s+/g, '')),
  carry: document.querySelectorAll('#sweep-carry li').length, tooMany: !!document.getElementById('sweep-too-many'), planned: !!document.getElementById('sweep-planned') }))()`;

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
    ok('先生と教卓は教室（席の列）の真ん中（中心の差 ' + dxT + 'px・±8px 以内）', Math.abs(dxT) <= 8, String(dxT));

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
    // 第2段から、今日の掃除の行は「掃除の時間」（掃除の時間の入口）と書く
    ok('時間割の枠は8行（1〜4限・昼休み・5〜6限・掃除）・今日の空いている時限（4〜6限）は「＋」で押せる', JSON.stringify(tt.slots) === '["1限","2限","3限","4限","昼休み","5限","6限","掃除の時間"]' &&
      JSON.stringify(tt.empty) === '["4限+","5限+","6限+"]' && tt.more === '', JSON.stringify(tt));
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
    const dxP = await page.eval(PRINTX);
    ok('教卓の前のプリントも教室（席の列）の真ん中（中心の差 ' + dxP + 'px・±8px 以内）', Math.abs(dxP) <= 8, String(dxP));
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
    const shp = await page.eval(SHEET);
    ok('頼みごとを出すシート: 時限のチップ6つ（うまっている1〜3限は選べない・下のボタンから開くといちばん早い空きの4限）', shp.pn === 6 && JSON.stringify(shp.pdis) === '[1,2,3]' && shp.period === 4, JSON.stringify(shp));
    await page.eval(`(() => { document.getElementById('write-ch-letter').click(); document.getElementById('write-subj-0').click(); const t = document.getElementById('write-text');
      t.value = '金曜の会議の資料を、A4 1枚にまとめてもらえると助かります'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(200);
    ok('シートでお便りを選ぶと、書いている文が教卓の前のプリントに映る', (await page.eval(ROOM)).print === '金曜の会議の資料を、A4 1枚にまとめてもらえると助かります');
    await page.shot('15_頼みごとを出すシート_' + V.tag + '.png');
    await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
    await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
    // 2026-10-18 枠: 今日の頼みが1つの日と6つの日で、大きい黒板と時間割の高さが同じ（枠は8行のまま）
    await page.eval(todayBoards(1));
    await page.load(base);
    const h1 = await page.eval(HEIGHTS);
    await page.eval(todayBoards(6));
    await page.load(base);
    const h6 = await page.eval(HEIGHTS);
    ok('今日の頼みが1つの日と6つの日で、大きい黒板と時間割の高さが同じ（枠は8行のまま）', h1.board === h6.board && h1.tt === h6.tt && h1.slots === 8 && h6.slots === 8, JSON.stringify([h1, h6]));
    ok('6つうまった日: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);

    // ---- v0.3 第2段：掃除の時間（見本の3つを、1枚ずつ） ----
    await page.eval('localStorage.clear(); true');
    await page.load(base);
    await openSweepSheet();
    let sw = await page.eval(SWEEP);
    ok('掃除の時間: 1枚目（1限）が大きい黒板に出て、下に「1/3」・相手2人・選ぶまで「次へ」は押せない・時間割の1限に印・横にはみ出さない', sw.open && /^1\/3/.test(sw.pos) &&
      sw.note === '掃除の時間 1/3' && sw.rows === 2 && !sw.next && /これ、簡単にまとめておいて/.test(sw.chalk) && JSON.stringify(sw.marked) === '["ex-b1"]' && sw.ow <= 0, JSON.stringify(sw));
    if (V.tag !== '390_dark') await page.shot('20_掃除の時間_1枚目_' + V.tag + '.png');
    await sweepAll(V.tag === '390_light' ? async () => { await sleep(200); await page.shot('21_掃除の時間_途中を選んだ_390_light.png'); } : null);
    sw = await page.eval(SWEEP);
    const sm = await page.eval(SUMMARY);
    ok('掃除の時間: 最後に「今日の掃除、おしまい」と数（終わった 2・途中 1・まだ 3）・明日の続き4つ・端に黄色い「続き」のメモ3つ・横にはみ出さない',
      /今日の掃除、おしまい/.test(sw.chalk) && JSON.stringify(sm.counts) === '["終わった2","途中1","まだ3"]' && sm.carry === 4 && sw.memos.length === 3 &&
      sw.nextText === '教室にもどる' && sw.ow <= 0, JSON.stringify([sw, sm]));
    if (V.tag !== '390_dark') await page.shot('22_掃除の時間_おしまい_' + V.tag + '.png');
    await page.eval(`document.getElementById('sweep-next').click(); true`);
    await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
    await sleep(200);
    ok('「教室にもどる」で掃除の時間を閉じると、大きい黒板はいまの黒板（1限）にもどる', (await page.eval(`document.getElementById('room-chalk').textContent`)) === 'これ、簡単にまとめておいて。なるはやで！' &&
      !(await page.eval(`document.getElementById('room-board').classList.contains('is-sweeping')`)));

    // ---- v0.3 第3段：昼休み（見本の2人） ----
    await page.eval('window.scrollTo(0, 0); true');
    await page.eval(`document.getElementById('tt-lunch').click(); true`);
    await sleep(900);
    const ln = await page.eval(LUNCH);
    ok('昼休み: 黒板には「昼休み」とだけ・生徒は席を離れて輪に（2人で1つ）・机は空き・時間割は「昼休み中（…から）」・横にはみ出さない', ln.on && ln.chalk === '昼休み' &&
      JSON.stringify(ln.groups) === '["2"]' && ln.kids === 2 && ln.desks === 0 && /^昼休み中（\d+:\d\dから）$/.test(ln.row) && ln.tea && ln.ow <= 0, JSON.stringify(ln));
    // 写真はお知らせが消えてから
    if (V.tag !== '390_dark') { await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 4000); await sleep(350); await page.shot('24_昼休みの教室_' + V.tag + '.png', true); }
    await page.eval(`document.getElementById('room-lunch-end').click(); true`);
    await sleep(900);
    const lb = await page.eval(LUNCH);
    ok('「授業にもどる」で生徒が席にもどる（保存も消える）', !lb.on && lb.desks === 2 && lb.saved === null && lb.row === '昼休み', JSON.stringify(lb));
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
  const today = await page.eval(`SekigaeEngine.dayKey(Date.now())`), todayJa = today.split('-').map(Number).slice(1).join('/').replace(/^(\d+)\/(\d+)$/, '$1月$2日');
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
  await page.eval(`(() => { const d = (back, h) => { const x = new Date(Date.now() - 3 * 3600000); x.setDate(x.getDate() - back); x.setHours(h, 0, 0, 0); return x.getTime(); };
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ v: 1, students: [{ id: 's1', name: '生徒A', color: 1, col: 1, answers: { q1: 'B' }, notes: {}, history: [], createdAt: d(8, 9) }],
      boards: [{ id: 'o1', text: '資料を3枚にまとめて', createdAt: d(8, 9), targets: ['s1'], firstTime: {}, results: {} }, { id: 'o2', text: '図を直して', createdAt: d(8, 15), targets: ['s1'], firstTime: {}, results: {} },
        { id: 'o3', text: '明日までに見ておいて', createdAt: d(6, 10), targets: ['s1'], firstTime: {}, results: {} }], currentId: 'o2', ui: { tab: 'room' } })); return true; })()`);
  await page.load(base);
  const old = await page.eval(`({ saved: ${SAVED}.boards.map((b) => b.id + ':' + b.channel + ':' + b.subject), tt: ${TT}, chalk: document.getElementById('room-chalk').textContent })`);
  ok('古いデータ（伝え方・科目名なし）も読み込み、黒板・授業として保存し直す', JSON.stringify(old.saved) === '["o1:board:授業","o2:board:授業","o3:board:授業"]' && old.chalk === '図を直して', JSON.stringify(old));
  // 2026-10-18 枠: 「今日の時間割は、まだ空いています」の文はやめて、空いている枠（＋ 頼みごとを書く）で見せる
  ok('今日がまだ空なら、枠の1〜6限が全部「＋」で押せる（前の日へは行ける・次の日はない）', JSON.stringify(old.tt.empty) === '["1限+","2限+","3限+","4限+","5限+","6限+"]' &&
    old.tt.rows.length === 0 && old.tt.prev && !old.tt.next, JSON.stringify(old.tt));
  await page.pressEl('#tt-prev');
  const d1 = await page.eval(TT);
  await page.pressEl('#tt-prev');
  const d2 = await page.eval(TT);
  ok('「← 前の日」で頼みのある日へ（6日前: 1限 授業・黒板 → 8日前: 2つ・いまの黒板の2限を強調）', d1.title === 'この日の時間割' && JSON.stringify(d1.rows) === '["1限 授業・黒板"]' && d1.prev && d1.next &&
    JSON.stringify(d2.rows) === '["1限 授業・黒板","2限 授業・黒板"]' && JSON.stringify(d2.now) === '["o2"]' && !d2.prev && d2.next, JSON.stringify([d1, d2]));
  ok('前の日の空いている時限は押せない（薄く「―」）', JSON.stringify(d2.empty) === '["3限-","4限-","5限-","6限-"]' && (await page.eval(`document.querySelectorAll('#tt-list button[data-period]').length`)) === 0, JSON.stringify(d2.empty));
  ok('古いデータ（時限なし）は、その日の出した順に 1限・2限… として保存し直す', JSON.stringify((await page.eval(SAVED)).boards.map((b) => b.id + ':' + b.period)) === '["o1:1","o2:2","o3:1"]');
  await page.pressEl('#tt-next');
  await page.pressEl('#tt-next');
  const d3 = await page.eval(TT);
  ok('「次の日 →」で今日に戻る', d3.title === '今日の時間割' && d3.rows.length === 0 && !d3.next, JSON.stringify(d3));
  ok('古いデータの教室: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);

  // ---- 2026-10-18 時間割の枠：空いている時限を押して書く・時限のチップ・直すで時限を移す・6つうまったとき・7件以上の古い日 ----
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-period="5"]');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  const fs5 = await page.eval(SHEET);
  ok('空いている時限（5限）を押すと、5限を選んだ状態で「頼みごとを出す」が開く（うまっている1〜3限は選べない）', fs5.open && fs5.title === '頼みごとを出す' && fs5.period === 5 &&
    JSON.stringify(fs5.pdis) === '[1,2,3]', JSON.stringify(fs5));
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = '表の数字を見直して。金曜までに'; t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(350);
  let fst = await page.eval(SAVED), ftt = await page.eval(TT);
  const f5 = fst.boards[fst.boards.length - 1];
  ok('出すと5限に入る（4限は空いたまま）', f5.period === 5 && ftt.rows[3] === '5限 授業・黒板' && JSON.stringify(ftt.empty) === '["4限+","6限+"]', JSON.stringify([f5.period, ftt]));
  await page.pressEl('#room-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  const fe = await page.eval(SHEET);
  ok('「直す」では今の時限（5限）も選べる（ほかにうまっている1〜3限は選べない）', fe.title === '頼みごとを直す' && fe.period === 5 && JSON.stringify(fe.pdis) === '[1,2,3]', JSON.stringify(fe));
  await page.eval(`(() => { document.getElementById('write-period-4').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(350);
  fst = await page.eval(SAVED); ftt = await page.eval(TT);
  ok('「直す」で空いている4限へ移せる（5限は空きにもどる）', fst.boards.find((b) => b.id === f5.id).period === 4 && ftt.rows[3] === '4限 授業・黒板' && JSON.stringify(ftt.empty) === '["5限+","6限+"]', JSON.stringify(ftt));
  await page.eval(todayBoards(6));
  await page.load(base);
  const full = await page.eval(TT);
  await page.pressEl('#btn-write');
  await sleep(300);
  ok('今日の6つが全部うまっていると「＋」はなく、「頼みごとを出す」は開かずに知らせる', full.empty.length === 0 && full.rows.length === 6 &&
    (await page.eval(`document.getElementById('sheet-write').hidden`)) && (await page.eval(`document.getElementById('toast-msg').textContent`)) === '今日の時間割は6限までうまっているよ。明日に回すか、どれかを直してね', JSON.stringify(full));
  // 時限のない古いデータで、1日に8件ある日：1〜6限に入り、7・8件目は時間割の下に「この日はほかに 2 件」
  await page.eval(`(() => { const d = new Date(Date.now() - 3 * 3600000); d.setDate(d.getDate() - 3); d.setHours(8, 0, 0, 0);
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ v: 1, students: [{ id: 's1', name: '生徒A', color: 1, col: 1, answers: { q1: 'B' }, notes: {}, history: [], createdAt: d.getTime() }],
      boards: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: 'w' + i, text: '頼み' + i, createdAt: d.getTime() + i * 600000, targets: ['s1'], firstTime: {}, results: {} })), currentId: 'w8', ui: { tab: 'room' } })); return true; })()`);
  await page.load(base);
  await page.pressEl('#tt-prev');
  const w = await page.eval(`({ per: ${SAVED}.boards.map((b) => b.period), tt: ${TT} })`);
  ok('時限のない古いデータで8件ある日: 出した順に 1〜6限、7・8件目は時限なし（0）', JSON.stringify(w.per) === '[1,2,3,4,5,6,0,0]', JSON.stringify(w.per));
  ok('… その日の時間割は6つ埋まり、下に「この日はほかに 2 件（提出物で見られる）」・前の日の空きはない', w.tt.title === 'この日の時間割' && w.tt.rows.length === 6 && w.tt.more === 'この日はほかに 2 件（提出物で見られる）' && w.tt.empty.length === 0, JSON.stringify(w.tt));
  await page.pressEl('#room-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  const w8 = await page.eval(`({ s: ${SHEET}, note: document.getElementById('write-period-note').hidden ? '' : document.getElementById('write-period-note').textContent })`);
  ok('… 時限なしの頼みを直すとき、その日がうまっていれば時限は選べず「時間割に入らない」と知らせる', w8.s.period === 0 && JSON.stringify(w8.s.pdis) === '[1,2,3,4,5,6]' && /時間割に入らない/.test(w8.note), JSON.stringify(w8));
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.pressEl('#tab-subs');
  await sleep(200);
  const wl = await page.eval(`[...document.querySelectorAll('.sub-card .sub-date .lesson')].map((x) => x.textContent)`);
  ok('… 提出物には8件とも出る（時限なしの2件は時限の書きなし）', wl.length === 8 && wl.filter((x) => /限/.test(x)).length === 6, JSON.stringify(wl));
  await page.pressEl('#tab-room');
  ok('時間割の枠（7件以上の日）: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);

  // ---- v0.3 第2段：掃除の時間（くわしく・390 ライト） ----
  await page.load(base);   // 今日の時間割にもどる（上は3日前の日を見ていた）
  ok('入口: 今日の頼みも前の日からの続きもない日は「掃除」の行を押せない', (await page.eval(CARRY)).sweep === false &&
    /まだない/.test(await page.eval(`document.getElementById('tt-sweep').getAttribute('aria-label')`)));
  ok('古いデータ（掃除の記録なし）も読み込み、掃除の記録は空として保存し直す', (await page.eval(`${SAVED}.boards.every((b) => b.sweep && !Object.keys(b.sweep).length)`)));
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  ok('入口: 今日の頼みがあると、時間割の「掃除」の行が「掃除の時間」になって押せる', (await page.eval(CARRY)).sweep === true && (await page.eval(`document.getElementById('tt-sweep').textContent`)) === '掃除の時間');
  const tday = await page.eval(`SekigaeEngine.dayKey(Date.now())`), md = await page.eval(`SekigaeEngine.mdDay(SekigaeEngine.dayKey(Date.now()))`);
  await openSweepSheet();
  await sweepPick(0, 'mid');
  let sq = await page.eval(SWEEP);
  ok('途中を選ぶと、生徒の声・一言の欄「続き（いつ・どこから）」・本人に聞くならが出る（もう1人を選ぶまで次へは押せない）', sq.voices[0] === '続きが気になる。いつやるか決めてないと、帰ってからも頭に浮かぶかも' &&
    JSON.stringify(sq.fields) === '["続き（いつ・どこから）"]' && sq.asks[0] === '続きは、明日のいつごろやれそう？ どこまで進んだ？' && !sq.next, JSON.stringify(sq));
  await sweepType(0, '明日の1限のあと、表の3行目から');
  await sweepPick(1, 'done');
  sq = await page.eval(SWEEP);
  const dn = await page.eval(`({ thanks: !!${SW_ROW(1)}.querySelector('[data-act="thanks"]'), good: !!${SW_ROW(1)}.querySelector('input[data-good]'), subs: !!${SW_ROW(1)}.querySelector('[data-act="to-subs"]') })`);
  ok('終わったを選ぶと「終わったって、気づいてもらえたかも」・お礼を伝える・「この頼み方はうまくいった」・提出物に記録する。全員選ぶと次へが押せる', sq.voices[1] === '終わったって、気づいてもらえたかも' &&
    dn.thanks && dn.good && dn.subs && sq.next, JSON.stringify([sq, dn]));
  await page.eval(`${SW_ROW(1)}.querySelector('[data-act="thanks"]').click(); true`);
  await sleep(250);
  ok('「お礼を伝える」で落ちない（コピーできないときは文字を選んで知らせる）', await page.eval(`document.getElementById('toast').classList.contains('is-on')`));
  await page.eval(`${SW_ROW(1)}.querySelector('input[data-good]').click(); true`);
  await page.eval(`document.getElementById('sweep-next').click(); true`);
  await sleep(60);
  const wipe = await page.eval(SWEEP);
  await page.waitFor(`!document.getElementById('room-board').classList.contains('is-wiping')`, 3000);
  await sleep(200);
  sq = await page.eval(SWEEP);
  ok('次へ: 黒板消しで消す動きのあと、2枚目（2限）が出る。途中があった1限は端に「続き：1限 授業」のメモ', wipe.wiping && /^2\/3/.test(sq.pos) && /来週の準備で/.test(sq.chalk) &&
    JSON.stringify(sq.memos) === '["続き：1限 授業"]' && JSON.stringify(sq.marked) === '["ex-b2"]', JSON.stringify([wipe.wiping, sq]));
  await sweepPick(0, 'not');
  await sweepPick(1, 'not');
  sq = await page.eval(SWEEP);
  ok('まだ（その日3本以上）: 声「手をつけられなかった…今日は頼みが多かったかも」・一言の欄「最初の一歩」・本人に聞くなら', sq.voices.every((v) => v === '手をつけられなかった…今日は頼みが多かったかも') &&
    JSON.stringify(sq.fields) === '["最初の一歩","最初の一歩"]' && sq.asks.every((a) => a === 'まだのもの、何があれば始めやすい？') && !sq.tips.length, JSON.stringify(sq));
  await sweepNext();
  await sweepPick(0, 'not');
  sq = await page.eval(SWEEP);
  ok('まだ（放送だけ）: 声「そういえば、頼まれてたのを忘れてたかも」と「次からは要点をお便りでも送る」', sq.voices[0] === 'そういえば、頼まれてたのを忘れてたかも' && JSON.stringify(sq.tips) === '["次からは要点をお便りでも送る"]', JSON.stringify(sq));
  await sweepPick(1, 'done');
  await sweepNext();
  const sum = await page.eval(SUMMARY);
  ok('まとめ: 数（終わった 2・途中 1・まだ 3）・3つとも残ったので「今日は頼みを出しすぎたかも」・一言のない「まだ」があるので「安心して帰れる」は出ない', JSON.stringify(sum.counts) === '["終わった2","途中1","まだ3"]' &&
    sum.tooMany && !sum.planned && sum.carry === 4, JSON.stringify(sum));
  await page.eval(`document.getElementById('sweep-next').click(); true`);
  await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
  const ssv = await page.eval(`${SAVED}.boards.map((b) => b.id + ':' + Object.keys(b.sweep).map((k) => k.slice(-1) + b.sweep[k].st + (b.sweep[k].good ? '+' : '') + b.sweep[k].log.length).join(','))`);
  ok('選んだ状態は頼みごとごとに保存される（うまくいった印・その日の記録1件）', JSON.stringify(ssv) === '["ex-b1:1mid1,2done+1","ex-b2:1not1,2not1","ex-b3:1not1,2done1"]', JSON.stringify(ssv));
  await page.pressEl('#tab-subs');
  await sleep(200);
  const swst = await page.eval(`[...document.querySelectorAll('.sub-card[data-bid="ex-b1"] .sw-state')].map((x) => x.textContent)`);
  ok('提出物のカードの生徒の行に、掃除の状態を小さく（「掃除（' + md + '）途中：明日の1限のあと…」）', JSON.stringify(swst) === JSON.stringify(['掃除（' + md + '）途中：明日の1限のあと、表の3行目から', '掃除（' + md + '）終わった・うまくいった頼み方']), JSON.stringify(swst));
  await page.pressEl('#tab-export');
  await sleep(200);
  const mdx = await page.eval(`document.getElementById('export-text').value`);
  ok('書き出しに「掃除: ' + md + ' 途中（続き: …）」と「うまくいった頼み方」の一覧', mdx.indexOf('    - 掃除: ' + md + ' 途中（続き: 明日の1限のあと、表の3行目から）') >= 0 &&
    mdx.indexOf('  - ' + tday + ' 1限 授業（黒板）「これ、簡単にまとめておいて。なるはやで！」（見本：慣れた生徒さん）') >= 0, mdx.slice(0, 900));
  await page.pressEl('#tab-room');
  // 次の日：途中・まだの頼みが「前の日からの続き」として時間割の下に出る
  await page.eval(SHIFT_DAY);
  await page.load(base);
  let cr = await page.eval(CARRY);
  ok('次の日: 途中・まだの頼みが時間割の下に「前の日からの続き」として1件1行で出る（終わった生徒の分は出ない）・掃除の時間も押せる', cr.shown && cr.rows.length === 3 &&
    /1限 授業（黒板）・はじめての生徒さん 途中「明日の1限のあと、表の3行目から」/.test(cr.rows[0]) && /2限 手伝い（お便り）.*まだ ほか1人/.test(cr.rows[1]) && /3限 雑務（放送）・はじめての生徒さん まだ/.test(cr.rows[2]) && cr.sweep, JSON.stringify(cr));
  const ft = await page.eval(TT);
  ok('… 続きは枠の外に出るので、今日の時間割は8行の枠のまま（1〜6限は空き）・横にはみ出さない', JSON.stringify(ft.empty) === '["1限+","2限+","3限+","4限+","5限+","6限+"]' && ft.slots.length === 8 && (await page.eval(OVERFLOW)) <= 0, JSON.stringify(ft));
  await page.eval(`(() => { const el = document.getElementById('room-tt'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16); return true; })()`);
  await sleep(200);
  await page.shot('23_前の日からの続き_390_light.png');
  await page.pressEl('#tt-carry .tt-carry-row[data-bid="ex-b2"]');
  await sleep(250);
  ok('続きの行を押すと、その頼みを黒板に出す（時間割は今日のまま）', (await page.eval(ROOM)).cur === 'ex-b2' && (await page.eval(TT)).title === '今日の時間割');
  await openSweepSheet();
  sq = await page.eval(SWEEP);
  const mdPrev = await page.eval(`SekigaeEngine.mdDay(SekigaeEngine.dayKey(Date.now() - 86400000))`);
  ok('次の日の掃除の時間: 続きの3つ（前の日からの続きの印・前の日の掃除の一言）・出すのは途中・まだの生徒だけ', /^1\/3/.test(sq.pos) && sq.carryTag && /前の日からの続き/.test(sq.chalk) && sq.rows === 1 &&
    JSON.stringify(sq.prev) === JSON.stringify([mdPrev + 'の掃除：途中「明日の1限のあと、表の3行目から」']), JSON.stringify(sq));
  await sweepPick(0, 'done');
  await page.eval(`document.querySelector('#sheet-sweep [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
  cr = await page.eval(CARRY);
  ok('掃除の時間で「終わった」にした続きは、時間割の下から消える（途中で閉じても、選んだものは残る）', cr.rows.length === 2 && !cr.rows.some((r) => /1限 授業/.test(r)), JSON.stringify(cr));
  // 提出済み・締めた頼みは、掃除の時間にも続きにも出ない
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); const b2 = st.boards.find((b) => b.id === 'ex-b2'), b3 = st.boards.find((b) => b.id === 'ex-b3');
    b2.closedAt = Date.now(); b3.results['ex-s1'] = { kind: 'asExpected', memo: '', ack: false, at: Date.now(), submitted: true };
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  cr = await page.eval(CARRY);
  await openSweepSheet();
  sq = await page.eval(SWEEP);
  ok('提出済み（3限）・締めた（2限）頼みは続きから消え、掃除の時間にも出ない（今日「終わった」にした1限だけが、選んだまま出る）', !cr.shown && cr.rows.length === 0 && /^1\/1/.test(sq.pos) &&
    sq.voices[0] === '終わったって、気づいてもらえたかも', JSON.stringify([cr, sq]));
  await page.eval(`document.querySelector('#sheet-sweep [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
  // 「提出物に記録する」：掃除の時間を閉じて、提出物のその生徒の行へ
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await openSweepSheet();
  await sweepPick(0, 'done');
  await page.eval(`${SW_ROW(0)}.querySelector('[data-act="to-subs"]').click(); true`);
  await sleep(350);
  const ts = await page.eval(`({ sweep: document.getElementById('sheet-sweep').hidden, subs: !document.getElementById('pane-subs').hidden, focus: document.activeElement && document.activeElement.id,
    state: (document.querySelector('.sub-card[data-bid="ex-b1"] .sub-row[data-sid="ex-s1"] .sw-state') || {}).textContent })`);
  ok('「提出物に記録する」で掃除の時間を閉じ、提出物のその生徒の行（返ってきたものの選択）へ', ts.sweep && ts.subs && ts.focus === 'res-ex-b1-ex-s1-asExpected' && /終わった/.test(ts.state || ''), JSON.stringify(ts));
  await page.pressEl('#tab-room');
  // 動きを減らす設定：黒板消しの動きなしで、すぐ次の1枚
  await page.viewport(390, 844, true, false, true);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await openSweepSheet();
  await sweepPick(0, 'done');
  await sweepPick(1, 'done');
  await page.eval(`document.getElementById('sweep-next').click(); true`);
  sq = await page.eval(SWEEP);
  ok('動きを減らす設定では、黒板消しの動きなしで、すぐ2枚目が出る', !sq.wiping && /^2\/3/.test(sq.pos), JSON.stringify(sq));
  await page.eval(`document.querySelector('#sheet-sweep [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
  await page.viewport(390, 844, true, false, false);

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
  // ---- v0.3 第3段：昼休み（くわしく・390 ライト） ----
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  // 入口は今日だけ：前の日を見ているときは「昼休み」は区切りの行
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); st.boards[2].createdAt -= 86400000; st.boards[2].period = 1;
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  await page.pressEl('#tt-prev');
  const lpast = await page.eval(`({ btn: !!document.getElementById('tt-lunch'), div: !!document.querySelector('#tt-list div[data-slot="lunch"]') })`);
  await page.pressEl('#tt-next');
  ok('入口: 「昼休み」の行は今日だけ押せる（前の日は区切りの行）', !lpast.btn && lpast.div && !!(await page.eval(`document.getElementById('tt-lunch')`)), JSON.stringify(lpast));
  // 5人なら近くの席どうしで3人と2人の輪
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); const t = Date.now();
    [['n3', 'B', 0], ['n4', 'B', 2], ['n5', 'A', 1]].forEach((x, i) => st.students.push({ id: x[0], name: '生徒' + (i + 3), color: i + 3, col: x[2], answers: { q1: x[1] }, notes: {}, history: [], createdAt: t, updatedAt: t }));
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  ok('古いデータ（「話を聞いた」の記録なし）も読み込み、記録は空として保存し直す', await page.eval(`${SAVED}.students.every((s) => Array.isArray(s.talks) && !s.talks.length) && ${SAVED}.lunch === null`));
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(80);
  const flip = await page.eval(`[...document.querySelectorAll('#room-lunch .lunch-kid .kid')].map((k) => k.style.transition)`);
  await sleep(900);
  let lq = await page.eval(LUNCH);
  ok('5人なら、近くの席どうしで3人と2人の輪になる（ふわっと動く）', JSON.stringify(lq.groups) === '["3","2"]' && lq.kids === 5 && flip.some((x) => /transform/.test(x)), JSON.stringify([lq.groups, flip]));
  ok('昼休みの間は「頼みごとを出す」が押せない形', lq.writeOff);
  await page.eval(`document.getElementById('btn-write').click(); true`);
  await sleep(200);
  const wb = await page.eval(`({ sheet: document.getElementById('sheet-write').hidden, toast: document.getElementById('toast-msg').textContent })`);
  await page.eval(`document.querySelector('#tt-list button[data-period]').click(); true`);
  await sleep(200);
  ok('昼休みの間は「頼みごとを出す」も時間割の空きも開かずに「昼休みのあとにしよう」', wb.sheet && wb.toast === '昼休みのあとにしよう（昼休みに頼みごとをすると、休めなかったかも）' &&
    (await page.eval(`document.getElementById('sheet-write').hidden`)), JSON.stringify(wb));
  // 「話を聞いた」の記録
  await page.pressEl('#room-lunch .lunch-kid[data-sid="ex-s1"]');
  await page.waitFor(`!document.getElementById('sheet-talk').hidden`, 2000);
  await sleep(250);
  let tk = await page.eval(TALK);
  ok('昼休みの教室で生徒を押すと「話を聞いた（雑談）」の記録のシート（何の話・最後まで聞けた）', tk.open && tk.title === '話を聞いた（雑談）' && /はじめての生徒さん/.test(tk.who) && tk.topic === '' &&
    !tk.listened && tk.submit === '記録する' && !tk.del, JSON.stringify(tk));
  await page.eval(`(() => { const t = document.getElementById('talk-topic'); t.value = '週末に行った場所の話'; document.getElementById('talk-listened').click(); return true; })()`);
  await sleep(150);
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 4000); await sleep(350);
  await page.shot('25_話を聞いたの記録_390_light.png');
  await page.eval(`document.getElementById('talk-submit').click(); true`);
  await sleep(300);
  const tday2 = await page.eval(`SekigaeEngine.dayKey(Date.now())`);
  let tv = await page.eval(`${SAVED}.students.find((s) => s.id === 'ex-s1').talks`);
  ok('記録すると保存される（その日・何の話・最後まで聞けた）・輪の中に「話した」の印', tv.length === 1 && tv[0].day === tday2 && tv[0].topic === '週末に行った場所の話' && tv[0].listened === true &&
    (await page.eval(LUNCH)).badges === 1, JSON.stringify(tv));
  await page.pressEl('#room-lunch .lunch-kid[data-sid="ex-s1"]');
  await page.waitFor(`!document.getElementById('sheet-talk').hidden`, 2000);
  await sleep(200);
  tk = await page.eval(TALK);
  ok('同じ日にもう一度押すと、記録が入った形で開く（書きかえる・消せる）', tk.topic === '週末に行った場所の話' && tk.listened && tk.submit === '書きかえる' && tk.del && /もう記録してある/.test(tk.state), JSON.stringify(tk));
  await page.eval(`(() => { document.getElementById('talk-topic').value = '好きな料理の話'; document.getElementById('talk-submit').click(); return true; })()`);
  await sleep(300);
  tv = await page.eval(`${SAVED}.students.find((s) => s.id === 'ex-s1').talks`);
  ok('書きかえても1日1人1回のまま', tv.length === 1 && tv[0].topic === '好きな料理の話', JSON.stringify(tv));
  await page.pressEl('#room-lunch .lunch-kid[data-sid="ex-s2"]');
  await page.waitFor(`!document.getElementById('sheet-talk').hidden`, 2000);
  await page.eval(`document.getElementById('talk-submit').click(); true`);
  await sleep(300);
  await page.pressEl('#room-lunch .lunch-kid[data-sid="ex-s2"]');
  await page.waitFor(`!document.getElementById('sheet-talk').hidden`, 2000);
  await page.eval(`document.getElementById('talk-del').click(); true`);
  await page.waitFor(`!document.getElementById('confirm').hidden`, 2000);
  await page.eval(`document.getElementById('confirm-yes').click(); true`);
  await sleep(300);
  ok('「この日の記録を消す」で消せる', (await page.eval(`${SAVED}.students.find((s) => s.id === 'ex-s2').talks.length`)) === 0 && (await page.eval(`document.getElementById('sheet-talk').hidden`)));
  // 保存されて、開き直しても昼休み・授業にもどるで消える・次の日には授業
  await page.load(base);
  lq = await page.eval(LUNCH);
  ok('昼休みにしたことは保存され、開き直しても「授業にもどる」まで昼休みのまま', lq.on && lq.chalk === '昼休み' && /^昼休み中/.test(lq.row) && lq.saved && lq.saved.day === tday2, JSON.stringify(lq));
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); st.lunch.day = SekigaeEngine.dayKey(Date.now() - 86400000);
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  lq = await page.eval(LUNCH);
  ok('次の日（午前3時の区切りのあと）には授業に戻っている', !lq.on && lq.desks === 5 && lq.row === '昼休み' && !lq.writeOff, JSON.stringify(lq));
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(300);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(300);
  ok('1日に何度でも押せる（時間割の「昼休み中」を押しても授業にもどる）', !(await page.eval(LUNCH)).on && (await page.eval(`${SAVED}.lunch`)) === null);
  // 生徒の目線：その日に記録があれば「昼休みから」の声
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(300);
  const tvo = await page.eval(`[...document.querySelectorAll('#view-day-voices li')].map((x) => x.dataset.key + ':' + x.textContent)`);
  ok('記録がある日のその生徒の目線に「昼休みから」の声「ちょっと話しかけやすくなったかも」（1つだけ）', tvo.filter((x) => /^talk:昼休みからちょっと話しかけやすくなったかも$/.test(x)).length === 1, JSON.stringify(tvo));
  await page.eval(`(() => { const v = document.getElementById('view'); v.scrollTop = document.getElementById('view-day-voices').getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop - 330; return true; })()`);
  await sleep(200);
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 4000); await sleep(350);
  await page.shot('26_昼休みからの声_390_light.png');
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  await page.pressEl('button.desk[data-sid="ex-s2"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  ok('… 記録のない生徒の目線には出ない', !(await page.eval(`!!document.querySelector('#view-day-voices li[data-key="talk"]')`)));
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  // 通知表・書き出し（見本でない生徒がいるときは、その人たちで数える：見本でない3人のうち1人に「最後まで聞けた」の記録）
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); st.students.find((s) => s.id === 'n3').talks = [{ day: SekigaeEngine.dayKey(Date.now()), at: Date.now(), topic: '', listened: true }];
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  await page.pressEl('#tab-report');
  await sleep(200);
  const rp = await page.eval(`(() => { const st = ${SAVED}, E = SekigaeEngine, ids = {}; st.students.forEach((s) => { ids[s.id] = s; });
    const base = E.reportCard(st.boards.map((b) => E.scoreSaved(b, ids))), ts = E.talkSummary(E.talkStudents(st.students), E.dayKey(Date.now()));
    return { line: document.getElementById('report-talk').textContent, pos: document.querySelector('.pos').textContent, base: base.support, bonus: ts.bonus, want: E.withTalkBonus(base, ts).support }; })()`);
  ok('通知表に「話を聞いた（この7日）: 3 人中 1 人」・「支える」に小さく足す（' + rp.base + ' ＋ ' + rp.bonus + '）', rp.line === '話を聞いた（この7日）: 3 人中 1 人' && rp.bonus === 0.03 &&
    rp.want > rp.base && rp.pos.indexOf('支える ' + rp.want.toFixed(2)) >= 0, JSON.stringify(rp));
  ok('… 位置の説明に「支えるには「話を聞いた」の 0.03 を足した」', /支えるには「話を聞いた」の 0\.03 を足した/.test(rp.pos), rp.pos);
  ok('通知表（話を聞いたつき）: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.pressEl('#tab-export');
  await sleep(200);
  const mdt = await page.eval(`document.getElementById('export-text').value`), mdd = await page.eval(`SekigaeEngine.mdDay(SekigaeEngine.dayKey(Date.now()))`);
  ok('書き出しの生徒ごとに「- 話を聞いた: ' + mdd + '（最後まで聞けた）「好きな料理の話」」', mdt.indexOf('- 話を聞いた: ' + mdd + '（最後まで聞けた）「好きな料理の話」') >= 0 && mdt.indexOf('- 話を聞いた: （まだない）') >= 0, mdt.slice(0, 800));
  await page.pressEl('#tab-room');
  // 動きを減らす設定：動かずに並びだけ変わる
  await page.viewport(390, 844, true, false, true);
  await page.load(base);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(80);
  const rflip = await page.eval(`({ t: [...document.querySelectorAll('#room-lunch .lunch-kid .kid')].map((k) => k.style.transition + k.style.transform), on: !document.getElementById('room-lunch').hidden })`);
  ok('動きを減らす設定では、動かずに並びだけ変わる', rflip.on && rflip.t.every((x) => x === ''), JSON.stringify(rflip));
  await page.eval(`document.getElementById('room-lunch-end').click(); true`);
  await page.viewport(390, 844, true, false, false);

  // ---- 日の区切りは午前3時（2026-10-18）：端末の時計を決まった時刻にして確かめる ----
  const fakeClock = async (y, mo, d, h, mi) => (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const RD = Date, off = new RD(${y}, ${mo - 1}, ${d}, ${h}, ${mi}).getTime() - RD.now();
    class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } }
    window.Date = FD; })();` })).identifier;
  const unClock = async (id) => { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); };
  await page.viewport(390, 844, true, false, false);
  const DATEKEY = `({ key: SekigaeEngine.dayKey(Date.now()), date: document.getElementById('tt-date').textContent, title: document.getElementById('tt-title').textContent })`;
  let clk = await fakeClock(2026, 10, 19, 2, 59);
  await page.load(base);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  const t259 = await page.eval(DATEKEY);
  await unClock(clk);
  clk = await fakeClock(2026, 10, 19, 3, 0);
  await page.load(base);
  const t300 = await page.eval(DATEKEY);
  await unClock(clk);
  ok('日の区切り: 10/19 の 2:59 は「今日」が 10/18、3:00 からは 10/19（時間割の日付）', t259.key === '2026-10-18' && t259.date === '10月18日（日）' && t259.title === '今日の時間割' &&
    t300.key === '2026-10-19' && t300.date === '10月19日（月）', JSON.stringify([t259, t300]));
  // 10/19 の 1:30 に開く：10/18 の頼みが「今日」。前の決まりで 10/19 の1限だった 0:30 の頼みは、10/18 の1限と重なるので空き（2限）へ
  clk = await fakeClock(2026, 10, 19, 1, 30);
  await page.load(base);
  await page.eval(`(() => { const T = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime(), S = (id, c) => ({ id: id, name: '生徒' + id.slice(-1), color: c, col: c, answers: { q1: 'B' }, notes: {}, history: [], createdAt: T(10, 9) });
    const B = (id, text, d, h, m) => ({ id: id, text: text, channel: 'board', subject: '授業', period: 1, createdAt: T(d, h, m), targets: ['s1', 's2'], firstTime: {}, results: {} });
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ v: 1, students: [S('s1', 1), S('s2', 2)],
      boards: [B('p', '前の日の頼み', 17, 10), B('a', '資料を3枚にまとめて', 18, 9), B('n', '夜のうちに見ておいて', 19, 0, 30)], currentId: 'a', ui: { tab: 'room' } })); return true; })()`);
  await page.load(base);
  const n130 = await page.eval(`({ d: ${DATEKEY}, tt: ${TT}, per: ${SAVED}.boards.map((b) => b.id + ':' + b.period) })`);
  ok('10/19 の 1:30 に開くと、10/18 の時間割が「今日の時間割」（日付 10月18日）', n130.d.key === '2026-10-18' && n130.d.title === '今日の時間割' && n130.d.date === '10月18日（日）', JSON.stringify(n130.d));
  ok('… 区切りが変わって重なった古い時限は、あとから出したほう（0:30 の頼み）を空いている2限へ直して保存する', JSON.stringify(n130.tt.rows) === '["1限 授業・黒板","2限 授業・黒板"]' &&
    JSON.stringify(n130.per) === '["p:1","a:1","n:2"]', JSON.stringify(n130));
  await openSweepSheet();
  const s130 = await page.eval(SWEEP);
  ok('… 1:30 に開いた掃除の時間には、10/18 の頼み2つが今日の頼みとして出る（前の日からの続きではない）', /^1\/2/.test(s130.pos) && !s130.carryTag && /資料を3枚に/.test(s130.chalk), JSON.stringify(s130));
  await page.eval(`document.querySelector('#sheet-sweep [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = '明日の朝までに、表を見直して'; t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(350);
  const w130 = await page.eval(`(() => { const st = ${SAVED}, b = st.boards[st.boards.length - 1]; return { per: b.period, day: SekigaeEngine.dayKey(b.createdAt), date: document.getElementById('room-date').textContent, rows: ${TT}.rows }; })()`);
  ok('… 1:30 に出した頼みは 10/18 の頼み（空いている3限に入り、黒板の日付も 10月18日）', w130.per === 3 && w130.day === '2026-10-18' && w130.date === '10月18日（日）' && w130.rows[2] === '3限 授業・黒板', JSON.stringify(w130));
  await unClock(clk);
  await page.eval('localStorage.clear(); true');
  await page.load(base);

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
