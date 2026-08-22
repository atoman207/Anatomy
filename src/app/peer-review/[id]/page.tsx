import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { PageHeader } from "@/components/shell/PageHeader";
import { PeerReviewReportView } from "@/components/peerReview/PeerReviewReportView";
import { requireUser } from "@/lib/auth/guards";
import { getPeerReview } from "@/lib/peerReview/actions";
import { getReviewerProfiles } from "@/lib/peerReview/reviewerProfileActions";
import {
  scoreTone,
  type CategoryScores,
  type PeerReviewReport,
  type ReviewerResult,
} from "@/lib/ai/peerReviewReport";

export const dynamic = "force-dynamic";

export default async function PeerReviewDetailPage(
  props: PageProps<"/peer-review/[id]">,
) {
  const { id } = await props.params;
  await requireUser(`/peer-review/${id}`);

  const [reviewRes, profiles] = await Promise.all([
    getPeerReview(id),
    getReviewerProfiles(),
  ]);

  if (!reviewRes.ok || !reviewRes.data) notFound();
  const row = reviewRes.data;

  const reviewers = row.reviewer_results as unknown as ReviewerResult[];
  const report: PeerReviewReport = {
    overallScore: Number(row.overall_score),
    categoryScores: row.category_scores as unknown as CategoryScores,
    reviewers: reviewers as PeerReviewReport["reviewers"],
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={row.title}
        description={
          <>
            {row.source_filename && <span>{row.source_filename} ・ </span>}
            {new Date(row.created_at).toLocaleString("ja-JP")}
          </>
        }
        meta={<Badge tone={scoreTone(report.overallScore)}>{report.overallScore} / 100</Badge>}
        actions={
          <>
            <Link href="/" className="text-[13px] text-accent underline underline-offset-2">
              ダッシュボード
            </Link>
            <Link href="/peer-review">
              <Button size="sm" variant="secondary">新しい査読</Button>
            </Link>
          </>
        }
      />

      <Card title="AI査読レポート">
        <PeerReviewReportView
          report={report}
          profiles={profiles}
          extractedText={row.extracted_text}
          showText
        />
      </Card>
    </div>
  );
}
