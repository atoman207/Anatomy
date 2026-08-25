import "server-only";

import { aiConfig, respondStructured } from "./openai";
import { TIER_LABELS, type PublicationAssessment, type ReviewTier } from "./peerReviewReport";

/**
 * "Where does this manuscript realistically fit, and how likely is
 * acceptance" - a separate model call from the three reviewers, run once
 * after their scores exist, rather than folded into one of them:
 *
 * - It needs different knowledge. The three reviewers are deliberately
 *   grounded in nothing but the manuscript text (see GROUNDING_RULES in
 *   peerReview.ts) - inventing a "concern" about content the paper never
 *   contained is the one thing they must never do. Naming real journals and
 *   their typical Impact Factor is the opposite: it requires the model's own
 *   world knowledge, which the reviewers are explicitly forbidden to use for
 *   their content judgments.
 * - It consumes the reviewers' output rather than re-deriving it. This call
 *   is given the already-computed scores and concerns, not the raw
 *   manuscript again, so "how severe are the problems" is answered once (by
 *   the reviewers) and reused, not re-judged from scratch by a fourth voice
 *   that could disagree with the first three.
 */

const SYSTEM_PROMPT = `あなたは学術出版に詳しいアドバイザーです。3名の査読者による評価結果をもとに、
この論文が投稿に値するジャーナルの水準と、採択の見込みを推定してください。以下を厳守してください:

1. 実在する、この分野に関連する学術誌のみを挙げてください。存在しない、または確信の持てないジャーナル名は挙げないでください。
2. Impact Factorは、あなたが把握している直近の値のおおよその目安として示してください。確信が持てない場合は typicalImpactFactor を null にしてください（存在しない数字を作らないこと）。
3. 推定は、与えられた査読者スコア・指摘・評価基準（トップジャーナル基準 or 一般的な国際誌基準）にもとづいて行ってください。
4. acceptanceLikelihood はあくまで目安です。誇張して高く見積もらず、査読者の指摘が重大であれば率直に低く見積もってください。
5. ユーザーメッセージに「投稿予定のジャーナル」が指定されている場合のみ、targetJournal を埋めてください。指定がない場合は targetJournal は null にしてください。
   targetJournal.acceptancePercent は0〜100の整数で、その具体的なジャーナル名を踏まえた採択可能性の推定値です（そのジャーナルの一般的な採択率の水準と、この論文の査読結果を組み合わせて推定してください）。誇張せず、率直な数字にしてください。
6. summary は2〜3文で、全体としての位置づけを日本語で要約してください。`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["impactFactorEstimate", "recommendedJournals", "acceptanceLikelihood", "targetJournal", "summary"],
  properties: {
    targetJournal: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["name", "acceptancePercent", "rationale"],
      properties: {
        name: { type: "string" },
        acceptancePercent: { type: "integer", minimum: 0, maximum: 100 },
        rationale: { type: "string" },
      },
    },
    impactFactorEstimate: {
      type: "object",
      additionalProperties: false,
      required: ["min", "max", "rationale"],
      properties: {
        min: { type: "number" },
        max: { type: "number" },
        rationale: { type: "string" },
      },
    },
    recommendedJournals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "typicalImpactFactor", "rationale"],
        properties: {
          name: { type: "string" },
          typicalImpactFactor: { type: ["number", "null"] },
          rationale: { type: "string" },
        },
      },
    },
    acceptanceLikelihood: {
      type: "object",
      additionalProperties: false,
      required: ["rating", "percentRange", "rationale"],
      properties: {
        rating: { type: "string", enum: ["very_low", "low", "moderate", "high"] },
        percentRange: { type: "string" },
        rationale: { type: "string" },
      },
    },
    summary: { type: "string" },
  },
};

export interface AssessPublicationFitOptions {
  /** A trimmed excerpt is enough - this call needs the manuscript's field and level, not the full text. */
  manuscriptExcerpt: string;
  tier: ReviewTier;
  overallScore: number;
  /** The highest-severity concerns across all three reviewers, as plain text summaries. */
  topConcerns: string[];
  /** The journal the researcher actually intends to submit to, if named - fills `targetJournal` when present. */
  targetJournalName?: string | null;
  model?: string;
}

export async function assessPublicationFit(
  opts: AssessPublicationFitOptions,
): Promise<{ data: PublicationAssessment; model: string }> {
  const targetJournalName = opts.targetJournalName?.trim() || null;
  const user = [
    `評価基準: ${TIER_LABELS[opts.tier].title}（${TIER_LABELS[opts.tier].description}）`,
    `3名の査読者の総合評価: ${opts.overallScore} / 100`,
    targetJournalName ? `投稿予定のジャーナル: ${targetJournalName}` : "投稿予定のジャーナル: （指定なし）",
    "",
    "主な指摘事項:",
    opts.topConcerns.length ? opts.topConcerns.map((c) => `- ${c}`).join("\n") : "（重大な指摘なし）",
    "",
    "論文の抜粋（分野・主題の把握用）:",
    opts.manuscriptExcerpt,
  ].join("\n");

  const result = await respondStructured<Omit<PublicationAssessment, "tier">>({
    model: opts.model ?? aiConfig().text,
    system: SYSTEM_PROMPT,
    user,
    schemaName: "publication_assessment",
    schema: SCHEMA,
  });

  return { data: { ...result.data, tier: opts.tier }, model: result.model };
}
