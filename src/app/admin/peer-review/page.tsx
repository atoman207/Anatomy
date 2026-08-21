import { PageHeader } from "@/components/shell/PageHeader";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { ReviewerProfileEditor } from "@/components/admin/ReviewerProfileEditor";
import { getReviewerProfiles } from "@/lib/peerReview/reviewerProfileActions";

export const dynamic = "force-dynamic";

/**
 * Names and scoring rubric for the three AI Peer Review reviewers.
 *
 * Platform-admin only, the same as `/admin/users`: these three identities
 * are shared by every laboratory, not something a lab admin tunes for their
 * own lab.
 */
export default async function AdminPeerReviewPage() {
  await requirePlatformAdmin("/admin/peer-review");
  const profiles = await getReviewerProfiles();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AI査読者"
        description="AI査読の3名の名前と採点ルーブリックを編集します。研究室ごとではなく、デプロイ全体で共有されます。"
      />
      <ReviewerProfileEditor profiles={profiles} />
    </div>
  );
}
