import "server-only";

import { aiConfig, respondStructured, type StructuredResult, type Usage } from "./openai";
import {
  aggregateReview, TIER_LABELS,
  type MethodsReviewResult, type NoveltyReviewResult, type PeerReviewReport, type ReviewTier,
  type ReviewerResult, type ReviewerRole, type StructureReviewResult,
} from "./peerReviewReport";
import { personalityById, type PersonalityId } from "./reviewerPersonalities";

/**
 * AI peer review: three independent reviewers, each judging a different
 * dimension of the manuscript, exactly the way a journal's reviewer panel is
 * split by expertise rather than asked one undifferentiated "is this paper
 * good" question.
 *
 * Every reviewer's score and comments come only from its own model call with
 * its own system prompt - there is no shared "opinion" object a later
 * reviewer could see and defer to. The three are combined only after the
 * fact, by `aggregateReview` in `peerReviewReport.ts`, which is why the
 * reviewers can safely run one after another or in parallel with no
 * coordination between them.
 *
 * The report shape and the pure helpers over it (aggregation, Markdown
 * rendering) live in `peerReviewReport.ts`, not here: this file needs the
 * OpenAI API key and must stay `server-only`, but the peer-review page needs
 * those helpers in the browser to render what this file already returned.
 */

export * from "./peerReviewReport";

/** Score fields are shared across all three reviewer schemas. */
const scoreField = { type: "integer", minimum: 0, maximum: 100 } as const;

/** A weakness with a 1-10 severity, replacing a plain string so it can be sorted/flagged, not only read. */
const scoredWeaknessSchema = {
  type: "object",
  additionalProperties: false,
  required: ["issue", "severity"],
  properties: {
    issue: { type: "string" },
    severity: { type: "integer", minimum: 1, maximum: 10 },
  },
} as const;

function resultSchema(categoryProps: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "overall_score", "category_scores", "major_concerns", "minor_concerns",
      "recommendations", "summary",
    ],
    properties: {
      overall_score: scoreField,
      category_scores: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(categoryProps),
        properties: categoryProps,
      },
      major_concerns: { type: "array", items: scoredWeaknessSchema },
      minor_concerns: { type: "array", items: { type: "string" } },
      recommendations: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
  };
}

const METHODS_SCHEMA = resultSchema({
  validity: scoreField, reproducibility: scoreField, statistics: scoreField, methods: scoreField,
});
const NOVELTY_SCHEMA = resultSchema({ novelty: scoreField, depth: scoreField });
const STRUCTURE_SCHEMA = resultSchema({ logic: scoreField, discussion: scoreField, citations: scoreField });

/**
 * Shared rules every reviewer prompt opens with.
 *
 * The grounding rule is the load-bearing one: a review tool that invents a
 * "major concern" about content the paper never contained is worse than no
 * review at all, because the researcher has no easy way to notice the
 * fabrication without re-reading the whole paper themselves.
 */
const GROUNDING_RULES = `あなたは学術論文の査読者です。以下を厳守してください:

1. 与えられた本文に実際に書かれている内容だけを根拠に評価してください。本文にない情報を推測して指摘や評価に含めることは、査読として最も重大な誤りです。
2. ある観点を判断するための情報が本文に不足している場合、その点を「minor_concerns」に「〜についての記載が不足しているため評価できません」のように明記してください。低い点数をつけて済ませるのではなく、不足そのものを指摘してください。
3. スコアは0〜100の整数。目安: 90以上は卓越、70〜89は妥当（軽微な修正で対応可）、50〜69は大幅な修正が必要、49以下は根本的な問題があります。すべての論文に70点前後を機械的につける癖を避け、実際の内容に応じて差をつけてください。
4. major_concerns には、採否判断に直結する重大な問題のみを挙げてください（例: 対照群の欠如、サンプルサイズの根拠不明、結論を支持しないデータ）。各項目には issue（指摘内容）と severity（1〜10の深刻度）を必ず付けてください。severity は「この指摘単独で、想定している評価基準（下記）における採択を妨げうるか」を基準にしてください: 1〜3は軽微（採否に直結しない）、4〜6は要修正（対応が必要だが致命的ではない）、7〜10は致命的（対応なしでは採択が困難）。
5. recommendations は指摘に対応する具体的な行動を書いてください。「〜を改善してください」ではなく「Methodsにsample size determinationの計算根拠を追記してください」のように、著者がそのまま着手できる粒度にします。
6. summary はこの観点から見た論文の状態を2〜3文で要約してください。`;

/**
 * Appended after the grounding rules and the role-specific prompt, so the
 * same manuscript can be judged at two different bars. "top" is deliberately
 * unforgiving: the same issue that is a minor_concern at "standard" should
 * often become a high-severity major_concern here, and the same numeric
 * score should land meaningfully lower for an equivalent paper.
 */
const TIER_INSTRUCTIONS: Record<ReviewTier, string> = {
  top: `評価基準: ${TIER_LABELS.top.title}。
このレビューは Nature / Science / Cell クラスのトップジャーナルへの投稿を想定した、最も厳格な基準で行ってください。
- novelty・significance は「その分野で妥当」ではなく「分野を超えて広く注目される、パラダイムを変えうる」水準を要求してください。
- 統計・再現性は完全性を求めてください。軽微な記述不足でも severity を高めに評価してください。
- 「良い研究だが、この基準では平均的」という水準の論文には overall_score を50〜65程度に厳しく採点し、70以上は本当に卓越した論文にのみ与えてください。
- major_concerns の severity は、標準的な国際誌であれば軽微（3〜4程度）とされる指摘でも、この基準では5〜7程度まで引き上げて構いません（トップジャーナルの読者・査読者が求める水準に照らして）。`,
  standard: `評価基準: ${TIER_LABELS.standard.title}。
このレビューは、分野の平均的な査読付き国際誌への投稿を想定した、現実的な基準で行ってください。
- しっかりとした方法論と明確な貢献があれば、必ずしも分野を一変させる新規性がなくても高評価をつけて構いません。
- 「良い研究であり、この基準では十分に掲載に値する」水準の論文には overall_score 70〜85程度を目安にしてください。
- 軽微な記述不足を過度に重く評価しないでください（それでも指摘自体は省略しないこと）。`,
};

const METHODS_PROMPT = `${GROUNDING_RULES}

あなたの担当は方法論・統計です。次の観点で評価してください:
- 実験デザインの妥当性（対照群の設定、交絡因子の制御）
- サンプルサイズとその根拠
- 統計手法の選択と実施の妥当性
- 再現性（手順が第三者により再現可能な粒度で記述されているか、ロット番号や機器条件などの記録）

category_scores は validity（研究の妥当性）, reproducibility（再現可能性）, statistics（統計解析）, methods（Methods章の記述の充実度）の4項目です。`;

const NOVELTY_PROMPT = `${GROUNDING_RULES}

あなたの担当は研究内容・新規性です。次の観点で評価してください:
- Novelty: 既知の知見と比べて何が新しいか
- Scientific significance: この分野にとっての意義
- 先行研究との差別化が明確に述べられているか
- 研究の深さ（表面的な観察に留まらず、機序やメカニズムまで踏み込んでいるか）
- 結論がデータの深さに見合った価値を主張しているか（誇張していないか、過小評価していないか）

category_scores は novelty（新規性）, depth（研究の深さ）の2項目です。`;

const STRUCTURE_PROMPT = `${GROUNDING_RULES}

あなたの担当は論文構成・論理展開です。次の観点で評価してください:
- Introduction / Methods / Results / Discussion がそれぞれの役割を果たしているか
- 論理展開が一貫しているか（結果が主張を支持しているか、飛躍がないか）
- 文章表現の明瞭さ
- 主張とデータの整合性（Discussionでの主張が、Resultsで示された範囲を超えていないか）
- 引用・先行研究の扱い（関連研究が十分に参照され、位置づけられているか）

category_scores は logic（論理性）, discussion（Discussionの質）, citations（引用・先行研究の扱い）の3項目です。`;

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/** Generous enough for a full manuscript; long enough that truncation is the exception. */
export const MAX_REVIEW_CHARS = 60_000;

export interface ReviewOneOptions {
  text: string;
  model?: string;
  tier?: ReviewTier;
  /**
   * Admin-editable text appended to this reviewer's base prompt (see
   * `/admin/peer-review`). Tunes emphasis and strictness; it never adds or
   * removes a category score field, since those are fixed by the JSON schema
   * below and by the report's own column shape.
   */
  rubricNotes?: string;
  /** Optional tone, chosen per run by the researcher (or randomized) - see reviewerPersonalities.ts. */
  personality?: PersonalityId | null;
}

/** Appends an admin's rubric supplement to a base prompt. Exported for testing. */
export function withRubricNotes(basePrompt: string, rubricNotes: string | undefined): string {
  const notes = rubricNotes?.trim();
  if (!notes) return basePrompt;
  return `${basePrompt}\n\n追加指示（管理者による調整）:\n${notes}`;
}

/** Appends the tier-specific strictness instructions to a base prompt. Exported for testing. */
export function withTier(basePrompt: string, tier: ReviewTier): string {
  return `${basePrompt}\n\n${TIER_INSTRUCTIONS[tier]}`;
}

/**
 * Appends the selected personality's tone instruction to a base prompt.
 * Never touches what counts as evidence or how severity/scores are judged
 * (see reviewerPersonalities.ts) - only how the same judgment is phrased.
 * Exported for testing.
 */
export function withPersonality(basePrompt: string, personality: PersonalityId | null | undefined): string {
  const p = personalityById(personality);
  if (!p) return basePrompt;
  return `${basePrompt}\n\n${p.promptInstruction}`;
}

/**
 * Every reviewer stays on the accurate tier, deliberately, even though this
 * is the single largest source of token usage in the app (three full-length
 * calls per review). Judging methodology, novelty and logical consistency is
 * exactly the kind of open-ended reasoning a cheaper model is most likely to
 * get subtly wrong - and unlike a query the researcher edits before running
 * it, a wrong peer-review verdict looks just as confident as a right one.
 */
async function reviewWith<T extends ReviewerResult>(
  role: T["reviewer"],
  system: string,
  schema: Record<string, unknown>,
  opts: ReviewOneOptions,
): Promise<StructuredResult<T>> {
  const { text } = truncate(opts.text, MAX_REVIEW_CHARS);
  const tier = opts.tier ?? "standard";
  const finalSystem = withPersonality(withRubricNotes(withTier(system, tier), opts.rubricNotes), opts.personality);
  const result = await respondStructured<Omit<T, "reviewer">>({
    model: opts.model ?? aiConfig().text,
    system: finalSystem,
    user: `論文本文:\n\n${text}`,
    schemaName: `peer_review_${role}`,
    schema,
  });
  return { ...result, data: { ...result.data, reviewer: role } as T };
}

export function reviewMethods(opts: ReviewOneOptions) {
  return reviewWith<MethodsReviewResult>("methods", METHODS_PROMPT, METHODS_SCHEMA, opts);
}
export function reviewNovelty(opts: ReviewOneOptions) {
  return reviewWith<NoveltyReviewResult>("novelty", NOVELTY_PROMPT, NOVELTY_SCHEMA, opts);
}
export function reviewStructure(opts: ReviewOneOptions) {
  return reviewWith<StructureReviewResult>("structure", STRUCTURE_PROMPT, STRUCTURE_SCHEMA, opts);
}

export interface RunFullReviewResult {
  report: PeerReviewReport;
  models: string[];
  usage: Usage;
  /** True when the manuscript text was cut down to fit the model's context. */
  truncated: boolean;
}

export interface RunFullReviewOptions {
  text: string;
  model?: string;
  /** Defaults to "standard" - see ReviewTier. */
  tier?: ReviewTier;
  /** Per-reviewer rubric supplement, keyed by role - see `/admin/peer-review`. */
  rubricNotes?: Partial<Record<ReviewerRole, string>>;
  /** Per-reviewer tone, keyed by role - chosen by the researcher per run, or randomized. */
  personalities?: Partial<Record<ReviewerRole, PersonalityId>>;
}

/**
 * Runs all three reviewers against one manuscript and combines the result.
 *
 * Sequential rather than parallel: three simultaneous long completions
 * against one API key multiplies the chance of hitting a rate limit on any
 * single review, and a paper is reviewed rarely enough that the extra
 * latency (roughly three times one call) is a reasonable trade for that
 * reliability.
 */
export async function runFullReview(opts: RunFullReviewOptions): Promise<RunFullReviewResult> {
  const { truncated } = truncate(opts.text, MAX_REVIEW_CHARS);
  const tier = opts.tier ?? "standard";

  const methods = await reviewMethods({
    text: opts.text, model: opts.model, tier,
    rubricNotes: opts.rubricNotes?.methods, personality: opts.personalities?.methods,
  });
  const novelty = await reviewNovelty({
    text: opts.text, model: opts.model, tier,
    rubricNotes: opts.rubricNotes?.novelty, personality: opts.personalities?.novelty,
  });
  const structure = await reviewStructure({
    text: opts.text, model: opts.model, tier,
    rubricNotes: opts.rubricNotes?.structure, personality: opts.personalities?.structure,
  });

  const report = aggregateReview([methods.data, novelty.data, structure.data], tier);
  const usage: Usage = {
    inputTokens: methods.usage.inputTokens + novelty.usage.inputTokens + structure.usage.inputTokens,
    outputTokens: methods.usage.outputTokens + novelty.usage.outputTokens + structure.usage.outputTokens,
    totalTokens: methods.usage.totalTokens + novelty.usage.totalTokens + structure.usage.totalTokens,
  };

  return {
    report,
    models: [methods.model, novelty.model, structure.model],
    usage,
    truncated,
  };
}
