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
  eq('その日の昼休みの放送・昼休みの放送は時限を使わない（空いている時限はそのまま）', [E.lunchOf(bs, D18).id, E.lunchOf(bs, D17), E.freePeriods(bs, D18)], ['L', null, [2, 3, 6]]);
  const two = bs.concat([B('L2', 14, { channel: 'broadcast', lunch: true, period: 0 })]);
  eq('1日1つ：同じ日の2つ目は、ふつうの頼みとして空いている時限へ', [E.periods(two).L, E.periods(two).L2], [4.5, 2]);
  // v0.4 段A：昼休みの枠には、どの伝え方の頼みも入る（v0.3.1 は放送だけだった）
  eq('黒板の頼みも、昼休みの枠の頼み（lunch: true）なら昼休みに入る', E.periods([B('x', 9, { lunch: true, period: 3 })]).x, 4.5);
  const cur = B('p5b', 15, { period: 5 }), list = E.dayList([cast, cur], D18);
  ok('割り込み：昼休みの放送（まだ提出も締めもない）は、5限から見ると前の頼み', E.dayView(list, cur, 's').voices.some((x) => x.key === 'interrupt'));
  const f = E.readBoard('あとで部屋の片づけ、お願いね'), w = (v, k) => (v.issues.find((x) => x.key === k) || {});
  const vl = E.studentView(f, USED, { channel: 'broadcast', lunch: true });
  eq('昼休みの放送の目線：放送の声に足して「せっかくの昼休み、頼まれたことが気になって休めなかったかも」（重み5・赤い枠なし）', [w(vl, 'lunch').w, vl.voices.map((x) => x.key).slice(0, 2), vl.voices[1].strong],
    [5, ['broadcast', 'lunch'], false]);
  eq('… 足すとよいもの「急ぎでなければ、昼休みのあとで大丈夫だよ」', vl.chips.some((c) => c.text === '急ぎでなければ、昼休みのあとで大丈夫だよ' && c.act === 'add'), true);
  eq('… 文にもう「昼休みのあと」があれば足すものは出さない・昼休みでない放送には出ない',
    [E.studentView(E.readBoard('昼休みのあとで、片づけお願いね'), USED, { channel: 'broadcast', lunch: true }).chips.some((c) => /昼休みのあと/.test(c.text)), E.studentView(f, USED, { channel: 'broadcast' }).issues.some((x) => x.key === 'lunch')],
    [false, false]);
  const md = E.exportMarkdown({ students: [{ id: 's', name: '生徒S', answers: UNKNOWN, notes: {}, history: [] }], boards: bs }, at(18, 20));
  ok('書き出し：昼休みの放送は「昼休み 雑務（放送）」で、4限と5限のあいだ', md.indexOf('  - 2026-10-18 昼休み 雑務（放送）「L」') > md.indexOf('4限 授業（黒板）') && md.indexOf('5限 授業（黒板）') > md.indexOf('昼休み 雑務（放送）'), md);
}

/* ================= O. v0.4 段A：時間割で時間を選ぶ（9行）・昼休みの枠にどの伝え方も・掃除するものがないわけ・掃除のあとの印 ================= */
section('O. v0.4 段A（時間の名前・枠の空き・その枠の頼み・昼休みの枠・掃除のわけと印）');
{
  eq('時間の名前：1限・昼休み（4.5 も lunch も）・掃除・放課後・6限', [1, 4.5, 'lunch', 'sweep', 'after', 6].map((t) => E.timeName(t)), ['1限', '昼休み', '昼休み', '掃除', '放課後', '6限']);
  eq('頼みの入る枠は 1〜4限・昼休み・5〜6限 の順（掃除と放課後には入らない）', E.SLOTS, [1, 2, 3, 4, 4.5, 5, 6]);
  const B = (id, h, extra) => Object.assign({ id: id, channel: 'board', text: id, subject: '授業', targets: ['s'], createdAt: at(18, h), firstTime: {}, results: {} }, extra || {});
  const lb = B('Lb', 12, { lunch: true, period: 0 }), ll = B('Ll', 12, { channel: 'letter', subject: '手伝い', lunch: true, period: 0 });
  const bs = [B('p1', 9, { period: 1 }), B('p4', 10, { period: 4 }), lb];
  eq('空いている枠：うまっている時限と昼休みをのぞく（直すときは、その頼みの枠も空き）・ほかの日は全部空き',
    [E.freeSlots(bs, D18), E.freeSlots(bs, D18, 'Lb'), E.freeSlots(bs, D17)], [[2, 3, 5, 6], [2, 3, 4.5, 5, 6], [1, 2, 3, 4, 4.5, 5, 6]]);
  eq('その枠の頼み：1限・昼休み・空いている2限（ほかの日は空）', [E.slotBoards(bs, D18, 1).map((b) => b.id), E.slotBoards(bs, D18, 4.5).map((b) => b.id), E.slotBoards(bs, D18, 2), E.slotBoards(bs, D17, 1)],
    [['p1'], ['Lb'], [], []]);
  // v0.4 段B：昼休みの枠にも伝え方ごとに1つずつ入る（段A では「1日1つ・2つ目は空いている時限へ」だった。期待を 2 → 4.5 に変えた）
  eq('昼休みの枠の黒板・お便り：「昼休み 授業（黒板）」「昼休み 手伝い（お便り）」・伝え方がちがえば同じ昼休みに入る（段B）',
    [E.lessonLabel(lb, E.periods(bs).Lb), E.lessonLabel(ll, E.periods([ll]).Ll), E.periods(bs.concat([ll])).Ll], ['昼休み 授業（黒板）', '昼休み 手伝い（お便り）', 4.5]);
  const f = E.readBoard('資料を3枚にまとめておいて'), lv = (ch) => E.studentView(f, USED, { channel: ch, lunch: true }).issues.find((x) => x.key === 'lunch') || {};
  eq('昼休みの枠の頼みなら、どの伝え方でも「せっかくの昼休み、頼まれたことが気になって休めなかったかも」（重み5）',
    ['board', 'letter', 'broadcast'].map((ch) => [lv(ch).voice, lv(ch).w]), ['board', 'letter', 'broadcast'].map(() => ['せっかくの昼休み、頼まれたことが気になって休めなかったかも', 5]));
  ok('… 昼休みでない黒板の頼みには出ない', !E.studentView(f, USED, { channel: 'board' }).issues.some((x) => x.key === 'lunch'));
}
{
  // 掃除するものがないわけ（今日の頼みがない／頼みの相手がいない／相手が全員提出済みか締めた）
  const B = (id, extra) => Object.assign({ id: id, channel: 'board', text: id, subject: '授業', period: 1, targets: ['s', 'u'], createdAt: at(18, 9), firstTime: {}, results: {} }, extra || {});
  const sub = { kind: 'ok', submitted: true, at: at(18, 11) };
  eq('掃除するものがないわけ：頼みがない（前の日の頼みだけ・掃除の記録なしも）・相手がいない・全員提出済み・締めた・まだある（＝わけなし）', [
    E.sweepEmptyWhy([], D18), E.sweepEmptyWhy([B('a', { createdAt: at(17, 9) })], D18),
    E.sweepEmptyWhy([B('a', { targets: [] })], D18), E.sweepEmptyWhy([B('a', { results: { s: sub, u: sub } })], D18),
    E.sweepEmptyWhy([B('a', { closedAt: at(18, 12) })], D18), E.sweepEmptyWhy([B('a')], D18)], ['none', 'none', 'noTargets', 'allDone', 'allDone', '']);
  const log = (st, day) => ({ st: st, next: '', good: false, at: 1, log: [{ day: day || D18, st: st }] });
  eq('掃除のあとの印：まだ掃除していない＝なし・全員終わった＝done（✓）・途中かまだが残る＝left（続き）', [
    E.sweepMark(B('a')), E.sweepMark(B('a', { sweep: { s: log('done'), u: log('done') } })), E.sweepMark(B('a', { sweep: { s: log('done'), u: log('mid') } })),
    E.sweepMark(B('a', { sweep: { s: log('not') }, results: { u: sub } }))], ['', 'done', 'left', 'left']);
  eq('… 提出済みの生徒は終わった扱い・いちばん新しい記録で決める（前の日は途中、今日は終わった）・一部だけ掃除して残りがまだ選ばれていなければ印なし', [
    E.sweepMark(B('a', { sweep: { s: log('done') }, results: { u: sub } })),
    E.sweepMark(B('a', { sweep: { s: { st: 'done', log: [{ day: D17, st: 'mid' }, { day: D18, st: 'done' }] }, u: log('done') } })),
    E.sweepMark(B('a', { sweep: { s: log('done') } }))], ['done', 'done', '']);
}

/* ================= P. v0.4 段B・段C（1つの枠に伝え方ごとの頼み・締め切り・宿題・居残り・正の字・机のお便り） ================= */
{
  const D16 = '2026-10-16', D20 = '2026-10-20', D21 = '2026-10-21';
  /* 頼みごと（ふつうは 10/18 9:00・黒板・授業・相手 s） */
  const B = (id, o) => Object.assign({ id: id, text: id + 'の頼み', channel: 'board', subject: '授業', targets: ['s'], createdAt: at(18, 9), firstTime: {}, results: {} }, o || {});
  const ids = (list) => list.map((b) => b.id);
  const vkeys = (v) => v.voices.map((x) => x.key);
  const byKey = (o, keys) => keys.map((k) => o[k]);   // 名前の並びに依らずに比べる

/* ================= 0. 読み込み ================= */
section('P0. v0.4 段B・段C の名前が出ている');
{
  const names = ['SLOTS', 'isLunch', 'slotBoards', 'channelOrder', 'validDay', 'slotOf', 'slotMates', 'alignSubject', 'slotSubject', 'slotCreatedAt', 'sameRequest',
    'slotView', 'SAME_SLOT_VOICE', 'DUE_KINDS', 'normDue', 'dueKind', 'dueLabel', 'boardDueDay', 'dueDayFor', 'withDue', 'dueChoice', 'doneBy', 'openOn',
    'normLogEntry', 'CHECK_ANS', 'slotAsk', 'answerSlot', 'normSlotCheck', 'STAY_VOICE', 'stayList', 'stayVoice', 'remainingTasks', 'tally', 'taskBoard',
    'TASK_ROWS_MAX', 'deskLetters', 'DESK_MAX'];
  const missing = names.filter((n) => E[n] === undefined);
  ok('段B・段C の新しい名前が全部出ている（' + names.length + ' 個）', !missing.length, J(missing));
  ok('置きかえた関数も出ている（今までの名前のまま）', ['periods', 'freePeriods', 'dayList', 'interrupted', 'dayView', 'scoreSaved', 'markSweep', 'sweepList',
    'carryOver', 'sweepSummary', 'sweepLogText', 'exportMarkdown'].every((n) => typeof E[n] === 'function'));
  eq('枠の並び（1〜4限・昼休み 4.5・5〜6限）・伝え方の並び（黒板 0・お便り 1・放送 2・知らないものは黒板）', [E.SLOTS, ['board', 'letter', 'broadcast', 'fax'].map(E.channelOrder)], [[1, 2, 3, 4, 4.5, 5, 6], [0, 1, 2, 0]]);
  eq('ほんとうにある日か（2/30・形のちがうものはだめ）', [E.validDay(D20), E.validDay('2026-02-30'), E.validDay('10/20'), E.validDay(''), E.validDay(null)], [true, false, false, false, false]);
}

/* ================= B1. 枠ごとに伝え方1つまで（periods） ================= */
section('B1. 1つの枠に、伝え方ごとの頼みを1つずつ（periods・slotBoards・freePeriods）');
{
  const bs = [B('k4', { period: 4, createdAt: at(18, 11) }), B('l4', { period: 4, channel: 'letter', createdAt: at(18, 9) }), B('c4', { period: 4, channel: 'broadcast', createdAt: at(18, 13) })];
  eq('1つの時限（4限）に、黒板・お便り・放送が1つずつ入る（枠に3つ）', byKey(E.periods(bs), ['k4', 'l4', 'c4']), [4, 4, 4]);
  eq('その枠の頼みは 黒板 → お便り → 放送 の順（出した順ではない）', ids(E.slotBoards(bs, D18, 4)), ['k4', 'l4', 'c4']);
  const dup = bs.concat([B('k4b', { period: 4, createdAt: at(18, 14) })]);
  eq('同じ日・同じ時限・同じ伝え方が重なったら、あとから出したほうを、どの伝え方も入っていない時限（1限）へ', [E.periods(dup).k4, E.periods(dup).k4b], [4, 1]);
  const old = bs.concat([B('o1', { createdAt: at(18, 8) }), B('o2', { channel: 'letter', createdAt: at(18, 10) })]);
  eq('時限のない古いデータは、どの伝え方も入っていない時限に小さい順（4限のお便りが入っていても、ほかの頼みと同じ枠にはしない）', [E.periods(old).o1, E.periods(old).o2], [1, 2]);
  const full = [1, 2, 3, 4, 5, 6].map((p) => B('f' + p, { period: p, createdAt: at(18, 8 + p) })).concat([B('x', { channel: 'letter', createdAt: at(18, 20) })]);
  eq('… 6つの時限にどれか入っていたら、時限のない頼みは時間割の外（0）。お便りが空いていても入れない', E.periods(full).x, 0);
  eq('はっきり 0（時間割に入らない）は 0 のまま', E.periods([B('z', { period: 0, channel: 'letter' })]).z, 0);
  const L = (id, ch, h) => B(id, { channel: ch, lunch: true, period: 0, createdAt: at(18, h) });
  const lb = [L('Lk', 'board', 12), L('Ll', 'letter', 12), L('Lc', 'broadcast', 13), L('Lc2', 'broadcast', 14)];
  eq('昼休みの枠（lunch: true）にも、黒板・お便り・放送を1つずつ（4.5）。同じ伝え方の2つ目は、ふつうの頼みとして空いている時限へ', E.periods(lb), { Lk: 4.5, Ll: 4.5, Lc: 4.5, Lc2: 1 });
  eq('その日の昼休みの枠の頼み（黒板 → お便り → 放送）', ids(E.slotBoards(lb, D18, E.LUNCH_SLOT)), ['Lk', 'Ll', 'Lc']);
  eq('昼休みは時限を使わない（空いている時限は 1限 をのぞく 2〜6限）', E.freePeriods(lb, D18), [2, 3, 4, 5, 6]);
  eq('空いている時限: どれかの伝え方が入っている時限はのぞく', E.freePeriods(bs, D18), [1, 2, 3, 5, 6]);
  eq('… 枠ごと動かすときは、その枠の頼み（id の配列）を空きとみなす', E.freePeriods(bs, D18, ['k4', 'l4', 'c4']), [1, 2, 3, 4, 5, 6]);
  eq('… 今までどおり id 1つでもよい（同じ枠にほかの伝え方が残るので 4限 は空きではない）', E.freePeriods(bs, D18, 'k4'), [1, 2, 3, 5, 6]);
  eq('頼みの枠（slotOf）: 4限・昼休み・はみ出て1限・見つからなければ 0', [E.slotOf(bs, bs[1]), E.slotOf(lb, lb[0]), E.slotOf(lb, lb[3]), E.slotOf(bs, B('nope'))], [4, 4.5, 1, 0]);
  eq('日がちがえば同じ時限・同じ伝え方でもよい', byKey(E.periods([B('a', { period: 2 }), B('b', { period: 2, createdAt: at(17, 9) })]), ['a', 'b']), [2, 2]);
}

/* ================= B2. 科目名は枠で1つ（そろえる） ================= */
section('B2. 科目名は枠で1つ（alignSubject・slotMates・slotSubject）');
{
  const bs = [B('k', { period: 2, subject: '手伝い' }), B('l', { period: 2, channel: 'letter', subject: '手伝い', createdAt: at(18, 10) }), B('o', { period: 3, subject: 'ゼミ' }),
    B('y', { period: 2, subject: '手伝い', createdAt: at(17, 10) })];
  const nb = E.alignSubject(bs, bs[1], '  発表の準備  ');
  eq('お便りで科目名を直すと、同じ枠（10/18 の2限）の全部がそろう。ほかの枠・ほかの日はそのまま（前後の空白はつめる）', nb.map((b) => b.subject), ['発表の準備', '発表の準備', 'ゼミ', '手伝い']);
  ok('… 新しい配列を返す。そろえた頼みは写し・ほかの頼みは同じもの・元の頼みは変えない', nb !== bs && nb[0] !== bs[0] && nb[2] === bs[2] && nb[3] === bs[3] && bs[0].subject === '手伝い');
  eq('… 空なら「授業」・10字まで', [E.alignSubject(bs, bs[0], '')[1].subject, E.alignSubject(bs, bs[0], '来月の発表会の準備と片づけ')[0].subject], ['授業', '来月の発表会の準備と']);
  eq('同じ枠の頼み（slotMates）: 黒板 → お便り の順', ids(E.slotMates(bs, bs[1])), ['k', 'l']);
  const outs = [B('z', { period: 0 }), B('w', { period: 0, channel: 'letter', createdAt: at(18, 10) })];
  eq('… 時間割の外の頼みは、それだけ（ほかの外の頼みとそろえない）', [ids(E.slotMates(outs, outs[1])), E.alignSubject(outs, outs[1], 'ゼミ').map((b) => b.subject)], [['w'], ['授業', 'ゼミ']]);
  eq('枠の科目名（黒板 → お便り → 放送 の順の最初の頼みのもの）・空の枠は空', [E.slotSubject(bs, D18, 2), E.slotSubject(bs, D18, 5)], ['手伝い', '']);
}

/* ================= B3. その日の並び ================= */
section('B3. その日の並び（dayList）');
{
  const bs = [B('c4', { period: 4, channel: 'broadcast', createdAt: at(18, 9) }), B('l4', { period: 4, channel: 'letter', createdAt: at(18, 10) }), B('k4', { period: 4, createdAt: at(18, 11) }),
    B('k5', { period: 5, createdAt: at(18, 8) }), B('L', { lunch: true, period: 0, channel: 'letter', createdAt: at(18, 12) }), B('k1', { period: 1, createdAt: at(18, 15) }),
    B('x2', { period: 0, channel: 'broadcast', createdAt: at(18, 16) }), B('x1', { period: 0, createdAt: at(18, 17) })];
  eq('枠の順（1〜4限・昼休み・5限）、同じ枠では 黒板 → お便り → 放送。時間割の外は最後に出した順（伝え方では並べない）', ids(E.dayList(bs, D18)), ['k1', 'k4', 'l4', 'c4', 'L', 'k5', 'x2', 'x1']);
}

/* ================= B4. 前の日の枠に伝え方を足したときの日 ================= */
section('B4. 前の日の枠に伝え方を足したときの日（slotCreatedAt）');
{
  const bs = [B('y4', { period: 4, createdAt: at(17, 13) }), B('y4l', { period: 4, channel: 'letter', createdAt: at(17, 14) })];
  const now = at(18, 10), t = E.slotCreatedAt(bs, D17, 4, now);
  eq('前の日（10/17）の4限に放送を足す: createdAt はその枠のいちばん新しい時刻＋1ミリ秒（日は 10/17 のまま）', [t, E.dayKey(t)], [at(17, 14) + 1, D17]);
  const added = bs.concat([B('y4c', { period: 4, channel: 'broadcast', createdAt: t })]);
  eq('… 足した放送は 10/17 の4限に入り（黒板 → お便り → 放送）、10/18 の時間割には出ない', [E.periods(added).y4c, ids(E.slotBoards(added, D17, 4)), E.dayList(added, D18).length], [4, ['y4', 'y4l', 'y4c'], 0]);
  ok('… （今の時刻のまま足すと 10/18 の頼みになってしまう）', E.dayKey(now) === D18);
  eq('今日の枠に足すときは now のまま', E.slotCreatedAt(bs, D18, 2, now), now);
  const edge = [B('e', { period: 2, createdAt: at(18, 2, 59) + 59999 })];
  eq('午前3時の区切りの直前（10/18 2:59:59.999＝10/17）の枠に足す: ＋1ミリ秒だと 10/18 になるので同じ時刻（日は 10/17）', [E.slotCreatedAt(edge, D17, 2, now) - edge[0].createdAt, E.dayKey(E.slotCreatedAt(edge, D17, 2, now))], [0, D17]);
  eq('枠が空の前の日に足すとき（ふつうは起きない）は、その日の正午', [E.slotCreatedAt([], D17, 3, now), E.dayKey(E.slotCreatedAt([], D17, 3, now))], [at(17, 12), D17]);
  eq('10/19 の 1:30（＝10/18）に 10/18 の枠に足す: 今日の枠なので now のまま', E.slotCreatedAt(bs, D18, 5, at(19, 1, 30)), at(19, 1, 30));
  const lunchY = [B('Ly', { lunch: true, period: 0, channel: 'broadcast', createdAt: at(17, 12, 10) })];
  eq('前の日の昼休みの枠に黒板を足す: その日の昼休みに入る', E.periods(lunchY.concat([B('Lyk', { lunch: true, period: 0, createdAt: E.slotCreatedAt(lunchY, D17, E.LUNCH_SLOT, now) })])).Lyk, 4.5);
}

/* ================= B5. 生徒の目線（伝え方ごとのまとまり） ================= */
section('B5. 生徒の目線：その枠でその生徒あての頼みを、伝え方ごとの区切りで（slotView）');
{
  const st = { id: 's', answers: FIRST }, tt = { id: 't', answers: USED }, uu = { id: 'u', answers: UNKNOWN };
  const bs = [B('k', { period: 4, subject: '手伝い', text: '資料を作って', targets: ['s', 't'] }),
    B('l', { period: 4, channel: 'letter', subject: '手伝い', text: '印刷もお願いね', targets: ['s'], createdAt: at(18, 10) }),
    B('c', { period: 4, channel: 'broadcast', subject: '手伝い', text: '片づけもお願い', targets: ['t'], createdAt: at(18, 11) })];
  const vs = E.slotView(bs, D18, 4, st), vt = E.slotView(bs, D18, 4, tt), vu = E.slotView(bs, D18, 4, uu);
  eq('その枠でその生徒あての頼みを伝え方ごとに（s＝黒板・お便り／t＝黒板・放送。お便りは s だけに配った）', [vs.sections.map((x) => x.label), vt.sections.map((x) => x.label)], [['黒板', 'お便り'], ['黒板', '放送']]);
  eq('… 枠の名前と科目名・相手', [vs.name, vs.subject, vs.off, vs.day, vs.slot], ['4限', '手伝い', false, D18, 4]);
  eq('… 区切りの目線は、studentView をその伝え方で呼んだものと同じ（お便り）', vs.sections[1].view.voices, E.studentView(E.readBoard('印刷もお願いね'), FIRST, { channel: 'letter' }).voices);
  eq('… 放送の区切りは、放送の声がいちばん上・「要点をお便りでも送る」', [vt.sections[1].view.voices[0].key, vt.sections[1].view.chips[0].act], ['broadcast', 'letter']);
  eq('… この生徒あての頼みが枠になければ、枠の頼みを全部「相手ではない（見え方は参考）」で', [vu.off, vu.sections.map((x) => x.label), vu.sections.every((x) => x.off), vu.voices], [true, ['黒板', 'お便り', '放送'], true, []]);
  ok('… 区切りごとの足すとよいものは6つまで', vs.sections.concat(vt.sections).every((x) => x.chips.length <= 6));
  ok('… その日の足すもの「お便りも見てね」は黒板の区切りだけ（お便りの区切りには出ない）', vs.sections[0].chips.some((c) => c.key === 'boardLetter') && !vs.sections[1].chips.some((c) => c.key === 'boardLetter'), J(vs.sections.map((x) => x.chips.map((c) => c.key))));
  eq('… その日の心の声は枠で1つ（s: 同じ枠に別々の頼み・黒板とお便り）', vkeys(vs), ['sameSlot', 'boardLetter']);
  eq('空の枠・時間割の外（0）は区切りなし', [E.slotView(bs, D18, 2, st).sections, E.slotView(bs, D18, 0, st).sections], [[], []]);
  const lunchB = [B('Lc', { lunch: true, period: 0, channel: 'broadcast', text: 'あとで部屋の片づけ、お願いね', createdAt: at(18, 12) })];
  const vl = E.slotView(lunchB, D18, E.LUNCH_SLOT, { id: 's', answers: USED });
  ok('昼休みの枠は昼休みとして目線を作る（「せっかくの昼休み…休めなかったかも」）・名前は「昼休み」', vl.sections[0].view.voices.some((v) => /せっかくの昼休み/.test(v.text)) && vl.name === '昼休み', J(vl.sections[0].view.voices));
}

/* ================= B6. 同じ枠に別々の頼みの心の声 ================= */
section('B6. その日の心の声：同じ枠に別々の頼み（dayView）');
{
  const two = [B('k', { period: 4, text: '資料を作って' }), B('l', { period: 4, channel: 'letter', text: '印刷もお願いね', createdAt: at(18, 10) })];
  const dv = E.dayView(E.dayList(two, D18), two[0], 's', two);
  eq('同じ枠（4限）に黒板とお便りで別々の頼み → 同じ枠に別々の頼み・黒板とお便り（同じ枠のほかの伝え方は割り込みにしない）', vkeys(dv), ['sameSlot', 'boardLetter']);
  eq('… 文言', dv.voices[0].text, '同じ時間に別々の頼み…どれからやればいいか迷うかも');
  eq('… 枠のどの頼みから見ても、その日の心の声は同じ', E.dayView(E.dayList(two, D18), two[1], 's', two).voices, dv.voices);
  const sameT = [two[0], B('l', { period: 4, channel: 'letter', text: ' 資料を作って\n', createdAt: at(18, 10) })];
  eq('… 同じ文（黒板の書き写しのお便り）なら別々の頼みではない', vkeys(E.dayView(E.dayList(sameT, D18), sameT[0], 's')), ['boardLetter']);
  const castPt = [B('c', { period: 4, channel: 'broadcast', text: '片づけお願い' }), B('p', { period: 4, channel: 'letter', text: '何を：片づけ\nいつまで：今日', fromCast: 'c', createdAt: at(18, 10) })];
  eq('… 放送とその要点のお便り（fromCast）は同じ頼み（別々ではない・放送だけでもない）', E.dayView(E.dayList(castPt, D18), castPt[0], 's', castPt).voices, []);
  const other = [two[0], Object.assign({}, two[1], { targets: ['t'] })];
  eq('… お便りがほかの生徒あてなら、この生徒には別々の頼みではない', E.dayView(E.dayList(other, D18), other[0], 's').voices, []);
  const kc = [B('k', { period: 4, text: '資料を作って' }), B('c', { period: 4, channel: 'broadcast', text: '片づけお願い', createdAt: at(18, 10) })];
  eq('同じ枠の放送は目線に出ている（放送の区切りに放送の声）ので「放送で聞いたことは、忘れるかも」に数えない', vkeys(E.dayView(E.dayList(kc, D18), kc[0], 's', kc)), ['sameSlot']);
  const lots = [B('c1', { period: 1, channel: 'broadcast', text: '放送の頼み', createdAt: at(18, 9) }), B('k4', { period: 4, text: '資料を作って', createdAt: at(18, 11) }),
    B('l4', { period: 4, channel: 'letter', text: '印刷も', createdAt: at(18, 12) })];
  eq('並びは 放送だけ → 3本以上 → 割り込み → 同じ枠に別々の頼み → 黒板とお便り で3つまで（5つ重なると、別々の頼みと黒板とお便りは出ない）', vkeys(E.dayView(E.dayList(lots, D18), lots[1], 's', lots)), ['castOnly', 'many', 'interrupt']);
  const two2 = [B('k1', { period: 1, text: '前の頼み', createdAt: at(18, 8) })].concat(two);
  eq('… 放送がなければ 3本以上 → 割り込み → 同じ枠に別々の頼み（黒板とお便りが押し出される）', vkeys(E.dayView(E.dayList(two2, D18), two2[1], 's', two2)), ['many', 'interrupt', 'sameSlot']);
  const dvm = E.dayView(E.dayList(two2, D18), two2[1], 's', two2), dvl = E.dayView(E.dayList(two2, D18), two2[2], 's', two2);
  eq('… 足すとよいもの: 3本以上と割り込みは枠の最初の頼み（黒板）にだけ出す（お便りから見ると出ない）', [dvm.chips.map((c) => c.key), dvl.chips.map((c) => c.key)], [['many', 'interrupt'], []]);
  const saidL = two2.map((b) => (b.id === 'l' ? Object.assign({}, b, { text: '印刷もお願いね\n今日の順番：先に資料、印刷は明日でいいよ' }) : b));
  eq('… その枠のどれかの文に「今日の順番」がもうあれば、黒板にも出さない', E.dayView(E.dayList(saidL, D18), saidL[1], 's', saidL).chips.map((c) => c.key), ['interrupt']);
}

/* ================= B7. 割り込み ================= */
section('B7. 割り込み（interrupted）：前の枠だけ・同じ枠のほかの伝え方は数えない');
{
  const p = B('p', { period: 2, text: '前の頼み', createdAt: at(18, 9), results: { s: { kind: 'asExpected', submitted: true, at: at(18, 12) } } });
  const k = B('k', { period: 4, text: '資料を作って', createdAt: at(18, 11) }), l = B('l', { period: 4, channel: 'letter', text: '印刷も', createdAt: at(18, 13) });
  const list = E.dayList([p, k, l], D18);
  eq('2限が提出される前（11時）に出した4限の黒板は割り込み・提出のあと（13時）に出した4限のお便りは割り込みではない', [E.interrupted(list, k, 's'), E.interrupted(list, l, 's')], [true, false]);
  eq('… 枠の目線ではどちらから見ても割り込みの声が出る・「いまの作業は…」は割り込みになった黒板にだけ', [vkeys(E.dayView(list, l, 's')).indexOf('interrupt') >= 0, E.dayView(list, k, 's').chips.some((c) => c.key === 'interrupt'), E.dayView(list, l, 's').chips.some((c) => c.key === 'interrupt')], [true, true, false]);
  eq('… 同じ枠のほかの伝え方は前の頼みにしない（4限の黒板が出しっぱなしでも、4限のお便りは割り込みではない）', E.interrupted(E.dayList([k, l], D18), l, 's'), false);
  const L = B('L', { lunch: true, period: 0, channel: 'letter', text: '昼の頼み', createdAt: at(18, 12) }), k5 = B('k5', { period: 5, text: '午後の頼み', createdAt: at(18, 13) });
  eq('… 昼休みの枠（4.5）のお便りは、5限から見ると前の頼み・4限から見るとあとの頼み', [E.interrupted(E.dayList([L, k5], D18), k5, 's'), E.interrupted(E.dayList([L, k], D18), k, 's')], [true, false]);
}

/* ================= B8. 伝え方の内訳・放送だけ・1日の頼み ================= */
section('B8. 伝え方の内訳・放送だけで終わった頼み・1日の頼み（枠に複数）');
{
  const slot3 = [B('k', { period: 3, text: '資料' }), B('l', { period: 3, channel: 'letter', text: '印刷' }), B('c', { period: 3, channel: 'broadcast', text: '片づけ' })];
  eq('1つの枠に3つでも、伝え方ごとに1件ずつ数える（放送だけで終わった頼み 1）', E.channelCounts(slot3), { board: 1, letter: 1, broadcast: 1, castOnly: 1 });
  const withPt = [B('c', { period: 3, channel: 'broadcast', text: '片づけ' }), B('p', { period: 3, channel: 'letter', text: '何を：片づけ', fromCast: 'c' })];
  eq('… 同じ枠の要点のお便り（fromCast）があれば、放送だけで終わった頼みは 0', E.channelCounts(withPt), { board: 0, letter: 1, broadcast: 1, castOnly: 0 });
  eq('1日の頼み: 同じ枠の3つは3本', E.busiestDay(slot3), { key: D18, n: 3 });
}

/* ================= B9. 掃除の時間（枠に複数） ================= */
section('B9. 掃除の時間（sweepList・carryOver・sweepCtx）：枠に複数の頼み');
{
  const bs = [B('c', { period: 2, channel: 'broadcast', text: '片づけ', createdAt: at(18, 9), targets: ['s', 't'] }), B('k', { period: 2, createdAt: at(18, 11), targets: ['s'] }),
    B('l', { period: 2, channel: 'letter', createdAt: at(18, 10), targets: ['t'] }), B('k1', { period: 1, createdAt: at(18, 12) })];
  eq('掃除に出すもの: 枠の順、同じ枠では 黒板 → お便り → 放送（伝え方ごとの頼みを1件ずつ、それぞれの相手で）', E.sweepList(bs, D18).map((it) => it.board.id + ':' + it.sids.join('')), ['k1:s', 'k:s', 'l:t', 'c:st']);
  eq('「まだ」の出し分けの「その日3本以上」は、伝え方ごとの頼みを1本ずつ数える（s は1限・2限の黒板・2限の放送で3本）', [E.sweepCtx(bs, bs[1], 's', D18).many, E.sweepCtx(bs, bs[2], 't', D18).many], [true, false]);
  const left = bs.map((b) => Object.assign({}, b, { sweep: {} }));
  left.forEach((b) => b.targets.forEach((sid) => { b.sweep[sid] = E.markSweep(null, { st: 'mid' }, D18, 1); }));
  eq('次の日の前の日からの続きも、同じ枠は 黒板 → お便り → 放送', E.carryOver(left, D19).map((c) => c.board.id), ['k1', 'k', 'l', 'c']);
}

/* ================= B10. 書き出し（枠に複数） ================= */
section('B10. 書き出し（exportMarkdown）：枠に複数の頼み');
{
  const data = { students: [{ id: 's', name: '生徒S', answers: FIRST, notes: {}, history: [] }], boards: [
    B('c', { period: 4, channel: 'broadcast', subject: '手伝い', text: '片づけもお願い', createdAt: at(18, 9) }),
    B('k', { period: 4, subject: '手伝い', text: '資料を作って', createdAt: at(18, 11), due: { kind: 'day' } }),
    B('l', { period: 4, channel: 'letter', subject: '手伝い', text: '印刷もお願いね', createdAt: at(18, 10), due: { kind: 'date', date: D20 } })] };
  const md = E.exportMarkdown(data, at(18, 20));
  const ik = md.indexOf('  - 2026-10-18 4限 手伝い（黒板） 〆 今日中「資料を作って」'), il = md.indexOf('  - 2026-10-18 4限 手伝い（お便り） 〆 10/20まで「印刷もお願いね」'), ic = md.indexOf('  - 2026-10-18 4限 手伝い（放送）「片づけもお願い」');
  ok('同じ枠の頼みは 黒板 → お便り → 放送 の順に1件ずつ・締め切りも書く（決めないなら書かない）', ik > 0 && il > ik && ic > il, md);
  ok('… 伝え方の内訳・頼みごとの数は1件ずつ', md.indexOf('- 伝え方の内訳: 黒板 1・お便り 1・放送 1（放送だけで終わった頼み 1）') >= 0 && md.indexOf('- 頼みごと: 3 件') >= 0, md);
  ok('… 「足りなかったもの」の期限かかける時間に、締め切りの欄も数える（3件のうち、締め切りのない放送だけ）', md.indexOf('・期限かかける時間 1・') >= 0, md.split('\n').find((x) => x.indexOf('足りなかったもの') >= 0));
}

/* ================= B11. 古いデータ ================= */
section('B11. 古いデータ（v0.2・v0.3 のデータを読む）');
{
  const v03 = [B('a', { period: 1 }), B('b', { period: 2, channel: 'letter', createdAt: at(18, 10) }), B('c', { period: 3, channel: 'broadcast', createdAt: at(18, 11) }),
    B('L', { channel: 'broadcast', lunch: true, period: 0, createdAt: at(18, 12) })];
  eq('v0.3 のデータ（1つの時限に1つ・昼休みの放送）は、時限も並びもそのまま', [byKey(E.periods(v03), ['a', 'b', 'c', 'L']), ids(E.dayList(v03, D18))], [[1, 2, 3, 4.5], ['a', 'b', 'c', 'L']]);
  const v02 = [{ id: 'x', text: 'x', createdAt: at(18, 9), targets: ['s'] }, { id: 'y', text: 'y', createdAt: at(18, 10), targets: ['s'] }, { id: 'z', text: 'z', createdAt: at(18, 11), targets: ['s'] }];
  eq('v0.2 のデータ（伝え方も時限もない）は、出した順に 1限・2限・3限（別々の枠。同じ枠にまとめない）', byKey(E.periods(v02), ['x', 'y', 'z']), [1, 2, 3]);
  eq('… その日の心の声に「同じ枠に別々の頼み」は出ない（今までどおり 3本以上・割り込み）', vkeys(E.dayView(E.dayList(v02, D18), v02[2], 's')), ['many', 'interrupt']);
  eq('… 締め切りは「決めない」・掃除の記録はそのまま読める', [E.normDue(v02[0].due), E.normLogEntry({ day: D18, st: 'mid', next: '表の3行目から' })], [{ kind: 'none' }, { day: D18, st: 'mid', next: '表の3行目から' }]);
}

/* ================= C1. 締め切りの形と古いデータ ================= */
section('C1. 締め切りの形（due）と古いデータ');
{
  eq('無い（古いデータ）・読めないもの → 決めない', [E.normDue(undefined), E.normDue(null), E.normDue('day'), E.normDue({ kind: 'week' }), E.normDue({ kind: 'date' }),
    E.normDue({ kind: 'date', date: '2026-02-30' }), E.normDue({ kind: 'date', date: '10/20' })], Array(7).fill({ kind: 'none' }));
  eq('この時間中・今日中・日付まで（いらない項目は持たない）', [E.normDue({ kind: 'slot', date: D20 }), E.normDue({ kind: 'day' }), E.normDue({ kind: 'date', date: D20, x: 1 })],
    [{ kind: 'slot' }, { kind: 'day' }, { kind: 'date', date: D20 }]);
  eq('シートの選択肢は4つ（この時間中・今日中・日付・決めない）', E.DUE_KINDS.map((k) => k.key + ':' + k.label), ['slot:この時間中', 'day:今日中', 'date:日付', 'none:決めない']);
  eq('頼みの締め切りの日: この時間中・今日中＝頼みの日・日付＝その日・決めない＝なし',
    [E.boardDueDay(B('a', { due: { kind: 'slot' } })), E.boardDueDay(B('b', { due: { kind: 'day' } })), E.boardDueDay(B('c', { due: { kind: 'date', date: D20 } })), E.boardDueDay(B('d'))], [D18, D18, D20, '']);
}

/* ================= C2. 締め切りの表示の文字 ================= */
section('C2. 締め切りの表示の文字（dueLabel）');
{
  eq('「〆 この時間中」「〆 今日中」「〆 10/20まで」「〆 1/5まで」・決めないなら空', [E.dueLabel({ kind: 'slot' }), E.dueLabel({ kind: 'day' }), E.dueLabel({ kind: 'date', date: D20 }),
    E.dueLabel({ kind: 'date', date: '2027-01-05' }), E.dueLabel(undefined), E.dueLabel({ kind: 'none' })], ['〆 この時間中', '〆 今日中', '〆 10/20まで', '〆 1/5まで', '', '']);
}

/* ================= C3. 「いつまで？」が消える ================= */
section('C3. 締め切りを選んである頼みは「いつまで？」の吹き出しと声を出さない（withDue）');
{
  const f = E.readBoard(SAMPLE), plain = E.studentView(f, FIRST), withD = E.studentView(E.withDue(f, { kind: 'day' }), FIRST);
  // 期限だけが足りない文（main の試験の「そろった黒板」から「明日10時の」を消したもの）
  const g = E.readBoard('ゼミで使う図を、去年のスライドを見本にA4 1枚で。30分まで。途中で一度見せてね。詰まったら声をかけて。進め方は任せるね。いつもありがとう');
  const gp = E.studentView(g, FIRST, { channel: 'letter' }), gd = E.studentView(E.withDue(g, { kind: 'date', date: D20 }), FIRST, { channel: 'letter' });
  eq('（前提）締め切りのない頼みには「いつまで？」の吹き出し・足すもの（いつまで：◯日◯時まで）がある', [plain.bubbles.some((b) => b.key === 'deadline'), gp.bubbles.map((b) => b.text), gp.chips.map((c) => c.text)],
    [true, ['いつまで？'], ['いつまで：◯日◯時まで']]);
  eq('締め切りを選んである頼み: 「いつまで？」の吹き出し・声・足すものが出ない', [withD.bubbles.some((b) => b.key === 'deadline'), withD.issues.some((x) => x.key === 'deadline'), gd.bubbles, gd.chips],
    [false, false, [], []]);
  eq('… 期限だけが足りない文に締め切りを選ぶと、心の声は前向きの2つになる', [gd.voices.length, gd.voices.every((x) => x.tone === 'pos')], [2, true]);
  ok('… この時間中・今日中・日付のどれでも出ない・決めないなら出る', [{ kind: 'slot' }, { kind: 'day' }, { kind: 'date', date: D20 }].every((d) => !E.studentView(E.withDue(f, d), FIRST).bubbles.some((b) => b.key === 'deadline')) &&
    E.studentView(E.withDue(f, { kind: 'none' }), FIRST).bubbles.some((b) => b.key === 'deadline'));
  ok('… withDue は読み取った特徴を変えない（写しを返す。決めないならそのもの）', f.deadline === false && E.withDue(f, { kind: 'day' }) !== f && E.withDue(f, {}) === f && E.withDue(f, { kind: 'day' }).dueSet === true);
  const q4e = Object.assign({}, UNKNOWN, { q4: 'E' });
  eq('… Q4 が E（締め切りがないと後回し）の声も、締め切りを選んであれば出ない', [E.studentView(f, q4e).issues.some((x) => x.key === 'deadline'), E.studentView(E.withDue(f, { kind: 'day' }), q4e).issues.some((x) => x.key === 'deadline')], [true, false]);
  eq('通知表: 締め切りの欄も「期限かかける時間」に数える（点の式は同じ）', [E.scoreSaved({ text: SAMPLE, targets: [] }, {}).d.when, E.scoreSaved({ text: SAMPLE, targets: [], due: { kind: 'day' } }, {}).d.when], [0, 1]);
  const sv = E.slotView([B('k', { period: 1, text: SAMPLE, due: { kind: 'slot' } })], D18, 1, { id: 's', answers: FIRST });
  eq('生徒の目線（枠）でも「いつまで？」は出ない・区切りに締め切りの文字', [sv.sections[0].view.bubbles.some((b) => b.key === 'deadline'), sv.sections[0].due], [false, '〆 この時間中']);
}

/* ================= C4. 「この時間中」の聞く相手と答え ================= */
section('C4. 「この時間中」の報告（slotAsk・answerSlot・normSlotCheck）');
{
  const k = B('k', { period: 2, due: { kind: 'slot' }, targets: ['s', 't', 'u'], results: { u: { kind: 'asExpected', submitted: true, at: at(18, 10) } } });
  const l = B('l', { period: 2, channel: 'letter', due: { kind: 'day' }, targets: ['s'], createdAt: at(18, 10) });
  const c = B('c', { period: 2, channel: 'broadcast', due: { kind: 'slot' }, targets: ['t'], createdAt: at(18, 9, 30) });
  const bs = [k, l, c], ask = () => E.slotAsk(bs, D18, 2, D18).map((x) => x.board.id + ':' + x.sids.join(''));
  eq('聞く相手: 締め切りが「この時間中」の頼みだけ（今日中のお便りは聞かない）・提出済み（u）は聞かない（黒板 → 放送）', ask(), ['k:st', 'c:t']);
  eq('… 前の日の枠を見ているとき（今日ではない）・時間割の外は聞かない', [E.slotAsk(bs, D18, 2, D19), E.slotAsk(bs, D18, 0, D18)], [[], []]);
  k.slotCheck = { s: { ans: 'later', at: 1 } };
  eq('… もう答えた生徒（「あとで」も答え）は聞かない', ask(), ['k:t', 'c:t']);
  const r1 = E.answerSlot(null, 'done', D18, 100), r2 = E.answerSlot(null, 'not', D18, 100), r3 = E.answerSlot(null, 'later', D18, 100);
  eq('答えの記録: 終わった → 掃除の「終わった」・まだ → 掃除の「まだ」・あとで → 掃除の記録は作らない', [r1.check, r1.sweep.st, r2.sweep.log, r3.check.ans, r3.sweep],
    [{ ans: 'done', at: 100 }, 'done', [{ day: D18, st: 'not' }], 'later', null]);
  eq('… あとでは、前の掃除の記録をそのまま返す・知らない答えは null', [E.answerSlot(r2.sweep, 'later', D18, 5).sweep === r2.sweep, E.answerSlot(null, 'maybe', D18, 1)], [true, null]);
  k.sweep = { t: r2.sweep };
  eq('… その日の掃除の記録がもうある生徒も聞かない', ask(), ['c:t']);
  eq('答えた頼みも、その日の掃除には出る（記録した状態から始まる）', [E.sweepList(bs, D18).find((it) => it.board.id === 'k').sids, E.logOn(k.sweep.t, D18).st], [['s', 't'], 'not']);
  c.closedAt = at(18, 11);
  eq('… 締めた頼みは聞かない', ask(), []);
  eq('slotCheck を読む: 答えが3つのどれかのものだけ・ok で生徒をしぼる', E.normSlotCheck({ s: { ans: 'done', at: 5 }, t: { ans: 'x' }, u: null, v: { ans: 'later' } }, (id) => id !== 'v'), { s: { ans: 'done', at: 5 } });
  eq('… 古いデータ（無い）は空', E.normSlotCheck(undefined), {});
}

/* ================= C5. 今日中 → 締め切りを延ばすと宿題 ================= */
section('C5. 今日中の頼み：掃除で途中・まだ → 締め切りを延ばす（宿題になる）');
{
  const k = B('k', { period: 3, subject: '手伝い', due: { kind: 'day' }, targets: ['s', 't'], sweep: {} }), bs = [k];
  eq('今日中の頼みは、その日の掃除に出る・「延ばす・居残り」を出せる', [ids(E.sweepList(bs, D18).map((it) => it.board)), E.dueChoice(k, 's', D18)], [['k'], true]);
  k.sweep.s = E.markSweep(E.markSweep(null, { st: 'mid', next: '表の3行目から' }, D18, 1), { ext: D20 }, D18, 2);
  eq('締め切りを 10/20 に延ばす: その日の掃除の記録に ext', k.sweep.s.log, [{ day: D18, st: 'mid', next: '表の3行目から', ext: D20 }]);
  eq('… その生徒の締め切りの日は 10/20（ほかの生徒は 10/18 のまま）', [E.dueDayFor(k, 's', D18), E.dueDayFor(k, 't', D18)], [D20, D18]);
  eq('… その日の掃除の中では、延ばしても一覧から消えない・「延ばす・居残り」も出たまま（選び直せる）', [E.sweepList(bs, D18).map((it) => it.sids.join('')), E.dueChoice(k, 's', D18)], [['st'], true]);
  eq('… 宿題になる（残っているタスクの種類。t は今日中で終わっていない）', E.remainingTasks(bs, D18).map((x) => x.sid + ':' + x.kind), ['s:homework', 't:today']);
  eq('次の日（10/19）: 宿題はまだ締め切りの日ではないので掃除に出ない（t は今日中を過ぎたので出る）', E.sweepList(bs, D19).map((it) => it.sids.join('')), ['t']);
  eq('… 前の日からの続きには出る（s：宿題 〆 10/20・t：締め切りを過ぎた）', E.carryOver(bs, D19)[0].pairs.map((p) => [p.sid, p.st, p.due, p.hw, p.late]),
    [['s', 'mid', D20, true, false], ['t', '', D18, false, true]]);
  eq('締め切りの日（10/20）: 掃除に出る・もう一度「延ばす・居残り」を出せる', [E.sweepList(bs, D20).map((it) => it.sids.join('')), E.dueChoice(k, 's', D20)], [['st'], true]);
  k.sweep.s = E.markSweep(k.sweep.s, { st: 'done' }, D20, 3);
  eq('終わったら消える（10/21 の続き・掃除・残っているタスクに s は出ない）', [E.carryOver(bs, D21).map((c) => c.pairs.map((p) => p.sid).join('')), E.sweepList(bs, D21).map((it) => it.sids.join('')), E.remainingTasks(bs, D21).map((x) => x.sid)],
    [['t'], ['t'], ['t']]);
  let e = E.markSweep(null, { st: 'not' }, D18, 1);
  eq('延ばす日は、その日より後のほんとうの日だけ（同じ日・前の日・ない日・空は延ばさない）', [D18, D17, '2026-10-32', ''].map((x) => E.markSweep(e, { ext: x }, D18, 2).log[0].ext || ''), ['', '', '', '']);
  e = E.markSweep(e, { ext: D20 }, D18, 2);
  eq('… 同じ日に状態や一言を選び直しても、延ばした日は残る', [E.markSweep(e, { st: 'mid' }, D18, 3).log[0].ext, E.markSweep(e, { next: '資料を開く' }, D18, 3).log[0]], [D20, { day: D18, st: 'not', next: '資料を開く', ext: D20 }]);
  eq('… 居残りを選ぶと延ばした日は消える（どちらか1つ）・「終わった」にすると両方消える・空で取り消し',
    [E.markSweep(e, { stay: true }, D18, 3).log[0], E.markSweep(e, { st: 'done' }, D18, 3).log[0], E.markSweep(e, { ext: '' }, D18, 3).log[0]],
    [{ day: D18, st: 'not', stay: true }, { day: D18, st: 'done' }, { day: D18, st: 'not' }]);
  eq('… 次の日の記録は別（前の日に延ばした日は、その日の記録に残る）', E.markSweep(e, { st: 'mid' }, D19, 4).log, [{ day: D18, st: 'not', ext: D20 }, { day: D19, st: 'mid' }]);
  eq('… 状態を選ぶ前に延ばしても記録しない（今までどおり）', E.markSweep(null, { ext: D20 }, D18, 1).log, []);
  eq('掃除の記録の1件を読む（ext・stay を残す。終わったなら持たない。だめなものは null）',
    [E.normLogEntry({ day: D18, st: 'mid', next: 'a', ext: D20 }), E.normLogEntry({ day: D18, st: 'not', stay: true }), E.normLogEntry({ day: D18, st: 'done', ext: D20, stay: true }),
      E.normLogEntry({ day: D18, st: 'mid', ext: D17 }), E.normLogEntry({ day: 'x', st: 'mid' }), E.normLogEntry({ day: D18, st: 'zz' })],
    [{ day: D18, st: 'mid', next: 'a', ext: D20 }, { day: D18, st: 'not', stay: true }, { day: D18, st: 'done' }, { day: D18, st: 'mid' }, null, null]);
  eq('書き出しの掃除の行に、延ばした日と居残り', E.sweepLogText({ st: 'mid', log: [{ day: D18, st: 'not', next: '資料を開く', ext: D20 }, { day: D20, st: 'mid', stay: true }] }),
    '10/18 まだ（最初の一歩: 資料を開く・締め切りを10/20まで延ばした）→ 10/20 途中（居残り）');
}

/* ================= C6. 居残り ================= */
section('C6. 居残り（stayList・stayVoice・掃除のまとめ）');
{
  const k = B('k', { period: 3, due: { kind: 'day' }, targets: ['s', 't'], sweep: {} });
  const l = B('l', { period: 4, channel: 'letter', due: { kind: 'slot' }, targets: ['s'], createdAt: at(18, 13), sweep: {} });
  k.sweep.s = E.markSweep(E.markSweep(null, { st: 'not' }, D18, 1), { stay: true }, D18, 2);
  l.sweep.s = E.markSweep(E.markSweep(null, { st: 'mid' }, D18, 1), { stay: true }, D18, 2);
  k.sweep.t = E.markSweep(null, { st: 'mid' }, D18, 1);
  const bs = [k, l];
  eq('その日の放課後に残る生徒（s）と、その頼み（枠の順）', E.stayList(bs, D18).map((x) => x.sid + ':' + ids(x.boards).join('')), ['s:kl']);
  eq('… 居残りはその日だけ（次の日は誰も残らない）', E.stayList(bs, D19), []);
  eq('… 生徒の目線（その日）に「居残りになると、今日は気持ちを切り替えにくいかも」。次の日・ほかの生徒には出ない',
    [E.stayVoice(bs, 's', D18), E.stayVoice(bs, 's', D19), E.stayVoice(bs, 't', D18)], [{ key: 'stay', text: '居残りになると、今日は気持ちを切り替えにくいかも' }, null, null]);
  eq('… 枠の目線（slotView）にも、その日の居残りの声', [E.slotView(bs, D18, 3, { id: 's', answers: UNKNOWN }).stay.key, E.slotView(bs, D18, 3, { id: 't', answers: UNKNOWN }).stay], ['stay', null]);
  eq('… その日に提出した頼みでは残らない', E.stayList([Object.assign({}, k, { results: { s: { kind: 'asExpected', submitted: true, at: at(18, 20) } } })], D18), []);
  const s = E.sweepSummary(E.sweepList(bs, D18), D18);
  eq('掃除のまとめ: 居残り（s の2つ）・延ばした（なし）・まだ選んでいない（t：今日中で途中、どちらも選んでいない）',
    [s.stay.map((x) => x.board.id + ':' + x.sid), s.ext.length, s.undecided.map((x) => x.board.id + ':' + x.sid), s.mid, s.not], [['k:s', 'l:s'], 0, ['k:t'], 2, 1]);
  k.sweep.t = E.markSweep(k.sweep.t, { ext: D20 }, D18, 3);
  const s2 = E.sweepSummary(E.sweepList(bs, D18), D18);
  eq('… 延ばしたら「延ばした（宿題にした）」に日付つきで・まだ選んでいないはなくなる', [s2.ext.map((x) => x.sid + ':' + x.date), s2.undecided.length, s2.carry.map((c) => c.sid + ':' + c.ext + ':' + c.stay)],
    [['t:' + D20], 0, ['s::true', 't:' + D20 + ':false', 's::true']]);
  eq('残っているタスクの種類: その日は居残り（s）・宿題（t）', E.remainingTasks(bs, D18).map((x) => x.board.id + ':' + x.sid + ':' + x.kind), ['k:s:stay', 'k:t:homework', 'l:s:stay']);
  const none = B('n', { period: 5, targets: ['s'], sweep: { s: E.markSweep(null, { st: 'not' }, D18, 1) } });
  eq('締め切りを決めない頼みは「延ばす・居残り」を出さない（まだ選んでいないにも入らない）', [E.dueChoice(none, 's', D18), E.sweepSummary(E.sweepList([none], D18), D18).undecided.length], [false, 0]);
}

/* ================= C7. 日付までの頼み（宿題） ================= */
section('C7. 宿題（日付まで）：締め切りの日まで残り、終わったら消える');
{
  const hw = B('h', { period: 2, channel: 'letter', subject: 'ゼミ', due: { kind: 'date', date: D20 }, targets: ['s'], sweep: {} }), bs = [hw];
  eq('出した日の掃除には出ない（締め切りの日に出す）・残っているタスクには宿題として入る', [E.sweepList(bs, D18), E.remainingTasks(bs, D18).map((x) => x.kind)], [[], ['homework']]);
  eq('次の日: 掃除には出ない・前の日からの続きに宿題として出る', [E.sweepList(bs, D19), E.carryOver(bs, D19).map((c) => c.pairs.map((p) => p.sid + ':' + p.due + ':' + p.hw + ':' + p.st))],
    [[], [['s:' + D20 + ':true:']]]);
  eq('締め切りの日（10/20）の掃除に出る（前の日からの続きとして）', E.sweepList(bs, D20).map((it) => it.board.id + (it.carry ? '*' : '')), ['h*']);
  eq('何も選ばずに締め切りを過ぎても、終わるまで残る（10/21：続き・掃除・残っているタスク（過ぎた））', [E.carryOver(bs, D21).length, E.sweepList(bs, D21).length, E.remainingTasks(bs, D21).map((x) => x.late)], [1, 1, [true]]);
  hw.results = { s: { kind: 'asExpected', submitted: true, at: at(21, 10) } };
  eq('提出したら消える（10/21）。10/20 の時点ではまだ残っている（その日の終わりの時点で数える）', [E.remainingTasks(bs, D21).length, E.carryOver(bs, D21).length, E.remainingTasks(bs, D20).length], [0, 0, 1]);
  const closed = B('x', { due: { kind: 'date', date: D20 }, closedAt: at(19, 9) });
  eq('締めたら消える（締めた日から）', [E.remainingTasks([closed], D18).length, E.remainingTasks([closed], D19).length, E.carryOver([closed], D20).length], [1, 0, 0]);
}

/* ================= C8. 正の字 ================= */
section('C8. 残っているタスクの正の字（tally・taskBoard）');
{
  eq('正の字の画の数: 7 → [5, 2]・5 → [5]・1 → [1]・12 → [5, 5, 2]・0 → []', [7, 5, 1, 12, 0].map((n) => E.tally(n)), [[5, 2], [5], [1], [5, 5, 2], []]);
  eq('… 数でないもの・負の数は []', [E.tally(-3), E.tally('x'), E.tally(null)], [[], [], []]);
  let h = 0;
  const T = (sub, sids, due) => B('b' + (++h), { period: 0, subject: sub, targets: sids, due: due === undefined ? { kind: 'day' } : due, createdAt: at(18, 4) + h * 60000 });
  const bs = [];
  for (let i = 0; i < 7; i++) bs.push(T('授業', ['s']));
  bs.push(T('手伝い', ['s', 't']), T('授業', ['t']), T('ゼミ', ['u'], { kind: 'date', date: D20 }), T('雑務', ['w'], { kind: 'slot' }), T('雑務', ['w'], { kind: 'slot' }), T('その他', ['v'], null));
  const students = ['s', 't', 'u', 'v', 'w'].map((id) => ({ id: id }));
  const tb = E.taskBoard(bs, D18, students);
  eq('生徒ごとの数: 多い生徒から3人まで＋ほか N 人（同じ数なら生徒の並び。t と w は2つずつ）', [tb.rows.map((r) => r.sid + ':' + r.n), tb.more, tb.people, tb.total], [['s:8', 't:2', 'w:2'], 1, 4, 13]);
  eq('… 科目ごとの数と正の字（多い順）：「授業 正丅」「手伝い 一」', tb.rows[0].subjects.map((x) => [x.subject, x.n, x.strokes]), [['授業', 7, [5, 2]], ['手伝い', 1, [1]]]);
  eq('… 締め切りを決めない頼みは数えない（v は出ない・ほかにも数えない）', tb.rows.some((r) => r.sid === 'v') || tb.people !== 4, false);
  eq('… students を渡さなければ全員を数え、同じ数は先にタスクが出てきた順', E.taskBoard(bs, D18).rows.map((r) => r.sid), ['s', 't', 'w']);
  eq('… students にいない生徒は数えない', E.taskBoard(bs, D18, [{ id: 'u' }]).rows.map((r) => r.sid + ':' + r.n), ['u:1']);
  const done = bs.map((b) => (b.subject === '授業' && b.targets[0] === 's' ? Object.assign({}, b, { sweep: { s: E.markSweep(null, { st: 'done' }, D18, 1) } }) : b));
  eq('… 掃除で「終わった」にしたものは数えない（s は 手伝い 1 だけ）', E.taskBoard(done, D18, students).rows.map((r) => r.sid + ':' + r.n), ['t:2', 'w:2', 's:1']);
  eq('… 居残りの生徒には印（stay）・種類ごとの数', (() => { const x = bs.slice(); x[7] = Object.assign({}, x[7], { sweep: { t: E.markSweep(E.markSweep(null, { st: 'not' }, D18, 1), { stay: true }, D18, 2) } });
    const r = E.taskBoard(x, D18, students).rows.find((y) => y.sid === 't'); return [r.stay, r.subjects.map((y) => y.subject + ':' + J(y.kinds))]; })(),
    [true, ['手伝い:{"today":0,"homework":0,"stay":1}', '授業:{"today":1,"homework":0,"stay":0}']]);
  eq('タスクがなければ空', E.taskBoard([], D18, students), { rows: [], more: 0, people: 0, total: 0 });
}

/* ================= C9. 机のお便り ================= */
section('C9. 机のお便り（deskLetters）：終わるまで残る・3枚まで');
{
  const L = (id, p, o) => B(id, Object.assign({ channel: 'letter', period: p, text: id, createdAt: at(18, 8 + p) }, o));
  const l1 = L('l1', 1, {}), l2 = L('l2', 2, { due: { kind: 'day' } }), l3 = L('l3', 3, { due: { kind: 'slot' } }), l5 = L('l5', 5, {});
  const y = L('y', 2, { createdAt: at(17, 10), due: { kind: 'date', date: D20 } });   // 前の日の宿題
  const yn = L('yn', 3, { createdAt: at(17, 11) });                                  // 前の日・締め切りなし・掃除の記録なし
  const ym = L('ym', 4, { createdAt: at(17, 12), sweep: { s: E.markSweep(null, { st: 'mid' }, D17, 1) } });   // 前の日からの続き
  const ot = L('ot', 4, { targets: ['t'] });                                          // ほかの生徒あて
  const bs = [l1, l2, l3, l5, y, yn, ym, ot];
  const d3 = E.deskLetters(bs, D18, 3, 's');
  eq('3限の机: その枠のお便りが上、その下に前の枠・前の日のまだ終わっていないお便り（新しい順）。3枚まで＋ほか N 枚', [ids(d3.letters), d3.more, d3.total, d3.current.id], [['l3', 'l2', 'l1'], 2, 5, 'l3']);
  l3.sweep = { s: E.answerSlot(null, 'done', D18, 1).sweep };
  eq('「この時間中」で終わったら、次の枠（4限）の机にはもうない・その枠（3限）を見ている間は置く', [ids(E.deskLetters(bs, D18, 4, 's').letters).indexOf('l3'), E.deskLetters(bs, D18, 3, 's').current.id], [-1, 'l3']);
  const d4 = E.deskLetters(bs, D18, 4, 's');
  eq('4限の机（その枠のお便りなし）: 2限・1限・前の日からの続き（ほか1枚＝前の日の宿題）。締め切りを決めず記録もない前の日のお便りは残らない', [ids(d4.letters), d4.more, d4.total, d4.current], [['l2', 'l1', 'ym'], 1, 4, null]);
  eq('… 同じ日のあとの枠（5限）のお便りは、まだ配っていないので置かない', ids(E.deskLetters(bs, D18, 2, 's').letters), ['l2', 'l1', 'ym']);
  eq('… 放課後など（枠でない）は、その日の枠のお便りを全部「前のもの」として見る', ids(E.deskLetters(bs, D18, 'after', 's').letters), ['l5', 'l2', 'l1']);
  eq('… ほかの生徒あてのお便りは置かない', ids(E.deskLetters(bs, D18, 4, 't').letters), ['ot']);
  y.results = { s: { kind: 'asExpected', submitted: true, at: at(18, 12) } };
  l2.sweep = { s: E.markSweep(null, { st: 'done' }, D18, 2) };
  eq('宿題・今日中のお便りも、終わったら消える（4限の机: 1限・前の日からの続きだけ）', [ids(E.deskLetters(bs, D18, 4, 's').letters), E.deskLetters(bs, D18, 4, 's').more], [['l1', 'ym'], 0]);
  eq('次の日（10/19）の1限の机: 前の日の締め切りなしで記録のないお便り（l1・l5）は残らない・続き（ym）は残る', ids(E.deskLetters(bs, D19, 1, 's').letters), ['ym']);
}

/* ================= C10. 午前3時の区切り ================= */
section('C10. 午前3時の区切りでずれない');
{
  const today = E.dayKey(at(19, 2, 0));
  eq('（前提）10/19 の 2:00 は 10/18', today, D18);
  const late = B('n', { period: 5, due: { kind: 'day' }, createdAt: at(19, 1, 30) });
  eq('10/19 1:30 に出した今日中の頼み: 締め切りの日は 10/18・10/19 2:00 に開いた掃除（＝10/18）に出る・「延ばす・居残り」を出せる',
    [E.boardDueDay(late), ids(E.sweepList([late], today).map((it) => it.board)), E.dueChoice(late, 's', today)], [D18, ['n'], true]);
  eq('… 10/19（3時から）は締め切りを過ぎたタスク', E.remainingTasks([late], E.dayKey(at(19, 3))).map((x) => x.late), [true]);
  const e = E.markSweep(null, { st: 'mid' }, today, at(19, 2, 0));
  eq('… 10/19 2:00 の掃除（＝10/18）で、締め切りを 10/19 に延ばせる（その日より後）', E.markSweep(e, { ext: D19 }, today, at(19, 2, 1)).log[0], { day: D18, st: 'mid', ext: D19 });
  const st = Object.assign({}, late, { sweep: { s: E.markSweep(e, { stay: true }, today, at(19, 2, 1)) } });
  eq('… 10/19 2:00 に選んだ居残りは 10/18 の放課後（10/19 の 3時からは残らない）', [E.stayList([st], today).length, E.stayList([st], E.dayKey(at(19, 3))).length], [1, 0]);
  const q = B('q', { period: 6, due: { kind: 'slot' }, createdAt: at(19, 0, 30) });
  eq('「この時間中」: 10/19 1:00 に 10/18 の6限から別の行へ → 聞く（今日の枠）。3:00 を過ぎたら前の日なので聞かない',
    [E.slotAsk([q], D18, 6, E.dayKey(at(19, 1))).length, E.slotAsk([q], D18, 6, E.dayKey(at(19, 3))).length], [1, 0]);
  const tb = [B('a', { period: 1, due: { kind: 'day' }, createdAt: at(18, 2, 59) }), B('b', { period: 1, due: { kind: 'day' }, createdAt: at(18, 3, 0) })];
  eq('10/18 2:59 の頼みは 10/17 の今日中（10/18 には過ぎている）・3:00 の頼みは 10/18 の今日中', E.remainingTasks(tb, D18).map((x) => x.board.id + ':' + x.due + ':' + x.late), ['a:' + D17 + ':true', 'b:' + D18 + ':false']);
  eq('机のお便りの「その日」も午前3時で分ける（10/19 1:00 に配ったお便りは 10/18 の5限）', ids(E.deskLetters([B('m', { channel: 'letter', period: 5, createdAt: at(19, 1) })], D18, 5, 's').letters), ['m']);
}

/* ================= V. 心の声の言い方の決まり ================= */
section('V. 心の声の言い方の決まり（「〜かも」・「やり残し」「覚えている」を使わない・数字を出さない）');
{
  const rule = (t) => /かも$/.test(t) && !/やり残し|覚えて/.test(t) && !/[0-9０-９]/.test(t);
  ok('新しい声（同じ枠に別々の頼み・居残り）は決まりどおり', [E.SAME_SLOT_VOICE, E.STAY_VOICE].every(rule), J([E.SAME_SLOT_VOICE, E.STAY_VOICE]));
  // いろいろな枠×生徒で、目線に出る声を全部集めて見る
  const TEXTS = [SAMPLE, '資料を作って', '印刷もお願いね', 'あとで部屋の片づけ、お願いね。ついでに鍵も返して。それと掃除も', 'また雑。直しておいて', '至急、資料を直して'];
  const ANS = [FIRST, USED, UNKNOWN, { q1: 'B', q2: 'E', q3: 'E', q4: 'E', q5: 'E' }];
  let bad = '', n = 0;
  TEXTS.forEach((t1, i) => TEXTS.forEach((t2, j) => {
    const bs = [B('p', { period: 1, channel: 'broadcast', text: t2, createdAt: at(18, 8) }), B('k', { period: 3, text: t1, due: i % 2 ? { kind: 'day' } : undefined, createdAt: at(18, 10) }),
      B('l', { period: 3, channel: 'letter', text: t2, createdAt: at(18, 11) }), B('c', { period: 3, channel: 'broadcast', text: t1 + '。あと印刷も', createdAt: at(18, 12) })];
    bs[1].sweep = { s: E.markSweep(E.markSweep(null, { st: 'not' }, D18, 1), { stay: j % 2 === 0 }, D18, 2) };
    ANS.forEach((a) => {
      const v = E.slotView(bs, D18, 3, { id: 's', answers: a });
      const day = v.voices.map((x) => x.text).concat(v.stay ? [v.stay.text] : []), all = day.concat(...v.sections.map((x) => x.view.voices.map((y) => y.text)));
      n += all.length;
      if (!bad && !(day.every(rule) && all.every((x) => /かも$/.test(x)) && v.voices.length <= 3)) bad = J(all);
    });
  }));
  ok('枠の目線 ' + TEXTS.length * TEXTS.length * ANS.length + ' 通り（声 ' + n + ' 個）: その日の声と居残りの声は決まりどおり・3つまで、区切りの声も全部「〜かも」', !bad && n > 0, bad);
}
}

/* ================= Q. v0.4 段B・段C（画面のために足した小さな判定：空いている枠・掃除するものがないわけ・枠の掃除の印） ================= */
section('Q. 空いている枠（枠ごと動かす）・掃除するものがないわけ（宿題）・枠の掃除のあとの印');
{
  const B = (id, o) => Object.assign({ id: id, text: id, channel: 'board', subject: '授業', targets: ['s'], createdAt: at(18, 9), firstTime: {}, results: {} }, o || {});
  const bs = [B('k4', { period: 4 }), B('l4', { period: 4, channel: 'letter', createdAt: at(18, 10) }), B('L', { lunch: true, period: 0, channel: 'broadcast', createdAt: at(18, 12) })];
  eq('空いている枠：どれかの伝え方が入っている枠（4限・昼休み）はのぞく', E.freeSlots(bs, D18), [1, 2, 3, 5, 6]);
  eq('… 枠ごと動かすときは、その枠の頼み（id の配列）を空きとみなす・id 1つなら同じ枠のほかの伝え方が残る', [E.freeSlots(bs, D18, ['k4', 'l4']), E.freeSlots(bs, D18, 'k4')], [[1, 2, 3, 4, 5, 6], [1, 2, 3, 5, 6]]);
  const hw = B('h', { period: 2, due: { kind: 'date', date: '2026-10-20' } });
  eq('掃除するものがないわけ：今日の頼みが締め切りのまだ先の宿題だけ＝homework（前の日の宿題だけでも）', [E.sweepEmptyWhy([hw], D18), E.sweepEmptyWhy([Object.assign({}, hw, { createdAt: at(17, 9) })], D18)], ['homework', 'homework']);
  eq('… 宿題を提出・締めたら、ふつうのわけ（全員提出済み・今日の頼みがない）', [E.sweepEmptyWhy([Object.assign({}, hw, { results: { s: { kind: 'asExpected', submitted: true, at: at(18, 11) } } })], D18),
    E.sweepEmptyWhy([Object.assign({}, hw, { createdAt: at(17, 9), closedAt: at(17, 20) })], D18)], ['allDone', 'none']);
  const log = (st) => ({ st: st, next: '', good: false, at: 1, log: [{ day: D18, st: st }] });
  const done = B('d', { sweep: { s: log('done') } }), left = B('m', { sweep: { s: log('mid') } }), none = B('n');
  eq('枠の掃除のあとの印：どれかに途中・まだが残る＝続き・全部終わった＝✓・まだ掃除していないものがあれば印なし・空の枠は印なし',
    [E.slotMarkOf([done, left]), E.slotMarkOf([done, done]), E.slotMarkOf([done, none]), E.slotMarkOf([])], ['left', 'done', '', '']);
}

console.log('\n' + (fails.length ? '通らなかった: ' + fails.length + ' 件 ／ 通った: ' + pass + ' 件' : 'すべて通った: ' + pass + ' 件'));
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
