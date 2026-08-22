/**
 * Shared catalogue for AI査読 credit packs.
 *
 * Kept free of `server-only` so the peer-review page can render the same
 * numbers the checkout action and the Stripe setup script use.
 */

export const FREE_PEER_REVIEW_CREDITS = 3;

export interface PeerReviewCreditPack {
  id: "single" | "ten" | "hundred";
  credits: number;
  amountJpy: number;
  name: string;
}

/** Mirrors the seed rows in `peer_review_credit_prices`. */
export const PEER_REVIEW_CREDIT_PACKS: PeerReviewCreditPack[] = [
  { id: "single", credits: 1, amountJpy: 50, name: "1件" },
  { id: "ten", credits: 10, amountJpy: 100, name: "10件セット" },
  { id: "hundred", credits: 100, amountJpy: 150, name: "100件セット" },
];

export function creditPackById(id: string): PeerReviewCreditPack | null {
  return PEER_REVIEW_CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

export interface PeerReviewCredits {
  freeRemaining: number;
  purchasedBalance: number;
  usedCount: number;
  totalPurchased: number;
  /** freeRemaining + purchasedBalance - what a review actually checks against. */
  remaining: number;
}
