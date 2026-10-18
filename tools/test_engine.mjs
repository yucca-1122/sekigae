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
  ['# マネジメント教室の書き出し（2026-10-17）', '## 自分の癖（見本の黒板から）', '- 通知表の位置: やさしいだけ（求める 0.20・支える 0.63）',
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

/* ================= H. 時間割と3つの伝え方（v0.3 第1段） ================= */
section('H. 時間割と3つの伝え方（黒板・お便り・放送）');
const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // 端末の時刻（その日の区切りも端末の時刻）
{
  // 古いデータ（channel と subject がない黒板）は、黒板・授業として読む
  eq('古いデータの黒板（伝え方・科目名なし）→ 黒板・授業', E.lessonMeta({ id: 'old', text: '資料を作って' }), { channel: 'board', subject: '授業' });
  eq('伝え方と科目名があれば、そのまま読む（前後の空白はつめる）', E.lessonMeta({ channel: 'letter', subject: '  手伝い ' }), { channel: 'letter', subject: '手伝い' });
  eq('知らない伝え方は黒板に戻す', [E.normChannel('fax'), E.normChannel(''), E.normChannel('broadcast')], ['board', 'board', 'broadcast']);
  eq('科目名は10字まで・空なら「授業」', [E.normSubject('来月の発表会の準備と片づけ'), E.normSubject(''), E.normSubject(null), E.normSubject('読書会')], ['来月の発表会の準備と', '授業', '授業', '読書会']);
  eq('科目名の選択肢は5つ（ゼミ・授業・雑務・手伝い・その他）', E.SUBJECTS, ['ゼミ', '授業', '雑務', '手伝い', 'その他']);
  eq('伝え方は3つ（黒板＝その場で説明・お便り＝文字で配る・放送＝口や Zoom で伝えた）', E.CHANNELS.map((c) => c.label + '＝' + c.desc), ['黒板＝その場で説明', 'お便り＝文字で配る', '放送＝口や Zoom で伝えた']);
  eq('時限・科目・伝え方の書き方「2限 手伝い（お便り）」', [E.lessonLabel({ subject: '手伝い', channel: 'letter' }, 2), E.lessonLabel({}, 1)], ['2限 手伝い（お便り）', '1限 授業（黒板）']);
}
{
  // 時限＝その日の中で出した順（並べ替えはしない）。配列の順ではなく、出した時刻の順
  const bs = [
    { id: 'c', createdAt: at(18, 15) }, { id: 'a', createdAt: at(18, 9) }, { id: 'y', createdAt: at(17, 20) },
    // 2026-10-18 から日の区切りは午前3時（0:05 は前の日）。新しい日のはじめの頼みは 10/19 の 3:05 にした
    { id: 'b', createdAt: at(18, 11) }, { id: 'd', createdAt: at(19, 3, 5) }, { id: 'e', createdAt: at(18, 15) }
  ];
  const per = E.periods(bs);
  eq('時限はその日の中で出した順（10/18: 9時→1限・11時→2限・15時→3限、同じ時刻なら先に保存したほう）', [per.a, per.b, per.c, per.e], [1, 2, 3, 4]);
  eq('日が変わると1限から（10/17 の夜・10/19 の3時5分はそれぞれ1限）', [per.y, per.d], [1, 1]);
  eq('その日の頼み（出した順）', E.dayList(bs, '2026-10-18').map((b) => b.id), ['a', 'b', 'c', 'e']);
  eq('時間割で行き来できる日は、頼みのある日と今日（古い順）', E.dayKeys(bs, '2026-10-21'), ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-21']);
  eq('今日に頼みがあっても、日は重ならない', E.dayKeys(bs, '2026-10-18'), ['2026-10-17', '2026-10-18', '2026-10-19']);
}
{
  const f = E.readBoard(SAMPLE);
  const pickV = (v) => ({ voices: v.voices, bubbles: v.bubbles, ask: v.ask, chips: v.chips, blur: v.blur, face: v.face, clock: v.clock });
  eq('お便り: にじみ・「？」の吹き出し・心の声・聞く一言は、黒板と同じ決まり', pickV(E.studentView(f, FIRST, { channel: 'letter' })), pickV(E.studentView(f, FIRST, { channel: 'board' })));
  eq('伝え方を渡さないときは黒板（今までどおり）', pickV(E.studentView(f, FIRST)), pickV(E.studentView(f, FIRST, { channel: 'board' })));
  // 2026-10-18 調整: 始めたばかりの生徒（Q1 A）への放送は「慣れていない生徒に放送」の決まりが重なるので、放送だけの決まりは中ほど（Q1 B）と慣れた生徒（Q1 C）で見る
  const MID = { q1: 'B', q2: 'D', q3: 'D', q4: 'D', q5: 'D' };
  const vc = E.studentView(f, MID, { channel: 'broadcast' }), vu = E.studentView(f, USED, { channel: 'broadcast' });
  eq('放送: にじみは強め（黒板の1.5倍。中ほどの生徒 2.4→3.6・慣れた生徒 1.5→2.3）', [vc.blur, vu.blur, vc.faded, vc.channel], [3.6, 2.3, true, 'broadcast']);
  eq('放送: 心の声のいちばん上は「さっき何て言ってた…？ メモしてないと忘れるかも」（強い印はつけない）', [vc.voices[0].text, vc.voices[0].strong], ['さっき何て言ってた…？ メモしてないと忘れるかも', false]);
  eq('放送: 本人に聞くなら「さっき放送で言ったこと、何をいつまでにって受け取った？」', [vc.ask.text, vu.ask.text], ['さっき放送で言ったこと、何をいつまでにって受け取った？', 'さっき放送で言ったこと、何をいつまでにって受け取った？']);
  eq('放送: 足すとよいものの先頭は「要点をお便りでも送る」（押すと要点の下書きでシートを開く）', vc.chips[0], { key: 'broadcast', text: '要点をお便りでも送る', act: 'letter' });
  ok('放送: ほかの足すものは今までどおり黒板の最後にひな形を入れる（act＝add）', vc.chips.slice(1).every((c) => c.act === 'add') && vc.chips.length <= 5, J(vc.chips));
  const vl = E.studentView(f, MID, { channel: 'broadcast', letterCopy: true });
  ok('放送: あとからのお便りがもうあれば「要点をお便りでも送る」は出さない（聞く一言は同じ）', !vl.chips.some((c) => c.act === 'letter') && vl.ask.text === vc.ask.text, J(vl.chips));
  const vt = E.studentView(E.readBoard('また雑。直しておいて'), { q1: 'B', q2: 'E', q3: 'C', q4: 'E', q5: 'B' }, { channel: 'broadcast' });
  eq('放送: 責める言葉や重い不足があっても、聞く一言は放送のもの', vt.ask.key, 'broadcast');
  // 2026-10-18 調整: そろった文（GOOD）は用事が5つの長い文なので、放送だと「いくつ頼まれたっけ」が出る。前向きの声はお便りで確かめる
  const vg = E.studentView(E.readBoard(GOOD), FIRST, { channel: 'letter' });
  eq('お便り: そろった文なら、心の声は前向きの2つ（お便りは黒板と同じ決まり）', [vg.voices.length, vg.voices.every((x) => x.tone === 'pos')], [2, true]);
  let allOk = true, bad = '';
  CASES.concat([{ t: GOOD }]).forEach((c) => [FIRST, USED, UNKNOWN, { q1: 'B', q2: 'E', q3: 'E', q4: 'E', q5: 'B' }].forEach((a) => ['letter', 'broadcast'].forEach((ch) => {
    const v = E.studentView(E.readBoard(c.t), a, { channel: ch });
    const fine = v.voices.length >= 2 && v.voices.length <= 4 && v.voices.every((x) => /かも$/.test(x.text)) && /？$/.test(v.ask.text) && v.chips.length <= 5;
    if (!fine && allOk) { allOk = false; bad = ch + ' ' + c.t + ' ' + J(v.voices) + ' ' + v.ask.text; }
  })));
  ok('全部の例文×4種の生徒×お便り・放送で: 心の声は2〜4個・全部「〜かも」・聞く一言は「？」・足すものは5つまで', allOk, bad);
}
{
  // その日この生徒に降ってきた頼み（ほかの時限も含む）から足す心の声
  const B = (id, ch, text, targets, h) => ({ id: id, channel: ch, text: text, targets: targets || ['s'], createdAt: at(18, h || 9) });
  // 2026-10-18 調整: dayVoices（心の声だけ）を dayView（見ている頼みを渡す・心の声と足すとよいもの）に置き換えた
  const keys = (list, cur, sid, all) => E.dayView(list, cur, sid || 's', all).voices.map((x) => x.key);
  const one = [B('a', 'board', '資料を作って')];
  eq('頼みが1つ（黒板だけ）→ 足す心の声も足すものもなし', E.dayView(one, one[0], 's'), { voices: [], chips: [] });
  const three = [B('a', 'board', '資料を作って', ['s'], 9), B('b', 'letter', '印刷を手伝って', ['s'], 10), B('c', 'broadcast', '片づけお願い', ['s'], 11)];
  eq('1限（黒板）を見る: 放送だけ → 3本以上 → 黒板とお便り', keys(three, three[0]), ['castOnly', 'many', 'boardLetter']);
  eq('… 文言（黒板とお便りは「見返すのを忘れる」に）', E.dayView(three, three[0], 's').voices.map((x) => x.text),
    ['放送で聞いたことは、忘れるかも', '今日は頼みごとが多くて、どれから手をつけるか迷うかも', '黒板のほうに気を取られて、お便りを見返すのを忘れるかも']);
  eq('… 足すとよいもの: 今日の順番・お便りも見てね（見ているのが黒板のときだけ）', E.dayView(three, three[0], 's').chips.map((x) => x.text),
    ['今日の順番：先に◯◯、◯◯は明日でいいよ', 'お便りも見てね（何を・いつまでが書いてある）']);
  eq('3限（放送）を見る: 見ている放送は「放送だけ」に数えない → 3本以上 → 割り込み → 黒板とお便り', keys(three, three[2]), ['many', 'interrupt', 'boardLetter']);
  eq('… 見ているのが放送なら「お便りも見てね」は出さない（今日の順番・区切り）', E.dayView(three, three[2], 's').chips.map((x) => x.key), ['many', 'interrupt']);
  eq('2限（お便り）を見る: 4つ重なったら3つまで（黒板とお便りは出さない）', keys(three, three[1]), ['castOnly', 'many', 'interrupt']);
  eq('同じ日に黒板とお便り（2本）・2限のお便りを見る → 割り込み・黒板とお便り', keys(three.slice(0, 2), three[1]), ['interrupt', 'boardLetter']);
  eq('… 1限の黒板を見る → 黒板とお便りだけ（足すものは「お便りも見てね」）', [keys(three.slice(0, 2), three[0]), E.dayView(three.slice(0, 2), three[0], 's').chips.map((x) => x.key)], [['boardLetter'], ['boardLetter']]);
  const copy = three.concat([B('d', 'letter', ' 片づけお願い\n', ['s'], 12)]);
  ok('放送と同じ文のお便り（前の版の書き写し・空白の違いは同じ文）があれば、「放送は忘れる」は出ない', keys(copy, copy[0]).indexOf('castOnly') < 0, J(keys(copy, copy[0])));
  const fromCast = three.concat([{ id: 'd', channel: 'letter', text: '何を：片づけ\nいつまで：今日', fromCast: 'c', targets: ['s'], createdAt: at(18, 12) }]);
  ok('fromCast がその放送のお便り（要点）があれば、文が違ってもお便りあり（「放送は忘れる」は出ない）', keys(fromCast, fromCast[0]).indexOf('castOnly') < 0 && E.hasLetterCopy(fromCast, three[2], 's'), J(keys(fromCast, fromCast[0])));
  const other = three.concat([B('d', 'letter', '片づけお願い', ['t'], 12)]);
  ok('… 同じ文のお便りがほかの生徒あてなら、この生徒には「放送は忘れる」が残る', keys(other, other[0]).indexOf('castOnly') >= 0);
  const later = [B('a', 'board', '資料を作って', ['s'], 9), B('c', 'broadcast', '片づけお願い', ['s'], 11)], all = later.concat([{ id: 'z', channel: 'letter', text: '片づけお願い', targets: ['s'], createdAt: at(19, 9) }]);
  ok('… 次の日に同じ文のお便りを送っても、「放送は忘れる」は消える（全部の頼みから探す）', keys(later, later[0], 's', all).indexOf('castOnly') < 0 && keys(later, later[0]).indexOf('castOnly') >= 0, J(keys(later, later[0], 's', all)));
  const notMine = [B('a', 'board', 'A', ['s'], 9), B('b', 'board', 'B', ['t'], 10), B('c', 'letter', 'C', ['t'], 11)];
  eq('ほかの生徒あての頼みは数えない（この生徒には黒板1本だけ）', E.dayView(notMine, notMine[0], 's'), { voices: [], chips: [] });
  const done = [B('a', 'board', '資料を作って', ['s'], 9), B('b', 'letter', '印刷を手伝って\nいまの作業は、区切りのいいところまででいいよ\nお便りも見てね', ['s'], 10)];
  eq('足すとよいものは、見ている頼みにもう書いてあれば出さない（心の声は残る）', [keys(done, done[1]), E.dayView(done, done[1], 's').chips], [['interrupt', 'boardLetter'], []]);
  eq('伝え方の内訳と、放送だけで終わった頼み', E.channelCounts(three), { board: 1, letter: 1, broadcast: 1, castOnly: 1 });
  eq('… 同じ文のお便りを足すと、放送だけで終わった頼みは 0', E.channelCounts(copy), { board: 1, letter: 2, broadcast: 1, castOnly: 0 });
  eq('… fromCast がその放送のお便り（要点）でも 0', E.channelCounts(fromCast), { board: 1, letter: 2, broadcast: 1, castOnly: 0 });
  eq('… 古いデータ（伝え方なし）は黒板に数える', E.channelCounts([{ text: 'a' }, { text: 'b' }]), { board: 2, letter: 0, broadcast: 0, castOnly: 0 });
  ok('同じ文かどうかは、前後と途中の空白の違いを無視する', E.sameText(' 片づけ  お願い\n', '片づけ お願い') && !E.sameText('片づけお願い', '片づけをお願い'));
}
{
  // 書き出し：時限・科目・伝え方
  const t = at(18, 9);
  const data = {
    students: [{ id: 's', name: '生徒S', answers: FIRST, notes: {}, history: [] }],
    boards: [
      { id: 'b1', text: SAMPLE, channel: 'board', subject: '授業', createdAt: t, targets: ['s'], firstTime: {}, results: {} },
      { id: 'b2', text: '来週の準備で、資料の印刷を手伝ってもらえると助かります', channel: 'letter', subject: '手伝い', createdAt: t + 1, targets: ['s'], firstTime: {}, results: {} },
      { id: 'b3', text: 'あとで部屋の片づけ、お願いね', channel: 'broadcast', subject: '雑務', createdAt: t + 2, targets: ['s'], firstTime: { s: true }, results: { s: { kind: 'asked', submitted: true } } },
      { id: 'b0', text: '去年の資料を見て', createdAt: at(17, 18), targets: ['s'], firstTime: {}, results: {} }
    ]
  };
  const md = E.exportMarkdown(data, t);
  ['- 伝え方の内訳: 黒板 2・お便り 1・放送 1（放送だけで終わった頼み 1）', '- 頼みごと: 4 件', '- 1日の頼み: いちばん多い日 3 本（2026-10-18）',
    '  - 2026-10-18 1限 授業（黒板）「これ、簡単にまとめておいて。なるはやで！」',
    '  - 2026-10-18 2限 手伝い（お便り）「来週の準備で', '  - 2026-10-18 3限 雑務（放送）「あとで部屋の片づけ、お願いね」（初めての作業） → 提出: 途中で聞いてきた',
    '  - 2026-10-17 1限 授業（黒板）「去年の資料を見て」']
    .forEach((line) => ok('書き出しに「' + line.trim().slice(0, 34) + '」', md.indexOf(line) >= 0, md));
}

/* ================= I. 第1段の調整（2026-10-18）：放送の用事・慣れていない生徒・お便りの言葉・割り込み・1日の頼み ================= */
section('I. 第1段の調整（用事の数・放送の多い／長い／慣れていない生徒・お便りの急ぎ言葉・割り込み・いちばん多い日）');
{
  eq('用事の数: 1文なら1つ', E.errandCount('あとで部屋の片づけ、お願いね'), 1);
  eq('用事の数: 文の途中の足し言葉（ついでに・それと）を足す。「お願いします」だけの文は数えない', E.errandCount('資料を印刷して、ついでに部屋も片づけて、それと鍵も返しておいて。お願いします'), 3);
  eq('用事の数: 文の数を足す。文の頭の足し言葉（あと、・それから）は数えない', E.errandCount('資料を印刷して。あと、部屋も片づけて。それから鍵も返して。'), 3);
  eq('用事の数: 改行と！？でも区切る', E.errandCount('印刷して！\n片づけて？\n返して'), 3);
  eq('用事の数: 挨拶・お礼だけの文（よろしく・ありがとう・助かります）は数えない', [E.errandCount('印刷して。よろしく！'), E.errandCount('よろしくお願いします。ありがとう！助かります'), E.errandCount('印刷して。いつも助かってるよ、ありがとう')], [1, 0, 1]);
  eq('用事の数: 足し言葉の言い方（あとは・あわせて・加えて・もう一つ・ほかに）', E.errandCount('印刷して、あとは片づけ、あわせて鍵、加えて掃除、もう一つ買い物、ほかに連絡'), 6);
  eq('用事の数: 「あとで」は足し言葉ではない・空の文は0', [E.errandCount('あとで印刷して'), E.errandCount('')], [1, 0]);
}
{
  const MID = { q1: 'B', q2: 'D', q3: 'D', q4: 'D', q5: 'D' }, w = (v, k) => (v.issues.find((x) => x.key === k) || {}).w;
  const many = E.readBoard('資料を印刷して、ついでに部屋も片づけて、それと鍵も返しておいて');
  const vm = E.studentView(many, MID, { channel: 'broadcast' });
  eq('放送で用事3つ以上: 心の声「いくつ頼まれたっけ…どれか抜けてるかも」（重み6）・聞く一言「いくつあったか覚えてる？」', [w(vm, 'castMany'), vm.voices.map((x) => x.key).slice(0, 2), vm.ask.text],
    [6, ['broadcast', 'castMany'], '放送で頼んだこと、いくつあったか覚えてる？']);
  eq('… 文字はさらにうすく、にじみは ×1.8（中ほどの生徒 2.4→4.3）', [vm.fadeMore, vm.blur, vm.errands], [true, 4.3, 3]);
  eq('… お便りや黒板なら、用事が多くてもこの声は出ない', [E.studentView(many, MID, { channel: 'letter' }).issues.some((x) => x.key === 'castMany'), E.studentView(many, MID).fadeMore], [false, false]);
  const longT = '来月の発表会で使う資料を、去年のものを見本にしてA4 2枚くらいにまとめておいてもらえると、とても助かるので、どうぞよろしくお願いね';
  ok('（前提）長い文は60字以上で、用事は3つ未満', Array.from(longT.replace(/\s+/g, '')).length >= 60 && E.errandCount(longT) < 3, String(Array.from(longT).length));
  const vlg = E.studentView(E.readBoard(longT), USED, { channel: 'broadcast' });
  eq('放送で60字以上（用事3つ未満）: 心の声「長くて、途中から覚えきれないかも」（重み5）・さらにうすく・にじみ ×1.8（1.5→2.7）', [w(vlg, 'castLong'), vlg.voices.some((x) => x.text === '長くて、途中から覚えきれないかも'), vlg.fadeMore, vlg.blur], [5, true, true, 2.7]);
  ok('… 用事3つ以上のときは「長くて」は出さない（「いくつ頼まれたっけ」のほう）', !E.studentView(E.readBoard(longT + '。ついでに鍵も返して。それと掃除も'), USED, { channel: 'broadcast' }).issues.some((x) => x.key === 'castLong'));
  const f = E.readBoard(SAMPLE), vn = E.studentView(f, FIRST, { channel: 'broadcast' });
  eq('慣れていない生徒（Q1 A）に放送: 心の声「聞いたけど、やり方が分からないままかも」（重み6.5・赤い枠なし）・聞く一言「やり方で、分からないところある？」',
    [w(vn, 'castNovice'), vn.voices.find((x) => x.key === 'castNovice').strong, vn.ask.text], [6.5, false, 'やり方で、分からないところある？']);
  eq('… にじみ ×1.8（3.6→6.5）。黒板やお便りなら、この声は出ない', [vn.blur, E.studentView(f, FIRST, { channel: 'letter' }).issues.some((x) => x.key === 'castNovice')], [6.5, false]);
  const vf = E.studentView(f, USED, { channel: 'broadcast', firstTime: true });
  ok('「初めての作業」にした慣れた生徒にも、同じ「慣れていない生徒に放送」の声', vf.issues.some((x) => x.key === 'castNovice') && vf.ask.text === 'やり方で、分からないところある？');
  const vb = E.studentView(many, FIRST, { channel: 'broadcast' });
  eq('用事が多い放送×慣れていない生徒: にじみ ×2.1（3.6→7.6）・聞く一言は「やり方」が先（心の声は重みの順で4つまで）', [vb.blur, vb.ask.text, vb.voices[0].key, vb.voices.some((x) => x.key === 'castNovice'), w(vb, 'castMany')],
    [7.6, 'やり方で、分からないところある？', 'broadcast', true, 6]);
}
{
  const w = (v, k) => (v.issues.find((x) => x.key === k) || {}).w;
  const urgent = ['なるはやで', '大至急で', '急ぎで', '急いで', '今すぐ', 'さすがに', 'いい加減'];
  ok('お便りの急ぎ・気持ちの言葉（なるはや・至急・大至急・急ぎで・急いで・今すぐ・さすがに・いい加減）で「どのくらい急ぎ？ 怒ってる…？」（重み3.5）',
    urgent.every((u) => w(E.studentView(E.readBoard('資料を直して。' + u), USED, { channel: 'letter' }), 'letterTone') === 3.5), J(urgent));
  ok('… 黒板と放送では出ない', !E.studentView(E.readBoard('至急直して'), USED, { channel: 'board' }).issues.some((x) => x.key === 'letterTone') &&
    !E.studentView(E.readBoard('至急直して'), USED, { channel: 'broadcast' }).issues.some((x) => x.key === 'letterTone'));
  const vq = E.studentView(E.readBoard(GOOD + '。なるはやで！'), USED, { channel: 'letter' });
  eq('… ほかの声が少ないときは出る（そろった文＋「なるはや」: 心の声の先頭と聞く一言）', [vq.voices[0].text, vq.ask.text], ['これ、どのくらい急ぎ？ 怒ってる…？って迷うかも', 'お便りの書き方、きつく読めなかった？']);
  const vs = E.studentView(E.readBoard('至急、資料を直して'), FIRST, { channel: 'letter' });
  ok('… ほかの声が多いときは出ない（4つまでに入らない）', !vs.voices.some((x) => x.text.indexOf('怒ってる') >= 0) && vs.voices.length === 4, J(vs.voices));
}
{
  // 割り込み：前の時限の頼みが、見ている頼みを出す前に「締め」も「提出」もしていない
  const mk = (r, closedAt) => [
    { id: 'p', channel: 'board', text: '資料を作って', targets: ['s'], createdAt: at(18, 9), closedAt: closedAt || 0, results: r ? { s: r } : {} },
    { id: 'c', channel: 'broadcast', text: '片づけお願い', targets: ['s'], createdAt: at(18, 11), results: {} }];
  const has = (list) => E.dayView(list, list[1], 's').voices.some((x) => x.key === 'interrupt');
  ok('割り込み: 前の時限の頼みがまだ提出されていない → 「さっきの続き、どこまでやったっけ…ってなるかも」', has(mk()) && E.dayView(mk(), mk()[1], 's').voices.find((x) => x.key === 'interrupt').text === 'さっきの続き、どこまでやったっけ…ってなるかも');
  ok('… 足すとよいもの「いまの作業は、区切りのいいところまででいいよ」', E.dayView(mk(), mk()[1], 's').chips.some((x) => x.text === 'いまの作業は、区切りのいいところまででいいよ'));
  eq('… 見ている頼みを出す前に提出済み（提出の at が前）→ 出ない／出した後に提出（at が後）→ 出る', [has(mk({ kind: 'asExpected', submitted: true, at: at(18, 10) })), has(mk({ kind: 'asExpected', submitted: true, at: at(18, 12) }))], [false, true]);
  eq('… 選んだだけ（提出の前）は提出に数えない → 出る', has(mk({ kind: 'asExpected', submitted: false, at: at(18, 10) })), true);
  eq('… 見ている頼みを出す前に締めた → 出ない／出した後に締めた（未提出のまま）→ 出る', [has(mk(null, at(18, 10))), has(mk(null, at(18, 15)))], [false, true]);
  const two = mk();
  eq('… 後の時限の頼みからは数えない（1限を見ると出ない）', E.dayView(two, two[0], 's').voices.some((x) => x.key === 'interrupt'), false);
  const otherS = mk(); otherS[0].targets = ['t'];
  eq('… 前の頼みがほかの生徒あてなら出ない', has(otherS), false);
  const notCur = mk(); notCur[1].targets = ['t'];
  eq('… 見ている頼みがこの生徒あてでなければ出ない', has(notCur), false);
}
{
  const bs = [{ createdAt: at(17, 9) }, { createdAt: at(17, 10) }, { createdAt: at(18, 9) }, { createdAt: at(18, 10) }, { createdAt: at(18, 11) }, { createdAt: at(19, 9) }];
  eq('1日の頼み: いちばん多い日（10/18 の3本）', E.busiestDay(bs), { key: '2026-10-18', n: 3 });
  eq('… 同じ数なら新しい日', E.busiestDay(bs.slice(0, 2).concat([{ createdAt: at(19, 9) }, { createdAt: at(19, 10) }])), { key: '2026-10-19', n: 2 });
  eq('… 頼みがなければ出さない', E.busiestDay([]), null);
}

/* ================= J. 時間割の枠（1〜6限の時限・2026-10-18） ================= */
section('J. 時間割の枠（頼みごとの時限 period）');
{
  const B = (id, h, period, extra) => Object.assign({ id: id, channel: 'board', text: id, targets: ['s'], createdAt: at(18, h) }, period === undefined ? {} : { period: period }, extra || {});
  const keep = [B('a', 9, 4), B('b', 10, 1), B('c', 11, 6)];
  eq('持っている時限はそのまま（出した順ではなく時限）', E.periods(keep), { a: 4, b: 1, c: 6 });
  eq('その日の並びは時限の順', E.dayList(keep, '2026-10-18').map((b) => b.id), ['b', 'a', 'c']);
  const old = [9, 10, 11, 12, 13, 14, 15, 16].map((h, i) => B('o' + i, h));
  eq('時限のない古いデータは、その日の出した順に 1〜6 を入れ、7番目からは 0（時間割に入らない）', old.map((b) => E.periods(old)[b.id]), [1, 2, 3, 4, 5, 6, 0, 0]);
  eq('… 時間割に入らない頼みは、その日の並びの最後（出した順）', E.dayList(old, '2026-10-18').map((b) => b.id).slice(5), ['o5', 'o6', 'o7']);
  const mix = [B('m1', 9, 2), B('m2', 10), B('m3', 11), B('m4', 12, 0)];
  eq('時限のある頼みとない頼みがまざっていたら、ないほうは空いている時限を小さい順に（はっきり 0 は 0 のまま）', E.periods(mix), { m1: 2, m2: 1, m3: 3, m4: 0 });
  const dup = [B('d1', 9, 3), B('d2', 10, 3)];
  eq('同じ日に同じ時限が重なっていたら、あとから出したほうを空いている時限へ', E.periods(dup), { d1: 3, d2: 1 });
  const twoDays = E.periods([B('x', 9, 1), Object.assign(B('y', 9, 1), { createdAt: at(17, 9) })]);
  eq('日がちがえば同じ時限でもよい', [twoDays.x, twoDays.y], [1, 1]);
  eq('ふつうでない時限（7・2.5・文字）は、ないものとして入れ直す', E.periods([B('v1', 9, 7), B('v2', 10, 2.5), B('v3', 11, '3')]), { v1: 1, v2: 2, v3: 3 });
  eq('空いている時限: うまっている時限をのぞく', E.freePeriods(keep, '2026-10-18'), [2, 3, 5]);
  eq('… 直すときは、その頼みの時限も空きとみなす', E.freePeriods(keep, '2026-10-18', 'a'), [2, 3, 4, 5]);
  eq('… 6つうまっていたら空きはない・ほかの日は全部空き', [E.freePeriods(old, '2026-10-18'), E.freePeriods(old, '2026-10-17')], [[], [1, 2, 3, 4, 5, 6]]);
  eq('時限の数の上限は 6', E.PERIOD_MAX, 6);
}
{
  // 割り込みの「前の時限」＝時限の数が小さい頼み（提出・締めの時刻は、見ている頼みの createdAt と比べる）
  const p1late = { id: 'p', channel: 'board', text: 'p', period: 1, targets: ['s'], createdAt: at(18, 15), results: {} };
  const cur = { id: 'c', channel: 'broadcast', text: 'c', period: 2, targets: ['s'], createdAt: at(18, 10), results: {} };
  const list = E.dayList([cur, p1late], '2026-10-18');
  eq('あとから出した 1限 は、2限 の前の時限（並びは時限の順）', list.map((b) => b.id), ['p', 'c']);
  ok('… 2限 を見ると、1限 は見ている頼みを出す前に提出されていないので割り込みになる', E.dayView(list, cur, 's').voices.some((x) => x.key === 'interrupt'));
  ok('… 1限 を見ると、後ろの時限（2限）は割り込みにならない', !E.dayView(list, p1late, 's').voices.some((x) => x.key === 'interrupt'));
}
{
  // 書き出し：同じ日の頼みは時限の順、時間割に入らない頼みは時限なし
  const t = at(18, 9);
  const data = { students: [{ id: 's', name: '生徒S', answers: FIRST, notes: {}, history: [] }], boards: [
    { id: 'b3', text: '三限の頼み', channel: 'board', subject: '授業', period: 3, createdAt: t, targets: ['s'], firstTime: {}, results: {} },
    { id: 'b1', text: '一限の頼み', channel: 'letter', subject: '手伝い', period: 1, createdAt: t + 5, targets: ['s'], firstTime: {}, results: {} },
    { id: 'b0', text: '時間割に入らない頼み', channel: 'board', subject: '雑務', period: 0, createdAt: t + 9, targets: ['s'], firstTime: {}, results: {} }] };
  const md = E.exportMarkdown(data, t), i1 = md.indexOf('1限 手伝い（お便り）「一限の頼み」'), i3 = md.indexOf('3限 授業（黒板）「三限の頼み」'), i0 = md.indexOf(' 雑務（黒板）「時間割に入らない頼み」');
  ok('書き出しの生徒ごとの頼みは時限の順（1限 → 3限 → 時間割に入らない頼み）', i1 > 0 && i3 > i1 && i0 > i3, md);
}

/* ================= K. 掃除の時間（v0.3 第2段・2026-10-18） ================= */
section('K. 掃除の時間（選んだ状態の記録・出すもの・声と聞く一言・まとめ・前の日からの続き）');
const D17 = '2026-10-17', D18 = '2026-10-18', D19 = '2026-10-19';
{
  let e = E.markSweep(null, { st: 'mid' }, D18, 100);
  eq('はじめて選ぶと、その日の記録が1件', [e.st, e.at, e.log], ['mid', 100, [{ day: D18, st: 'mid' }]]);
  e = E.markSweep(e, { next: '明日の1限のあと、表の3行目から' }, D18, 110);
  eq('一言を書くと、その日の記録にも入る', [e.next, e.log], ['明日の1限のあと、表の3行目から', [{ day: D18, st: 'mid', next: '明日の1限のあと、表の3行目から' }]]);
  e = E.markSweep(e, { st: 'not' }, D18, 120);
  eq('同じ日に選び直すと、その日の記録を書きかえる（一言はそのまま）', [e.st, e.log.length, e.log[0]], ['not', 1, { day: D18, st: 'not', next: '明日の1限のあと、表の3行目から' }]);
  const e2 = E.markSweep(e, { st: 'done' }, D19, 200);
  eq('次の日に選ぶと記録が増える。その日はじめて選ぶときは一言が空から（前の日の一言は記録に残る）', [e2.st, e2.next, e2.log.map((x) => x.day + ':' + x.st + ':' + (x.next || ''))],
    ['done', '', [D18 + ':not:明日の1限のあと、表の3行目から', D19 + ':done:']]);
  eq('「うまくいった」は終わったときだけ残る', [E.markSweep(e2, { good: true }, D19, 210).good, E.markSweep(E.markSweep(e2, { good: true }, D19, 210), { st: 'mid' }, D19, 220).good], [true, false]);
  eq('一言は60字まで', Array.from(E.markSweep(null, { st: 'mid', next: 'あ'.repeat(80) }, D18, 1).next).length, 60);
  let many = null;
  for (let i = 1; i <= 12; i++) many = E.markSweep(many, { st: i % 2 ? 'mid' : 'not' }, '2026-10-' + String(i).padStart(2, '0'), i);
  eq('記録は10件まで（古いものから消える）', [many.log.length, many.log[0].day], [10, '2026-10-03']);
  eq('状態を選ぶ前の一言だけでは記録しない', E.markSweep(null, { next: 'メモ' }, D18, 1).log, []);
}
{
  const v = (st, ctx) => E.sweepVoice(st, ctx);
  eq('終わった: 声「終わったって、気づいてもらえたかも」・お礼「ありがとう、助かったよ」・聞く一言', [v('done').voice, v('done').thanks, v('done').ask],
    ['終わったって、気づいてもらえたかも', 'ありがとう、助かったよ', 'やってみて、頼み方で分かりやすかったところある？']);
  eq('途中: 声・聞く一言・一言の欄「続き（いつ・どこから）」', [v('mid').voice, v('mid').ask, v('mid').field, v('mid').placeholder],
    ['続きが気になる。いつやるか決めてないと、帰ってからも頭に浮かぶかも', '続きは、明日のいつごろやれそう？ どこまで進んだ？', '続き（いつ・どこから）', '例：明日の1限のあと、表の3行目から']);
  eq('まだ: 聞く一言と、一言の欄「最初の一歩」', [v('not').ask, v('not').field, v('not').placeholder], ['まだのもの、何があれば始めやすい？', '最初の一歩', '例：去年の資料を開くところまで']);
  eq('まだの声の出し分け: 放送だけ ＞ 初めての作業 ＞ その日3本以上 ＞ ほか',
    [v('not', { castOnly: true, firstTime: true, many: true }).voice, v('not', { firstTime: true, many: true }).voice, v('not', { many: true }).voice, v('not', {}).voice],
    ['そういえば、頼まれてたのを忘れてたかも', '何から始めればいいか分からなかったかも', '手をつけられなかった…今日は頼みが多かったかも', 'まだ手をつけられていないかも']);
  eq('… 放送だけのときだけ「次からは要点をお便りでも送る」', [v('not', { castOnly: true }).tip, v('not', { firstTime: true }).tip, v('mid', { castOnly: true }).tip], ['次からは要点をお便りでも送る', undefined, undefined]);
  const all = ['done', 'mid', 'not'].map((st) => v(st)).concat([v('not', { castOnly: true }), v('not', { firstTime: true }), v('not', { many: true })]);
  ok('声はどれも「〜かも」で終わり、「やり残し」「覚えている」と言わず、数字を出さない（聞く一言は「？」で終わる）',
    all.every((x) => /かも$/.test(x.voice) && /？$/.test(x.ask) && !/やり残し|覚えて/.test(x.voice + x.ask) && !/[0-9０-９]/.test(x.voice + x.ask)), J(all.map((x) => x.voice)));
  eq('選んでいないときは何も出さない', v(''), null);
}
{
  const B = (id, d, h, period, extra) => Object.assign({ id: id, channel: 'board', text: id, subject: '授業', period: period, targets: ['s', 't'], createdAt: at(d, h), firstTime: {}, results: {} }, extra || {});
  const cast = B('c', 18, 11, 3, { channel: 'broadcast', text: '片づけお願い' });
  const boards = [B('a', 18, 9, 1), B('b', 18, 10, 2, { firstTime: { s: true } }), cast];
  eq('「まだ」の出し分けのようす: 放送でお便りなし・初めての作業・その日3本以上', [E.sweepCtx(boards, cast, 's', D18), E.sweepCtx(boards, boards[1], 's', D18)],
    [{ castOnly: true, firstTime: false, many: true }, { castOnly: false, firstTime: true, many: true }]);
  const withPoint = boards.concat([B('d', 18, 12, 4, { channel: 'letter', text: '何を：片づけ', fromCast: 'c', targets: ['s'] })]);
  eq('… 要点のお便り（fromCast）がその生徒に出ていれば、放送だけではない（ほかの生徒は放送だけのまま）', [E.sweepCtx(withPoint, cast, 's', D18).castOnly, E.sweepCtx(withPoint, cast, 't', D18).castOnly], [false, true]);
  eq('… その日の頼みが2本なら「多い」ではない', E.sweepCtx(boards.slice(0, 2), boards[0], 's', D18).many, false);
}
{
  const B = (id, d, h, period, extra) => Object.assign({ id: id, channel: 'board', text: id, subject: '授業', period: period, targets: ['s', 't'], createdAt: at(d, h), firstTime: {}, results: {} }, extra || {});
  const sw = (log) => ({ st: log[log.length - 1].st, next: '', good: false, at: 1, log: log });
  const boards = [
    B('p2', 18, 9, 2), B('p1', 18, 10, 1),
    B('closed', 18, 11, 3, { closedAt: at(18, 12) }),
    B('allsub', 18, 12, 4, { results: { s: { kind: 'asExpected', submitted: true }, t: { kind: 'asked', submitted: true } } }),
    B('half', 18, 13, 5, { results: { s: { kind: 'asExpected', submitted: true } } }),
    B('y1', 17, 9, 1, { sweep: { s: sw([{ day: D17, st: 'mid', next: '表の3行目から' }]), t: sw([{ day: D17, st: 'done' }]) } }),
    B('y2', 17, 10, 2, { sweep: { s: sw([{ day: D17, st: 'done' }]) } }),
    B('old', 16, 9, 1, { sweep: { t: sw([{ day: '2026-10-16', st: 'not' }]) } }),
    B('ysub', 17, 11, 3, { sweep: { s: sw([{ day: D17, st: 'mid' }]) }, results: { s: { kind: 'asExpected', submitted: true } } }),
    B('yclosed', 17, 12, 4, { closedAt: at(17, 20), sweep: { s: sw([{ day: D17, st: 'not' }]) } }),
    B('none', 17, 13, 5),
    B('future', 19, 9, 1)
  ];
  const list = E.sweepList(boards, D18);
  eq('掃除に出すもの: 前の日からの続き（古い日から）→ その日の頼み（時限の順）。締めた・全員提出済み・続きでない前の日の頼み・先の日は出さない',
    list.map((it) => it.board.id + (it.carry ? '*' : '') + ':' + it.sids.join('')), ['old*:t', 'y1*:s', 'p1:st', 'p2:st', 'half:t']);
  eq('… 提出済みの生徒は出さない（半分だけ提出なら、残りの生徒だけ）・その日の頼みは時限つき', [list[4].sids, list[2].period, list[3].period], [['t'], 1, 2]);
  eq('前の日からの続き（時間割の下）: 続きの頼みと生徒・前の日の一言', E.carryOver(boards, D18).map((c) => [c.board.id, c.pairs.map((p) => p.sid + ':' + p.st + ':' + p.next + ':' + p.from)]),
    [['old', ['t:not::2026-10-16']], ['y1', ['s:mid:表の3行目から:' + D17]]]);
  const doneToday = boards.map((b) => (b.id === 'y1' ? Object.assign({}, b, { sweep: { s: E.markSweep(b.sweep.s, { st: 'done' }, D18, 5) } }) : b));
  eq('… その日に「終わった」にすると続きから消える（掃除の時間には、その日のうちは出る）', [E.carryOver(doneToday, D18).map((c) => c.board.id), E.sweepList(doneToday, D18).some((it) => it.board.id === 'y1')], [['old'], true]);
  eq('… 次の日には、もう続きではない', E.sweepList(doneToday, D19).some((it) => it.board.id === 'y1'), false);
  const midToday = boards.map((b) => (b.id === 'p1' ? Object.assign({}, b, { sweep: { s: E.markSweep(null, { st: 'mid', next: '明日の朝' }, D18, 5) } }) : b));
  eq('その日に「途中」にした頼みは、次の日から続きとして出る', E.carryOver(midToday, D19).filter((c) => c.board.id === 'p1').map((c) => c.pairs.map((p) => p.sid + ':' + p.next)), [['s:明日の朝']]);
  eq('頼みも続きもない日は、掃除に出すものがない', E.sweepList([B('x', 17, 9, 1)], D18), []);
}
{
  const B = (id, sids) => ({ id: id, text: id, targets: sids, createdAt: at(18, 9), sweep: {} });
  const mark = (b, sid, st, next) => { b.sweep[sid] = E.markSweep(null, { st: st, next: next }, D18, 1); };
  const a = B('a', ['s', 't']), b = B('b', ['s']), c = B('c', ['s']);
  mark(a, 's', 'done'); mark(a, 't', 'mid', '明日の1限のあと'); mark(b, 's', 'done'); mark(c, 's', 'done');
  const items = [a, b, c].map((x) => ({ board: x, sids: x.targets, period: 1 }));
  let s = E.sweepSummary(items, D18);
  eq('まとめ: 数は生徒ごと（終わった 3・途中 1・まだ 0）・明日の続き1つ', [s.done, s.mid, s.not, s.carry.map((x) => x.sid + ':' + x.next)], [3, 1, 0, ['t:明日の1限のあと']]);
  eq('… 残った頼みが1つ（3つのうち）なら出しすぎではない・一言が全部あれば「全部決まった」', [s.tooMany, s.allPlanned], [false, true]);
  mark(b, 's', 'not');
  s = E.sweepSummary(items, D18);
  eq('… 残った頼みが2つ（3つのうち＝半分以上）なら「出しすぎたかも」・一言のない「まだ」があれば「全部決まった」ではない', [s.left, s.tooMany, s.allPlanned], [2, true, false]);
  const one = [{ board: B('o', ['s', 't']), sids: ['s', 't'], period: 1 }];
  mark(one[0].board, 's', 'not', 'a'); mark(one[0].board, 't', 'not', 'b');
  eq('… 頼みが1つで2人とも「まだ」でも、残った頼みは1つなので出しすぎではない', E.sweepSummary(one, D18).tooMany, false);
  eq('… 全部「終わった」なら明日の続きはなく、「全部決まった」も出さない', (() => { const x = B('z', ['s']); mark(x, 's', 'done'); const r = E.sweepSummary([{ board: x, sids: ['s'] }], D18); return [r.carry.length, r.allPlanned]; })(), [0, false]);
  eq('… その日に選んでいない生徒は数えない', E.sweepSummary([{ board: B('n', ['s']), sids: ['s'] }], D18).done + E.sweepSummary([{ board: B('n', ['s']), sids: ['s'] }], D18).not, 0);
}
{
  let e = E.markSweep(null, { st: 'mid', next: '明日の1限のあと、表の3行目から' }, D18, 1);
  e = E.markSweep(e, { st: 'done' }, D19, 2);
  e = E.markSweep(e, { good: true }, D19, 3);
  eq('書き出しの掃除の行「10/18 途中（続き: …）→ 10/19 終わった（うまくいった頼み方）」', E.sweepLogText(e), '10/18 途中（続き: 明日の1限のあと、表の3行目から）→ 10/19 終わった（うまくいった頼み方）');
  eq('… まだの一言は「最初の一歩」', E.sweepLogText(E.markSweep(null, { st: 'not', next: '資料を開く' }, D18, 1)), '10/18 まだ（最初の一歩: 資料を開く）');
  const t = at(18, 9);
  const data = { students: [{ id: 's', name: '生徒S', answers: FIRST, notes: {}, history: [] }], boards: [
    { id: 'g', text: '明日10時までにA4 1枚で', channel: 'board', subject: '授業', period: 1, createdAt: t, targets: ['s'], firstTime: {}, results: {}, sweep: { s: e } },
    { id: 'h', text: 'ほかの頼み', channel: 'letter', subject: '手伝い', period: 2, createdAt: t + 1, targets: ['s'], firstTime: {}, results: {}, sweep: {} }] };
  const md = E.exportMarkdown(data, t);
  ['    - 掃除: 10/18 途中（続き: 明日の1限のあと、表の3行目から）→ 10/19 終わった（うまくいった頼み方）', '- うまくいった頼み方（掃除の時間で選んだもの）:',
    '  - 2026-10-18 1限 授業（黒板）「明日10時までにA4 1枚で」（生徒Sさん）']
    .forEach((line) => ok('書き出しに「' + line.trim().slice(0, 36) + '」', md.indexOf(line) >= 0, md));
  ok('… 掃除の記録のない頼みには掃除の行を出さない・うまくいった頼み方がなければ「まだない」', md.split('\n').filter((l) => l.indexOf('- 掃除:') >= 0).length === 1 &&
    E.exportMarkdown({ students: [], boards: [data.boards[1]] }, t).indexOf('- うまくいった頼み方（掃除の時間で選んだもの）: まだない') >= 0);
  eq('うまくいった頼み方は「終わった」で印のあるものだけ', E.goodBoards(data.boards.concat([{ id: 'x', sweep: { s: { st: 'mid', good: true } } }])).map((b) => b.id), ['g']);
}

/* ================= L. 日の区切りは午前3時（2026-10-18） ================= */
section('L. 日の区切り（午前3時。0:00〜2:59 は前の日）');
{
  eq('区切りの時刻は3時', E.DAY_START_HOUR, 3);
  eq('2:59 は前の日・3:00 からその日（10/19 の 2:59 → 10/18、3:00 → 10/19）', [E.dayKey(at(19, 2, 59)), E.dayKey(at(19, 3, 0)), E.dayKey(at(19, 0, 0)), E.dayKey(at(18, 23, 59))],
    ['2026-10-18', '2026-10-19', '2026-10-18', '2026-10-18']);
  const bs = [{ id: 'a', createdAt: at(18, 9) }, { id: 'b', createdAt: at(18, 20) }, { id: 'late', createdAt: at(19, 1, 30) }, { id: 'next', createdAt: at(19, 9) }];
  const per = E.periods(bs);
  eq('10/19 の 1:30 に出した頼みは 10/18 の頼み（10/18 の3限）・10/19 の 9時は 10/19 の1限', [per.late, per.next, E.dayList(bs, '2026-10-18').map((b) => b.id)], [3, 1, ['a', 'b', 'late']]);
  eq('行き来できる日・いちばん多い日も午前3時で分ける', [E.dayKeys(bs, '2026-10-18'), E.busiestDay(bs)], [['2026-10-18', '2026-10-19'], { key: '2026-10-18', n: 3 }]);
  // 区切りが変わって、古いデータの時限が同じ日に重なったとき：あとから出したほうを空きへ・7件目からは時間割の外
  const old = [{ id: 'm9', period: 1, createdAt: at(18, 9) }, { id: 'n1', period: 1, createdAt: at(19, 0, 30) }, { id: 'n2', period: 2, createdAt: at(19, 1, 0) }];
  const po = E.periods(old);
  eq('… 10/19 の 0:30（前は10/19の1限）は 10/18 の1限と重なるので空き（3限）へ。1:00 の2限は重ならないのでそのまま', [po.m9, po.n1, po.n2], [1, 3, 2]);
  const full = [1, 2, 3, 4, 5, 6].map((p) => ({ id: 'f' + p, period: p, createdAt: at(18, 8 + p) })).concat([{ id: 'x', period: 1, createdAt: at(19, 2) }]);
  eq('… 10/18 が6つうまっていたら、10/19 の 2:00 の頼みは時間割の外（0）', E.periods(full).x, 0);
  // 掃除の時間：10/19 の 1:30 に開くと、10/18 の頼みが「今日」の頼み
  const sw = [{ id: 'a', text: 'a', targets: ['s'], createdAt: at(18, 9), results: {} }, { id: 'late', text: 'b', targets: ['s'], createdAt: at(19, 1, 30), results: {} }];
  eq('掃除の時間（10/19 の 1:30 に開く＝今日は 10/18）: 10/18 の頼みと 1:30 の頼みが今日の頼みとして出る', E.sweepList(sw, E.dayKey(at(19, 1, 30))).map((it) => it.board.id + (it.carry ? '*' : '')), ['a', 'late']);
  const md = E.exportMarkdown({ students: [{ id: 's', name: '生徒S', answers: UNKNOWN, notes: {}, history: [{ at: at(19, 2), answers: UNKNOWN }] }],
    boards: [{ id: 'late', text: '夜の頼み', channel: 'board', subject: '授業', period: 1, createdAt: at(19, 1, 30), targets: ['s'], firstTime: {}, results: {} }] }, at(19, 2, 30));
  ok('書き出しの日付も午前3時で分ける（見出し・頼みごとの日・カードの書き直しの日が 2026-10-18）', md.indexOf('# マネジメント教室の書き出し（2026-10-18）') >= 0 &&
    md.indexOf('  - 2026-10-18 1限 授業（黒板）「夜の頼み」') >= 0 && md.indexOf('  - 2026-10-18: 答えは同じ') >= 0, md);
}

/* ================= M. 昼休み（v0.3 第3段・2026-10-18） ================= */
section('M. 昼休み（「話を聞いた」の記録・通知表の小さな加点・昼休みの輪・書き出し）');
{
  let t = E.setTalk([], D18, 100, '  週末に行った場所の話  ', true);
  eq('「話を聞いた」を記録（何の話は前後の空白をつめる）', t, [{ day: D18, at: 100, topic: '週末に行った場所の話', listened: true }]);
  t = E.setTalk(t, D18, 200, '別の話', false);
  eq('1日に1人1回：同じ日は書きかえる', [t.length, t[0].topic, t[0].listened, t[0].at], [1, '別の話', false, 200]);
  t = E.setTalk(t, D17, 50, '', false);
  eq('日の順にならぶ・何の話はなくてもいい', t.map((x) => x.day + ':' + x.topic), [D17 + ':', D18 + ':別の話']);
  eq('何の話は40字まで', Array.from(E.setTalk([], D18, 1, 'あ'.repeat(60), false)[0].topic).length, 40);
  let many = [];
  for (let i = 1; i <= 35; i++) many = E.setTalk(many, '2026-' + String(Math.ceil(i / 28) + 8).padStart(2, '0') + '-' + String((i - 1) % 28 + 1).padStart(2, '0'), i, '', false);
  eq('記録は30件まで（古いものから消える）', [many.length, many[0].day], [30, '2026-09-06']);
  eq('その日の記録を消す・その日の記録を見る', [E.dropTalk(t, D18).map((x) => x.day), E.talkOn({ talks: t }, D18).topic, E.talkOn({ talks: t }, D19), E.talkOn({}, D18)], [[D17], '別の話', null, null]);
}
{
  const S = (id, talks, ex) => ({ id: id, example: !!ex, talks: talks });
  const T = (day, listened) => ({ day: day, at: 1, topic: '', listened: !!listened });
  const sts = [S('a', [T(D18, true)]), S('b', [T('2026-10-12', false)]), S('c', [T('2026-10-11', true)]), S('d', [])];
  const ts = E.talkSummary(sts, D18);
  eq('通知表：直近7日（10/12〜10/18）に「話を聞いた」がある生徒の割合（10/11 は入らない）', [ts.from, ts.n, ts.talked, ts.listened], ['2026-10-12', 4, 2, 1]);
  eq('… 加点＝0.05×（話を聞いた割合）＋0.05×（最後まで聞けた割合）', ts.bonus, Math.round((0.05 * 2 / 4 + 0.05 * 1 / 4) * 100) / 100);
  const lots = [S('a', [T(D18, true), T('2026-10-17', true), T('2026-10-16', true), T('2026-10-15', true)])];
  eq('… 回数では増えない（1人に何回あっても、全員が最後まで聞けたなら上限の 0.1）', [E.talkSummary(lots, D18).bonus, E.talkSummary([S('a', [T(D18, true)])], D18).bonus], [0.1, 0.1]);
  eq('… 最後まで聞けたがなければ半分（0.05）まで・生徒がいなければ 0', [E.talkSummary([S('a', [T(D18, false)])], D18).bonus, E.talkSummary([], D18).bonus], [0.05, 0]);
  const rc = { demand: 0.3, support: 0.47, n: 2, quad: E.quadrant(0.3, 0.47) };
  const rb = E.withTalkBonus(rc, { bonus: 0.05 });
  eq('「支える」に足す（0.47＋0.05＝0.52 で「ほったらかし」→「やさしいだけ」）・1 を超えない', [rb.support, rb.base, rb.quad.label, E.withTalkBonus({ demand: 1, support: 0.98, n: 1 }, { bonus: 0.1 }).support], [0.52, 0.47, 'やさしいだけ', 1]);
  eq('数える生徒：見本でない生徒がいればその人たち、いなければ見本', [E.talkStudents([S('x', [], true), S('y', [])]).map((s) => s.id), E.talkStudents([S('x', [], true)]).map((s) => s.id)], [['y'], ['x']]);
}
// v0.3.1 で「丸いテーブルの輪」（lunchGroups）はやめて、今ある机のとなりあう席に移る形（lunchSeats）にした。その試験は N 節
{
  const t = at(18, 12);
  const data = { students: [
    { id: 's', name: '生徒S', answers: UNKNOWN, notes: {}, history: [], talks: [{ day: D17, at: 1, topic: '', listened: false }, { day: D18, at: 2, topic: '週末の話', listened: true }] },
    { id: 'u', name: '生徒U', answers: UNKNOWN, notes: {}, history: [] }],
    boards: [{ id: 'b', text: SAMPLE, channel: 'board', subject: '授業', period: 1, createdAt: t, targets: ['s', 'u'], firstTime: {}, results: {} }] };
  const md = E.exportMarkdown(data, t);
  ok('書き出し：生徒ごとに「- 話を聞いた: 10/17、10/18（最後まで聞けた）「週末の話」」・ない生徒は（まだない）', md.indexOf('- 話を聞いた: 10/17、10/18（最後まで聞けた）「週末の話」') >= 0 &&
    md.indexOf('- 話を聞いた: （まだない）') >= 0, md);
  const base = E.reportCard([E.scoreSaved(data.boards[0], { s: data.students[0], u: data.students[1] })]);
  const want = E.withTalkBonus(base, E.talkSummary(data.students, D18));
  ok('書き出しの通知表の位置にも、話を聞いた分を足す（支える ' + base.support.toFixed(2) + ' → ' + want.support.toFixed(2) + '）', want.support > base.support &&
    md.indexOf('支える ' + want.support.toFixed(2)) >= 0, md.split('\n').find((l) => l.indexOf('通知表の位置') >= 0));
  ok('「雑談すると関係が良くなる」とは書かない（声は「話しかけやすくなったかも」）', E.TALK_VOICE === 'ちょっと話しかけやすくなったかも' && !/関係が良く/.test(md + E.TALK_VOICE));
}

/* ================= N. v0.3.1：昼休みの席（今ある机のとなりあう席に移る）と昼休みの放送 ================= */
section('N. v0.3.1（昼休みの席・昼休みの放送）');
{
  eq('まとまりの人数：2人・3人・4人・5人・7人・10人（3人を中心に、大きい順）', [2, 3, 4, 5, 7, 10].map((n) => E.lunchSizes(n)), [[2], [3], [4], [3, 2], [4, 3], [4, 3, 3]]);
  eq('… 0人・1人', [E.lunchSizes(0), E.lunchSizes(1)], [[], [1]]);
  ok('… 2人から30人まで、どのまとまりも2〜4人で、合わせると全員', Array.from({ length: 29 }, (_, i) => i + 2).every((n) => { const s = E.lunchSizes(n); return s.every((x) => x >= 2 && x <= 4) && s.reduce((a, b) => a + b, 0) === n; }));
  // 向き：0度＝黒板の方、90度＝右、180度＝後ろ（-90度＝左）。まとまりの真ん中の方を向く
  eq('向き：左右の2人は横を向いて向かい合わせ（左の人は右・右の人は左）', E.facingOf([[0, 0], [0, 1]]).map((f) => f.rot), [90, -90]);
  eq('向き：前後の2人は向かい合わせ（前の人は後ろ・後ろの人は前）', E.facingOf([[0, 0], [1, 0]]).map((f) => f.rot), [180, 0]);
  eq('向き：2×2 の4人は真ん中へ斜め（左前・右前・左後ろ・右後ろ）', E.facingOf([[0, 0], [0, 1], [1, 0], [1, 1]]).map((f) => f.rot), [135, -135, 45, -45]);
  eq('向き：L の3人は 2×2 の真ん中の方', E.facingOf([[0, 0], [0, 1], [1, 0]]).map((f) => f.rot), [135, -135, 45]);
  eq('向き：まとまりの真ん中に寄る向き（左右の2人なら右へ1・左へ1）', E.facingOf([[0, 0], [0, 1]]).map((f) => [f.ux, f.uy]), [[1, 0], [-1, 0]]);
}
{
  const seatsOf = (n, cols) => Array.from({ length: n }, (_, i) => ({ id: 's' + i, line: Math.floor(i / cols), col: i % cols }));
  const check = (L, C, n, seed) => {
    const r = E.lunchSeats(L, C, seatsOf(n, C), seed), ps = Object.values(r.seats);
    const uniq = new Set(ps.map((p) => p.line + ':' + p.col)).size === n, inside = ps.every((p) => p.line >= 0 && p.line < L && p.col >= 0 && p.col < C);
    const conn = r.groups.every((g) => { const c = g.map((id) => r.seats[id]), seen = new Set([0]); let more = true;
      while (more) { more = false; c.forEach((a, i) => { if (!seen.has(i) && [...seen].some((j) => Math.abs(c[j].line - a.line) + Math.abs(c[j].col - a.col) === 1)) { seen.add(i); more = true; } }); }
      return seen.size === c.length; });
    return { ok: r.placed && uniq && inside && conn && r.groups.every((g) => g.length >= 2 && g.length <= 4), r };
  };
  // スマホ（3列）とパソコン（5列）の机の並び。段は3（前・中ほど・後ろ）か、1つの段に人が多いときはもっと
  const GRIDS = [[3, 3, 9], [3, 5, 15], [4, 3, 12], [4, 5, 20], [6, 5, 30]];
  let bad = '';
  GRIDS.forEach(([L, C, max]) => { for (let n = 2; n <= max; n++) for (let seed = 1; seed <= 12; seed++) { const c = check(L, C, n, 1792302053465 + seed * 7919); if (!c.ok && !bad) bad = L + '×' + C + ' ' + n + '人 種' + seed; } });
  ok('全員がとなりあう席（前後・左右）のまとまりにいて、席が重ならず、机の並びの中にいる（5通りの並び×2〜最大の人数×種12）', !bad, bad);
  const a = E.lunchSeats(3, 5, seatsOf(10, 5), 12345), b = E.lunchSeats(3, 5, seatsOf(10, 5), 12345), c = E.lunchSeats(3, 5, seatsOf(10, 5), 67890);
  eq('同じ種なら同じ並び（開き直しても同じ）', J(a.seats) === J(b.seats), true);
  ok('… 種がちがえば、並びもちがう（次に昼休みを押すと新しい並び）', J(a.seats) !== J(c.seats));
  eq('10人なら 4・3・3 のまとまり', a.groups.map((g) => g.length), [4, 3, 3]);
  const one = E.lunchSeats(3, 3, [{ id: 'x', line: 2, col: 1 }], 99);
  eq('生徒が1人だけのときは、自分の席のまま（向きも黒板の方）', one.seats.x, { line: 2, col: 1, rot: 0, ux: 0, uy: 0, group: 0 });
  const two = E.lunchSeats(3, 3, seatsOf(2, 3), 5), t = Object.values(two.seats);
  const horiz = t[0].line === t[1].line, rots = t.map((p) => p.rot).sort((x, y) => x - y);
  ok('2人：となりあう2つの机で向かい合わせ（左右なら ±90度、前後なら 0度と180度）', horiz ? J(rots) === J([-90, 90]) : J(rots) === J([0, 180]), J(t));
  eq('丸いテーブルの輪（lunchGroups）はもうない', typeof E.lunchGroups, 'undefined');
}
{
  // 昼休みの放送：時間割の「昼休み」（4限と5限のあいだ）・1日1つ
  const B = (id, h, extra) => Object.assign({ id: id, channel: 'board', text: id, subject: '授業', targets: ['s'], createdAt: at(18, h), firstTime: {}, results: {} }, extra || {});
  const cast = B('L', 12, { channel: 'broadcast', subject: '雑務', lunch: true, period: 0 });
  const bs = [B('p5', 9, { period: 5 }), B('p4', 10, { period: 4 }), cast, B('p1', 13, { period: 1 })];
  const per = E.periods(bs);
  eq('昼休みの放送は時間割の「昼休み」（並びの順は 4.5＝4限と5限のあいだ）', [per.L, E.LUNCH_SLOT, E.periodName(per.L), E.periodName(4), E.periodName(0)], [4.5, 4.5, '昼休み', '4限', '']);
  eq('その日の並び：1限 → 4限 → 昼休み → 5限', E.dayList(bs, D18).map((b) => b.id), ['p1', 'p4', 'L', 'p5']);
  eq('書き方「昼休み 雑務（放送）」', E.lessonLabel(cast, per.L), '昼休み 雑務（放送）');
  eq('その日の昼休みの放送・昼休みの放送は時限を使わない（空いている時限はそのまま）', [E.lunchCastOf(bs, D18).id, E.lunchCastOf(bs, D17), E.freePeriods(bs, D18)], ['L', null, [2, 3, 6]]);
  const two = bs.concat([B('L2', 14, { channel: 'broadcast', lunch: true, period: 0 })]);
  eq('1日1つ：同じ日の2つ目は、ふつうの頼みとして空いている時限へ', [E.periods(two).L, E.periods(two).L2], [4.5, 2]);
  eq('放送でなければ昼休みには入らない（ふつうの頼み）', E.periods([B('x', 9, { lunch: true, period: 3 })]).x, 3);
  const cur = B('p5b', 15, { period: 5 }), list = E.dayList([cast, cur], D18);
  ok('割り込み：昼休みの放送（まだ提出も締めもない）は、5限から見ると前の頼み', E.dayView(list, cur, 's').voices.some((x) => x.key === 'interrupt'));
  const f = E.readBoard('あとで部屋の片づけ、お願いね'), w = (v, k) => (v.issues.find((x) => x.key === k) || {});
  const vl = E.studentView(f, USED, { channel: 'broadcast', lunch: true });
  eq('昼休みの放送の目線：放送の声に足して「せっかくの昼休み、頼まれたことが気になって休めなかったかも」（重み5・赤い枠なし）', [w(vl, 'castLunch').w, vl.voices.map((x) => x.key).slice(0, 2), vl.voices[1].strong],
    [5, ['broadcast', 'castLunch'], false]);
  eq('… 足すとよいもの「急ぎでなければ、昼休みのあとで大丈夫だよ」', vl.chips.some((c) => c.text === '急ぎでなければ、昼休みのあとで大丈夫だよ' && c.act === 'add'), true);
  eq('… 文にもう「昼休みのあと」があれば足すものは出さない・昼休みでない放送には出ない',
    [E.studentView(E.readBoard('昼休みのあとで、片づけお願いね'), USED, { channel: 'broadcast', lunch: true }).chips.some((c) => /昼休みのあと/.test(c.text)), E.studentView(f, USED, { channel: 'broadcast' }).issues.some((x) => x.key === 'castLunch')],
    [false, false]);
  const md = E.exportMarkdown({ students: [{ id: 's', name: '生徒S', answers: UNKNOWN, notes: {}, history: [] }], boards: bs }, at(18, 20));
  ok('書き出し：昼休みの放送は「昼休み 雑務（放送）」で、4限と5限のあいだ', md.indexOf('  - 2026-10-18 昼休み 雑務（放送）「L」') > md.indexOf('4限 授業（黒板）') && md.indexOf('5限 授業（黒板）') > md.indexOf('昼休み 雑務（放送）'), md);
}

console.log('\n' + (fails.length ? '通らなかった: ' + fails.length + ' 件 ／ 通った: ' + pass + ' 件' : 'すべて通った: ' + pass + ' 件'));
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
