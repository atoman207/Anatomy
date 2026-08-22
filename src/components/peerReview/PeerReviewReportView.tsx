import {
  Badge, StatTile, cx,
} from "@/components/ui";
import { ReviewerAvatar } from "@/components/peerReview/ReviewerAvatar";
import {
  CATEGORY_LABELS, REVIEWER_LABELS, scoreTone,
  type CategoryScores, type PeerReviewReport, type ReviewerResult, type ReviewerRole,
} from "@/lib/ai/peerReviewReport";
import type { ReviewerProfile } from "@/lib/ai/reviewerProfiles";

/**
 * Renders a completed peer-review report — shared by the live result panel
 * and the saved-detail page so both stay visually in step.
 */
export function PeerReviewReportView({
  report, profiles, extractedText, showText = false,
}: {
  report: PeerReviewReport;
  profiles: Record<ReviewerRole, ReviewerProfile>;
  extractedText?: string | null;
  showText?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {showText && extractedText && (
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-[12px] text-ink-2">
          {extractedText}
        </div>
      )}

      <div className="flex items-center gap-4">
        <StatTile
          label="総合評価"
          value={`${report.overallScore} / 100`}
          tone={scoreTone(report.overallScore)}
          hint={`3名の査読者スコアの平均（${report.reviewers.map((r) => r.overall_score).join(" / ")}）`}
        />
      </div>

      <CategoryScoreGrid scores={report.categoryScores} />

      <div className="flex flex-col gap-4">
        {report.reviewers.map((r) => (
          <ReviewerCard key={r.reviewer} result={r} profile={profiles[r.reviewer]} />
        ))}
      </div>
    </div>
  );
}

function CategoryScoreGrid({ scores }: { scores: CategoryScores }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {(Object.keys(CATEGORY_LABELS) as (keyof CategoryScores)[]).map((key) => {
        const score = scores[key];
        return (
          <div key={key} className="rounded-md border border-line px-3 py-2">
            <p className="text-[11px] text-ink-3">{CATEGORY_LABELS[key]}</p>
            <p className={cx("mt-0.5 text-lg font-semibold tabular-nums", {
              good: "text-good", warn: "text-warn", danger: "text-danger",
            }[scoreTone(score)])}>
              {score}
              <span className="text-[11px] font-normal text-ink-3"> / 100</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ReviewerCard({ result, profile }: { result: ReviewerResult; profile: ReviewerProfile }) {
  const { title, focus } = REVIEWER_LABELS[result.reviewer];
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <ReviewerAvatar name={profile.name} size={32} />
          <h3 className="font-serif text-[15px] font-semibold text-ink">
            {profile.name}
            <span className="font-sans text-[13px] font-normal text-ink-3"> ・ {title}（{focus}）</span>
          </h3>
        </div>
        <Badge tone={scoreTone(result.overall_score)}>{result.overall_score} / 100</Badge>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{result.summary}</p>

      {result.major_concerns.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-danger">重大な指摘</p>
          <ol className="mt-1 flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-2">
            {result.major_concerns.map((c, i) => (
              <li key={i} className="list-decimal">{c}</li>
            ))}
          </ol>
        </div>
      )}

      {result.minor_concerns.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-warn">軽微な指摘</p>
          <ul className="mt-1 flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-2">
            {result.minor_concerns.map((c, i) => (
              <li key={i} className="list-disc">{c}</li>
            ))}
          </ul>
        </div>
      )}

      {result.recommendations.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-accent">改善提案</p>
          <ul className="mt-1 flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-2">
            {result.recommendations.map((r, i) => (
              <li key={i} className="list-disc">{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
