import "server-only";

import { aiConfig, respondStructured, type StructuredResult, type Usage } from "./openai";
import {
  aggregateReview,
  type MethodsReviewResult, type NoveltyReviewResult, type PeerReviewReport,
  type ReviewerResult, type ReviewerRole, type StructureReviewResult,
} from "./peerReviewReport";

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
      major_concerns: { type: "array", items: { type: "string" } },
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
4. major_concerns には、採否判断に直結する重大な問題のみを挙げてください（例: 対照群の欠如、サンプルサイズの根拠不明、結論を支持しないデータ）。
5. recommendations は指摘に対応する具体的な行動を書いてください。「〜を改善してください」ではなく「Methodsにsample size determinationの計算根拠を追記してください」のように、著者がそのまま着手できる粒度にします。
6. summary はこの観点から見た論文の状態を2〜3文で要約してください。`;

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
  /**
   * Admin-editable text appended to this reviewer's base prompt (see
   * `/admin/peer-review`). Tunes emphasis and strictness; it never adds or
   * removes a category score field, since those are fixed by the JSON schema
   * below and by the report's own column shape.
   */
  rubricNotes?: string;
}

/** Appends an admin's rubric supplement to a base prompt. Exported for testing. */
export function withRubricNotes(basePrompt: string, rubricNotes: string | undefined): string {
  const notes = rubricNotes?.trim();
  if (!notes) return basePrompt;
  return `${basePrompt}\n\n追加指示（管理者による調整）:\n${notes}`;
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
  const result = await respondStructured<Omit<T, "reviewer">>({
    model: opts.model ?? aiConfig().text,
    system: withRubricNotes(system, opts.rubricNotes),
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
  /** Per-reviewer rubric supplement, keyed by role - see `/admin/peer-review`. */
  rubricNotes?: Partial<Record<ReviewerRole, string>>;
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

  const methods = await reviewMethods({
    text: opts.text, model: opts.model, rubricNotes: opts.rubricNotes?.methods,
  });
  const novelty = await reviewNovelty({
    text: opts.text, model: opts.model, rubricNotes: opts.rubricNotes?.novelty,
  });
  const structure = await reviewStructure({
    text: opts.text, model: opts.model, rubricNotes: opts.rubricNotes?.structure,
  });

  const report = aggregateReview([methods.data, novelty.data, structure.data]);
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
