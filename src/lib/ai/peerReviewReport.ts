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

/**
 * How strict the three reviewers should be. "top" targets the bar of a
 * Nature/Science/Cell-tier journal (near-flawless novelty, exhaustive
 * statistical rigor, broad significance); "standard" targets a typical
 * peer-reviewed international journal in the field - the same paper can
 * score very differently under each, which is the point: a researcher
 * deciding where to submit needs to know how the manuscript reads against
 * the bar of the venue they actually have in mind.
 */
export type ReviewTier = "top" | "standard";

export const TIER_LABELS: Record<ReviewTier, { title: string; description: string }> = {
  top: {
    title: "トップジャーナル基準",
    description: "Nature / Science / Cell クラスを想定した、最も厳格な基準で評価します。",
  },
  standard: {
    title: "一般的な国際誌基準",
    description: "分野の平均的な査読付き国際誌を想定した、現実的な基準で評価します。",
  },
};

/** A single weakness, numerically scored so severity can be sorted/compared rather than only read as prose. */
export interface ScoredWeakness {
  issue: string;
  /** 1 (minor) - 10 (fatal to acceptance at the selected tier). */
  severity: number;
}

interface ReviewerResultBase {
  overall_score: number;
  major_concerns: ScoredWeakness[];
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
  /** The strictness level the three reviewers were run under. */
  tier: ReviewTier;
}

/** score >= 70 solid, 50-69 needs major revision, below that reject-level — matches the reviewer prompts' own rubric. */
export function scoreTone(score: number): "good" | "warn" | "danger" {
  if (score >= 70) return "good";
  if (score >= 50) return "warn";
  return "danger";
}

/** 1-3 minor, 4-6 worth fixing, 7-10 could sink acceptance on its own. */
export function severityTone(severity: number): "good" | "warn" | "danger" {
  if (severity >= 7) return "danger";
  if (severity >= 4) return "warn";
  return "good";
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
  tier: ReviewTier = "standard",
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
  return { reviewers, categoryScores, overallScore, tier };
}

/* ------------------------------------------------------------------ */
/* Publication fit - IF range, recommended journals, acceptance odds   */
/* ------------------------------------------------------------------ */

export interface RecommendedJournal {
  name: string;
  /** The journal's typical/recent Impact Factor, when the model can name one; null if unsure rather than guessed. */
  typicalImpactFactor: number | null;
  /** Why this journal fits the manuscript's field and apparent level. */
  rationale: string;
}

export type AcceptanceLikelihood = "very_low" | "low" | "moderate" | "high";

export const ACCEPTANCE_LIKELIHOOD_LABELS: Record<AcceptanceLikelihood, string> = {
  very_low: "低い（大幅な追加実験・再構成が必要）",
  low: "やや低い（主要な指摘への対応が必要）",
  moderate: "中程度（軽微な修正で射程内）",
  high: "高い（現状でも競争力がある）",
};

/**
 * The model's estimate of where this manuscript realistically fits - not a
 * fourth reviewer judging content, but a separate reading of the same
 * report against the researcher's actual question: "where should I send
 * this, and how likely is it to get in". Always framed as an estimate (see
 * the disclaimer this ships with in the UI), since no tool can know an
 * editor's or reviewer's actual decision in advance.
 */
export interface PublicationAssessment {
  tier: ReviewTier;
  impactFactorEstimate: { min: number; max: number; rationale: string };
  recommendedJournals: RecommendedJournal[];
  acceptanceLikelihood: { rating: AcceptanceLikelihood; percentRange: string; rationale: string };
  /**
   * A specific numeric estimate for the journal the researcher actually
   * named, distinct from the generic `acceptanceLikelihood` above (which
   * applies to "a journal at roughly this level" in general). Null when no
   * target journal was supplied for the run.
   */
  targetJournal: { name: string; acceptancePercent: number; rationale: string } | null;
  summary: string;
}

/** Renders a report as Markdown, for the notebook clip and the .md export. */
export function peerReviewToMarkdown(
  report: PeerReviewReport,
  meta: {
    title: string;
    sourceFilename?: string | null;
    /** Reviewer names from `/admin/peer-review`, keyed by role. Omitted entirely when not supplied. */
    reviewerNames?: Partial<Record<ReviewerRole, string>>;
    assessment?: PublicationAssessment | null;
  } = { title: "AI査読" },
): string {
  const lines: string[] = [];
  lines.push(`# AI査読: ${meta.title}`, "");
  if (meta.sourceFilename) lines.push(`元ファイル: ${meta.sourceFilename}`, "");
  lines.push(`評価基準: ${TIER_LABELS[report.tier].title}`, "");
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
      lines.push("**重大な指摘（深刻度）**", "");
      r.major_concerns.forEach((c, i) => lines.push(`${i + 1}. ${c.issue}（深刻度: ${c.severity} / 10）`));
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

  if (meta.assessment) {
    const a = meta.assessment;
    lines.push("## 掲載可能性の評価（AIによる目安）", "");
    if (a.targetJournal) {
      lines.push(
        `**「${a.targetJournal.name}」への採択可能性: 約${a.targetJournal.acceptancePercent}%**`,
        "",
        a.targetJournal.rationale,
        "",
      );
    }
    lines.push(
      `想定IFレンジ: ${a.impactFactorEstimate.min} 〜 ${a.impactFactorEstimate.max}`,
      "",
      a.impactFactorEstimate.rationale,
      "",
    );
    if (a.recommendedJournals.length) {
      lines.push("**推奨ジャーナル**", "");
      for (const j of a.recommendedJournals) {
        const ifPart = j.typicalImpactFactor !== null ? `（IF ${j.typicalImpactFactor}）` : "";
        lines.push(`- ${j.name}${ifPart}: ${j.rationale}`);
      }
      lines.push("");
    }
    lines.push(
      `**採択可能性の目安**: ${ACCEPTANCE_LIKELIHOOD_LABELS[a.acceptanceLikelihood.rating]}` +
        `（${a.acceptanceLikelihood.percentRange}）`,
      "",
      a.acceptanceLikelihood.rationale,
      "",
      a.summary,
      "",
      "※ この評価はAIによる目安であり、実際の査読結果・採否を保証するものではありません。",
      "",
    );
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** Every major concern across the three reviewers, tagged with who raised it. */
export function allMajorConcerns(
  report: PeerReviewReport,
): { reviewer: ReviewerRole; issue: string; severity: number }[] {
  return report.reviewers.flatMap((r) =>
    r.major_concerns.map((c) => ({ reviewer: r.reviewer, issue: c.issue, severity: c.severity })),
  );
}

/** Every recommendation across the three reviewers, tagged with who raised it. */
export function allRecommendations(report: PeerReviewReport): { reviewer: ReviewerRole; text: string }[] {
  return report.reviewers.flatMap((r) => r.recommendations.map((text) => ({ reviewer: r.reviewer, text })));
}
