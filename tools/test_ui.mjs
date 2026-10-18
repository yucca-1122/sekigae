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
  rows: [...document.querySelectorAll('#tt-list .tt-row[data-bid]')].map((r) => r.querySelector('.tt-p').childNodes[0].textContent + ' ' + r.querySelector('.tt-s').textContent + '・' + r.querySelector('.tt-ch-t').textContent),
  now: [...document.querySelectorAll('#tt-list .tt-row.is-now')].map((r) => r.dataset.bid),
  slots: [...document.querySelectorAll('#tt-list > li')].map((li) => li.querySelector('.tt-p') ? li.querySelector('.tt-p').childNodes[0].textContent : li.querySelector('.tt-row').childNodes[0].textContent.trim()),
  marks: [...document.querySelectorAll('#tt-list .tt-mark')].map((m) => m.closest('.tt-row').dataset.bid + ':' + m.textContent),
  sel: [...document.querySelectorAll('#tt-list > li.tt-now > .tt-row')].map((r) => r.dataset.slot),
  empty: [...document.querySelectorAll('#tt-list .tt-row.is-empty')].map((r) => r.querySelector('.tt-p').textContent + (r.tagName === 'BUTTON' ? '+' : '-')),
  more: document.getElementById('tt-more').hidden ? '' : document.getElementById('tt-more').textContent,
  prev: !document.getElementById('tt-prev').disabled, next: !document.getElementById('tt-next').disabled }))()`;
/* 掃除の時間のようす */
/* v0.3.1：時間割の選んでいる行の「直す」と、黒板の下の行 */
const TTEDIT = `(() => { const li = document.querySelector('#tt-list .tt-now'), e = li && li.querySelector('.tt-edit'), r = li && li.querySelector('.tt-row'), er = e ? e.getBoundingClientRect() : { width: 0, height: 0 };
  return { metaHidden: document.getElementById('room-meta').hidden, oldEdit: !!document.getElementById('room-edit'), oldCopy: !!document.getElementById('room-copy'),
    edits: document.querySelectorAll('#tt-list .tt-edit').length, nowBid: r ? r.dataset.bid : '', ew: Math.round(er.width), eh: Math.round(er.height),
    liOver: li ? li.scrollWidth > li.clientWidth + 1 : true, rowOver: r ? r.scrollWidth > r.clientWidth + 1 : true,
    cut: [...document.querySelectorAll('#tt-list .tt-s')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent) }; })()`;
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
// v0.3.1：昼休みは丸いテーブルを出さず、今ある机のとなりあう席に移る。groups＝まとまりごとの人数・kids＝昼休みの机にいる生徒・desks＝授業の机にいる生徒
const LUNCH = `(() => { const ld = [...document.querySelectorAll('#room-rows button.desk.is-lunch')], g = {}, st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}));
  ld.forEach((d) => { g[d.dataset.group] = (g[d.dataset.group] || 0) + 1; });
  return { on: !!(st.time && st.time.slot === 'lunch'), chalk: document.getElementById('room-chalk').textContent,
    note: document.getElementById('room-meta').hidden ? '' : document.getElementById('room-note').textContent, lunchNote: !!document.getElementById('room-lunch-note'),
    groups: Object.keys(g).sort().map((k) => String(g[k])), kids: ld.length, desks: document.querySelectorAll('#room-rows button.desk:not(.is-lunch)').length,
    allDesks: document.querySelectorAll('#room-rows .desk').length, round: document.querySelectorAll('.lunch-group, .lunch-table, .lunch-rug, .lunch-kid, #room-lunch').length,
    row: (document.getElementById('tt-lunch') || {}).textContent || '', tea: !document.getElementById('room-tea').hidden, btn: document.getElementById('btn-write').textContent,
    writeOff: document.getElementById('btn-write').getAttribute('aria-disabled') === 'true', badges: document.querySelectorAll('#room-rows .badge-talk').length,
    saved: st.time, ow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`;
/* 机の並びの中の場所：{ 生徒: [段, 列, 向き（昼休みの机なら度）, まとまり] }（段は前の席から数える） */
const LUNCHPOS = `(() => { const nc = window.matchMedia('(min-width: 760px)').matches ? 5 : 3, out = {}; let line = 0;
  document.querySelectorAll('#room-rows .row').forEach((r) => { const ds = [...r.querySelectorAll('.row-desks > .seat > .desk')];
    ds.forEach((d, i) => { if (d.dataset.sid) out[d.dataset.sid] = [line + Math.floor(i / nc), i % nc, d.classList.contains('is-lunch') ? parseInt(d.style.getPropertyValue('--rot'), 10) : null, d.dataset.group || null]; });
    line += ds.length / nc; });
  return out; })()`;
/* まとまりごとに、全員がとなりあう席（前後・左右）でつながっているか */
function lunchAdjacent(pos) {
  const g = {};
  Object.keys(pos).forEach((id) => { const p = pos[id]; (g[p[3]] = g[p[3]] || []).push(p); });
  return Object.keys(g).every((k) => { const c = g[k], seen = new Set([0]); let more = true;
    while (more) { more = false; c.forEach((a, i) => { if (!seen.has(i) && [...seen].some((j) => Math.abs(c[j][0] - a[0]) + Math.abs(c[j][1] - a[1]) === 1)) { seen.add(i); more = true; } }); }
    return c.length >= 2 && seen.size === c.length; });
}
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
const ROOM = `(() => { const say = document.getElementById('room-say'), st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || 'null');
  return { chalk: document.getElementById('room-chalk').textContent, print: !!document.getElementById('room-print'),
    papers: [...document.querySelectorAll('#room-rows .desk-paper')].map((p) => p.dataset.sid).sort(), paperBid: [...new Set([...document.querySelectorAll('#room-rows .desk-paper')].map((p) => p.dataset.bid))],
    say: say.hidden ? '' : document.getElementById('room-say-text').textContent, sayK: document.getElementById('room-say-k').textContent, sayOff: say.classList.contains('is-off'),
    sayOp: say.hidden ? 0 : Number(getComputedStyle(say).opacity), speaker: !document.getElementById('room-speaker').disabled, cur: st && st.currentId, time: st && st.time,
    date: document.getElementById('room-date').textContent }; })()`;
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
const SPEAKERX = `(() => { const p = document.getElementById('room-speaker').getBoundingClientRect(), r = document.getElementById('room-rows').getBoundingClientRect();
  return Math.round((p.left + p.width / 2) - (r.left + r.width / 2)); })()`;
/* v0.4 段A：放送の吹き出しと大きい黒板が重ならない（吹き出しはスピーカーの下・黒板の上）。お便りを大きく読む紙 */
const SAYBOX = `(() => { const s = document.getElementById('room-say'), b = document.getElementById('room-board').getBoundingClientRect(), r = s.getBoundingClientRect();
  return { shown: !s.hidden && !s.classList.contains('is-off'), below: Math.round(r.bottom) <= Math.round(b.top), boardH: Math.round(b.height) }; })()`;
const LETTERPOP = `(() => { const p = document.getElementById('letter-pop'), r = p.getBoundingClientRect();
  return { open: !p.hidden, text: document.getElementById('letter-pop-text').textContent, meta: document.getElementById('letter-pop-meta').textContent,
    to: document.getElementById('letter-pop-to').textContent, inView: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1,
    expanded: [...document.querySelectorAll('#room-rows .desk-paper[aria-expanded="true"]')].map((x) => x.dataset.sid) }; })()`;
/* 見出し（アイコン・題・説明がない／タブと「？」はある）と、ふだんは出さない説明の文 */
const HEAD = `(() => { const h1 = document.querySelector('header h1'), hr = h1 ? h1.getBoundingClientRect() : { width: 0, height: 0 };
  return { logo: !!document.querySelector('.logo, .brand, .brand-sub'), h1Shown: !!h1 && hr.width > 2 && hr.height > 2, h1Text: h1 ? h1.textContent : '', help: !!document.getElementById('btn-help'),
    tabs: document.querySelectorAll('header [role="tab"]').length, title: document.title }; })()`;
const NOTES = `(() => { const vis = (el) => !!el && !el.hidden && el.getBoundingClientRect().width > 2 && getComputedStyle(el).visibility !== 'hidden';
  const tip = document.getElementById('room-shuffle-tip'), sh = document.getElementById('room-shuffle');
  return { seatNote: [...document.querySelectorAll('.floor p, .floor span')].some((p) => vis(p) && /席の前後は|机を押すと、その生徒の目線/.test(p.textContent)),
    shuffleText: [...document.querySelectorAll('.seat-tools span, .seat-tools p')].some((p) => vis(p) && /左右の席だけくじで/.test(p.textContent)),
    shuffleTitle: sh.title, tip: vis(tip), tipText: tip ? tip.textContent : '', lunchNote: [...document.querySelectorAll('.floor p')].some((p) => vis(p) && /となりあう席に集まっている/.test(p.textContent)),
    labels: [...document.querySelectorAll('#room-rows .row-label')].map((l) => l.textContent + (vis(l) ? '+' : '-')),
    exNote: vis(document.getElementById('room-ex')) }; })()`;
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
    // v0.4 段A：見出しはタブと「？」だけ（アイコン・題・説明は見えない。ページの題はそのまま）・説明の文はふだん出さない・列の名前は読み上げ用だけ
    const hd = await page.eval(HEAD), nt = await page.eval(NOTES);
    ok('見出しはタブ4つと「？」だけ（アイコン・題・説明は見えない。読み上げ用の題とページの題は「マネジメント教室」のまま）', !hd.logo && !hd.h1Shown && hd.h1Text === 'マネジメント教室' &&
      hd.help && hd.tabs === 4 && hd.title === 'マネジメント教室', JSON.stringify(hd));
    ok('席の説明の文・席替えの説明・昼休みの説明はふだん出ない（見本を消す文は残る）・席替えの説明はカーソルを合わせると出る（title）', !nt.seatNote && !nt.shuffleText && !nt.lunchNote && !nt.tip &&
      nt.shuffleTitle === '前後は「慣れ」のまま、左右の席だけくじで入れ替えます' && nt.exNote, JSON.stringify(nt));
    ok('教室の列の名前（前の席・中ほどの席・後ろの席）は見えない（読み上げ用には残る）', JSON.stringify(nt.labels) === JSON.stringify(['前の席-', '中ほどの席-', '後ろの席-']), JSON.stringify(nt.labels));
    const bg = await page.eval(`getComputedStyle(document.body).backgroundColor`);
    ok('body に背景色（' + (V.dark ? 'ダーク' : 'ライト') + '）', V.dark ? bg === 'rgb(18, 24, 21)' : bg === 'rgb(238, 242, 239)', bg);
    await page.shot('01_教室_' + V.tag + '.png', true);
    // 2026-10-18 調整 K: 先生と教卓は、大きい黒板の真ん中の下（パソコンでは右に時間割があっても）
    const dxT = await page.eval(TEACHER);
    ok('先生と教卓は教室（席の列）の真ん中（中心の差 ' + dxT + 'px・±8px 以内）', Math.abs(dxT) <= 8, String(dxT));
    // v0.4 段A：スピーカーも、大きい黒板の真ん中ではなく教室（席の列）の真ん中
    const dxS = await page.eval(SPEAKERX);
    ok('スピーカーも教室（席の列）の真ん中（中心の差 ' + dxS + 'px・±8px 以内）', Math.abs(dxS) <= 8, String(dxS));

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
    // v0.4 段A：放課後を足して9行（期待を8行から変えた）
    ok('時間割の枠は9行（1〜4限・昼休み・5〜6限・掃除・放課後）・今日の空いている時限（4〜6限）は「＋」で押せる', JSON.stringify(tt.slots) === '["1限","2限","3限","4限","昼休み","5限","6限","掃除の時間","放課後"]' &&
      JSON.stringify(tt.empty) === '["4限+","5限+","6限+"]' && tt.more === '', JSON.stringify(tt));
    await page.eval('window.scrollTo(0, 0); true');
    await sleep(150);
    await page.shot('10_時間割のある教室_' + V.tag + '.png');
    // v0.4 段A：大きい黒板の右上の日付は縦書きのまま、2けたの数字を立てる（縦中横）。その下に今の時間
    const bdt = await page.eval(`(() => { const d = document.getElementById('room-date'); return { text: d.textContent, mode: getComputedStyle(d).writingMode, time: (d.querySelector('.bd-time') || {}).textContent || '',
      tcy: [...d.querySelectorAll('.bd-date .tcy')].map((x) => x.textContent + ':' + getComputedStyle(x).textCombineUpright + ':' + (x.getBoundingClientRect().width > x.getBoundingClientRect().height ? 'w' : 'h')) }; })()`);
    ok('大きい黒板の右上：縦書きの日付の数字（月・日）は縦中横でまっすぐ立つ・その下に今の時間「1限」', bdt.mode === 'vertical-rl' && bdt.tcy.length === 2 && bdt.tcy.every((x) => x.split(':')[1] === 'all') &&
      bdt.time === '1限' && /^\d+月\d+日（.）1限$/.test(bdt.text), JSON.stringify(bdt));
    if (V.tag === '1280_light') await page.shot('31_黒板の日付と今の時間_1280_light.png');
    const boardH0 = (await page.eval(SAYBOX)).boardH;
    // ---- v0.3.1：時間割の選んでいる行に「直す」（黒板の下の「いまの黒板・相手・直す・コピー」の行はなし） ----
    const tm = await page.eval(TTEDIT);
    ok('黒板の下の「いまの黒板・相手・直す・コピー」の行はない・選んでいる行（1限）の右端にだけ「直す」', tm.metaHidden && !tm.oldEdit && !tm.oldCopy && tm.edits === 1 && tm.nowBid === 'ex-b1', JSON.stringify(tm));
    ok('… 「直す」は押しやすい大きさで、行の文字があふれない・科目名が切れない（' + (V.w >= 760 ? 'パソコン' : 'スマホの2列') + '）', tm.ew >= (V.mobile ? 40 : 30) && tm.eh >= (V.mobile ? 30 : 24) && !tm.liOver && !tm.rowOver && !tm.cut.length, JSON.stringify(tm));
    await page.pressEl('#tt-list .tt-now .tt-edit');
    await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
    await sleep(250);
    const te = await page.eval(SHEET);
    ok('選んでいる行の「直す」で、その頼みの「頼みごとを直す」が開く（文のコピーもシートから）', te.open && te.title === '頼みごとを直す' && te.text === 'これ、簡単にまとめておいて。なるはやで！' &&
      !!(await page.eval(`document.getElementById('write-copy')`)) && (await page.eval(`!document.getElementById('room-meta').hidden && document.getElementById('room-note').textContent`)) === '書いている途中（まだ出していない）', JSON.stringify(te));
    await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
    await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
    await sleep(150);
    ok('… 閉じると、黒板の下の行はまた出ない・横にはみ出さない', (await page.eval(`document.getElementById('room-meta').hidden`)) && (await page.eval(OVERFLOW)) <= 0);
    // お便り：時間割の2限を押す → 2限の時間になる（v0.4 段A：大きい黒板には何も書かず、お便りは相手の机に小さな紙。教卓の前のプリントはなくした）
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b2"]');
    await sleep(250);
    let rm = await page.eval(ROOM);
    ok('時間割の行（2限）を押すと、2限の時間になる（いまの黒板＝2限・強調も移る・選んだ時間は保存）', rm.cur === 'ex-b2' && JSON.stringify((await page.eval(TT)).now) === '["ex-b2"]' &&
      !!rm.time && rm.time.slot === 2, JSON.stringify(rm));
    const tm2 = await page.eval(TTEDIT);
    ok('… 「直す」も2限に移る・いちばん長い行（2限 手伝い・お便り）でも科目名が切れない', tm2.edits === 1 && tm2.nowBid === 'ex-b2' && !tm2.liOver && !tm2.rowOver && !tm2.cut.length, JSON.stringify(tm2));
    ok('お便り: 大きい黒板には一言を書かない（「（お便りで配った）」なし）・教卓の前のプリントはない・相手2人の机それぞれに小さな紙', rm.chalk === '' && !rm.print &&
      JSON.stringify(rm.papers) === '["ex-s1","ex-s2"]' && JSON.stringify(rm.paperBid) === '["ex-b2"]' && !rm.speaker && /2限$/.test(rm.date), JSON.stringify(rm));
    ok('お便り: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
    await page.shot('11_お便り_' + V.tag + '.png', true);
    await page.pressEl('#room-rows .desk-paper[data-sid="ex-s1"]');
    await sleep(350);
    let lp = await page.eval(LETTERPOP);
    ok('机の紙を押すと、そのお便りが大きく読める（時限と科目・本文・配った相手）・画面からはみ出さない', lp.open && lp.meta === '2限 手伝い' && lp.text === '来週の準備で、資料の印刷を手伝ってもらえると助かります' &&
      lp.to === '配った相手：はじめての生徒さん、慣れた生徒さん' && lp.inView && JSON.stringify(lp.expanded) === '["ex-s1"]' && (await page.eval(OVERFLOW)) <= 0, JSON.stringify(lp));
    if (V.tag === '390_light') await page.shot('32_お便りを開いた_390_light.png');
    await page.pressEl('#room-rows .desk-paper[data-sid="ex-s1"]');
    await sleep(200);
    ok('… もう一度押すと閉じる（机の目線は開かない）', !(await page.eval(LETTERPOP)).open && (await page.eval(`document.getElementById('view').hidden`)));
    if (!V.mobile) {
      // パソコン：カーソルを合わせると出て、外すと消える
      const pr = await page.eval(`(() => { const r = document.querySelector('#room-rows .desk-paper[data-sid="ex-s2"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pr.x, y: pr.y });
      await sleep(250);
      const hov = await page.eval(LETTERPOP);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await sleep(200);
      ok('パソコン: 机の紙にカーソルを合わせると大きく読め、外すと消える', hov.open && JSON.stringify(hov.expanded) === '["ex-s2"]' && !(await page.eval(LETTERPOP)).open, JSON.stringify(hov));
    }
    // 放送：3限を押す → その時間の間は、スピーカーの下に吹き出しがずっと出ている（v0.4 段A：3秒で消える形から変えた）
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b3"]');
    await page.eval('window.scrollTo(0, 0); true');
    await sleep(550);
    rm = await page.eval(ROOM);
    // v0.4 段C：お便りは終わるまで相手の机に残るので、3限でも2限のお便り（まだ終わっていない）は机にある（期待を「机に紙はない」から変えた）
    ok('放送: 時間割の3限を押すと、スピーカーの下に吹き出しが出る（放送中…）・大きい黒板には一言を書かない・机には、まだ終わっていない2限のお便りが残る', rm.cur === 'ex-b3' && rm.say === 'あとで部屋の片づけ、お願いね' &&
      rm.sayK === '放送中…' && rm.sayOp > 0.6 && rm.speaker && rm.chalk === '' && JSON.stringify(rm.papers) === '["ex-s1","ex-s2"]' && JSON.stringify(rm.paperBid) === '["ex-b2"]', JSON.stringify(rm));
    const sbx = await page.eval(SAYBOX);
    ok('放送: 吹き出しはスピーカーの下で、大きい黒板に重ならない（黒板の高さは変わらない）', sbx.shown && sbx.below && sbx.boardH === boardH0, JSON.stringify([sbx, boardH0]));
    await page.shot('12_放送_' + V.tag + '.png');
    await sleep(3600);
    rm = await page.eval(ROOM);
    ok('放送: 3秒たっても、その時間の間は出したまま', rm.say === 'あとで部屋の片づけ、お願いね' && !rm.sayOff && rm.sayOp > 0.9, JSON.stringify(rm));
    await page.pressEl('#room-speaker');
    await sleep(700);
    rm = await page.eval(ROOM);
    ok('放送: スピーカーを押すと、吹き出しがふわっと消える', rm.sayOff && rm.sayOp < 0.05, JSON.stringify(rm));
    await page.pressEl('#room-speaker');
    await sleep(700);
    rm = await page.eval(ROOM);
    ok('放送: もう一度押すと、また出る', !rm.sayOff && rm.sayOp > 0.9 && rm.say === 'あとで部屋の片づけ、お願いね', JSON.stringify(rm));
    ok('放送: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
    // お便りの生徒の目線：机の上の紙
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b2"]');
    await sleep(150);
    await page.pressEl('button.desk[data-sid="ex-s1"]');
    await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
    await sleep(300);
    let v2 = await page.eval(VIEW2);
    // v0.4 段B：生徒の目線の黒板の注記（「（お便りで配った）お便りは机の上にある」）もなくした（期待を変えた）
    ok('お便りの目線: 頼みは机の上の紙（1枚）に見え、「？」の吹き出しは紙のまわり・黒板には何も書かない', v2.ch === 'letter' && v2.desk && v2.papers === 1 && v2.under === 0 &&
      v2.paper === '来週の準備で、資料の印刷を手伝ってもらえると助かります' && v2.deskBubbles === 6 && v2.boardBubbles === 0 && v2.chalk === '' && !v2.myDesk && !v2.pa, JSON.stringify(v2));
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
    // v0.4 段B：生徒の目線の黒板の注記（「（放送で伝えた）」）もなくした（期待を変えた）
    ok('放送の目線: スピーカーの文字が薄れたあと（文字はうすい）・黒板には何も書かない', v2.pa && v2.paText.indexOf('あとで部屋の片づけ、お願いね') === 0 && v2.paOp < 0.6 && v2.chalk === '' && !v2.desk, JSON.stringify(v2));
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
    // v0.4 段A：昼休みの枠にもふつうの頼みが入るので、チップは7つ（期待を6つから変えた）
    ok('頼みごとを出すシート: 枠のチップ7つ（1〜4限・昼休み・5〜6限。うまっている1〜3限は選べない・今の時間の3限はうまっているので、いちばん早い空きの4限）', shp.pn === 7 &&
      JSON.stringify(shp.pdis) === '[1,2,3]' && shp.period === 4, JSON.stringify(shp));
    await page.eval(`(() => { document.getElementById('write-ch-letter').click(); document.getElementById('write-subj-0').click(); const t = document.getElementById('write-text');
      t.value = '金曜の会議の資料を、A4 1枚にまとめてもらえると助かります'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(200);
    // v0.4 段A：教卓の前のプリントはなくした。書いている途中のお便りは、シートの書く欄（お便りの紙の見た目）だけ
    const wl0 = await page.eval(ROOM);
    // v0.4 段C：机に残っているのは、まだ終わっていない2限のお便りだけ（書いている途中のお便りは机に出さない。期待を「机の紙もない」から変えた）
    ok('シートでお便りを選ぶと、書く欄がお便りの紙の見た目になる（書いている途中のお便りは教室に出さない：机にあるのは、まだ終わっていない2限のお便りだけ）', (await page.eval(`document.getElementById('write-slate').dataset.ch`)) === 'letter' &&
      !wl0.print && JSON.stringify(wl0.paperBid) === '["ex-b2"]', JSON.stringify(wl0));
    // 書いている途中の教室は、書いている枠（4限）のようす：今の時間（3限）の放送の吹き出しは出さず、黒板の右上は「4限」
    ok('… 書いている途中の教室は、書いている枠（4限）のようす（3限の放送の吹き出しは出ない・黒板の右上は「4限」）', wl0.say === '' && /4限$/.test(wl0.date), JSON.stringify(wl0));
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
    ok('今日の頼みが1つの日と6つの日で、大きい黒板と時間割の高さが同じ（枠は9行のまま）', h1.board === h6.board && h1.tt === h6.tt && h1.slots === 9 && h6.slots === 9, JSON.stringify([h1, h6]));
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
    // v0.4 段A：掃除の行を押すと時間は「掃除」になり、閉じても「掃除」のまま（期待を「いまの黒板（1限）にもどる」から変えた）。行には掃除のあとの印
    const sw2 = await page.eval(ROOM), stt = await page.eval(TT);
    ok('「教室にもどる」で閉じると、時間は「掃除」のまま（大きい黒板は日付と「掃除」だけ）・時間割の掃除の行を選んでいる', sw2.chalk === '' && /掃除$/.test(sw2.date) && !!sw2.time && sw2.time.slot === 'sweep' &&
      JSON.stringify(stt.sel) === '["sweep"]' && !(await page.eval(`document.getElementById('room-board').classList.contains('is-sweeping')`)), JSON.stringify([sw2, stt.sel]));
    ok('… 掃除のあと、時間割の行に小さな印（途中・まだが残った1限・2限・3限は「続き」）', JSON.stringify(stt.marks) === '["ex-b1:続き","ex-b2:続き","ex-b3:続き"]', JSON.stringify(stt.marks));

    // ---- v0.3 第3段：昼休み（見本の2人） ----
    await page.eval('window.scrollTo(0, 0); true');
    const cpos = await page.eval(LUNCHPOS);
    await page.eval(`document.getElementById('tt-lunch').click(); true`);
    await sleep(900);
    const ln = await page.eval(LUNCH), lpos = await page.eval(LUNCHPOS);
    // v0.3.1：丸いテーブルの輪をやめて、今ある机のとなりあう席に移る。v0.4 段A：黒板の大きい「昼休み」の字はなくし、時間割の行は「昼休み（…から）」（期待を変えた）
    ok('昼休み: 黒板には何も書かない・生徒2人はとなりあう机に移る（丸いテーブル・新しい机はない）・時間割と黒板の下は「昼休み（…から）」・横にはみ出さない', ln.on && ln.chalk === '' &&
      JSON.stringify(ln.groups) === '["2"]' && ln.kids === 2 && ln.desks === 0 && ln.round === 0 && ln.allDesks === (V.w >= 760 ? 15 : 9) && /^昼休み（\d+:\d\dから）$/.test(ln.row) &&
      /^昼休み（\d+:\d\dから）$/.test(ln.note) && ln.tea && ln.ow <= 0, JSON.stringify(ln));
    const lr = Object.values(lpos).map((p) => p[2]).sort((a, b) => a - b);
    ok('… 2人はとなりあう席で向かい合わせ（左右なら ±90度・前後なら 0度と180度）', lunchAdjacent(lpos) && (JSON.stringify(lr) === '[-90,90]' || JSON.stringify(lr) === '[0,180]'), JSON.stringify(lpos));
    // 写真はお知らせが消えてから
    if (V.tag !== '390_dark') { await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 7000); await sleep(350); await page.shot('24_昼休みの教室_' + V.tag + '.png', true); }
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b3"]');
    await sleep(900);
    const lb = await page.eval(LUNCH);
    ok('昼休みのあと、ほかの行（3限）を押すと3限になり、生徒は自分の席にもどる（「授業にもどる」はない）', !lb.on && lb.desks === 2 && lb.kids === 0 && !!lb.saved && lb.saved.slot === 3 && lb.row === '昼休み' &&
      !(await page.eval(`!!document.getElementById('room-lunch-end')`)) && JSON.stringify(await page.eval(LUNCHPOS)) === JSON.stringify(cpos), JSON.stringify([lb, cpos]));
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
  const seatIdx = await page.eval(`(() => { const idx = (seat, sid) => [...document.querySelectorAll('.row[data-seat="' + seat + '"] .row-desks > .seat')].findIndex((el) => { const d = el.querySelector('.desk'); return !!d && d.dataset.sid === sid; });
    return [idx('front', 'ex-s2'), idx('back', 'ex-s1')]; })()`);
  ok('席: 見本の生徒は左右ばらばら（慣れた生徒＝前の2番目・はじめての生徒＝後ろの3番目）', seatIdx[0] === 1 && seatIdx[1] === 2, JSON.stringify(seatIdx));
  await page.eval(`document.getElementById('room-shuffle').click(); true`);
  await sleep(250);
  const sh = await page.eval(`({ n: document.querySelectorAll('button.desk').length, cols: JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).students.map((s) => s.col),
    toast: document.getElementById('toast').classList.contains('is-on') })`);
  ok('席替え: 生徒は2人のまま、左右の席（0〜4）が決まり直す・お知らせ「左右の席をくじで入れ替えたよ（前後は「慣れ」のまま）」', sh.n === 2 && sh.cols.every((c) => Number.isInteger(c) && c >= 0 && c < 5) && sh.toast &&
    (await page.eval(`document.getElementById('toast-msg').textContent`)) === '左右の席をくじで入れ替えたよ（前後は「慣れ」のまま）', JSON.stringify(sh));
  // スマホ：席替えのボタンを長押しすると小さな説明が出る（席替えはしない）
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 4000);
  const lpb = await page.eval(`(() => { const b = document.getElementById('room-shuffle'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const colsBefore = await page.eval(`${SAVED}.students.map((s) => s.col)`);
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lpb.x, y: lpb.y }] });
  await sleep(800);
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  const lpn = await page.eval(NOTES);
  ok('スマホ：席替えのボタンを長押しすると「前後は「慣れ」のまま、左右の席だけくじで入れ替えます」の小さな説明が出る（席替えはしない）', lpn.tip &&
    lpn.tipText === '前後は「慣れ」のまま、左右の席だけくじで入れ替えます' && JSON.stringify(await page.eval(`${SAVED}.students.map((s) => s.col)`)) === JSON.stringify(colsBefore), JSON.stringify([lpn, colsBefore]));
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

  // ---- v0.3 第1段 → v0.4 段B：頼みごとを出す（伝え方・自分で書く科目名）・直す（伝え方のタブ）・「要点をお便りでも送る」・机に重なるお便り ----
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
  // v0.3.1 から「直す」は時間割の選んでいる行の右端（黒板の下の「直す」はなくした）
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  const TABS3 = `({ ch: document.querySelector('input[name="write-ch"]:checked').value, text: document.getElementById('write-text').value, submit: document.getElementById('write-submit').textContent,
    del: !document.getElementById('write-del').hidden, has: ['board', 'letter', 'broadcast'].map((c) => c + ':' + (document.getElementById('write-has-' + c).hidden ? '' : document.getElementById('write-has-' + c).textContent)) })`;
  const ed = await page.eval(`({ title: document.getElementById('write-title').textContent, ch: document.querySelector('input[name="write-ch"]:checked').value,
    free: document.getElementById('write-subject').value, chip: document.querySelectorAll('input[name="write-subj"]:checked').length, text: document.getElementById('write-text').value, tabs: ${TABS3} })`);
  ok('「直す」で開くと、伝え方・科目名（自分で書いた名前）・文がそのまま入っている・書いてある伝え方（お便り）に印・「この伝え方の頼みを消す」がある', ed.title === '頼みごとを直す' && ed.ch === 'letter' &&
    ed.free === '読書会' && ed.chip === 0 && ed.text === 'これ、ざっと読んでおいて。金曜までに' && JSON.stringify(ed.tabs.has) === '["board:","letter:書いてある","broadcast:"]' && ed.tabs.del && ed.tabs.submit === '直す', JSON.stringify(ed));
  // v0.4 段B：伝え方のカードはタブ。放送のタブを押すと、お便りとは別の頼み（まだない＝新しく書く）に切り替わる（期待を「伝え方をお便りから放送に変える」から変えた）
  await page.eval(`document.getElementById('write-ch-broadcast').click(); true`);
  await sleep(100);
  const tb1 = await page.eval(TABS3);
  ok('放送のタブを押すと、放送の頼み（まだない）に切り替わる：文は空・「出す」・消すボタンはない', tb1.ch === 'broadcast' && tb1.text === '' && tb1.submit === '出す' && !tb1.del, JSON.stringify(tb1));
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = 'これ、ざっと読んでおいて。金曜までに'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-subj-0').click(); document.getElementById('first-ex-s2').click(); return true; })()`);
  await sleep(100);
  ok('直す途中でチップ（ゼミ）を選ぶと、自分で書いた欄は空になる・放送のタブに「書きかけ」の印', (await page.eval(`document.getElementById('write-subject').value`)) === '' &&
    JSON.stringify((await page.eval(TABS3)).has) === '["board:","letter:書いてある","broadcast:書きかけ"]');
  await page.eval(`document.getElementById('write-ch-letter').click(); true`);
  await sleep(100);
  ok('… お便りのタブにもどると、お便りの文のまま（放送の書きかけは放送のタブに残る）', (await page.eval(TABS3)).text === 'これ、ざっと読んでおいて。金曜までに' &&
    JSON.stringify((await page.eval(TABS3)).has) === '["board:","letter:書いてある","broadcast:書きかけ"]');
  await page.eval(`document.getElementById('write-submit').click(); true`);
  await sleep(400);
  st3 = await page.eval(SAVED);
  const eb = st3.boards.find((b) => b.channel === 'broadcast' && !b.example), el = st3.boards.find((b) => b.id === nl.id);
  ok('出すと、4限にお便りと放送の2つ（科目名は枠で1つ：読書会→ゼミで両方そろう・初めての作業は放送だけ）', st3.boards.length === 5 && !!eb && eb.period === 4 && el.period === 4 && el.channel === 'letter' &&
    eb.subject === 'ゼミ' && el.subject === 'ゼミ' && eb.firstTime['ex-s2'] === true && !el.firstTime['ex-s2'] && (await page.eval(TT)).rows[3] === '4限 ゼミ・お便り・放送', JSON.stringify([eb, el]));
  const r4 = await page.eval(ROOM);
  ok('… 4限の教室：放送はスピーカーの吹き出しに、お便りは相手の机の紙に、同時に出る', r4.say === 'これ、ざっと読んでおいて。金曜までに' && JSON.stringify(r4.papers) === '["ex-s1","ex-s2"]', JSON.stringify(r4));
  // 伝え方ごとに消す：お便りのタブで「この伝え方の頼みを消す」
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  ok('「直す」でまた開くと、お便りと放送の両方に「書いてある」の印', JSON.stringify((await page.eval(TABS3)).has) === '["board:","letter:書いてある","broadcast:書いてある"]');
  await page.eval(`(() => { document.getElementById('write-ch-letter').click(); document.getElementById('write-del').click(); return true; })()`);
  await page.waitFor(`!document.getElementById('confirm').hidden`, 2000);
  await page.eval(`document.getElementById('confirm-yes').click(); true`);
  await sleep(300);
  st3 = await page.eval(SAVED);
  ok('お便りのタブの「この伝え方の頼みを消す」で、お便りだけ消える（シートは開いたまま・放送は残る）', !st3.boards.some((b) => b.id === nl.id) && st3.boards.some((b) => b.id === eb.id) &&
    !(await page.eval(`document.getElementById('sheet-write').hidden`)) && JSON.stringify((await page.eval(TABS3)).has) === '["board:","letter:","broadcast:書いてある"]');
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  ok('… 時間割の4限は「ゼミ・放送」だけ・スピーカーから流れたまま', (await page.eval(TT)).rows[3] === '4限 ゼミ・放送' && (await page.eval(ROOM)).say === 'これ、ざっと読んでおいて。金曜までに');
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(300);
  const vb2 = await page.eval(VIEW2);
  // 2026-10-18 調整: はじめての生徒（Q1 A）への放送は ×1.5 に＋0.3 で ×1.8。足すものは「要点をお便りでも送る」
  ok('放送の目線: あいまいな言葉のにじみは強め（はじめての生徒は慣れていない生徒への放送なので 3.6px × 1.8 → 6.5px）', vb2.ch === 'broadcast' && vb2.blur === '6.5px', JSON.stringify(vb2));
  ok('放送の目線: お便りのない放送（3限）があるので「放送で聞いたことは、忘れるかも」、この放送にもお便りがないので「要点をお便りでも送る」が出る', vb2.day.indexOf('castOnly') >= 0 && vb2.chips[0] === '要点をお便りでも送る', JSON.stringify([vb2.day, vb2.chips]));
  // 要点をお便りでも送る → v0.4 段B：放送と同じ4限にお便りがないので、4限の「頼みごとを直す」をお便りのタブで開く（期待を「新しい頼みとして出す」から変えた）
  const POINT = '（さっきの放送の要点）\n何を：◯◯\nいつまで：◯◯';
  const sheetUp = `!document.getElementById('sheet-write').hidden && document.getElementById('view').hidden`;
  await page.pressEl('#view-chips [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(350);
  const sp = await page.eval(SHEET);
  ok('「要点をお便りでも送る」で、生徒の目線を閉じて4限のシートがお便りのタブで開く（科目名・相手・初めての作業は元の放送と同じ）', sp.open && sp.title === '頼みごとを直す' && sp.ch === 'letter' &&
    sp.subj === 'ゼミ' && sp.free === '' && JSON.stringify(sp.tgt) === '["ex-s1+","ex-s2+"]' && JSON.stringify(sp.first) === '["ex-s2"]' && sp.period === 4, JSON.stringify(sp));
  ok('… 文は要点の下書き（何を・いつまで）。書く欄の下に元の放送の文と「要点だけ書くと残りやすい」', sp.text === POINT &&
    sp.cast === 'さっきの放送：「これ、ざっと読んでおいて。金曜までに」要点だけ書くと残りやすい', JSON.stringify([sp.text, sp.cast]));
  await page.shot('18_要点のお便りシート_390_light.png');
  await page.eval(`document.getElementById('write-ch-board').click(); true`);
  const hid = await page.eval(SHEET);
  await page.eval(`document.getElementById('write-ch-letter').click(); true`);
  ok('黒板のタブに切り替えると元の放送の文は隠れ、お便りのタブに戻すとまた出る（要点の下書きもそのまま）', hid.cast === '' && (await page.eval(SHEET)).cast !== '' && (await page.eval(SHEET)).text === POINT, JSON.stringify(hid));
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = '何を：資料を読む\\nいつまで：金曜まで'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-submit').click(); return true; })()`);
  await sleep(400);
  st3 = await page.eval(SAVED);
  const pl = st3.boards[st3.boards.length - 1];
  ok('出すと、元の放送の id（fromCast）つきのお便りが同じ4限に入る（同じ文の書き写しは作らない）', st3.boards.length === 5 && pl.channel === 'letter' && pl.fromCast === eb.id &&
    pl.subject === 'ゼミ' && pl.text === '何を：資料を読む\nいつまで：金曜まで' && JSON.stringify(pl.targets) === JSON.stringify(eb.targets) && pl.firstTime['ex-s2'] === true &&
    pl.period === 4 && (await page.eval(TT)).rows[3] === '4限 ゼミ・お便り・放送', JSON.stringify(pl));
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(250);
  const v4 = await page.eval(`({ secs: [...document.querySelectorAll('#view-secs .vsec')].map((x) => x.dataset.ch), castChips: [...document.querySelectorAll('#view-secs .vsec[data-ch="broadcast"] .chips button')].map((b) => b.textContent.trim()), v: ${VIEW2} })`);
  ok('… 4限の目線は伝え方ごとの見出し（お便り・放送）で、放送の「要点をお便りでも送る」は消える（3限の放送はまだお便りがないので「放送で聞いたことは、忘れるかも」は残る）', JSON.stringify(v4.secs) === '["letter","broadcast"]' &&
    v4.castChips.indexOf('要点をお便りでも送る') < 0 && v4.v.day.indexOf('castOnly') >= 0, JSON.stringify(v4));
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  // 同じ枠にお便りがもうある放送の要点は、今までどおり空いている時限の新しい頼み（書きかけの頼みがあるときは上書きしない）
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b3"]');
  await sleep(200);
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { document.getElementById('write-ch-letter').click(); const t = document.getElementById('write-text'); t.value = '帰りに鍵も返してね'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-submit').click(); return true; })()`);
  await sleep(400);
  ok('3限（放送）にお便りを足すと「3限 雑務・お便り・放送」', (await page.eval(TT)).rows[2] === '3限 雑務・お便り・放送');
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = '書きかけのメモ'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sheet-write [data-close]').click(); return true; })()`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await page.pressEl('#view-secs .vsec[data-ch="broadcast"] [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(200);
  const sd = await page.eval(SHEET), tmsg = await page.eval(`document.getElementById('toast-msg').textContent`);
  ok('同じ枠にお便りがある放送の要点で、書きかけの頼みがあるときは上書きしない（書きかけのまま開いて「書きかけの頼みごとがあるよ…」と知らせる）', sd.title === '頼みごとを出す' && sd.text === '書きかけのメモ' && sd.cast === '' &&
    tmsg === '書きかけの頼みごとがあるよ。出すか消してから、もう一度押してね', JSON.stringify([sd, tmsg]));
  await page.eval(`(() => { const t = document.getElementById('write-text'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#sheet-write [data-close]').click(); return true; })()`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await page.pressEl('#view-secs .vsec[data-ch="broadcast"] [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(200);
  const s3 = await page.eval(SHEET);
  ok('書きかけを消してからもう一度押すと、要点の下書きで、空いている時限（5限）の新しい頼みとして開く（3限 雑務・元の放送の文）', s3.title === '頼みごとを出す' && s3.text === POINT && s3.subj === '雑務' &&
    s3.period === 5 && s3.cast.indexOf('あとで部屋の片づけ、お願いね') >= 0, JSON.stringify(s3));
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
  await page.pressEl('#view-secs .vsec[data-ch="broadcast"] [data-act="letter"]');
  await page.waitFor(sheetUp, 3000);
  await sleep(200);
  ok('… もう一度押すと、止められずに要点の下書きで開く', (await page.eval(SHEET)).text === POINT);
  await page.eval(`document.getElementById('write-submit').click(); true`);
  await sleep(400);
  st3 = await page.eval(SAVED);
  const pl3 = st3.boards[st3.boards.length - 1];
  ok('… 出すと fromCast＝3限のお便りが5限に入る', pl3.fromCast === 'ex-b3' && pl3.channel === 'letter' && pl3.subject === '雑務' && pl3.period === 5 && (await page.eval(TT)).rows[4] === '5限 雑務・お便り', JSON.stringify(pl3));
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(200);
  const vz = await page.eval(VIEW2);
  ok('どの放送にも要点のお便りがあるので、その日の「放送で聞いたことは、忘れるかも」が消える（5限を見る）', vz.ch === 'letter' && vz.day.indexOf('castOnly') < 0 && vz.day.length > 0, JSON.stringify(vz.day));
  // v0.4 段C：机の上のお便りは、まだ終わっていない前の時間のお便りが下に重なる（期待を「その日のお便りを全部重ねる」から変えた）
  ok('5限のお便りの目線: 机の上で、まだ終わっていない前の時間のお便りが下に重なる（上は5限・下の2枚は端だけ・「4 枚」）', vz.papers === 3 && vz.under === 2 &&
    vz.paper === POINT && /お便り 4 枚/.test(vz.cap), JSON.stringify(vz));
  await page.eval(`(() => { const v = document.getElementById('view'); v.scrollTop = document.getElementById('view-desk').offsetTop - 170; return true; })()`);
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 5000); await sleep(300);
  await page.shot('16_お便りが重なる_390_light.png');
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  await page.pressEl('#tab-subs');
  await sleep(200);
  const lessons = await page.eval(`[...document.querySelectorAll('.sub-card .sub-date .lesson')].map((x) => x.textContent)`);
  ok('提出物のカードは伝え方ごとの頼みを1件ずつ（「4限 ゼミ（放送）」「4限 ゼミ（お便り）」など）', ['1限 授業（黒板）', '2限 手伝い（お便り）', '3限 雑務（放送）', '3限 雑務（お便り）', '4限 ゼミ（放送）', '4限 ゼミ（お便り）', '5限 雑務（お便り）'].every((x) => lessons.indexOf(x) >= 0), JSON.stringify(lessons));
  ok('提出物（伝え方つき）: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.pressEl('#tab-report');
  await sleep(200);
  const RCH = `({ ch: [...document.querySelectorAll('#report-ch li')].map((x) => x.textContent.replace(/\\s+/g, '')), cast: document.getElementById('report-cast').textContent.replace(/\\s+/g, ''),
    hint: (document.getElementById('report-cast-hint') || {}).textContent || '', day: ((document.getElementById('report-day') || {}).textContent || '').replace(/\\s+/g, '') })`;
  const today = await page.eval(`SekigaeEngine.dayKey(Date.now())`), todayJa = today.split('-').map(Number).slice(1).join('/').replace(/^(\d+)\/(\d+)$/, '$1月$2日');
  const rch = await page.eval(RCH);
  // v0.4 段B：自分の頼みは4つ（4限の放送・4限の要点のお便り・3限のお便り・5限の要点のお便り）
  ok('通知表に伝え方の内訳（自分の頼み4つ: 黒板 0・お便り 3・放送 1）と「放送だけで終わった頼み 0」（0なので要点の一言は出ない）', JSON.stringify(rch.ch) === '["黒板0","お便り3","放送1"]' &&
    rch.cast === '放送だけで終わった頼み0' && rch.hint === '', JSON.stringify(rch));
  ok('通知表に「1日の頼み（いちばん多い日）4 本（' + todayJa + '）」', rch.day === '1日の頼み（いちばん多い日）4本（' + todayJa + '）', JSON.stringify(rch.day));
  await page.pressEl('#tab-export');
  await sleep(200);
  const md3 = await page.eval(`document.getElementById('export-text').value`);
  ok('書き出しに時限・科目・伝え方（同じ枠は 黒板 → お便り → 放送：「4限 ゼミ（お便り）」→「4限 ゼミ（放送）」・「1限 授業（黒板）（見本）」と内訳）', md3.indexOf(' 4限 ゼミ（放送）「これ、ざっと読んでおいて。金曜までに」') > md3.indexOf(' 4限 ゼミ（お便り）「') &&
    md3.indexOf(' 4限 ゼミ（お便り）「') >= 0 && md3.indexOf(' 1限 授業（黒板）（見本）「') >= 0 && md3.indexOf('- 伝え方の内訳: 黒板 0・お便り 3・放送 1（放送だけで終わった頼み 0）') >= 0, md3.slice(0, 600));
  ok('書き出しに「- 1日の頼み: いちばん多い日 4 本（' + today + '）」', md3.indexOf('- 1日の頼み: いちばん多い日 4 本（' + today + '）') >= 0, md3.slice(0, 600));
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
  // v0.3.1：前の日の頼みも、時間割の選んでいる行の「直す」から直せる
  const pe = await page.eval(TTEDIT);
  ok('前の日の時間割でも、選んでいる行（8日前の2限）の右端に「直す」', pe.edits === 1 && pe.nowBid === 'o2' && !pe.liOver && !pe.cut.length, JSON.stringify(pe));
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  const pes = await page.eval(SHEET);
  ok('… 押すと、前の日の頼みの「頼みごとを直す」が開く', pes.open && pes.title === '頼みごとを直す' && pes.text === '図を直して', JSON.stringify(pes));
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await sleep(150);
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
  await page.pressEl('#tt-list .tt-now .tt-edit');
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
  // v0.4 段A：昼休みの枠にもふつうの頼みが入るので、1〜6限がうまっていても昼休みが空いていれば開く（期待を変えた）
  const s6 = await page.eval(SHEET);
  ok('1〜6限が全部うまっていると「＋」はなく、「頼みごとを出す」は空いている昼休みを選んで開く', full.empty.length === 0 && full.rows.length === 6 && s6.open && s6.period === 4.5 &&
    JSON.stringify(s6.pdis) === '[1,2,3,4,5,6]', JSON.stringify([full, s6]));
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); const t = new Date(Date.now() - 3 * 3600000); t.setHours(12, 10, 0, 0);
    st.boards.push({ id: 'nL', text: '昼の頼み', channel: 'board', subject: '授業', period: 0, lunch: true, createdAt: t.getTime(), updatedAt: t.getTime(), targets: [], firstTime: {}, results: {} });
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  await page.pressEl('#btn-write');
  await sleep(300);
  ok('… 昼休みもうまっていると、開かずに知らせる', (await page.eval(`document.getElementById('sheet-write').hidden`)) &&
    (await page.eval(`document.getElementById('toast-msg').textContent`)) === '今日の時間割は6限と昼休みまでうまっているよ。明日に回すか、どれかを直してね');
  // 時限のない古いデータで、1日に8件ある日：1〜6限に入り、7・8件目は時間割の下に「この日はほかに 2 件」
  await page.eval(`(() => { const d = new Date(Date.now() - 3 * 3600000); d.setDate(d.getDate() - 3); d.setHours(8, 0, 0, 0);
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ v: 1, students: [{ id: 's1', name: '生徒A', color: 1, col: 1, answers: { q1: 'B' }, notes: {}, history: [], createdAt: d.getTime() }],
      boards: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: 'w' + i, text: '頼み' + i, createdAt: d.getTime() + i * 600000, targets: ['s1'], firstTime: {}, results: {} })), currentId: 'w8', ui: { tab: 'room' } })); return true; })()`);
  await page.load(base);
  await page.pressEl('#tt-prev');
  const w = await page.eval(`({ per: ${SAVED}.boards.map((b) => b.period), tt: ${TT} })`);
  ok('時限のない古いデータで8件ある日: 出した順に 1〜6限、7・8件目は時限なし（0）', JSON.stringify(w.per) === '[1,2,3,4,5,6,0,0]', JSON.stringify(w.per));
  ok('… その日の時間割は6つ埋まり、下に「この日はほかに 2 件（提出物で見られる）」・前の日の空きはない', w.tt.title === 'この日の時間割' && w.tt.rows.length === 6 && w.tt.more === 'この日はほかに 2 件（提出物で見られる）' && w.tt.empty.length === 0, JSON.stringify(w.tt));
  // 時間割に入らない頼み（w8）は時間割に行がないので、提出物のカードの「直す」から（v0.3.1 で黒板の下の「直す」はなくした）
  await page.pressEl('#tab-subs');
  await sleep(200);
  await page.pressEl('.sub-card[data-bid="w8"] [data-act="edit"]');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  const w8 = await page.eval(`({ s: ${SHEET}, note: document.getElementById('write-period-note').hidden ? '' : document.getElementById('write-period-note').textContent })`);
  // v0.4 段A：その日の昼休みの枠は空いているので、時限なしの頼みも昼休みには入れられる（期待を「時間割に入らない」から変えた）
  ok('… 時限なしの頼みを直すとき、1〜6限がうまっていれば選べるのは空いている昼休みだけ（まだ選ばれていない）', w8.s.period === 0 && JSON.stringify(w8.s.pdis) === '[1,2,3,4,5,6]' &&
    /空いている時限を選んで/.test(w8.note), JSON.stringify(w8));
  ok('… 時間割の外の頼み（時限なし）を直すときは、ほかの伝え方のタブは使わない（1つずつ直す）', (await page.eval(`['write-ch-board', 'write-ch-letter', 'write-ch-broadcast'].map((id) => document.getElementById(id).disabled)`)).join() === 'false,true,true');
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
  // v0.4 段A：掃除の行はいつでも押せる。掃除するものがないときは、わけを知らせる（期待を「押せない」から変えた）
  await page.pressEl('#tt-sweep');
  await sleep(300);
  ok('入口: 今日の頼みも前の日からの続きもない日も「掃除」の行は押せて、「今日はまだ頼みごとがないので、掃除するものはないよ」と知らせる（掃除の時間は開かない・時間は「掃除」）',
    (await page.eval(CARRY)).sweep === true && (await page.eval(`document.getElementById('sheet-sweep').hidden`)) &&
    (await page.eval(`document.getElementById('toast-msg').textContent`)) === '今日はまだ頼みごとがないので、掃除するものはないよ' && (await page.eval(`${SAVED}.time.slot`)) === 'sweep');
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
  ok('… 続きは枠の外に出るので、今日の時間割は9行の枠のまま（1〜6限は空き）・横にはみ出さない', JSON.stringify(ft.empty) === '["1限+","2限+","3限+","4限+","5限+","6限+"]' && ft.slots.length === 9 && (await page.eval(OVERFLOW)) <= 0, JSON.stringify(ft));
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
  // 動きを減らす設定の放送：その時間の間は出したまま（黒板には重ねない）。スピーカーを押すと、すぐ消える・出る
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b3"]');
  await sleep(3800);
  const rms = await page.eval(`(() => { const r = ${ROOM}, s = document.getElementById('room-say').getBoundingClientRect(), b = document.getElementById('room-board').getBoundingClientRect(); return Object.assign(r, { overBoard: s.bottom > b.top + 1 }); })()`);
  // v0.4 段A：今日の放送は「放送中…」（期待を「放送で伝えた」から変えた）
  ok('動きを減らす設定の放送: 3秒たっても薄れず出したまま（黒板に重ねない）', rms.say === 'あとで部屋の片づけ、お願いね' && rms.sayK === '放送中…' && rms.sayOp === 1 && !rms.overBoard, JSON.stringify(rms));
  ok('動きを減らす設定の放送: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.eval('window.scrollTo(0, 0); true');
  await page.shot('17_放送_動きを減らす設定_390_light.png');
  await page.pressEl('#room-speaker');
  await sleep(60);
  const rmo = await page.eval(ROOM);
  await page.pressEl('#room-speaker');
  await sleep(60);
  ok('動きを減らす設定: スピーカーを押すと、すぐ消える・もう一度押すと、すぐ出る', rmo.sayOff && rmo.sayOp === 0 && (await page.eval(ROOM)).sayOp === 1, JSON.stringify(rmo));
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
  ok('古いデータ（「話を聞いた」の記録なし）も読み込み、記録は空として保存し直す（選んだ時間もまだない）', await page.eval(`${SAVED}.students.every((s) => Array.isArray(s.talks) && !s.talks.length) && !('lunch' in ${SAVED}) && ${SAVED}.time === null`));
  const cpos5 = await page.eval(LUNCHPOS);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(80);
  const flip = await page.eval(`[...document.querySelectorAll('#room-rows .desk.is-lunch .kid')].map((k) => k.style.transition)`);
  await sleep(900);
  let lq = await page.eval(LUNCH);
  const lp5 = await page.eval(LUNCHPOS);
  // v0.3.1：丸いテーブルの輪をやめて、今ある机のとなりあう席に移る（期待を「近くの席どうしで輪」から変えた）
  ok('5人なら、今ある机のとなりあう席で3人と2人のまとまりになる（ふわっと動く・全員がとなりあう席・机の数は変わらない）', JSON.stringify(lq.groups) === '["3","2"]' && lq.kids === 5 &&
    lq.desks === 0 && lq.round === 0 && lunchAdjacent(lp5) && flip.some((x) => /transform/.test(x)), JSON.stringify([lq, lp5, flip]));
  ok('… 生徒の向きが変わる（まとまりの真ん中の方を向く）・移った机に名札', Object.values(lp5).some((p) => p[2] !== 0) &&
    (await page.eval(`[...document.querySelectorAll('#room-rows .desk.is-lunch')].every((d) => d.querySelector('.tag-n').textContent.length > 0)`)), JSON.stringify(lp5));
  // v0.4 段A：下のボタンはいつも「頼みごとを出す」。昼休みの枠にも、ふつうの頼み（黒板・お便り・放送）を入れられる（期待を「放送を出す」「時間割の空きからは開かない」から変えた）
  ok('昼休みの間も、下のボタンは「頼みごとを出す」', lq.btn === '頼みごとを出す' && !lq.writeOff, JSON.stringify(lq));
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  const lw = await page.eval(`({ s: ${SHEET}, dis: [...document.querySelectorAll('input[name="write-ch"]:disabled')].map((x) => x.value) })`);
  ok('昼休みの間の「頼みごとを出す」：枠は「昼休み」が選ばれている・伝え方は3つとも選べる', lw.s.open && lw.s.title === '頼みごとを出す' && lw.s.period === 4.5 && !lw.dis.length && lw.s.pn === 7, JSON.stringify(lw));
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await sleep(150);
  // 「話を聞いた」の記録
  await page.pressEl('#room-rows .desk.is-lunch[data-sid="ex-s1"]');
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
  ok('記録すると保存される（その日・何の話・最後まで聞けた）・その生徒の机に「話した」の印', tv.length === 1 && tv[0].day === tday2 && tv[0].topic === '週末に行った場所の話' && tv[0].listened === true &&
    (await page.eval(LUNCH)).badges === 1, JSON.stringify(tv));
  await page.pressEl('#room-rows .desk.is-lunch[data-sid="ex-s1"]');
  await page.waitFor(`!document.getElementById('sheet-talk').hidden`, 2000);
  await sleep(200);
  tk = await page.eval(TALK);
  ok('同じ日にもう一度押すと、記録が入った形で開く（書きかえる・消せる）', tk.topic === '週末に行った場所の話' && tk.listened && tk.submit === '書きかえる' && tk.del && /もう記録してある/.test(tk.state), JSON.stringify(tk));
  await page.eval(`(() => { document.getElementById('talk-topic').value = '好きな料理の話'; document.getElementById('talk-submit').click(); return true; })()`);
  await sleep(300);
  tv = await page.eval(`${SAVED}.students.find((s) => s.id === 'ex-s1').talks`);
  ok('書きかえても1日1人1回のまま', tv.length === 1 && tv[0].topic === '好きな料理の話', JSON.stringify(tv));
  await page.pressEl('#room-rows .desk.is-lunch[data-sid="ex-s2"]');
  await page.waitFor(`!document.getElementById('sheet-talk').hidden`, 2000);
  await page.eval(`document.getElementById('talk-submit').click(); true`);
  await sleep(300);
  await page.pressEl('#room-rows .desk.is-lunch[data-sid="ex-s2"]');
  await page.waitFor(`!document.getElementById('sheet-talk').hidden`, 2000);
  await page.eval(`document.getElementById('talk-del').click(); true`);
  await page.waitFor(`!document.getElementById('confirm').hidden`, 2000);
  await page.eval(`document.getElementById('confirm-yes').click(); true`);
  await sleep(300);
  ok('「この日の記録を消す」で消せる', (await page.eval(`${SAVED}.students.find((s) => s.id === 'ex-s2').talks.length`)) === 0 && (await page.eval(`document.getElementById('sheet-talk').hidden`)));
  // 保存されて、開き直しても昼休み（同じ並び）・授業にもどるで消える・次の日には授業
  const before5 = await page.eval(LUNCHPOS);
  await page.load(base);
  lq = await page.eval(LUNCH);
  // v0.4 段A：「授業にもどる」はなくした。黒板の大きい「昼休み」の字もなし（期待を変えた）
  ok('昼休みを選んだことは保存され、開き直しても（ほかの行を押すまで）昼休みのまま', lq.on && lq.chalk === '' && /^昼休み（\d+:\d\dから）$/.test(lq.row) && !!lq.saved && lq.saved.day === tday2 && lq.saved.slot === 'lunch', JSON.stringify(lq));
  ok('… 開き直しても同じ並び（昼休みを始めた時刻を種にしている）', JSON.stringify(await page.eval(LUNCHPOS)) === JSON.stringify(before5) && JSON.stringify(before5) === JSON.stringify(lp5), JSON.stringify(before5));
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(300);
  ok('ほかの行（1限）を押すと、5人とも自分の席にもどる（時間は1限）', JSON.stringify(await page.eval(LUNCHPOS)) === JSON.stringify(cpos5) && (await page.eval(`${SAVED}.time.slot`)) === 1);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(300);
  ok('次に昼休みを押すと、並びの種（昼休みを選んだ時刻）が新しくなる', (await page.eval(`${SAVED}.time.at`)) > lq.saved.at && (await page.eval(`${SAVED}.time.slot`)) === 'lunch' && lunchAdjacent(await page.eval(LUNCHPOS)));
  const lunchAt = await page.eval(`${SAVED}.time.at`), lpos2 = await page.eval(LUNCHPOS);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(300);
  ok('昼休みの行をもう一度押しても、昼休みのまま（並びも同じ）', (await page.eval(LUNCH)).on && (await page.eval(`${SAVED}.time.at`)) === lunchAt && JSON.stringify(await page.eval(LUNCHPOS)) === JSON.stringify(lpos2));
  await page.load(base);
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); st.time.at = Date.now() - 86400000;
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  lq = await page.eval(LUNCH);
  ok('次の日（午前3時の区切りのあと）には、選んだ時間はなくなって自分の席', !lq.on && lq.desks === 5 && lq.row === '昼休み' && lq.saved === null && !lq.writeOff, JSON.stringify(lq));
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
  const rflip = await page.eval(`({ t: [...document.querySelectorAll('#room-rows .desk.is-lunch .kid')].map((k) => k.style.transition + k.style.transform), on: ${SAVED}.time.slot === 'lunch' })`);
  ok('動きを減らす設定では、動かずに並びだけ変わる（となりあう席に移って向きも変わる）', rflip.on && rflip.t.length === 5 && rflip.t.every((x) => x === '') && lunchAdjacent(await page.eval(LUNCHPOS)), JSON.stringify(rflip));
  await page.eval(`document.querySelector('#tt-list .tt-row[data-bid="ex-b1"]').click(); true`);
  await page.viewport(390, 844, true, false, false);

  // ---- v0.3.1 → v0.4 段A：昼休みの枠の頼み（どの伝え方も・1日1つ）。昼休みの放送は、昼休みの間ずっと吹き出しに ----
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(900);
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  const LSHEET = `({ s: ${SHEET}, dis: [...document.querySelectorAll('input[name="write-ch"]:disabled')].map((x) => x.value),
    chips: [...document.querySelectorAll('input[name="write-period"]')].map((x) => x.closest('label').textContent.replace('（うまっている）', '')) })`;
  const ls = await page.eval(LSHEET);
  // v0.4 段A：昼休みの間も「頼みごとを出す」。伝え方は3つとも、枠のチップは7つで「昼休み」が選ばれている（期待を「放送だけ・昼休みだけ」から変えた）
  ok('昼休みの間の「頼みごとを出す」：伝え方は3つとも選べる・枠のチップは1〜4限・昼休み・5〜6限で「昼休み」が選ばれている', ls.s.title === '頼みごとを出す' && !ls.dis.length &&
    JSON.stringify(ls.chips) === '["1限","2限","3限","4限","昼休み","5限","6限"]' && ls.s.period === 4.5, JSON.stringify(ls));
  await page.eval(`(() => { document.getElementById('write-ch-broadcast').click(); const t = document.getElementById('write-text'); t.value = '昼休みのうちに、プリントを取りに来てね'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-subj-2').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(500);
  const lc = await page.eval(`(() => { const st = ${SAVED}, b = st.boards[st.boards.length - 1]; return { ch: b.channel, lunch: b.lunch, per: b.period, subj: b.subject, cur: st.currentId === b.id, id: b.id, tt: ${TT}, room: ${ROOM}, on: ${LUNCH}.on }; })()`);
  ok('出すと時間割の「昼休み」に入り（「昼休み 雑務・放送」）、昼休みのまま、スピーカーの下に吹き出しが出る（黒板には一言なし）', lc.ch === 'broadcast' && lc.lunch === true && lc.per === 0 && lc.subj === '雑務' && lc.cur &&
    lc.tt.rows.indexOf('昼休み 雑務・放送') >= 0 && lc.room.say === '昼休みのうちに、プリントを取りに来てね' && lc.room.speaker && lc.room.chalk === '' && lc.on, JSON.stringify(lc));
  ok('… 時間割の1〜6限の空きはそのまま（昼休みの枠の頼みは時限を使わない）', JSON.stringify(lc.tt.empty) === '["4限+","5限+","6限+"]', JSON.stringify(lc.tt.empty));
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 7000); await sleep(350);
  await page.eval('window.scrollTo(0, 0); true');
  await page.shot('27_昼休みの放送_390_light.png');
  // 昼休みの枠は1日1つ：うまったあとは、下のボタンからは空いている時限（4限）を選んで開く
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  const l2 = await page.eval(LSHEET);
  ok('昼休みの枠は1日1つ：うまったあとは、下のボタンからは空いている時限（4限）を選んで開く（昼休みのチップは選べない）', l2.s.open && l2.s.period === 4 && JSON.stringify(l2.s.pdis) === '[1,2,3,4.5]', JSON.stringify(l2));
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  // 時間割の昼休みの行の「直す」：枠は昼休みのまま。v0.4 段B：黒板のタブで、放送とは別の頼みを足せる（期待を「伝え方を黒板に変える」から変えた）
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  const le = await page.eval(LSHEET);
  ok('時間割の昼休みの頼みの「直す」：枠は「昼休み」のまま・伝え方は3つとも選べる', le.s.title === '頼みごとを直す' && le.s.ch === 'broadcast' && !le.dis.length && le.s.period === 4.5 &&
    le.s.text === '昼休みのうちに、プリントを取りに来てね', JSON.stringify(le));
  await page.eval(`(() => { document.getElementById('write-ch-board').click(); const t = document.getElementById('write-text'); t.value = '資料を机に置いておくね'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-submit').click(); return true; })()`);
  await sleep(500);
  const lbd = await page.eval(`({ room: ${ROOM}, lunch: ${LUNCH}, tt: ${TT} })`);
  ok('昼休みの枠に黒板の頼みを足す：昼休みのまま（生徒は集まったまま）、大きい黒板に黒板の字・スピーカーの下に放送の吹き出しが同時に出る', lbd.lunch.on && lbd.lunch.kids === 2 &&
    lbd.room.chalk === '資料を机に置いておくね' && lbd.room.say === '昼休みのうちに、プリントを取りに来てね' && lbd.tt.rows.indexOf('昼休み 雑務・黒板・放送') >= 0, JSON.stringify(lbd));
  ok('昼休みの枠の頼み（時間割の昼休みの行つき）: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  // 授業の時間（1限）から時間割の昼休みの行を押すと、昼休みになって黒板の字と吹き出しが出る
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(300);
  await page.pressEl('#tt-lunch');
  await sleep(500);
  const lr2 = await page.eval(`({ room: ${ROOM}, on: ${LUNCH}.on, lead: ${SAVED}.boards.find((b) => b.lunch && b.channel === 'board').id })`);
  ok('授業のときに時間割の昼休みの行（黒板・放送入り）を押すと、昼休みになって黒板の字と吹き出しが出る', lr2.on && lr2.room.cur === lr2.lead && lr2.room.chalk === '資料を机に置いておくね' &&
    lr2.room.say === '昼休みのうちに、プリントを取りに来てね', JSON.stringify(lr2));
  // 生徒の目線（昼休みの間は机を押すと「話を聞いた」なので、1限にしてから目線の小さな時間割で昼休みの枠へ）
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(300);
  await page.pressEl('button.desk[data-sid="ex-s2"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await page.pressEl('#view-tt-list .tt-row[data-slot="lunch"]');
  await sleep(300);
  const lv = await page.eval(`({ v: ${VIEW2}, secs: [...document.querySelectorAll('#view-secs .vsec')].map((x) => x.dataset.ch + ':' + [...x.querySelectorAll('.voice')].map((y) => y.textContent).join('|')),
    castChips: [...document.querySelectorAll('#view-secs .vsec[data-ch="broadcast"] .chips button')].map((b) => b.textContent.trim()) })`);
  ok('昼休みの枠の生徒の目線：黒板と放送の見出しで分かれ、どちらにも「せっかくの昼休み、頼まれたことが気になって休めなかったかも」・放送の足すとよいもの「急ぎでなければ、昼休みのあとで大丈夫だよ」',
    lv.secs.length === 2 && lv.secs.every((x) => x.indexOf('せっかくの昼休み、頼まれたことが気になって休めなかったかも') >= 0) && lv.secs[0].indexOf('board' + ':') === 0 && lv.secs[1].indexOf('broadcast' + ':') === 0 &&
    lv.castChips.indexOf('＋ 急ぎでなければ、昼休みのあとで大丈夫だよ') >= 0 && lv.v.vtt.slice(-1)[0] === lr2.lead + '*', JSON.stringify(lv));
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);

  // ---- v0.3.1：昼休みの席（10人・パソコン5列）：4・3・3 のまとまりで、今ある机のとなりあう席に ----
  await page.viewport(1280, 800, false, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); const t = Date.now();
    for (let i = 3; i <= 10; i++) st.students.push({ id: 'p' + i, name: '生徒' + i, color: (i % 8) + 1, col: (i * 2) % 5, answers: { q1: ['A', 'B', 'C'][i % 3] }, notes: {}, history: [], createdAt: t, updatedAt: t });
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  const c10 = await page.eval(LUNCHPOS);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(1000);
  const l10 = await page.eval(LUNCH), p10 = await page.eval(LUNCHPOS);
  ok('10人（パソコン5列）：4・3・3 のまとまりで、全員がとなりあう席・席は重ならない・机の数は15のまま・横にはみ出さない', JSON.stringify(l10.groups) === '["4","3","3"]' && l10.kids === 10 &&
    l10.allDesks === 15 && l10.round === 0 && lunchAdjacent(p10) && new Set(Object.values(p10).map((p) => p[0] + ':' + p[1])).size === 10 && l10.ow <= 0, JSON.stringify([l10, p10]));
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 7000); await sleep(350);
  await page.shot('28_昼休みの席_10人_1280_light.png', true);
  await page.eval(`document.querySelector('#tt-list .tt-row[data-bid="ex-b1"]').click(); true`);
  await sleep(300);
  ok('… ほかの行（1限）を押すと、10人とも自分の席', JSON.stringify(await page.eval(LUNCHPOS)) === JSON.stringify(c10));
  // パソコンの時間割の昼休みの行：頼み（科目「手伝い」）が入っていて選んでいると、科目名が切れずに「直す」（時刻は黒板の下に）。選んでいないときは伝え方の印
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.eval(`document.getElementById('tt-lunch').click(); true`);
  await sleep(300);
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  await page.eval(`(() => { document.getElementById('write-ch-broadcast').click(); const t = document.getElementById('write-text'); t.value = '昼休みのうちに、プリントを取りに来てね'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-subj-3').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(500);
  const LROW = `(() => { const r = document.getElementById('tt-lunch'), li = r && r.closest('li'), ic = r && r.querySelector('.tt-ch .ch-ico'), w = r && r.querySelector('.tt-when');
    return r ? { over: li.scrollWidth > li.clientWidth + 1, edit: !!li.querySelector('.tt-edit'), icon: !!ic && ic.getBoundingClientRect().width > 0, when: !!w && w.getBoundingClientRect().width > 2,
      subj: [...li.querySelectorAll('.tt-s')].map((s) => s.textContent + (s.scrollWidth > s.clientWidth + 1 ? '（切れている）' : '')),
      note: document.getElementById('room-meta').hidden ? '' : document.getElementById('room-note').textContent } : null; })()`;
  const pc1 = await page.eval(LROW);
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(200);
  const pc2 = await page.eval(LROW);
  ok('パソコンの時間割の昼休みの行：頼みが入っていて選んでいると「手伝い」が切れずに「直す」（時刻は黒板の下に）・選んでいないときは伝え方の印・はみ出さない',
    !!pc1 && !!pc2 && pc1.edit && !pc1.over && JSON.stringify(pc1.subj) === '["手伝い"]' && !pc1.when && /^昼休み（\d+:\d\dから）$/.test(pc1.note) &&
    !pc2.edit && pc2.icon && !pc2.over && JSON.stringify(pc2.subj) === '["手伝い"]', JSON.stringify([pc1, pc2]));
  // 幅の狭いスマホ（360px）：2列の時間割で、どの行を選んでも科目名が切れず、「直す」は押しやすい大きさ
  await page.viewport(360, 780, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  const n360 = [];
  for (const id of ['ex-b1', 'ex-b2', 'ex-b3']) {
    await page.pressEl('#tt-list .tt-row[data-bid="' + id + '"]');
    await sleep(120);
    n360.push(await page.eval(TTEDIT));
  }
  ok('幅の狭いスマホ（360px）：どの行を選んでも科目名が切れない・「直す」は 40×30 以上・横にはみ出さない', n360.every((t, i) => t.nowBid === 'ex-b' + (i + 1) && !t.cut.length && !t.liOver && t.ew >= 40 && t.eh >= 30) &&
    (await page.eval(OVERFLOW)) <= 0, JSON.stringify(n360));
  await page.viewport(390, 844, true, false, false);

  // ---- v0.4 段A：時間割で時間を選ぶ（保存）・放課後・お便りは相手の机だけ（昼休みでも自分の机）・掃除のあとの印・掃除するものがないわけ ----
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  // 空いている時限（5限）を押す → 5限にして「頼みごとを出す」。閉じても5限のまま・開き直しても5限
  await page.pressEl('#tt-list .tt-row[data-period="5"]');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  await page.load(base);
  const t5 = await page.eval(`({ tt: ${TT}, room: ${ROOM} })`);
  ok('選んだ時間は保存される：空いている5限を選ぶと、開き直しても5限（黒板は空・日付の下に「5限」）', JSON.stringify(t5.tt.sel) === '["5"]' && t5.room.chalk === '' && /5限$/.test(t5.room.date) &&
    !!t5.room.time && t5.room.time.slot === 5 && t5.room.cur === '', JSON.stringify(t5));
  await page.pressEl('#btn-write');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  ok('… 下の「頼みごとを出す」は、今の時間（5限）を選んで開く', (await page.eval(SHEET)).period === 5);
  await page.eval(`document.querySelector('#sheet-write [data-close]').click(); true`);
  await page.waitFor(`document.getElementById('sheet-write').hidden`, 2000);
  // 放課後：生徒は帰る（机は残る）。黒板は日付と「放課後」だけ
  await page.pressEl('#tt-after');
  await sleep(900);
  const af = await page.eval(`(() => { const kids = [...document.querySelectorAll('#room-rows .desk:not(.is-empty) > .kid')];
    return { after: document.getElementById('room-rows').classList.contains('is-after'), kids: kids.map((k) => Number(getComputedStyle(k).opacity)), desks: document.querySelectorAll('#room-rows button.desk').length,
      chairs: [...document.querySelectorAll('#room-rows .kid-chair')].map((c) => Number(getComputedStyle(c).opacity)), room: ${ROOM}, tt: ${TT},
      label: document.querySelector('#room-rows button.desk').getAttribute('aria-label') }; })()`);
  ok('放課後を押すと、生徒は教室からいなくなる（机と名札は残り、椅子が見える）・黒板は日付と「放課後」だけ', af.after && af.kids.every((o) => o === 0) && af.desks === 2 && af.chairs.every((o) => o === 1) &&
    af.room.chalk === '' && /放課後$/.test(af.room.date) && af.room.time.slot === 'after' && JSON.stringify(af.tt.sel) === '["after"]' && /放課後/.test(af.label), JSON.stringify(af));
  ok('放課後: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 4000); await sleep(350);
  await page.eval('window.scrollTo(0, 0); true');
  await page.shot('29_放課後_390_light.png', true);
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(900);
  ok('… ほかの行（1限）を押すと、生徒が席にもどる', (await page.eval(`[...document.querySelectorAll('#room-rows .desk:not(.is-empty) > .kid')].every((k) => Number(getComputedStyle(k).opacity) === 1) && !document.getElementById('room-rows').classList.contains('is-after')`)));
  // お便りは相手の机にだけ（はじめての生徒だけに配る）。昼休みに生徒が移っても、紙は自分の机に置いたまま
  await page.pressEl('#tt-list .tt-row[data-period="4"]');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { document.getElementById('write-ch-letter').click(); document.getElementById('tgt-ex-s2').click(); const t = document.getElementById('write-text'); t.value = 'この表、金曜までに見ておいてね';
    t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('write-period-lunch').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(900);
  const home = await page.eval(`(() => { const st = ${SAVED}; return st.boards[st.boards.length - 1]; })()`);
  // （v0.4 段C：2限のお便りは、まだ終わっていないので2人の机に残る。ここでは、出したお便りの紙だけを見る）
  const lpp = await page.eval(`(() => { const seat = (el) => { const sts = [...document.querySelectorAll('#room-rows .row-desks > .seat')]; return sts.indexOf(el.closest('.seat')); };
    return { papers: [...document.querySelectorAll('#room-rows .desk-paper')].filter((p) => p.dataset.bid === ${JSON.stringify(home.id)}).map((p) => p.dataset.sid + '@' + seat(p)), kid: (() => { const d = document.querySelector('#room-rows .desk.is-lunch[data-sid="ex-s1"]'); return d ? seat(d) : -1; })(),
      on: ${LUNCH}.on }; })()`);
  ok('お便りは相手（はじめての生徒だけ）の机にだけ紙を置く・昼休みの枠に出すと昼休みのまま', home.channel === 'letter' && home.lunch === true && JSON.stringify(home.targets) === '["ex-s1"]' && lpp.on &&
    lpp.papers.length === 1 && /^ex-s1@/.test(lpp.papers[0]), JSON.stringify([home, lpp]));
  // 生徒が自分の机から移った並びになるまで、昼休みを選び直す（並びは選んだ時刻で決まる）
  const PAPERPOS = `(() => { const sts = [...document.querySelectorAll('#room-rows .row-desks > .seat')], seat = (el) => sts.indexOf(el.closest('.seat')), d = document.querySelector('#room-rows .desk.is-lunch[data-sid="ex-s1"]');
    return { papers: [...document.querySelectorAll('#room-rows .desk-paper')].filter((p) => p.dataset.bid === ${JSON.stringify(home.id)}).map((p) => p.dataset.sid + '@' + seat(p)), kid: d ? seat(d) : -1 }; })()`;
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(300);
  const seatHome = await page.eval(`(() => { const d = document.querySelector('#room-rows .desk[data-sid="ex-s1"]'); return [...document.querySelectorAll('#room-rows .row-desks > .seat')].indexOf(d.closest('.seat')); })()`);
  let pp = lpp;
  for (let k = 0; k < 6 && pp.kid === seatHome; k++) {
    await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
    await sleep(120);
    await page.pressEl('#tt-lunch');
    await sleep(300);
    pp = await page.eval(PAPERPOS);
  }
  ok('… 昼休みに生徒が移っても、紙は自分の机（授業の席）に置いたまま（移った先の机ではない）', pp.papers.length === 1 && pp.papers[0] === 'ex-s1@' + seatHome && pp.kid !== seatHome && pp.kid >= 0, JSON.stringify([pp, seatHome]));
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(300);
  // 掃除のあとの印：1限は全員終わった＝✓、2限・3限は途中・まだが残る＝「続き」
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await openSweepSheet();
  await sweepPick(0, 'done');
  await sweepPick(1, 'done');
  await sweepNext();
  await sweepPick(0, 'mid');
  await sweepPick(1, 'done');
  await sweepNext();
  await sweepPick(0, 'not');
  await sweepPick(1, 'not');
  await sweepNext();
  await page.eval(`document.getElementById('sweep-next').click(); true`);
  await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
  await sleep(300);
  const mk = await page.eval(TT);
  ok('掃除のあと、時間割の行に小さな印：全員終わった1限は「✓」、途中・まだが残る2限・3限は「続き」', JSON.stringify(mk.marks) === '["ex-b1:✓","ex-b2:続き","ex-b3:続き"]', JSON.stringify(mk.marks));
  const mcut = (await page.eval(TTEDIT)).cut;
  ok('掃除のあとの時間割: 横にはみ出さない・科目名が切れない', (await page.eval(OVERFLOW)) <= 0 && !mcut.length, JSON.stringify(mcut));
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 4000); await sleep(200);
  await page.eval(`(() => { const el = document.getElementById('room-tt'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16); return true; })()`);
  await sleep(200);
  await page.shot('30_掃除のあとの時間割_390_light.png');
  // 掃除するものがないわけ：相手が全員提出済み
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); st.boards.forEach((b) => { b.targets.forEach((sid) => { b.results[sid] = { kind: 'asExpected', memo: '', ack: false, at: Date.now(), submitted: true }; }); });
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  await page.pressEl('#tt-sweep');
  await sleep(300);
  ok('掃除するものがないわけ：相手が全員提出済みなら「今日の頼みは、相手が全員提出済み（締めたものも）なので、掃除するものはないよ」', (await page.eval(`document.getElementById('sheet-sweep').hidden`)) &&
    (await page.eval(`document.getElementById('toast-msg').textContent`)) === '今日の頼みは、相手が全員提出済み（締めたものも）なので、掃除するものはないよ');

  {
  // ---- v0.4 段B：1つの時限に、伝え方ごとの頼み（文と相手は伝え方ごと・科目名と時限は枠で1つ）。シートの伝え方はタブ ----
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  // 見本の生徒2人だけにする（見本の頼み3つがあると、その日の声が「放送だけ・3本以上・割り込み」でうまって「同じ時間に別々の頼み」が出ない）
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); st.boards = []; st.currentId = ''; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  const TABS = `({ ch: (document.querySelector('input[name="write-ch"]:checked') || {}).value, text: document.getElementById('write-text').value, submit: document.getElementById('write-submit').textContent,
    has: ['board', 'letter', 'broadcast'].map((c) => c + ':' + (document.getElementById('write-has-' + c).hidden ? '' : document.getElementById('write-has-' + c).textContent)) })`;
  const typeIn = (t) => `(() => { const t = document.getElementById('write-text'); t.value = ${JSON.stringify(t)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
  await page.pressEl('#tt-list .tt-row[data-period="4"]');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  await page.eval(typeIn('表を3枚にまとめて。金曜までに'));
  await page.eval(`document.getElementById('write-subj-3').click(); document.getElementById('write-ch-letter').click(); true`);
  await page.eval(typeIn('印刷は職員室のプリンターで'));
  await page.eval(`document.getElementById('tgt-ex-s2').click(); true`);
  const nt = await page.eval(TABS);
  ok('新しく出すときも伝え方はタブ：黒板とお便りに別々の文を書くと、両方に「書きかけ」の印', nt.ch === 'letter' && JSON.stringify(nt.has) === '["board:書きかけ","letter:書きかけ","broadcast:"]' && nt.submit === '出す', JSON.stringify(nt));
  await page.eval(`document.getElementById('write-submit').click(); true`);
  await sleep(400);
  let sb = await page.eval(SAVED), s4 = sb.boards.filter((b) => !b.example);
  ok('出すと、4限に黒板とお便りが1つずつ入る（科目名は同じ「手伝い」・お便りの相手は、はじめての生徒だけ）', s4.length === 2 && s4.every((b) => b.period === 4 && b.subject === '手伝い') &&
    JSON.stringify(s4.map((b) => b.channel).sort()) === '["board","letter"]' && JSON.stringify(s4.find((b) => b.channel === 'letter').targets) === '["ex-s1"]' &&
    (await page.eval(`document.getElementById('toast-msg').textContent`)) === '4限 手伝い：黒板・お便りを出したよ', JSON.stringify(s4));
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  await page.eval(`document.getElementById('write-ch-broadcast').click(); true`);
  await page.eval(typeIn('終わったら、ひと声かけてね'));
  const nt2 = await page.eval(TABS);
  ok('「直す」で開くと、書いてある伝え方（黒板・お便り）に「書いてある」・放送のタブに書くと「書きかけ」', JSON.stringify(nt2.has) === '["board:書いてある","letter:書いてある","broadcast:書きかけ"]' && nt2.submit === '出す', JSON.stringify(nt2));
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 5000); await sleep(300);
  await page.shot('34_伝え方のタブ_390_light.png');
  await page.eval(`document.getElementById('write-submit').click(); true`);
  await sleep(500);
  const r3 = await page.eval(`({ room: ${ROOM}, tt: ${TT} })`);
  ok('1つの時限（4限）に黒板・お便り・放送：時間割の行は科目名と伝え方の印3つ（「4限 手伝い・黒板・お便り・放送」）', r3.tt.rows[0] === '4限 手伝い・黒板・お便り・放送' &&
    (await page.eval(`document.querySelectorAll('#tt-list .tt-row[data-slot="4"] .tt-ics .ch-ico').length`)) === 3, JSON.stringify(r3.tt));
  ok('… 教室には同時に出る：黒板の頼みは黒板・お便りは相手（はじめての生徒）の机の紙・放送はスピーカーの吹き出し', r3.room.chalk === '表を3枚にまとめて。金曜までに' && JSON.stringify(r3.room.papers) === '["ex-s1"]' &&
    r3.room.say === '終わったら、ひと声かけてね', JSON.stringify(r3.room));
  const tc3 = await page.eval(TTEDIT);
  ok('… 時間割の行（スマホの2列）は文字があふれない・科目名が切れない・「直す」は押しやすい・横にはみ出さない', !tc3.liOver && !tc3.rowOver && !tc3.cut.length && tc3.ew >= 40 && (await page.eval(OVERFLOW)) <= 0, JSON.stringify(tc3));
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 5000); await sleep(300);
  await page.eval('window.scrollTo(0, 0); true');
  await page.shot('33_同じ時間に伝え方ごとの頼み_390_light.png', true);
  // 生徒の目線：その時限でその生徒あての頼みを全部（黒板の字・机の紙・放送の吹き出し）。心の声などは伝え方ごとの見出しで分ける
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(300);
  const VSECS = `({ secs: [...document.querySelectorAll('#view-secs .vsec')].map((x) => x.dataset.ch), heads: [...document.querySelectorAll('#view-secs .vsec-h')].map((h) => h.textContent),
    voices: [...document.querySelectorAll('#view-secs .vsec')].map((x) => x.querySelectorAll('.voice').length), asks: document.querySelectorAll('#view-secs .ask-q').length,
    chalk: document.getElementById('view-chalk').textContent, desk: !document.getElementById('view-desk').hidden, paper: (document.querySelector('#view-papers .paper.is-top .paper-text') || {}).textContent || '',
    pa: !document.getElementById('view-pa').hidden, paText: document.getElementById('view-pa-text').textContent, day: [...document.querySelectorAll('#view-day-voices li')].map((x) => x.dataset.key + ':' + x.textContent),
    pills: document.getElementById('view-pills').textContent, ow: document.getElementById('view').scrollWidth - document.getElementById('view').clientWidth })`;
  const vs1 = await page.eval(VSECS);
  ok('はじめての生徒の目線（4限）：黒板・お便り・放送の見出しで分かれ（心の声・本人に聞くなら・足すとよいもの）、黒板の字・机の紙・放送の吹き出しが同時に見える', JSON.stringify(vs1.secs) === '["board","letter","broadcast"]' &&
    vs1.heads[0].indexOf('黒板の頼み') >= 0 && vs1.voices.every((n) => n > 0) && vs1.asks === 3 && /表を3枚に/.test(vs1.chalk) && vs1.desk && /印刷は職員室/.test(vs1.paper) && vs1.pa && /終わったら/.test(vs1.paText) &&
    vs1.pills.indexOf('4限 手伝い（黒板・お便り・放送）') === 0 && vs1.ow <= 0, JSON.stringify(vs1));
  ok('… 同じ時間に2つ以上の伝え方で別々の頼み →「同じ時間に別々の頼み…どれからやればいいか迷うかも」', vs1.day.some((x) => x === 'sameSlot:今日の頼みから同じ時間に別々の頼み…どれからやればいいか迷うかも'), JSON.stringify(vs1.day));
  // 目線の全体（上の黒板・机の紙・放送から、下の伝え方ごとの区切りまで）を1枚に。目線は画面いっぱいの窓の中で動くので、窓の高さを目線の高さにして撮る（大きくなるので等倍で）
  await page.eval(`document.getElementById('view').scrollTop = 0; true`);
  const vh35 = await page.eval(`document.getElementById('view').scrollHeight`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: vh35, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  { const shot = await page.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, '35_生徒の目線_伝え方ごと_390_light.png'), Buffer.from(shot.data, 'base64')); console.log('  撮影     shots/35_生徒の目線_伝え方ごと_390_light.png'); }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  await page.pressEl('button.desk[data-sid="ex-s2"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(200);
  const vs2 = await page.eval(VSECS);
  ok('慣れた生徒の目線（4限）：お便りは配っていないので、黒板と放送だけ（机に紙はない）', JSON.stringify(vs2.secs) === '["board","broadcast"]' && !vs2.desk && vs2.pa, JSON.stringify(vs2));
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  // 科目名は枠で1つ（どれかのタブで直すと全部そろう）・時限を変えると枠ごと動く
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { document.getElementById('write-ch-letter').click(); document.getElementById('write-subj-0').click(); document.getElementById('write-period-5').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(500);
  sb = await page.eval(SAVED); s4 = sb.boards.filter((b) => !b.example);
  const t5 = await page.eval(TT);
  ok('お便りのタブで科目名を「ゼミ」に、時限を5限に直すと、黒板・お便り・放送の3つとも「5限 ゼミ」になる（4限は空く）', s4.length === 3 && s4.every((b) => b.period === 5 && b.subject === 'ゼミ') &&
    t5.rows[0] === '5限 ゼミ・黒板・お便り・放送' && t5.empty.indexOf('4限+') >= 0, JSON.stringify([s4.map((b) => b.channel + b.period + b.subject), t5]));
  // パソコンの5限（黒板・お便り・放送）
  await page.viewport(1280, 800, false, false, false);
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-slot="5"]');
  await sleep(500);
  const r1280 = await page.eval(`({ room: ${ROOM}, cut: ${TTEDIT}.cut, ow: ${OVERFLOW} })`);
  ok('パソコンの5限（黒板・お便り・放送）：黒板・机の紙・吹き出しが同時に出る・科目名が切れない・横にはみ出さない', r1280.room.chalk === '表を3枚にまとめて。金曜までに' && JSON.stringify(r1280.room.papers) === '["ex-s1"]' &&
    r1280.room.say === '終わったら、ひと声かけてね' && !r1280.cut.length && r1280.ow <= 0, JSON.stringify(r1280));
  await page.eval('window.scrollTo(0, 0); true');
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 5000); await sleep(300);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });   // カーソルを行から外して撮る
  await sleep(150);
  await page.shot('33_同じ時間に伝え方ごとの頼み_1280_light.png');
  // スマホで放送のある時間を選ぶと吹き出しのぶん時間割がずれるので、押した行が指の下から動かないように画面を動かす（見本の頼みで）
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(300);
  const keep = async (sel) => {
    const y0 = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}); r.scrollIntoView({ block: 'center' }); return Math.round(r.getBoundingClientRect().top); })()`);
    await sleep(120);
    const box = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await page.press(box.x, box.y);
    await sleep(350);
    return { y0, y1: Math.round(await page.eval(`document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top`)), say: !(await page.eval(`document.getElementById('room-say').hidden`)) };
  };
  const k390 = await keep('#tt-list .tt-row[data-bid="ex-b3"]');
  ok('スマホ：放送のある時間（3限）を押しても、押した行は指の下から動かない（吹き出しは出る）', Math.abs(k390.y1 - k390.y0) <= 2 && k390.say, JSON.stringify(k390));
  // ページの一番上で、放送のある3限から1限を押す（吹き出しが消えて時間割が上がる）：上へは動かせないので、吹き出しの場所をあけておいて行を動かさない
  await page.eval('window.scrollTo(0, 0); true');
  await sleep(150);
  const t0 = await page.eval(`(() => { const r = document.querySelector('#tt-list .tt-row[data-bid="ex-b1"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: Math.round(r.top), sy: scrollY }; })()`);
  await page.press(t0.x, t0.y);
  await sleep(350);
  const t1 = await page.eval(`({ top: Math.round(document.querySelector('#tt-list .tt-row[data-bid="ex-b1"]').getBoundingClientRect().top), say: !document.getElementById('room-say').hidden, ow: ${OVERFLOW} })`);
  ok('スマホ：ページの一番上で放送のある3限から1限を押しても（吹き出しが消える）、押した行は指の下から動かない', t0.sy === 0 && Math.abs(t1.top - t0.top) <= 2 && !t1.say && t1.ow <= 0, JSON.stringify([t0, t1]));
  await page.viewport(1280, 800, false, false, false);
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-bid="ex-b1"]');
  await sleep(300);
  const k1280 = await keep('#tt-list .tt-row[data-bid="ex-b3"]');
  ok('パソコン：放送のある時間（3限）を押しても、押した行はカーソルの下から動かない', Math.abs(k1280.y1 - k1280.y0) <= 2 && k1280.say, JSON.stringify(k1280));
  await page.viewport(390, 844, true, false, false);
  }

  // ---- v0.4 段C：締め切り（伝え方ごと）・「この時間中」の報告・今日中 → 延ばす（宿題）／居残り・放課後の居残り・正の字・机に残るお便り ----
  {
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  const typeIn = (t) => `(() => { const t = document.getElementById('write-text'); t.value = ${JSON.stringify(t)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
  const dayAfter = (n) => `(() => { const E = SekigaeEngine, p = E.dayKey(Date.now()).split('-').map(Number); return E.ymd(new Date(p[0], p[1] - 1, p[2] + ${n}, 12).getTime()); })()`;
  const d1 = await page.eval(dayAfter(1)), d2 = await page.eval(dayAfter(2)), md2 = await page.eval(`SekigaeEngine.mdDay(${JSON.stringify(d2)})`);
  const DUES = `({ kind: (document.querySelector('input[name="write-due"]:checked') || {}).value, date: document.getElementById('write-due-date-wrap').hidden ? '' : document.getElementById('write-due-on').value,
    min: document.getElementById('write-due-on').min, chips: [...document.querySelectorAll('input[name="write-due"]')].map((x) => x.closest('label').textContent) })`;
  // 締め切りの欄：伝え方のタブごと（黒板＝今日中・お便り＝日付・放送＝この時間中）
  await page.pressEl('#tt-list .tt-row[data-period="4"]');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(200);
  const dz = await page.eval(DUES);
  ok('締め切りの欄：選べるのは「この時間中・今日中・日付・決めない」（新しい頼みは「決めない」から）', JSON.stringify(dz.chips) === '["この時間中","今日中","日付","決めない"]' && dz.kind === 'none' && dz.date === '', JSON.stringify(dz));
  await page.eval(typeIn('資料を3枚にまとめて'));
  await page.eval(`document.getElementById('write-due-day').click(); true`);
  await sleep(100);
  ok('黒板のタブで「今日中」を選ぶと、書いている途中の黒板の字の下に「〆 今日中」', (await page.eval(`document.getElementById('room-board-due').textContent`)) === '〆 今日中');
  await page.eval(`document.getElementById('write-ch-letter').click(); true`);
  await page.eval(typeIn('印刷は職員室のプリンターで'));
  ok('お便りのタブに切り替えると、締め切りはお便りのもの（まだ「決めない」）', (await page.eval(DUES)).kind === 'none');
  await page.eval(`document.querySelector('input[name="write-due"][value="date"]').click(); true`);
  await sleep(100);
  const dd = await page.eval(DUES);
  ok('「日付」を選ぶと日付の欄が出る：頼みの日より後だけ（いちばん早いのは明日・はじめは明日）', dd.kind === 'date' && dd.date === d1 && dd.min === d1, JSON.stringify([dd, d1]));
  await page.eval(`(() => { const x = document.getElementById('write-due-on'); x.value = ${JSON.stringify(d2)}; x.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  ok('… 日付をあさってにできる・今日より前を入れると、もとの日にもどる', (await page.eval(DUES)).date === d2 &&
    (await page.eval(`(() => { const x = document.getElementById('write-due-on'); x.value = SekigaeEngine.dayKey(Date.now()); x.dispatchEvent(new Event('change', { bubbles: true })); return x.value; })()`)) === d2);
  await page.eval(`document.getElementById('write-ch-broadcast').click(); true`);
  await page.eval(typeIn('終わったら、ひと声かけてね'));
  await page.eval(`document.getElementById('write-due-slot').click(); true`);
  await sleep(100);
  ok('放送のタブは「この時間中」：書いている途中の吹き出しの端に「〆 この時間中」', (await page.eval(`document.getElementById('room-say-due').textContent`)) === '〆 この時間中');
  await page.eval(`document.getElementById('write-ch-letter').click(); true`);
  await sleep(150);
  await page.eval(`(() => { const el = document.getElementById('write-dues-f'); el.scrollIntoView({ block: 'center' }); return true; })()`);
  await sleep(150);
  await page.shot('36_締め切りの欄_390_light.png');
  await page.eval(`document.getElementById('write-submit').click(); true`);
  await sleep(500);
  const sv = await page.eval(SAVED), my = sv.boards.filter((b) => !b.example);
  const dueOf = (ch) => JSON.stringify((my.find((b) => b.channel === ch) || {}).due);
  ok('出すと、伝え方ごとに締め切りが保存される（黒板＝今日中・お便り＝あさってまで・放送＝この時間中）', my.length === 3 && dueOf('board') === '{"kind":"day"}' && dueOf('letter') === JSON.stringify({ kind: 'date', date: d2 }) &&
    dueOf('broadcast') === '{"kind":"slot"}', JSON.stringify(my));
  const rr = await page.eval(`({ bd: document.getElementById('room-board-due').textContent, say: document.getElementById('room-say-due').textContent })`);
  ok('4限の教室：黒板の字の下に「〆 今日中」・吹き出しの端に「〆 この時間中」', rr.bd === '〆 今日中' && rr.say === '〆 この時間中', JSON.stringify(rr));
  await page.pressEl('#room-rows .desk-paper[data-sid="ex-s1"]');
  await sleep(300);
  ok('… 机の紙を押すと、お便りの端に「〆 ' + md2 + 'まで」', (await page.eval(`document.getElementById('letter-pop-due').textContent`)) === '〆 ' + md2 + 'まで');
  await page.pressEl('#room-rows .desk-paper[data-sid="ex-s1"]');
  await sleep(150);
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(300);
  const vd = await page.eval(`({ bubbles: [...document.querySelectorAll('#scene .q-bubble')].map((x) => x.textContent), dues: [...document.querySelectorAll('#view-secs .vsec-due')].map((x) => x.textContent),
    voices: [...document.querySelectorAll('#view-secs .voice')].map((x) => x.textContent), board: document.getElementById('view-board-due').textContent, pa: document.getElementById('view-pa-due').textContent })`);
  ok('生徒の目線：締め切りを選んだ頼みは「いつまで？」の吹き出しも声も出ない・見出しと黒板・吹き出しの端に締め切り', vd.bubbles.indexOf('いつまで？') < 0 && !vd.voices.some((x) => /いつまで|締め切りがない|後回しにする/.test(x)) &&
    JSON.stringify(vd.dues) === JSON.stringify(['〆 今日中', '〆 ' + md2 + 'まで', '〆 この時間中']) && vd.board === '〆 今日中' && vd.pa === '〆 この時間中', JSON.stringify(vd));
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  ok('締め切りの欄つきの教室：横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);

  // 「この時間中」の報告：4限の放送は「この時間中」なので、4限から5限（空き）を押すと、まず「4限の頼み、終わった？」→ 閉じると5限の「頼みごとを出す」
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 5000); await sleep(200);
  await page.pressEl('#tt-list .tt-row[data-period="5"]');
  await page.waitFor(`!document.getElementById('sheet-ask').hidden`, 2000);
  await sleep(250);
  const cb = my.find((b) => b.channel === 'broadcast').id;
  const a4 = await page.eval(`({ title: document.getElementById('ask-title').textContent, secs: [...document.querySelectorAll('#ask-body .ask-b')].map((x) => x.dataset.bid + ':' + [...x.querySelectorAll('.ask-st')].map((r) => r.dataset.sid).join(',')),
    write: !document.getElementById('sheet-write').hidden, time: ${SAVED}.time.slot })`);
  ok('4限（「この時間中」の放送）から空いている5限を押すと、5限になって、まず「4限の頼み、終わった？」（放送・2人）', a4.title === '4限の頼み、終わった？' && JSON.stringify(a4.secs) === JSON.stringify([cb + ':ex-s1,ex-s2']) &&
    !a4.write && a4.time === 5, JSON.stringify(a4));
  await page.eval(`(() => { document.getElementById(${JSON.stringify('ask-' + cb + '-ex-s1-later')}).click(); document.getElementById(${JSON.stringify('ask-' + cb + '-ex-s2-later')}).click(); return true; })()`);
  await page.pressEl('#ask-done');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await sleep(250);
  const w5 = await page.eval(SHEET);
  ok('… 「あとで」と答えて閉じると、5限の「頼みごとを出す」が開く（「あとで」は掃除の記録を変えない）', w5.open && w5.title === '頼みごとを出す' && w5.period === 5 &&
    (await page.eval(`(() => { const b = ${SAVED}.boards.find((x) => x.id === ${JSON.stringify(cb)}); return JSON.stringify([b.slotCheck['ex-s1'].ans, b.slotCheck['ex-s2'].ans, Object.keys(b.sweep || {}).length]); })()`)) === '["later","later",0]', JSON.stringify(w5));
  // 5限（黒板＝相手2人・お便り＝はじめての生徒だけ。どちらもこの時間中）から放課後へ
  await page.eval(typeIn('表の数字を見直して'));
  await page.eval(`document.getElementById('write-due-slot').click(); document.getElementById('write-ch-letter').click(); true`);
  await page.eval(typeIn('見直した表は、机の上に置いておいてね'));
  await page.eval(`(() => { document.getElementById('write-due-slot').click(); document.getElementById('tgt-ex-s2').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(500);
  const five = (await page.eval(SAVED)).boards.filter((b) => !b.example && b.period === 5);
  ok('5限に「この時間中」の黒板とお便り（お便りは、はじめての生徒だけ）', five.length === 2 && five.every((b) => b.due && b.due.kind === 'slot'), JSON.stringify(five));
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 5000); await sleep(200);
  await page.pressEl('#tt-after');
  await page.waitFor(`!document.getElementById('sheet-ask').hidden`, 2000);
  await sleep(300);
  const ASK = `({ title: document.getElementById('ask-title').textContent, secs: [...document.querySelectorAll('#ask-body .ask-b')].map((x) => x.dataset.bid + ':' + [...x.querySelectorAll('.ask-st')].map((r) => r.dataset.sid).join(',')),
    opts: [...document.querySelectorAll('#ask-body .ask-st')].slice(0, 1).map((r) => [...r.querySelectorAll('.res span')].map((x) => x.textContent).join('・'))[0] || '', time: ${SAVED}.time.slot,
    ow: document.getElementById('sheet-ask').scrollWidth - document.getElementById('sheet-ask').clientWidth })`;
  const ak = await page.eval(ASK), kb = five.find((b) => b.channel === 'board').id, lb = five.find((b) => b.channel === 'letter').id;
  ok('5限から放課後を押すと、放課後になって小さなシート「5限の頼み、終わった？」：黒板（2人）とお便り（はじめての生徒）・生徒ごとに 終わった・まだ・あとで', ak.title === '5限の頼み、終わった？' && ak.time === 'after' &&
    JSON.stringify(ak.secs) === JSON.stringify([kb + ':ex-s1,ex-s2', lb + ':ex-s1']) && ak.opts === '終わった・まだ・あとで（掃除の時間に）' && ak.ow <= 0, JSON.stringify(ak));
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 5000); await sleep(300);
  await page.shot('37_この時間中の報告_390_light.png');
  const pick = (bid, sid, v) => page.eval(`(() => { document.getElementById(${JSON.stringify('ask-' + bid + '-' + sid + '-' + v)}).click(); return true; })()`);
  await pick(kb, 'ex-s1', 'done'); await pick(kb, 'ex-s2', 'later'); await pick(kb, 'ex-s2', 'not'); await pick(lb, 'ex-s1', 'done');
  await sleep(200);
  const st5 = await page.eval(`(() => { const st = ${SAVED}, k = st.boards.find((b) => b.id === ${JSON.stringify(kb)}), l = st.boards.find((b) => b.id === ${JSON.stringify(lb)}), d = SekigaeEngine.dayKey(Date.now());
    const lo = (b, sid) => { const e = (b.sweep || {})[sid]; return e && e.log.length ? e.log[e.log.length - 1].day + ':' + e.log[e.log.length - 1].st : ''; };
    return { kc: Object.keys(k.slotCheck).sort().map((x) => x + ':' + k.slotCheck[x].ans), lc: Object.keys(l.slotCheck).map((x) => x + ':' + l.slotCheck[x].ans), ks1: lo(k, 'ex-s1'), ks2: lo(k, 'ex-s2'), ls1: lo(l, 'ex-s1'), d }; })()`);
  ok('答えは保存され、終わった・まだは、その日の掃除の記録にも入る（「あとで」→「まだ」に選び直してもよい）', JSON.stringify(st5.kc) === '["ex-s1:done","ex-s2:not"]' && JSON.stringify(st5.lc) === '["ex-s1:done"]' &&
    st5.ks1 === st5.d + ':done' && st5.ks2 === st5.d + ':not' && st5.ls1 === st5.d + ':done', JSON.stringify(st5));
  const dl = await page.eval(`({ paper: (() => { const p = document.querySelector('#room-rows .desk-paper[data-sid="ex-s1"]'); return p ? p.dataset.bid + ':' + p.dataset.n : ''; })(),
    eng: SekigaeEngine.deskLetters(${SAVED}.boards, SekigaeEngine.dayKey(Date.now()), 'after', 'ex-s1').letters.map((b) => b.id) })`);
  const l4 = my.find((b) => b.channel === 'letter').id;
  ok('「この時間中」で終わったお便り（5限）は、次の時間（放課後）の机にはもうない（はじめての生徒の机：4限のお便りと2限の見本のお便りだけ）', dl.paper === l4 + ':2' &&
    JSON.stringify(dl.eng) === JSON.stringify([l4, 'ex-b2']), JSON.stringify(dl));
  await page.pressEl('#ask-done');
  await page.waitFor(`document.getElementById('sheet-ask').hidden`, 2000);
  await page.pressEl('#tt-list .tt-row[data-slot="5"]');
  await sleep(300);
  await page.pressEl('#tt-list .tt-row[data-slot="4"]');
  await sleep(400);
  ok('もう答えた頼みは聞かない（5限から4限へ移っても、シートは出ない）', await page.eval(`document.getElementById('sheet-ask').hidden`));
  }

  // 今日中 → 掃除の時間で「締め切りを延ばす（宿題）」か「居残り」→ 放課後は居残りの生徒だけ残る → 次の日の続き
  {
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  const dayAfter = (n) => `(() => { const E = SekigaeEngine, p = E.dayKey(Date.now()).split('-').map(Number); return E.ymd(new Date(p[0], p[1] - 1, p[2] + ${n}, 12).getTime()); })()`;
  const d1 = await page.eval(dayAfter(1)), d2 = await page.eval(dayAfter(2)), md2 = await page.eval(`SekigaeEngine.mdDay(${JSON.stringify(d2)})`);
  // 見本の生徒2人と、1限「今日中」の黒板（2人あて）・2限「決めない」のお便り
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})), t = new Date(Date.now() - 3 * 3600000); t.setHours(9, 0, 0, 0);
    st.boards = [{ id: 'c1', text: '資料を3枚にまとめて', channel: 'board', subject: '授業', period: 1, due: { kind: 'day' }, createdAt: t.getTime(), updatedAt: t.getTime(), targets: ['ex-s1', 'ex-s2'], firstTime: {}, results: {} }];
    st.currentId = 'c1'; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  await openSweepSheet();
  await sweepPick(0, 'not');
  const DUEC = (i) => `(() => { const r = ${SW_ROW(i)}, d = r.querySelector('.sw-due'); return d ? { lbl: d.querySelector('.lbl').textContent, opts: [...d.querySelectorAll('.res span')].map((x) => x.textContent), date: (d.querySelector('input[data-ext]') || {}).value || '',
    voice: (d.querySelector('.voice') || {}).textContent || '' } : null; })()`;
  const c0 = await page.eval(DUEC(0));
  ok('掃除の時間：今日中の頼みで「まだ」を選ぶと「締め切りは今日：どうする？」（締め切りを延ばす（宿題）・居残り）', !!c0 && /^締め切りは今日/.test(c0.lbl) && JSON.stringify(c0.opts) === '["締め切りを延ばす（宿題）","居残り"]', JSON.stringify(c0));
  await page.eval(`${SW_ROW(0)}.querySelector('input[data-due][value="stay"]').click(); true`);
  await sleep(150);
  const c0s = await page.eval(DUEC(0));
  ok('… 居残りを選ぶと、生徒の声「居残りになると、今日は気持ちを切り替えにくいかも」', !!c0s && c0s.voice === '居残りになると、今日は気持ちを切り替えにくいかも', JSON.stringify(c0s));
  await sweepPick(1, 'mid');
  await page.eval(`${SW_ROW(1)}.querySelector('input[data-due][value="ext"]').click(); true`);
  await sleep(150);
  const c1 = await page.eval(DUEC(1));
  ok('… 締め切りを延ばすを選ぶと、延ばす日（はじめは明日）を選べる', !!c1 && c1.date === d1, JSON.stringify([c1, d1]));
  await page.eval(`(() => { const x = ${SW_ROW(1)}.querySelector('input[data-ext]'); x.value = ${JSON.stringify(d2)}; x.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(150);
  const lg = await page.eval(`(() => { const b = ${SAVED}.boards.find((x) => x.id === 'c1'); return ['ex-s1', 'ex-s2'].map((sid) => JSON.stringify(b.sweep[sid].log.slice(-1)[0])); })()`);
  const today = await page.eval(`SekigaeEngine.dayKey(Date.now())`);
  ok('記録：はじめての生徒＝まだ・居残り、慣れた生徒＝途中・あさってまで延ばした（宿題）', lg[0] === JSON.stringify({ day: today, st: 'not', stay: true }) && lg[1] === JSON.stringify({ day: today, st: 'mid', ext: d2 }), JSON.stringify(lg));
  await sweepNext();
  const sm = await page.eval(`({ stay: [...document.querySelectorAll('#sweep-stay li')].map((x) => x.textContent), ext: [...document.querySelectorAll('#sweep-ext li')].map((x) => x.textContent), und: !!document.getElementById('sweep-undecided') })`);
  ok('まとめ：居残り（はじめての生徒）・締め切りを延ばした（慣れた生徒・〆 ' + md2 + 'まで）', sm.stay.length === 1 && /はじめての生徒さん/.test(sm.stay[0]) && sm.ext.length === 1 && /慣れた生徒さん.*〆 /.test(sm.ext[0]) && sm.ext[0].indexOf(md2) >= 0 && !sm.und, JSON.stringify(sm));
  await page.eval(`document.getElementById('sweep-next').click(); true`);
  await page.waitFor(`document.getElementById('sheet-sweep').hidden`, 2000);
  await sleep(200);
  // 大きい黒板の右下：残っているタスク（居残り・宿題）
  const tk = await page.eval(`({ shown: !document.getElementById('room-tasks').hidden, rows: [...document.querySelectorAll('#room-tasks .task-row')].map((x) => x.textContent) })`);
  ok('大きい黒板の右下に、残っているタスク（はじめての生徒さん 居残り 授業 一・慣れた生徒さん 授業 一）', tk.shown && tk.rows.length === 2 && /^はじめての生徒さん居残り授業一/.test(tk.rows[0]) && /^慣れた生徒さん授業一/.test(tk.rows[1]), JSON.stringify(tk));
  // 放課後：居残りの生徒だけ席に残る
  await page.pressEl('#tt-after');
  await sleep(900);
  const af = await page.eval(`(() => { const op = (sid) => Number(getComputedStyle(document.querySelector('#room-rows .desk[data-sid="' + sid + '"] > .kid')).opacity);
    return { s1: op('ex-s1'), s2: op('ex-s2'), badge: !!document.querySelector('#room-rows .desk[data-sid="ex-s1"] .badge-stay'), toast: document.getElementById('toast-msg').textContent }; })()`);
  ok('放課後を押すと、居残りの生徒（はじめての生徒）だけ席に残る（「居残り」の札）・ほかの生徒は帰る', af.s1 === 1 && af.s2 === 0 && af.badge && af.toast === '放課後。居残りの はじめての生徒さん だけ席に残っている（ほかの生徒は帰った）', JSON.stringify(af));
  ok('居残りの放課後: 横にはみ出さない', (await page.eval(OVERFLOW)) <= 0);
  await page.waitFor(`!document.getElementById('toast').classList.contains('is-on')`, 7000); await sleep(300);
  await page.eval('window.scrollTo(0, 0); true');
  await page.shot('38_居残りの放課後_390_light.png', true);
  await page.pressEl('button.desk[data-sid="ex-s1"]');
  await page.waitFor(`document.getElementById('view').classList.contains('is-settled')`, 3000);
  await sleep(200);
  const sv1 = await page.eval(`[...document.querySelectorAll('#view-day-voices li')].map((x) => x.dataset.key + ':' + x.textContent)`);
  ok('居残りの生徒の目線に「放課後から」の印で「居残りになると、今日は気持ちを切り替えにくいかも」', sv1.indexOf('stay:放課後から居残りになると、今日は気持ちを切り替えにくいかも') >= 0, JSON.stringify(sv1));
  await page.pressEl('#view-back');
  await page.waitFor(`document.getElementById('view').hidden`, 2000);
  // 次の日：宿題は「前の日からの続き」に（締め切りの日まで掃除には出ない）。居残りはその日だけ（締め切りを過ぎたものとして続きに出る）
  await page.eval(SHIFT_DAY);
  await page.load(base);
  const cr = await page.eval(CARRY);
  const pr = await page.eval(`SekigaeEngine.carryOver(${SAVED}.boards, SekigaeEngine.dayKey(Date.now())).map((c) => c.pairs.map((x) => x.sid + ':' + x.st + ':' + (x.hw ? 'hw' : '') + (x.late ? 'late' : '') + ':' + x.due).join('|'))`);
  ok('次の日の「前の日からの続き」：1限の頼み（はじめての生徒さん まだ・締め切りを過ぎた ほか1人）。慣れた生徒は宿題（〆 ' + md2 + 'まで）として続きに残る', cr.shown && cr.rows.length === 1 &&
    /はじめての生徒さん まだ 締め切りを過ぎた ほか1人/.test(cr.rows[0]) && pr.length === 1 && pr[0].indexOf('ex-s2:mid:hw:' + d2) >= 0 && pr[0].indexOf('ex-s1:not:late:') === 0, JSON.stringify([cr, pr]));
  const nsw = await page.eval(`SekigaeEngine.sweepList(${SAVED}.boards, SekigaeEngine.dayKey(Date.now())).map((it) => it.board.id + ':' + it.sids.join(','))`);
  ok('… 次の日の掃除には、締め切りを過ぎた はじめての生徒だけ（宿題の慣れた生徒は締め切りの日まで出ない）', JSON.stringify(nsw) === '["c1:ex-s1"]', JSON.stringify(nsw));
  ok('… 次の日の放課後には、もう誰も残らない（居残りはその日だけ）', (await page.eval(`SekigaeEngine.stayList(${SAVED}.boards, SekigaeEngine.dayKey(Date.now())).length`)) === 0);
  }
  // 大きい黒板の右下の正の字（パソコン）：多い生徒から3人まで＋ほか N 人
  {
  await page.viewport(1280, 800, false, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})), now = Date.now(), t = new Date(now - 3 * 3600000); t.setHours(9, 0, 0, 0); const T = t.getTime(), Y = T - 86400000;
    [['n3', 'B', 0], ['n4', 'B', 2], ['n5', 'A', 1]].forEach((x, i) => st.students.push({ id: x[0], name: '生徒' + (i + 3), color: i + 3, col: x[2], answers: { q1: x[1] }, notes: {}, history: [], createdAt: now, updatedAt: now }));
    const B = (id, ch, subj, p, due, tg, at, extra) => Object.assign({ id: id, text: '頼み ' + id, channel: ch, subject: subj, period: p, due: due, createdAt: at, updatedAt: at, targets: tg, firstTime: {}, results: {} }, extra || {});
    st.boards = [B('t1', 'board', '授業', 1, { kind: 'day' }, ['ex-s1', 'ex-s2', 'n3', 'n4', 'n5'], T + 1), B('t2', 'letter', '手伝い', 2, { kind: 'day' }, ['ex-s1', 'n3'], T + 2),
      B('t3', 'broadcast', '雑務', 3, { kind: 'slot' }, ['ex-s1', 'ex-s2'], T + 3), B('t5', 'letter', '授業', 5, { kind: 'day' }, ['ex-s1', 'n5'], T + 5), B('t6', 'board', '授業', 6, { kind: 'day' }, ['ex-s1'], T + 6),
      B('tl', 'board', '授業', 0, { kind: 'day' }, ['ex-s1'], T + 7, { lunch: true }), B('y1', 'board', '授業', 1, { kind: 'day' }, ['ex-s1'], Y + 1), B('y2', 'letter', '授業', 2, { kind: 'day' }, ['ex-s1'], Y + 2),
      B('y3', 'board', '授業', 3, { kind: 'day' }, ['ex-s1'], Y + 3), B('y4', 'letter', '授業', 4, { kind: 'none' }, ['ex-s1'], Y + 4)];
    st.currentId = 't1'; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  const tb = await page.eval(`({ rows: [...document.querySelectorAll('#room-tasks .task-row')].map((x) => x.textContent), more: (document.querySelector('#room-tasks .task-more') || {}).textContent || '',
    tally: (document.querySelector('#room-tasks .task-row .tally') || {}).textContent || '', ow: ${OVERFLOW}, box: (() => { const b = document.getElementById('room-tasks').getBoundingClientRect(), f = document.querySelector('#room-board .board-face').getBoundingClientRect(); return b.right <= f.right && b.bottom <= f.bottom; })() })`);
  ok('大きい黒板の右下：残っているタスクを生徒ごと・科目ごとの正の字で（はじめての生徒さん 授業 正丅…）・3人まで＋「ほか 2 人」・決めない頼みは数えない', tb.rows.length === 3 && /^はじめての生徒さん授業正丅/.test(tb.rows[0]) &&
    tb.tally === '正丅' && tb.more === 'ほか 2 人' && tb.box && tb.ow <= 0, JSON.stringify(tb));
  await page.eval('window.scrollTo(0, 0); true');
  await page.shot('39_黒板の正の字_1280_light.png');
  }
  // 机に残るお便り（スマホ）：終わるまで残り、3枚まで重なって「＋N」。紙を押すと、上から読める
  {
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  const d2 = await page.eval(`(() => { const E = SekigaeEngine, p = E.dayKey(Date.now()).split('-').map(Number); return E.ymd(new Date(p[0], p[1] - 1, p[2] + 2, 12).getTime()); })()`);
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})), t = new Date(Date.now() - 3 * 3600000); t.setHours(9, 0, 0, 0); const T = t.getTime(), Y = T - 86400000;
    const L = (id, p, text, due, at, extra) => Object.assign({ id: id, text: text, channel: 'letter', subject: '手伝い', period: p, due: due, createdAt: at, updatedAt: at, targets: ['ex-s1'], firstTime: {}, results: {} }, extra || {});
    st.boards = [L('m1', 1, '資料をそろえておいて', undefined, T + 1), L('m2', 2, '印刷は職員室で', { kind: 'day' }, T + 2), L('m3', 3, 'この時間のうちに、表を見て', { kind: 'slot' }, T + 3),
      L('my', 2, '来週までに読んでおいて', { kind: 'date', date: ${JSON.stringify(d2)} }, Y + 2),
      { id: 'k4', text: '黒板の頼み', channel: 'board', subject: '授業', period: 4, createdAt: T + 4, updatedAt: T + 4, targets: ['ex-s1', 'ex-s2'], firstTime: {}, results: {} }];
    st.currentId = 'k4'; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-slot="4"]');
  await sleep(400);
  const dk = await page.eval(`(() => { const p = document.querySelector('#room-rows .desk-paper[data-sid="ex-s1"]'); return p ? { bid: p.dataset.bid, n: p.dataset.n, cls: p.className, more: (p.querySelector('.dp-more') || {}).textContent || '', s2: !!document.querySelector('#room-rows .desk-paper[data-sid="ex-s2"]') } : null; })()`);
  ok('4限の机：まだ終わっていない前のお便り（3限・2限・1限・前の日の宿題）が残り、重なって見える（いちばん上は3限・3枚まで＋「＋1」）', !!dk && dk.bid === 'm3' && dk.n === '4' && /is-stack3/.test(dk.cls) && dk.more === '＋1' && !dk.s2, JSON.stringify(dk));
  await page.pressEl('#room-rows .desk-paper[data-sid="ex-s1"]');
  await sleep(350);
  const lp = await page.eval(`({ top: document.getElementById('letter-pop-text').textContent, due: document.getElementById('letter-pop-due').textContent, under: [...document.querySelectorAll('#letter-pop-under .lp-item')].map((x) => x.textContent),
    more: (document.querySelector('#letter-pop-under .lp-more') || {}).textContent || '', inView: (() => { const r = document.getElementById('letter-pop').getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth + 1; })() })`);
  ok('紙を押すと、重なっているお便りを上から読める（いちばん上は大きく・下の2枚は小さく・「ほか 1 枚」）', lp.top === 'この時間のうちに、表を見て' && lp.due === '〆 この時間中' && lp.under.length === 2 &&
    /2限 手伝い/.test(lp.under[0]) && /1限 手伝い/.test(lp.under[1]) && lp.more === 'ほか 1 枚' && lp.inView && (await page.eval(OVERFLOW)) <= 0, JSON.stringify(lp));
  await page.shot('40_机に残るお便り_390_light.png');
  await page.pressEl('#room-rows .desk-paper[data-sid="ex-s1"]');
  await sleep(150);
  // 終わったら消える：2限のお便りを提出したことにする
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); st.boards.find((b) => b.id === 'm2').results['ex-s1'] = { kind: 'asExpected', memo: '', ack: false, at: Date.now(), submitted: true };
    localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  ok('提出したお便り（2限）は、机から消える（残りは3枚・「＋N」なし）', (await page.eval(`(() => { const p = document.querySelector('#room-rows .desk-paper[data-sid="ex-s1"]'); return p.dataset.n + ':' + !p.querySelector('.dp-more'); })()`)) === '3:true');
  }

  // 伝え方ごとに消す：書いてある頼みを消しても、ほかのタブに書きかけの文があれば、シートは開いたまま（その文は出せる）
  {
  await page.viewport(390, 844, true, false, false);
  await page.eval('localStorage.clear(); true');
  await page.load(base);
  await page.eval(`(() => { const st = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})), t = new Date(Date.now() - 3 * 3600000); t.setHours(9, 0, 0, 0);
    st.boards = [{ id: 'd1', text: '黒板の頼み', channel: 'board', subject: '雑務', period: 1, createdAt: t.getTime(), updatedAt: t.getTime(), targets: ['ex-s1', 'ex-s2'], firstTime: {}, results: {} }];
    st.currentId = 'd1'; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(st)); return true; })()`);
  await page.load(base);
  await page.pressEl('#tt-list .tt-row[data-slot="1"]');
  await sleep(200);
  await page.pressEl('#tt-list .tt-now .tt-edit');
  await page.waitFor(`!document.getElementById('sheet-write').hidden`, 2000);
  await page.eval(`(() => { document.getElementById('write-ch-letter').click(); const t = document.getElementById('write-text'); t.value = 'お便りの書きかけ'; t.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('write-ch-board').click(); document.getElementById('write-del').click(); return true; })()`);
  await page.waitFor(`!document.getElementById('confirm').hidden`, 2000);
  await page.eval(`document.getElementById('confirm-yes').click(); true`);
  await sleep(300);
  const dl1 = await page.eval(`({ open: !document.getElementById('sheet-write').hidden, boards: ${SAVED}.boards.length, has: ['board', 'letter'].map((c) => document.getElementById('write-has-' + c).hidden ? '' : document.getElementById('write-has-' + c).textContent),
    text: document.getElementById('write-text').value })`);
  ok('黒板の頼みを消しても、お便りのタブに書きかけがあればシートは開いたまま（黒板のタブは空にもどる）', dl1.open && dl1.boards === 0 && JSON.stringify(dl1.has) === '["","書きかけ"]' && dl1.text === '', JSON.stringify(dl1));
  await page.eval(`(() => { document.getElementById('write-ch-letter').click(); document.getElementById('write-submit').click(); return true; })()`);
  await sleep(400);
  const dl2 = await page.eval(`${SAVED}.boards.map((b) => b.channel + ':' + b.period + ':' + b.subject + ':' + b.text)`);
  ok('… そのまま出すと、お便りが同じ1限に入る（科目名もそのまま）', JSON.stringify(dl2) === '["letter:1:雑務:お便りの書きかけ"]', JSON.stringify(dl2));
  }

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
  const w130 = await page.eval(`(() => { const st = ${SAVED}, b = st.boards[st.boards.length - 1]; return { per: b.period, day: SekigaeEngine.dayKey(b.createdAt), date: document.querySelector('#room-date .bd-date').textContent, rows: ${TT}.rows }; })()`);
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
