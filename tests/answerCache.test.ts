import { test } from "node:test";
import assert from "node:assert/strict";
import { QuestionIndex, normalizeQuestion, skipReason } from "../src/lib/ai/answerCache/matcher";

const entry = (id: string, question: string) => ({ id, normalized: normalizeQuestion(question) });

const index = new QuestionIndex([
  entry("features", "LABNOTEでは何ができますか？"),
  entry("pricing", "料金はいくらですか？"),
  entry("register", "アカウントの登録方法を教えてください"),
  entry("peer", "AI査読とは何ですか？"),
  entry("voice", "音声入力で実験記録を残せますか？"),
]);

test("normalization folds spelling, synonyms, fillers and polite endings", () => {
  assert.equal(normalizeQuestion("ラボノートで何ができますか？"), normalizeQuestion("LABNOTEでは、何ができますか"));
  assert.equal(normalizeQuestion("えーと、値段を教えてください"), normalizeQuestion("料金"));
  assert.equal(normalizeQuestion("ＡＩ査読って何？"), normalizeQuestion("AI査読って何"));
});

test("paraphrases of an answered question hit the cache", () => {
  const cases: [string, string][] = [
    ["ラボノートでは、どんなことができますか？", "features"],
    ["LABNOTEで何ができるの？", "features"],
    ["ラボノートは何ができるんですか", "features"],
    ["すみません、価格はいくらですか", "pricing"],
    ["登録方法を教えて", "register"],
    ["AI査読って何ですか", "peer"],
    ["音声入力で実験記録は残せますか", "voice"],
  ];
  for (const [question, expected] of cases) {
    const hit = index.match(normalizeQuestion(question));
    assert.equal(hit?.entry.id, expected, `${question} -> ${hit?.entry.id ?? "miss"} (${hit?.score.toFixed(2)})`);
  }
});

test("small wording differences still hit through n-gram similarity", () => {
  for (const question of ["音声で実験記録は残せますか", "音声入力を使って実験記録を残せますか"]) {
    const hit = index.match(normalizeQuestion(question));
    assert.equal(hit?.entry.id, "voice", question);
    assert.ok(hit && hit.score < 1, "should be a similarity hit, not an exact one");
  }
});

test("a narrower question does not reuse the broader answer", () => {
  // Price of AI peer review specifically ≠ general pricing.
  assert.equal(index.match(normalizeQuestion("AI査読の料金はいくらですか？"))?.entry.id ?? null, null);
});

test("different questions do not hit", () => {
  for (const question of [
    "解約するにはどうすればいいですか",
    "統計解析はどのように行いますか",
    "論文検索のやり方",
    "データはどこに保存されますか",
    "スマホアプリはありますか",
  ]) {
    const hit = index.match(normalizeQuestion(question));
    assert.equal(hit, null, `${question} unexpectedly matched ${hit?.entry.id} (${hit?.score.toFixed(2)})`);
  }
});

test("context-, person- and time-dependent questions skip the shared cache", () => {
  assert.equal(skipReason("それはいくらですか？"), "context");
  assert.equal(skipReason("さっきの話をもう一度"), "context");
  assert.equal(skipReason("私の研究室のデータはどこですか"), "personal");
  assert.equal(skipReason("今日のメンテナンス予定は？"), "time");
  assert.equal(skipReason("test@example.com に送れますか"), "identifier");
  assert.equal(skipReason("料金はいくらですか？"), null);
  assert.equal(skipReason("？"), "empty");
});

test("calibration pairs stay separated (paraphrases hit, narrower/other questions miss)", () => {
  const same: [string, string][] = [
    ["音声で実験記録は残せますか", "音声入力で実験記録を残せますか？"],
    ["音声入力を使って実験記録を残せますか", "音声入力で実験記録を残せますか？"],
    ["統計解析って使えますか", "統計解析は使えますか？"],
    ["AI査読のやり方を教えて", "AI査読の使い方を教えてください"],
    ["登録するにはどうすればいい？", "登録はどうやってするんですか"],
    ["論文検索はどうやって使うの", "論文検索の使い方を教えて"],
  ];
  const different: [string, string][] = [
    ["AI査読の料金はいくらですか？", "料金はいくらですか？"],
    ["統計解析のやり方", "統計解析はできますか？"],
    ["解約方法を教えて", "登録方法を教えてください"],
    ["論文検索はできますか", "統計解析はできますか？"],
    ["スマホアプリはありますか", "スマホで使えますか？"],
    ["PDFで出力できますか", "CSVで出力できますか"],
  ];
  const hits = ([asked, cached]: [string, string]) =>
    new QuestionIndex([{ id: "cached", normalized: normalizeQuestion(cached) }]).match(normalizeQuestion(asked)) !== null;
  for (const pair of same) assert.ok(hits(pair), `should hit: ${pair.join(" / ")}`);
  for (const pair of different) assert.ok(!hits(pair), `should miss: ${pair.join(" / ")}`);
});
