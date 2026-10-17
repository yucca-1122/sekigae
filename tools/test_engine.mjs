// 判定エンジン（sekigae.html の // ENGINE START 〜 // ENGINE END）の試験
// 本体からエンジンの部分だけを切り出し、node の vm で動かす（画面には触らない）
// 使い方: node tools/test_engine.mjs   （sekigae フォルダで実行。全部通ると終了コード 0）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'sekigae.html'), 'utf8');
const m = html.match(/\/\/ ENGINE START([\s\S]*?)\/\/ ENGINE END/);
if (!m) { console.error('// ENGINE START 〜 // ENGINE END が見つからない'); process.exit(2); }
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: 'engine' });
const E = sandbox.SekigaeEngine;
if (!E) { console.error('SekigaeEngine が出ていない'); process.exit(2); }

let pass = 0;
const fails = [];
const J = (v) => JSON.stringify(v);
function ok(name, cond, detail) {
  if (cond) pass++; else fails.push(name + (detail ? ' … ' + detail : ''));
  console.log((cond ? '  通った   ' : '  通らない ') + name + (!cond && detail ? ' … ' + detail : ''));
}
function eq(name, got, want) { ok(name, J(got) === J(want), '期待 ' + J(want) + ' ／ 実際 ' + J(got)); }
function section(t) { console.log('\n■ ' + t); }

/* 見本の生徒（仕様どおり） */
const FIRST = { q1: 'A', q2: 'C', q3: 'B', q4: 'C', q5: 'C' };   // 見本：はじめての生徒
const USED = { q1: 'C', q2: 'A', q3: 'A', q4: 'A', q5: 'A' };    // 見本：慣れた生徒
const UNKNOWN = { q1: 'D', q2: 'D', q3: 'D', q4: 'D', q5: 'D' }; // ぜんぶ「まだ分からない」
const SAMPLE = 'これ、簡単にまとめておいて。なるはやで！';
const GOOD = '明日10時のゼミで使う図を、去年のスライドを見本にA4 1枚で。30分まで。途中で一度見せてね。詰まったら声をかけて。進め方は任せるね。いつもありがとう';

/* ================= A. 黒板の文の特徴（例文） ================= */
section('A. 黒板の文の特徴の読み取り（例文 ' + 27 + ' 件）');
const BOOL = ['purpose', 'goal', 'example', 'deadline', 'timebox', 'decide', 'midway', 'regular', 'askOk'];
const LIST = ['vague', 'abbr', 'soft', 'blame', 'push', 'thanks'];
const pick = (f, k) => (k === 'vague' || k === 'abbr' ? f[k].map((x) => x.word) : f[k]);
const CASES = [
  { t: SAMPLE, want: { purpose: false, goal: false, deadline: false, timebox: false, midway: false, regular: false, askOk: false, vague: ['簡単に', 'なるはや'], abbr: [], blame: [], thanks: [] } },
  { t: '明日10時のゼミで使う図を、A4 1枚にまとめて。30分くらいで。途中で一度見せてね', want: { purpose: true, goal: true, deadline: true, timebox: true, midway: true, vague: [], abbr: [], askOk: false } },
  { t: '来週の会議用に、去年の発表スライドを見本にして3枚作ってください。', want: { purpose: true, goal: true, example: true, deadline: true, regular: false } },
  { t: 'KPIの結果、OKRでざっと見ておいて', want: { abbr: ['KPI', 'OKR'], vague: ['ざっと'], purpose: false } },
  { t: 'また間違えてる。なんでいつも雑なの？', want: { blame: ['また', 'なんで', 'いつも', '雑'], thanks: [] } },
  { t: 'いつもありがとう。助かってるよ', want: { thanks: ['ありがとう', '助かっ'], blame: [] } },
  { t: 'もしよかったら、時間があれば読んでおいてくれるといいかも', want: { soft: ['もしよかったら', '時間があれば', 'かも'], thanks: [], vague: [], timebox: false } },
  { t: '必ず言われたとおりにやりなさい', want: { push: ['必ず', '言われたとおり', 'なさい'] } },
  { t: 'ごめんなさい、必ずしも今日じゃなくていい', want: { push: [], deadline: true } },
  { t: '詰まったら30分で声をかけてね。質問はいつでも', want: { askOk: true, timebox: true } },
  { t: '毎週水曜に研究室で進捗を見せて', want: { regular: true, midway: true, deadline: true } },
  { t: '1. データを開く\n2. 列を選ぶ\n3. 平均を出す\n4. 図にする\n5. 保存する', want: { steps: 5, goal: true, decide: false } },
  { t: '十分に気をつけて、半分の量でいいよ', want: { timebox: false, goal: false } },
  { t: 'この件、発表の前に一覧表で整理して', want: { goal: true, purpose: true } },
  { t: '質問があればどうぞ。あれ、どこまで進んだ？', want: { askOk: true, vague: ['あれ'] } },
  { t: '自分で決めていいよ。どちらでもOK', want: { decide: true, abbr: [] } },
  { t: '出来るところまでで大丈夫。研究室に来たら声かけて', want: { regular: true, askOk: true, midway: false } },
  { t: 'うまくいかなかったら、迷ったら相談して', want: { vague: [], askOk: true } },
  { t: '絶対値の平均をグラフにして', want: { push: [], goal: true } },
  { t: 'ダメでもいいから、とりあえずたたき台を作ってみて', want: { blame: [], vague: ['とりあえず'], goal: true } },
  { t: '例の資料、いい感じにしておいて', want: { vague: ['例の', 'いい感じ'], goal: false } },
  { t: 'あとで聞いてね、また明日！', want: { blame: [], askOk: true, deadline: true } },
  { t: 'お疲れさま。さすが、よかったよ', want: { thanks: ['お疲れ', 'さすが', 'よかった'], soft: [] } },
  { t: 'ROIとSLAの値をPDFでLINEに送って', want: { abbr: ['ROI', 'SLA'] } },
  { t: '10/20 の 13:30 までに', want: { deadline: true, timebox: false } },
  { t: '一時的に保存しておいて', want: { deadline: false } },
  { t: 'かなり難しいけど、かならずやってね', want: { soft: [], push: ['かならず'] } }
];
CASES.forEach((c, i) => {
  const f = E.readBoard(c.t);
  const got = {}, want = {};
  Object.keys(c.want).forEach((k) => { want[k] = c.want[k]; got[k] = BOOL.indexOf(k) >= 0 ? f[k] : (LIST.indexOf(k) >= 0 ? pick(f, k) : f[k]); });
  eq('例文' + (i + 1) + '「' + c.t.replace(/\n/g, ' / ').slice(0, 28) + '」', got, want);
  const back = E.segments(f.text, f.marks).map((s) => s.t).join('');
  if (back !== f.text) ok('例文' + (i + 1) + ' の切れ目をつなぐと元の文に戻る', false, back);
});
{
  const all = CASES.every((c) => { const f = E.readBoard(c.t); return E.segments(f.text, f.marks).map((s) => s.t).join('') === c.t; });
  ok('全部の例文で、描くための切れ目をつなぐと元の文に戻る', all);
  const f = E.readBoard('KPI（重要な指標）の結果を確認。KPIは明日まで');
  eq('略語の直後に（説明）があれば、同じ略語は全部「説明あり」（にじませない）', f.abbr.map((x) => [x.word, x.explained]), [['KPI', true], ['KPI', true]]);
  eq('ひな形「（KPI＝◯◯）」を足すと説明ありになる', E.readBoard('KPIを見て\n（KPI＝◯◯）').abbr.every((x) => x.explained), true);
  const marks = E.readBoard('また雑になるはやで').marks.map((x) => [x.cat, x.word]);
  eq('印のつく言葉（責める・あいまい）が重ならずに並ぶ', marks, [['blame', 'また'], ['blame', '雑'], ['vague', 'なるはや']]);
}
{
  // 黒板に足すひな形は、押すとその吹き出しが消える（検出に引っかかる）こと
  const tpl = { purpose: '目的：◯◯に使うため', goal: '完成の目安：◯◯（例：A4 1枚・箇条書き5つ）', timebox: 'かける時間：◯分まで', deadline: 'いつまで：◯日◯時まで',
    decide: '自分で決めていいこと：◯◯', askOk: '◯分たっても詰まったら、声をかけてね', midway: '途中で見せる日：◯日（途中のままでいいよ）', example: '見本：◯◯（前のものを見てね）' };
  Object.keys(tpl).forEach((k) => ok('ひな形「' + tpl[k] + '」で ' + k + ' がそろう', E.readBoard('資料を作って\n' + tpl[k])[k] === true));
  const th = E.readBoard('資料を作って\nいつも助かってるよ、ありがとう');
  ok('お礼のひな形「いつも助かってるよ、ありがとう」は、お礼に数え、責める言葉に数えない', th.thanks.length > 0 && th.blame.length === 0, J([th.thanks, th.blame]));
}

/* ================= B. 生徒ごとの強さ ================= */
section('B. 生徒ごとの強さ（席・にじみ・顔・時計・心の声）');
{
  eq('席: A＝後ろ・B＝中ほど・C＝前・D＝中ほど', ['A', 'B', 'C', 'D'].map((x) => E.seatOf(x)), ['back', 'middle', 'front', 'middle']);
  eq('にじみ(px): A 3.6 ＞ B・D 2.4 ＞ C 1.5', ['A', 'B', 'D', 'C'].map((x) => E.blurPx(x)), [3.6, 2.4, 2.4, 1.5]);
  const f = E.readBoard(SAMPLE);
  const v1 = E.studentView(f, FIRST), v2 = E.studentView(f, USED);
  eq('見本の黒板×はじめての生徒: 後ろの席・にじみ 3.6・先生は忙しそう・時計は大', [v1.seat, v1.blur, v1.face, v1.clock], ['back', 3.6, 'busy', 2]);
  eq('見本の黒板×慣れた生徒: 前の席・にじみ 1.5・ふつうの顔・時計は小', [v2.seat, v2.blur, v2.face, v2.clock], ['front', 1.5, 'normal', 1]);
  ok('はじめての生徒の心の声は4つ、慣れた生徒は3つ（2〜4の範囲）', v1.voices.length === 4 && v2.voices.length === 3, J([v1.voices.length, v2.voices.length]));
  ok('はじめての生徒の心の声に「家だと進まない」「迷惑かな」「放り出された」が入る（Q5・Q2・Q1）',
    ['家だと進まない', '迷惑かな', '放り出された'].every((w) => v1.voices.some((x) => x.text.indexOf(w) >= 0)), J(v1.voices.map((x) => x.text)));
  ok('「放り出された」は強めの印（後ろの席の不足は強めに出す）', v1.voices.some((x) => x.key === 'handsOff' && x.strong));
  ok('慣れた生徒の心の声に「放り出された」は出ない', !v2.voices.some((x) => x.key === 'handsOff'));
  ok('吹き出しの大きさ: はじめての生徒の「どこまで？」は大(3)、慣れた生徒は中(2)',
    v1.bubbles.find((b) => b.key === 'goal').size === 3 && v2.bubbles.find((b) => b.key === 'goal').size === 2, J([v1.bubbles, v2.bubbles]));
  eq('足りないものの吹き出しは7種（何のため？どこまで？何分？いつまで？決めていい？いつ聞いていい？次いつ見せる？）が全部出る',
    v1.bubbles.map((b) => b.text).sort(), ['いつまで？', 'いつ聞いていい？', 'どこまで？', '何のため？', '何分？', '次いつ見せる？', '決めていい？'].sort());
  const vf = E.studentView(f, USED, { firstTime: true });
  eq('「この人には初めての作業」なら、慣れた生徒でも A 扱い（後ろの席・にじみ 3.6）', [vf.fam, vf.seat, vf.blur], ['A', 'back', 3.6]);
  const vu = E.studentView(f, UNKNOWN);
  eq('ぜんぶ「まだ分からない」: 中ほどの席・ふつうの顔', [vu.seat, vu.face], ['middle', 'normal']);
}
{
  const ask = E.readBoard('資料をまとめて。詰まったら声をかけてね');
  eq('Q2 が C でも、聞いていい目安があれば忙しそうに見えない', E.studentView(ask, FIRST).face, 'normal');
  const blame = E.readBoard('また雑。明日10時までにA4 1枚で直して');
  const b3 = E.studentView(blame, { q1: 'B', q2: 'B', q3: 'C', q4: 'B', q5: 'B' }), b1 = E.studentView(blame, { q1: 'B', q2: 'B', q3: 'A', q4: 'B', q5: 'B' });
  eq('責める言葉 → かたい顔。Q3 が C なら言葉が大きく・怒りの印つき', [b3.face, b3.blameBig, b3.faceStrong, b1.face, b1.blameBig, b1.faceStrong], ['stiff', true, true, 'stiff', false, false]);
  ok('Q3 が C の心の声は「刺さって、しばらく手が止まるかも」', b3.voices.some((x) => x.text.indexOf('刺さって') >= 0), J(b3.voices));
  eq('お礼 → やわらかい顔', E.studentView(E.readBoard('資料ありがとう、助かる'), USED).face, 'soft');
  eq('責める言葉とお礼が両方 → かたい顔が勝つ', E.studentView(E.readBoard('ありがとう。でもまた雑'), USED).face, 'stiff');
  eq('押しつけ → かたい顔', E.studentView(E.readBoard('必ず今日中にやりなさい'), USED).face, 'stiff');
  const q4c = { q1: 'B', q2: 'B', q3: 'B', q4: 'C', q5: 'B' };
  eq('Q4 が C で完成の目安と時間がない → 時計が大', E.studentView(E.readBoard('レポートを見直して'), q4c).clock, 2);
  eq('Q4 が C でも、かける時間があれば時計は出ない', E.studentView(E.readBoard('レポートを30分で見直して'), q4c).clock, 0);
  eq('Q4 が A で時間がない → 時計は小', E.studentView(E.readBoard('レポートを見直して'), { q1: 'B', q2: 'B', q3: 'B', q4: 'A', q5: 'B' }).clock, 1);
  const q5b = E.studentView(E.readBoard('資料を3枚にまとめて'), { q1: 'B', q2: 'D', q3: 'D', q4: 'D', q5: 'B' });
  ok('Q5 が B で期限がない → 「急ぎじゃないのかな、後回し」', q5b.voices.some((x) => x.text.indexOf('急ぎじゃないのかな') >= 0), J(q5b.voices));
  const q5c = E.studentView(E.readBoard('資料を3枚にまとめて。途中で一度見せて'), { q1: 'B', q2: 'D', q3: 'D', q4: 'D', q5: 'C' });
  ok('Q5 が C でも、途中で見せる日があれば「家だと進まない」は出ない', !q5c.voices.some((x) => x.text.indexOf('家だと') >= 0) && !q5c.bubbles.some((b) => b.key === 'show'), J(q5c.voices));
  const steps = E.readBoard('1. データを開く\n2. 列を選ぶ\n3. 平均を出す\n4. 図にする\n5. 保存する');
  ok('慣れた生徒に手順5つ以上 → 「任せてもらえていない」', E.studentView(steps, USED).voices.some((x) => x.key === 'tooMany'));
  ok('はじめての生徒には、同じ手順でも「任せてもらえていない」は出ない', !E.studentView(steps, FIRST).voices.some((x) => x.key === 'tooMany'));
  const good = E.studentView(E.readBoard(GOOD), FIRST);
  eq('そろった黒板: 吹き出しなし・足すものなし・心の声は前向き2つ', [good.bubbles.length, good.chips.length, good.voices.length, good.voices.every((x) => x.tone === 'pos')], [0, 0, 2, true]);
  // すべての例文×4種の生徒で、心の声は2〜4個・全部「〜かも」・聞く一言は「？」で終わる
  let allOk = true, bad = '';
  CASES.concat([{ t: GOOD }]).forEach((c) => [FIRST, USED, UNKNOWN, { q1: 'B', q2: 'B', q3: 'C', q4: 'B', q5: 'B' }].forEach((a) => {
    const v = E.studentView(E.readBoard(c.t), a);
    const fine = v.voices.length >= 2 && v.voices.length <= 4 && v.voices.every((x) => /かも$/.test(x.text)) && /？$/.test(v.ask.text) && v.chips.length <= 5;
    if (!fine && allOk) { allOk = false; bad = c.t + ' ' + J(v.voices) + ' ' + v.ask.text; }
  }));
  ok('全部の例文×4種の生徒で: 心の声は2〜4個・全部「〜かも」で終わる・聞く一言は「？」で終わる・足すものは5つまで', allOk, bad);
}

/* ================= C. 「本人に聞くなら」の選び方 ================= */
section('C. 「本人に聞くなら」の選び方（いちばん重い不足から1つ）');
{
  const f = E.readBoard(SAMPLE);
  eq('見本の黒板×はじめての生徒 → あいまいな言葉「簡単に」を聞く', E.studentView(f, FIRST).ask.text, '「簡単に」って、どれくらいのつもりで受け取った？');
  eq('見本の黒板×慣れた生徒 → 目的を聞く', E.studentView(f, USED).ask.text, 'これ、何に使うものだと思った？');
  eq('責める言葉×Q3 が C → その言葉の受け取り方を聞く', E.studentView(E.readBoard('また雑。明日10時までにA4 1枚で直して'), { q1: 'B', q2: 'B', q3: 'C', q4: 'B', q5: 'B' }).ask.text, '「また」って書いたけど、責められているように読めた？');
  eq('期限がない×Q5 が B → いつまでのつもりかを聞く', E.studentView(E.readBoard('資料を3枚にまとめて'), { q1: 'B', q2: 'D', q3: 'D', q4: 'D', q5: 'B' }).ask.text, 'いつまでに出すつもりで受け取った？');
  const kpi = E.readBoard('KPIの結果を図1枚にまとめて、明日までに');
  eq('説明のない略語×始めたばかりの生徒（ほかは まだ分からない） → 略語が伝わったかを聞く', E.studentView(kpi, { q1: 'A', q2: 'D', q3: 'D', q4: 'D', q5: 'D' }).ask.text, '「KPI」って、何のことか伝わってた？');
  eq('同じ黒板でも Q2 が C（一人で抱えがち）なら、聞いていい目安のほうを先に聞く', E.studentView(kpi, FIRST).ask.text, '途中で聞きに来るとしたら、いつなら来やすい？');
  eq('見本も完成の目安もない×はじめての生徒（Q4・Q2 はまだ分からない） → 最初の一歩を聞く', E.studentView(E.readBoard('アンケートの集計、やっておいて'), { q1: 'A', q2: 'D', q3: 'D', q4: 'D', q5: 'D' }).ask.text, '最初の一歩、何から始めればいいか見えてた？');
  eq('そろった黒板 → 開いた問い', E.studentView(E.readBoard(GOOD), USED).ask.text, 'この頼み方で、分かりにくいところはあった？');
}

/* ================= D. 通知表の点数 ================= */
section('D. 先生の通知表の点数（0〜1）と4つの場所');
{
  const f = E.readBoard(SAMPLE);
  const s = E.scoreBoard(f, ['A', 'C'], false);
  eq('見本の黒板（相手 A と C）: 求める 0.2・支える 0.38（手厚さは半分だけ合う）', [s.demand, s.support, s.s.fit], [0.2, 0.38, 0.5]);
  eq('… 位置は「ほったらかし」', E.quadrant(s.demand, s.support).label, 'ほったらかし');
  const g = E.scoreBoard(E.readBoard(GOOD), ['A', 'C'], false);
  eq('そろった黒板: 求める 1・支える 1・「温かく厳しい」', [g.demand, g.support, E.quadrant(g.demand, g.support).label], [1, 1, '温かく厳しい']);
  eq('やわらげすぎ（「できれば」）があると「言い切る」が 0', E.scoreBoard(E.readBoard('できれば明日までに3枚で'), [], false).d.firm, 0);
  eq('お礼がなくても「認める一言を送った」があれば「報いる」は 1', [E.scoreBoard(f, [], false).s.reward, E.scoreBoard(f, [], true).s.reward], [0, 1]);
  eq('責める言葉があると「責める言葉・押しつけがない」が 0', E.scoreBoard(E.readBoard('また雑'), [], false).s.noBlame, 0);
  eq('押しつけ（必ず・〜しなさい）があっても「責める言葉・押しつけがない」が 0（2026-10-17 追加）', E.scoreBoard(E.readBoard('必ず明日までに3枚で出しなさい'), [], false).s.noBlame, 0);
  const steps = E.readBoard('1. a\n2. b\n3. c\n4. d\n5. e');
  eq('手順5つ以上: 慣れた生徒には合わない(0)、はじめての生徒・中ほどには合う(1)', ['C', 'A', 'B'].map((x) => E.scoreBoard(steps, [x], false).s.fit), [0, 0, 1]);
  eq('4つの場所の境目は 0.5（0.5 は高いほう）', [E.quadrant(0.5, 0.5).label, E.quadrant(0.6, 0.2).label, E.quadrant(0.2, 0.6).label, E.quadrant(0.4, 0.49).label], ['温かく厳しい', 'きびしいだけ', 'やさしいだけ', 'ほったらかし']);
  const rc = E.reportCard([{ demand: 0.2, support: 0.38 }, { demand: 1, support: 1 }]);
  eq('平均: 求める 0.6・支える 0.69 →「温かく厳しい」', [rc.demand, rc.support, rc.quad.label, rc.n], [0.6, 0.69, '温かく厳しい', 2]);
  eq('黒板がなければ通知表は出ない', E.reportCard([]), null);
  const stu = { s1: { id: 's1', answers: { q1: 'C' } }, s2: { id: 's2', answers: { q1: 'C' } } };
  const saved = { text: SAMPLE, targets: ['s1', 's2'], firstTime: { s2: true }, results: { s1: { kind: 'direction', ack: true } } };
  const ss = E.scoreSaved(saved, stu);
  eq('保存した黒板: 「初めての作業」は A 扱いで手厚さを数え、認める一言も数える', [ss.s.fit, ss.s.reward], [0.5, 1]);
  eq('よく使うあいまいな言葉（上位）: 言い方が違っても見出しでまとめる', E.topVague(['簡単にまとめて', '簡単なもので', 'ざっと見て', 'なるはやで'], 2), [{ word: '簡単に', n: 2 }, { word: 'ざっと', n: 1 }]);
}

/* ================= E. 提出物：まず疑う・何人もずれた・像の見直し ================= */
section('E. 提出物（まず疑う黒板の特徴・何人もずれた・この像まだ合ってる？）');
{
  const f = E.readBoard(SAMPLE);
  eq('方向がずれた → 目的・完成の基準・略語の説明・自分の言葉で言い直してもらう（あった／なかった）', E.suspects('direction', f, 'A').map((x) => [x.key, x.ok]), [['purpose', false], ['goal', false], ['abbr', true], ['teachBack', false]]);
  eq('量や質がずれた → 完成の基準', E.suspects('amount', f, 'C').map((x) => x.key), ['goal']);
  eq('時間がかかりすぎた → かける時間・慣れに合った手厚さ', E.suspects('time', f, 'A').map((x) => [x.key, x.ok]), [['timebox', false], ['fit', false]]);
  eq('途中で止まった → 手厚さ・決めていい範囲・聞いていい目安・こちらから様子を聞く日', E.suspects('stalled', E.readBoard(GOOD), 'A').map((x) => [x.key, x.ok]), [['fit', true], ['decide', true], ['askOk', true], ['nudge', false]]);
  eq('思ったとおり・途中で聞いてきたは「まず疑う」を出さない', [E.suspects('asExpected', f, 'A').length, E.suspects('asked', f, 'A').length], [0, 0]);
  const b2 = { targets: ['a', 'b', 'c'], results: { a: { kind: 'direction' }, b: { kind: 'amount' }, c: { kind: 'asked' } } };
  const b1 = { targets: ['a', 'b'], results: { a: { kind: 'direction' }, b: { kind: 'asked' } } };
  eq('同じ黒板で2人ずれた → 「何人もずれた」を出す（途中で聞いてきたはずれに数えない）', [E.crowd(b2).misses, E.crowd(b2).alert, E.crowd(b1).alert], [2, true, false]);
  const now = Date.UTC(2026, 9, 17);
  const s = { id: 's', createdAt: now - 3 * E.DAY, updatedAt: now - 3 * E.DAY };
  const boards = [1, 2, 3, 4, 5].map((i) => ({ results: { s: { kind: 'asExpected', at: now - i * 1000 } } }));
  eq('書き直してから記録が5件 → 「この像、まだ合ってる？」', E.needsReview(s, boards, now), 'count');
  eq('4件ならまだ出ない', E.needsReview(s, boards.slice(0, 4), now), '');
  eq('4週間たったら出る', E.needsReview({ id: 's', createdAt: now - 29 * E.DAY, updatedAt: now - 29 * E.DAY }, [], now), 'time');
}

/* ================= F. 書き出し（Markdown） ================= */
section('F. 書き出し');
{
  const t = Date.UTC(2026, 9, 17, 3);
  const data = {
    students: [
      { id: 'ex-s1', name: 'はじめての生徒', example: true, answers: FIRST, notes: { heard: '', noticed: '' }, history: [{ at: t - E.DAY, answers: { q1: 'B', q2: 'C', q3: 'B', q4: 'C', q5: 'C' } }] },
      { id: 'ex-s2', name: '慣れた生徒', example: true, answers: USED, notes: { heard: 'チャットより口頭が楽', noticed: '' }, history: [] }
    ],
    boards: [{ id: 'ex-b1', text: SAMPLE, example: true, createdAt: t, targets: ['ex-s1', 'ex-s2'], firstTime: {}, results: { 'ex-s1': { kind: 'direction', memo: '目次だけ出てきた', ack: true, at: t, submitted: true } } }]
  };
  const md = E.exportMarkdown(data, t);
  ['# せきがえの書き出し（2026-10-17）', '## 自分の癖（見本の黒板から）', '- 通知表の位置: やさしいだけ（求める 0.20・支える 0.63）',
    '- よく使うあいまいな言葉: 簡単に（1回）、なるはや（1回）', '### 見本：はじめての生徒', '- 慣れ: 始めたばかりで、見本や手順があると進めやすい時期',
    '慣れ「慣れた作業は一人で進められて、新しい種類の作業は見本があると進めやすい」→「始めたばかりで、見本や手順があると進めやすい時期」',
    '→ 提出: 方向がずれた。メモ: 目次だけ出てきた。認める一言: 送った', '- 本人から聞いたこと: チャットより口頭が楽', '提出物の記録: 思ったとおり 0・方向がずれた 1']
    .forEach((line) => ok('書き出しに「' + line.slice(0, 40) + '」', md.indexOf(line) >= 0, md));
  const banned = ['能力', '性格', '苦手', '弱い', 'メンタル', '完璧主義', 'できない子'];
  ok('書き出しに能力・性格のラベルの言葉が入らない（' + banned.join('・') + '）', banned.every((w) => md.indexOf(w) < 0));
  eq('生徒も黒板もなければ「まだ」と書く', E.exportMarkdown({ students: [], boards: [] }, t).indexOf('- まだ黒板がない') >= 0 && E.exportMarkdown({ students: [], boards: [] }, t).indexOf('- まだ生徒がいない') >= 0, true);
}

/* ================= G. いちばん強い段（E）・先生から声をかける日・自分の言葉で言い直す（2026-10-17 追加） ================= */
section('G. いちばん強い段（E）と、新しく読む言葉');
{
  eq('Q2〜Q5 は E を受け付け、Q1 の E は「まだ分からない」に戻す', E.normAnswers({ q1: 'E', q2: 'E', q3: 'E', q4: 'E', q5: 'E' }), { q1: 'D', q2: 'E', q3: 'E', q4: 'E', q5: 'E' });
  eq('カードの問い: Q2〜Q5 に E があり、C と「まだ分からない」の間に並ぶ', E.QUESTIONS.map((q) => Object.keys(q.opts).join('')), ['ABCD', 'ABCED', 'ABCED', 'ABCED', 'ABCED']);
  const nb = E.readBoard('水曜にこちらから様子を聞くね。やることを自分の言葉で一度返してね');
  eq('「こちらから様子を聞くね」→ 先生から声をかける日、「自分の言葉で」→ 言い直してもらう', [nb.nudge, nb.teachBack], [true, true]);
  eq('相手からの「声をかけて」は、先生から声をかける日に数えない', E.readBoard('詰まったら声をかけて').nudge, false);
  const STUCK = Object.assign({}, UNKNOWN, { q2: 'E' });
  const v1 = E.studentView(E.readBoard(SAMPLE), STUCK, {});
  ok('Q2 が E: 足すとよいものに「◯日に、こちらから様子を聞くね」が出る', v1.chips.some((c) => c.key === 'nudge'), J(v1.chips));
  eq('Q2 が E: 聞いていい目安がないと先生が忙しそうに見える', v1.face, 'busy');
  const v1b = E.studentView(E.readBoard(SAMPLE + '水曜にこちらから様子を聞くね'), STUCK, {});
  ok('… 黒板に先生から声をかける日があれば、その不足は消える', !v1b.issues.some((x) => x.key === 'nudge'));
  const SAYS = Object.assign({}, UNKNOWN, { q3: 'E' });
  eq('Q3 が E:「本人に聞くなら」は、自分の言葉で言い直してもらう一言', E.studentView(E.readBoard('この図を直しておいて。明日までに'), SAYS, {}).ask.text, 'やることを、自分の言葉で一回言ってみてもらえる？');
  const v2b = E.studentView(E.readBoard('また雑。直しておいて'), SAYS, {});
  eq('Q3 が E: 責める言葉は大きく・こわく見える（C と同じ強さ）', [v2b.blameBig, v2b.faceStrong], [true, true]);
  const v3 = E.studentView(E.readBoard(SAMPLE), Object.assign({}, UNKNOWN, { q4: 'E' }), {});
  eq('Q4 が E: 時計は大きく、締め切りがないと「声をかけられるまで後回し」', [v3.clock, (v3.issues.find((x) => x.key === 'deadline') || {}).voice], [2, '締め切りがないと、声をかけられるまで後回しにするかも']);
  const w3 = E.studentView(E.readBoard('A4 1枚で、金曜までに。30分まで'), Object.assign({}, UNKNOWN, { q5: 'E' }), {});
  ok('Q5 が E: 見せる日も声をかける日もないと、両方の不足が出る', ['show', 'nudge'].every((k) => w3.issues.some((x) => x.key === k)), J(w3.issues.map((x) => x.key)));
  eq('通知表: 先生から声をかける日も「見せる日・来る日・声をかける日」に数える', E.scoreBoard(E.readBoard('あとでこちらから様子を聞くね'), [], false).d.checkpoint, 1);
  const tE = Date.UTC(2026, 9, 17, 3);
  const md2 = E.exportMarkdown({ students: [{ id: 'x', name: '生徒X', answers: UNKNOWN, notes: {}, history: [] }],
    boards: [{ id: 'b', text: 'A4 1枚で', createdAt: tE, closedAt: tE, targets: ['x'], firstTime: {}, results: {} }] }, tE);
  ok('書き出し: 締めた黒板で提出がない人は「未提出のまま締めた」と書き、数にも入れる', md2.indexOf('→ 未提出のまま締めた') >= 0 && md2.indexOf('未提出のまま締めた 1') >= 0, md2);
}

console.log('\n' + (fails.length ? '通らなかった: ' + fails.length + ' 件 ／ 通った: ' + pass + ' 件' : 'すべて通った: ' + pass + ' 件'));
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
