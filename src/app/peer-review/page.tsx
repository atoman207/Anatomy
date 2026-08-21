import { PeerReviewWorkspace } from "@/components/peerReview/PeerReviewWorkspace";
import { getReviewerProfiles } from "@/lib/peerReview/reviewerProfileActions";

export const dynamic = "force-dynamic";

/**
 * AI Peer Review.
 *
 * Names and avatars for the three reviewers are fetched here, server-side,
 * so every visitor sees the same reviewer identities the admin page last
 * saved - the workspace itself is a client component (every action ends in
 * a fetch or a redirect), but who the three reviewers are is server state,
 * not something the browser should have to ask for separately.
 */
export default async function PeerReviewPage() {
  const profiles = await getReviewerProfiles();
  return <PeerReviewWorkspace profiles={profiles} />;
}
