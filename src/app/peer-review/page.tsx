import { Suspense } from "react";
import { PeerReviewWorkspace } from "@/components/peerReview/PeerReviewWorkspace";
import { getReviewerProfiles } from "@/lib/peerReview/reviewerProfileActions";
import { listRecentPeerReviews } from "@/lib/peerReview/actions";

export const dynamic = "force-dynamic";

/**
 * AI Peer Review.
 *
 * Names and avatars for the three reviewers are fetched here, server-side,
 * so every visitor sees the same reviewer identities the admin page last
 * saved - the workspace itself is a client component (every action ends in
 * a fetch or a redirect), but who the three reviewers are is server state,
 * not something the browser should have to ask for separately.
 *
 * Recent saved reviews are also loaded here so the history panel can render
 * immediately; new runs append via savePeerReview on the client.
 *
 * Suspense wraps the workspace because it reads checkout query params via
 * `useSearchParams`.
 */
export default async function PeerReviewPage() {
  const [profiles, historyRes] = await Promise.all([
    getReviewerProfiles(),
    listRecentPeerReviews(30),
  ]);
  return (
    <Suspense fallback={<p className="text-sm text-ink-3">読み込み中…</p>}>
      <PeerReviewWorkspace
        profiles={profiles}
        initialHistory={historyRes.data ?? []}
      />
    </Suspense>
  );
}
