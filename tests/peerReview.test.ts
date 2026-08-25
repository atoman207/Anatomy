import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  aggregateReview, allMajorConcerns, allRecommendations, CATEGORY_LABELS,
  peerReviewToMarkdown, REVIEWER_LABELS, severityTone, TIER_LABELS,
  type MethodsReviewResult, type NoveltyReviewResult, type PublicationAssessment,
  type StructureReviewResult,
} from "../src/lib/ai/peerReviewReport";
import { extractPdfText, PdfExtractionError } from "../src/lib/peerReview/pdf";
import { withPersonality, withRubricNotes, withTier } from "../src/lib/ai/peerReview";
import {
  avatarFor, DEFAULT_REVIEWER_NAMES, defaultReviewerProfiles,
} from "../src/lib/ai/reviewerProfiles";
import { PEER_REVIEW_CREDIT_PACKS } from "../src/lib/peerReview/creditPacks";
import { randomPersonalities, REVIEWER_PERSONALITIES } from "../src/lib/ai/reviewerPersonalities";

function methods(overrides: Partial<MethodsReviewResult> = {}): MethodsReviewResult {
  return {
    reviewer: "methods",
    overall_score: 72,
    category_scores: { validity: 70, reproducibility: 65, statistics: 75, methods: 80 },
    major_concerns: [{ issue: "対照群の設定が不十分です。", severity: 7 }],
    minor_concerns: ["サンプルサイズの根拠が記載されていません。"],
    recommendations: ["Methodsにsample size determinationの計算根拠を追記してください。"],
    summary: "方法は概ね妥当だが、対照群の説明が不足している。",
    ...overrides,
  };
}

function novelty(overrides: Partial<NoveltyReviewResult> = {}): NoveltyReviewResult {
  return {
    reviewer: "novelty",
    overall_score: 81,
    category_scores: { novelty: 85, depth: 78 },
    major_concerns: [],
    minor_concerns: ["先行研究との差分がやや簡潔すぎます。"],
    recommendations: ["Discussionに関連する先行研究を3〜5報追加してください。"],
    summary: "新規性は高く、機序への踏み込みも十分である。",
    ...overrides,
  };
}

function structure(overrides: Partial<StructureReviewResult> = {}): StructureReviewResult {
  return {
    reviewer: "structure",
    overall_score: 75,
    category_scores: { logic: 74, discussion: 76, citations: 77 },
    major_concerns: [{ issue: "Figure 3だけでは結論を十分に支持できません。", severity: 6 }],
    minor_concerns: [],
    recommendations: ["Figure 3に追加解析を検討してください。"],
    summary: "論理展開は概ね一貫しているが、一部結論が先行している。",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

test("the overall score is the arithmetic mean of the three reviewers, rounded", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  // (72 + 81 + 75) / 3 = 76
  assert.equal(report.overallScore, 76);
});

test("rounding follows standard rounding, not truncation", () => {
  const report = aggregateReview([
    methods({ overall_score: 70 }),
    novelty({ overall_score: 70 }),
    structure({ overall_score: 71 }),
  ]);
  // (70+70+71)/3 = 70.333... -> 70
  assert.equal(report.overallScore, 70);

  const report2 = aggregateReview([
    methods({ overall_score: 70 }),
    novelty({ overall_score: 71 }),
    structure({ overall_score: 71 }),
  ]);
  // (70+71+71)/3 = 70.666... -> 71
  assert.equal(report2.overallScore, 71);
});

test("category scores are the union of all three reviewers, with no overlap and nothing missing", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  assert.deepEqual(report.categoryScores, {
    validity: 70, reproducibility: 65, statistics: 75, methods: 80,
    novelty: 85, depth: 78,
    logic: 74, discussion: 76, citations: 77,
  });
  // Every key CATEGORY_LABELS advertises must actually be populated.
  for (const key of Object.keys(CATEGORY_LABELS)) {
    assert.ok(
      key in report.categoryScores,
      `${key} is in CATEGORY_LABELS but aggregateReview never produced it`,
    );
  }
});

test("no reviewer contributes a category another reviewer also claims", () => {
  const keySets = [
    Object.keys(methods().category_scores),
    Object.keys(novelty().category_scores),
    Object.keys(structure().category_scores),
  ];
  const seen = new Set<string>();
  for (const keys of keySets) {
    for (const k of keys) {
      assert.ok(!seen.has(k), `category "${k}" is claimed by more than one reviewer`);
      seen.add(k);
    }
  }
  assert.equal(seen.size, Object.keys(CATEGORY_LABELS).length);
});

test("REVIEWER_LABELS and CATEGORY_LABELS cover exactly what aggregateReview produces", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  for (const r of report.reviewers) {
    assert.ok(REVIEWER_LABELS[r.reviewer], `no label for reviewer "${r.reviewer}"`);
  }
  assert.deepEqual(
    Object.keys(CATEGORY_LABELS).sort(),
    Object.keys(report.categoryScores).sort(),
  );
});

test("aggregateReview defaults to the standard tier and carries whichever tier it is given", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  assert.equal(report.tier, "standard");

  const topReport = aggregateReview([methods(), novelty(), structure()], "top");
  assert.equal(topReport.tier, "top");
});

/* ------------------------------------------------------------------ */
/* Consolidated concerns / recommendations                             */
/* ------------------------------------------------------------------ */

test("allMajorConcerns tags each concern with the reviewer that raised it", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const concerns = allMajorConcerns(report);
  assert.deepEqual(
    concerns.map((c) => c.reviewer),
    ["methods", "structure"], // novelty() has no major concerns in this fixture
  );
  assert.equal(concerns.length, methods().major_concerns.length + structure().major_concerns.length);
});

test("allRecommendations includes every reviewer that made one", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const recs = allRecommendations(report);
  assert.equal(recs.length, 3);
  assert.deepEqual(new Set(recs.map((r) => r.reviewer)), new Set(["methods", "novelty", "structure"]));
});

test("a reviewer with no concerns at all produces an empty list, not a crash", () => {
  const report = aggregateReview([
    methods({ major_concerns: [], minor_concerns: [] }),
    novelty({ major_concerns: [], minor_concerns: [] }),
    structure({ major_concerns: [], minor_concerns: [] }),
  ]);
  assert.deepEqual(allMajorConcerns(report), []);
});

/* ------------------------------------------------------------------ */
/* Markdown rendering                                                  */
/* ------------------------------------------------------------------ */

test("the rendered report includes the overall score and every category", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const md = peerReviewToMarkdown(report, { title: "IL-1β刺激による軟骨細胞の異化応答" });

  assert.ok(md.includes("IL-1β刺激による軟骨細胞の異化応答"));
  assert.ok(md.includes("総合評価: 76 / 100"));
  for (const label of Object.values(CATEGORY_LABELS)) {
    assert.ok(md.includes(label), `markdown is missing the ${label} category`);
  }
});

test("the rendered report attributes concerns to the correct reviewer section", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const md = peerReviewToMarkdown(report, { title: "t" });

  const methodsSection = md.slice(md.indexOf("査読者1"), md.indexOf("査読者2"));
  assert.ok(methodsSection.includes("対照群の設定が不十分です。"));
  assert.ok(!methodsSection.includes("Figure 3だけでは結論を十分に支持できません。"));
});

test("a reviewer section with no major concerns omits the heading rather than printing an empty list", () => {
  const report = aggregateReview([methods(), novelty({ major_concerns: [] }), structure()]);
  const md = peerReviewToMarkdown(report, { title: "t" });
  const noveltySection = md.slice(md.indexOf("査読者2"), md.indexOf("査読者3"));
  assert.ok(!noveltySection.includes("重大な指摘"));
});

test("the source filename is included only when provided", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const withFile = peerReviewToMarkdown(report, { title: "t", sourceFilename: "draft.pdf" });
  const withoutFile = peerReviewToMarkdown(report, { title: "t" });
  assert.ok(withFile.includes("draft.pdf"));
  assert.ok(!withoutFile.includes("元ファイル"));
});

test("reviewer names appear in the markdown when supplied, and the Reviewer N labels survive alongside them", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const named = peerReviewToMarkdown(report, {
    title: "t",
    reviewerNames: DEFAULT_REVIEWER_NAMES,
  });
  for (const name of Object.values(DEFAULT_REVIEWER_NAMES)) {
    assert.ok(named.includes(name), `markdown is missing reviewer name "${name}"`);
  }
  // 「査読者1/2/3」はセクション切り出し用に残す。
  assert.ok(named.includes("査読者1"));
  assert.ok(named.includes("査読者2"));
  assert.ok(named.includes("査読者3"));

  const unnamed = peerReviewToMarkdown(report, { title: "t" });
  for (const name of Object.values(DEFAULT_REVIEWER_NAMES)) {
    assert.ok(!unnamed.includes(name), `unnamed markdown unexpectedly includes "${name}"`);
  }
});

test("markdown output never leaves a template placeholder unresolved", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const md = peerReviewToMarkdown(report, { title: "t" });
  assert.ok(!/\{\{/.test(md));
  assert.ok(!/undefined|NaN/.test(md));
});

test("the rendered report states which tier it was evaluated under", () => {
  const standardMd = peerReviewToMarkdown(aggregateReview([methods(), novelty(), structure()], "standard"), { title: "t" });
  const topMd = peerReviewToMarkdown(aggregateReview([methods(), novelty(), structure()], "top"), { title: "t" });
  assert.ok(standardMd.includes(TIER_LABELS.standard.title));
  assert.ok(topMd.includes(TIER_LABELS.top.title));
});

test("major concerns render with their numeric severity, not just prose", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const md = peerReviewToMarkdown(report, { title: "t" });
  assert.ok(md.includes("対照群の設定が不十分です。（深刻度: 7 / 10）"));
  assert.ok(md.includes("Figure 3だけでは結論を十分に支持できません。（深刻度: 6 / 10）"));
});

function assessment(overrides: Partial<PublicationAssessment> = {}): PublicationAssessment {
  return {
    tier: "standard",
    impactFactorEstimate: { min: 3, max: 6, rationale: "分野内で中堅の専門誌に相当する内容です。" },
    recommendedJournals: [
      { name: "Osteoarthritis and Cartilage", typicalImpactFactor: 7.6, rationale: "軟骨代謝の主題と直接合致します。" },
      { name: "Journal of Orthopaedic Research", typicalImpactFactor: null, rationale: "方法論の水準が合致します。" },
    ],
    acceptanceLikelihood: { rating: "moderate", percentRange: "30〜50%", rationale: "主要な指摘への対応次第です。" },
    targetJournal: null,
    summary: "分野専門誌への投稿が現実的です。",
    ...overrides,
  };
}

test("the publication assessment section is included only when supplied", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const withAssessment = peerReviewToMarkdown(report, { title: "t", assessment: assessment() });
  const withoutAssessment = peerReviewToMarkdown(report, { title: "t" });

  assert.ok(withAssessment.includes("掲載可能性の評価"));
  assert.ok(withAssessment.includes("3 〜 6"));
  assert.ok(withAssessment.includes("Osteoarthritis and Cartilage"));
  assert.ok(withAssessment.includes("IF 7.6"));
  // A journal the model was unsure of never gets a fabricated number.
  assert.ok(withAssessment.includes("Journal of Orthopaedic Research"));
  assert.ok(withAssessment.includes("実際の査読結果・採否を保証するものではありません"));

  assert.ok(!withoutAssessment.includes("掲載可能性の評価"));
});

test("a named target journal's acceptance estimate renders as its own headline, distinct from the generic range", () => {
  const report = aggregateReview([methods(), novelty(), structure()]);
  const withTarget = peerReviewToMarkdown(report, {
    title: "t",
    assessment: assessment({
      targetJournal: {
        name: "Osteoarthritis and Cartilage",
        acceptancePercent: 35,
        rationale: "統計面の指摘への対応次第で射程内です。",
      },
    }),
  });
  assert.ok(withTarget.includes("「Osteoarthritis and Cartilage」への採択可能性: 約35%"));

  const withoutTarget = peerReviewToMarkdown(report, { title: "t", assessment: assessment() });
  assert.ok(!withoutTarget.includes("への採択可能性: 約"));
});

/* ------------------------------------------------------------------ */
/* PDF text extraction                                                 */
/* ------------------------------------------------------------------ */

/** A minimal single-page PDF whose content stream is the literal text below. */
const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 144] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 63 >>
stream
BT /F1 18 Tf 20 100 Td (Reviewed manuscript text) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;

function pdfBytes(source: string): ArrayBuffer {
  const buf = Buffer.from(source, "latin1");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test("extractPdfText reads the text out of a real PDF", async () => {
  const result = await extractPdfText(pdfBytes(MINIMAL_PDF));
  assert.equal(result.pageCount, 1);
  assert.equal(result.text, "Reviewed manuscript text");
});

test("extractPdfText rejects a file that is not a PDF, in Japanese, rather than throwing a raw parser error", async () => {
  await assert.rejects(
    () => extractPdfText(pdfBytes("this is not a pdf at all")),
    (err: unknown) => {
      assert.ok(err instanceof PdfExtractionError);
      assert.ok(/PDFを読み取れませんでした/.test((err as Error).message));
      return true;
    },
  );
});

/* ------------------------------------------------------------------ */
/* Reviewer names and rubric notes                                     */
/* ------------------------------------------------------------------ */

test("the default reviewer names are generic labels, one per role, none blank", () => {
  // Deliberately generic ("Researcher N") rather than a real-sounding personal
  // name, per customer feedback - see reviewerProfiles.ts. This test used to
  // require a Japanese personal name; that requirement is exactly what the
  // feedback asked to remove.
  for (const role of ["methods", "novelty", "structure"] as const) {
    const name = DEFAULT_REVIEWER_NAMES[role];
    assert.ok(name.trim().length > 0, `${role} has no default name`);
  }
  // All three are distinct - three reviewers must not collapse into one identity.
  const names = Object.values(DEFAULT_REVIEWER_NAMES);
  assert.equal(new Set(names).size, names.length);
});

test("defaultReviewerProfiles starts every reviewer with empty rubric notes", () => {
  const profiles = defaultReviewerProfiles();
  for (const role of ["methods", "novelty", "structure"] as const) {
    assert.equal(profiles[role].role, role);
    assert.equal(profiles[role].name, DEFAULT_REVIEWER_NAMES[role]);
    assert.equal(profiles[role].rubricNotes, "");
  }
});

test("withRubricNotes leaves the base prompt untouched when there is nothing to add", () => {
  assert.equal(withRubricNotes("base prompt", undefined), "base prompt");
  assert.equal(withRubricNotes("base prompt", ""), "base prompt");
  assert.equal(withRubricNotes("base prompt", "   "), "base prompt");
});

test("withRubricNotes appends admin notes as a clearly separated supplement", () => {
  const out = withRubricNotes("base prompt", "再現性を厳しく見てください。");
  assert.ok(out.startsWith("base prompt"));
  assert.ok(out.includes("再現性を厳しく見てください。"));
  assert.notEqual(out, "base prompt");
});

/* ------------------------------------------------------------------ */
/* Review tier (Nature/Science/Cell vs. a typical international journal) */
/* ------------------------------------------------------------------ */

test("withTier appends different, tier-specific instructions for top vs standard", () => {
  const top = withTier("base prompt", "top");
  const standard = withTier("base prompt", "standard");
  assert.ok(top.startsWith("base prompt"));
  assert.ok(standard.startsWith("base prompt"));
  assert.notEqual(top, standard);
  // Each mentions its own tier's title, so a reviewer prompt can never
  // silently run under the wrong bar without it being visible in the prompt.
  assert.ok(top.includes(TIER_LABELS.top.title));
  assert.ok(standard.includes(TIER_LABELS.standard.title));
});

/* ------------------------------------------------------------------ */
/* Reviewer personalities                                              */
/* ------------------------------------------------------------------ */

test("withPersonality leaves the base prompt untouched when nothing is selected", () => {
  assert.equal(withPersonality("base prompt", undefined), "base prompt");
  assert.equal(withPersonality("base prompt", null), "base prompt");
});

test("withPersonality appends the matching catalogue instruction and nothing else", () => {
  const out = withPersonality("base prompt", "strict");
  assert.ok(out.startsWith("base prompt"));
  const strict = REVIEWER_PERSONALITIES.find((p) => p.id === "strict")!;
  assert.ok(out.includes(strict.promptInstruction));
});

test("every personality produces a distinct instruction", () => {
  const outputs = REVIEWER_PERSONALITIES.map((p) => withPersonality("base", p.id));
  assert.equal(new Set(outputs).size, outputs.length);
});

test("randomPersonalities assigns one personality per role, from the real catalogue", () => {
  const ids = new Set(REVIEWER_PERSONALITIES.map((p) => p.id));
  const roles = ["methods", "novelty", "structure"] as const;
  const picked = randomPersonalities(roles);
  for (const role of roles) {
    assert.ok(ids.has(picked[role]), `${role} got an id not in the catalogue: ${picked[role]}`);
  }
});

test("randomPersonalities picks distinct personalities across the three roles when the catalogue allows it", () => {
  const roles = ["methods", "novelty", "structure"] as const;
  const picked = randomPersonalities(roles);
  const values = Object.values(picked);
  // REVIEWER_PERSONALITIES currently has 6 entries, comfortably more than 3.
  assert.equal(new Set(values).size, values.length);
});

test("severityTone escalates from good to danger as severity rises", () => {
  assert.equal(severityTone(1), "good");
  assert.equal(severityTone(3), "good");
  assert.equal(severityTone(4), "warn");
  assert.equal(severityTone(6), "warn");
  assert.equal(severityTone(7), "danger");
  assert.equal(severityTone(10), "danger");
});

/* ------------------------------------------------------------------ */
/* Generated avatars                                                   */
/* ------------------------------------------------------------------ */

test("avatarFor is deterministic: the same name always produces the same avatar", () => {
  const a = avatarFor("高橋 誠");
  const b = avatarFor("高橋 誠");
  assert.deepEqual(a, b);
});

test("avatarFor extracts the first character as the glyph, ignoring leading whitespace", () => {
  assert.equal(avatarFor("高橋 誠").glyph, "高");
  assert.equal(avatarFor("  藤井 彩").glyph, "藤");
});

test("avatarFor never crashes on an empty or whitespace-only name", () => {
  assert.doesNotThrow(() => avatarFor(""));
  assert.doesNotThrow(() => avatarFor("   "));
  assert.equal(avatarFor("").glyph, "?");
});

test("the three default reviewers do not all land on the same avatar", () => {
  const specs = Object.values(DEFAULT_REVIEWER_NAMES).map((n) => avatarFor(n));
  const distinctBg = new Set(specs.map((s) => s.bg));
  assert.ok(distinctBg.size > 1, "all three reviewers generated the same background color");
});

/* ------------------------------------------------------------------ */
/* Credit packs                                                        */
/* ------------------------------------------------------------------ */

// Two sessions once disagreed on these numbers - one changed the catalogue,
// the other never noticed - and the drift was only caught by re-reading the
// file by hand. These checks make that drift a test failure instead.

test("the credits setup script charges exactly what the catalogue advertises", () => {
  const js = readFileSync(new URL("../scripts/stripe-credits-setup.mjs", import.meta.url), "utf8");
  for (const pack of PEER_REVIEW_CREDIT_PACKS) {
    const pattern = new RegExp(`id: "${pack.id}"[^}]*amountJpy: (\\d+)`);
    const found = js.match(pattern);
    assert.ok(found, `stripe-credits-setup.mjs has no amount for ${pack.id}`);
    assert.equal(
      Number(found[1]), pack.amountJpy,
      `${pack.id}: the script would create a price Stripe charges but the app does not show`,
    );
  }
});

test("the migration's seeded credit prices match the catalogue", () => {
  const sql = readFileSync(new URL("../supabase/migrations/all.sql", import.meta.url), "utf8");
  for (const pack of PEER_REVIEW_CREDIT_PACKS) {
    const pattern = new RegExp(`\\('${pack.id}',\\s*${pack.credits},\\s*${pack.amountJpy}\\)`);
    assert.ok(
      pattern.test(sql),
      `all.sql's peer_review_credit_prices seed does not match ${pack.id} (${pack.credits} credits, ¥${pack.amountJpy})`,
    );
  }
});
