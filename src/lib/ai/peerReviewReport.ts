/**
 * The AI peer review report shape and the pure functions over it.
 *
 * Deliberately not `server-only`, unlike `peerReview.ts` next to it: this
 * file has no dependency on the OpenAI client or an API key, and the
 * peer-review page needs it directly in the browser to render the report,
 * build the notebook clip and build the .md export. Splitting the report
 * shape out from the model-calling code is the same pattern
 * `notebook/templateFields.ts` uses for the same reason - a "use server"
 * (or here, `server-only`) file may only export things a server context can
 * see, and a plain module is how the rest of the app reaches the parts that
 * are safe anywhere.
 */

export type ReviewerRole = "methods" | "novelty" | "structure";

interface ReviewerResultBase {
  overall_score: number;
  major_concerns: string[];
  minor_concerns: string[];
  recommendations: string[];
  summary: string;
}

/** 実験デザイン・サンプル数・統計手法・Control設定・再現性。 */
export interface MethodsReviewResult extends ReviewerResultBase {
  reviewer: "methods";
  category_scores: {
    validity: number;
    reproducibility: number;
    statistics: number;
    methods: number;
  };
}

/** Novelty・Scientific significance・先行研究との差・研究の深さ・結論の価値。 */
export interface NoveltyReviewResult extends ReviewerResultBase {
  reviewer: "novelty";
  category_scores: {
    novelty: number;
    depth: number;
  };
}

/** Introduction/Methods/Results/Discussion の論理展開・書き方・主張とデータの整合性。 */
export interface StructureReviewResult extends ReviewerResultBase {
  reviewer: "structure";
  category_scores: {
    logic: number;
    discussion: number;
    citations: number;
  };
}

export type ReviewerResult = MethodsReviewResult | NoveltyReviewResult | StructureReviewResult;

/** The nine named scores shown in the summary table, one union of the three reviewers' categories. */
export interface CategoryScores {
  novelty: number;
  validity: number;
  depth: number;
  logic: number;
  reproducibility: number;
  statistics: number;
  methods: number;
  discussion: number;
  citations: number;
}

export const CATEGORY_LABELS: Record<keyof CategoryScores, string> = {
  novelty: "新規性",
  validity: "研究の妥当性",
  depth: "研究の深さ",
  logic: "論理性",
  reproducibility: "再現可能性",
  statistics: "統計解析",
  methods: "方法",
  discussion: "考察",
  citations: "引用・先行研究",
};

export const REVIEWER_LABELS: Record<ReviewerRole, { title: string; focus: string }> = {
  methods: { title: "査読者1", focus: "方法・統計担当" },
  novelty: { title: "査読者2", focus: "研究内容・新規性担当" },
  structure: { title: "査読者3", focus: "論文構成・論理担当" },
};

export interface PeerReviewReport {
  reviewers: [MethodsReviewResult, NoveltyReviewResult, StructureReviewResult];
  categoryScores: CategoryScores;
  /** Average of the three reviewers' overall_score, rounded to the nearest integer. */
  overallScore: number;
}

/** score >= 70 solid, 50-69 needs major revision, below that reject-level — matches the reviewer prompts' own rubric. */
export function scoreTone(score: number): "good" | "warn" | "danger" {
  if (score >= 70) return "good";
  if (score >= 50) return "warn";
  return "danger";
}

/**
 * Combines the three reviewers' results into one report.
 *
 * Pure and deterministic on purpose: the overall score is an arithmetic mean
 * computed here, not a fourth model call asked to "summarize the three
 * scores" - a number a researcher can recompute by hand from the three
 * reviewer scores next to it is more trustworthy than one only the model can
 * explain.
 */
export function aggregateReview(
  reviewers: [MethodsReviewResult, NoveltyReviewResult, StructureReviewResult],
): PeerReviewReport {
  const [methods, novelty, structure] = reviewers;
  const categoryScores: CategoryScores = {
    ...methods.category_scores,
    ...novelty.category_scores,
    ...structure.category_scores,
  };
  const overallScore = Math.round(
    (methods.overall_score + novelty.overall_score + structure.overall_score) / 3,
  );
  return { reviewers, categoryScores, overallScore };
}

/** Renders a report as Markdown, for the notebook clip and the .md export. */
export function peerReviewToMarkdown(
  report: PeerReviewReport,
  meta: {
    title: string;
    sourceFilename?: string | null;
    /** Reviewer names from `/admin/peer-review`, keyed by role. Omitted entirely when not supplied. */
    reviewerNames?: Partial<Record<ReviewerRole, string>>;
  } = { title: "AI査読" },
): string {
  const lines: string[] = [];
  lines.push(`# AI査読: ${meta.title}`, "");
  if (meta.sourceFilename) lines.push(`元ファイル: ${meta.sourceFilename}`, "");
  lines.push(`**総合評価: ${report.overallScore} / 100**`, "");

  lines.push("## カテゴリ別評価", "");
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const score = report.categoryScores[key as keyof CategoryScores];
    lines.push(`- ${label}: ${score} / 100`);
  }
  lines.push("");

  lines.push("## 査読者別評価", "");
  for (const r of report.reviewers) {
    const { title, focus } = REVIEWER_LABELS[r.reviewer];
    const name = meta.reviewerNames?.[r.reviewer];
    const heading = name ? `${title}: ${name}（${focus}）` : `${title}（${focus}）`;
    lines.push(`### ${heading} — ${r.overall_score} / 100`, "");
    lines.push(r.summary, "");
    if (r.major_concerns.length) {
      lines.push("**重大な指摘**", "");
      r.major_concerns.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
      lines.push("");
    }
    if (r.minor_concerns.length) {
      lines.push("**軽微な指摘**", "");
      for (const c of r.minor_concerns) lines.push(`- ${c}`);
      lines.push("");
    }
    if (r.recommendations.length) {
      lines.push("**改善提案**", "");
      for (const rec of r.recommendations) lines.push(`- ${rec}`);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** Every major concern across the three reviewers, tagged with who raised it. */
export function allMajorConcerns(report: PeerReviewReport): { reviewer: ReviewerRole; text: string }[] {
  return report.reviewers.flatMap((r) => r.major_concerns.map((text) => ({ reviewer: r.reviewer, text })));
}

/** Every recommendation across the three reviewers, tagged with who raised it. */
export function allRecommendations(report: PeerReviewReport): { reviewer: ReviewerRole; text: string }[] {
  return report.reviewers.flatMap((r) => r.recommendations.map((text) => ({ reviewer: r.reviewer, text })));
}
