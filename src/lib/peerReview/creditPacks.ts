/**
 * Shared catalogue for AI査読 credit packs.
 *
 * Kept free of `server-only` so the peer-review page can render the same
 * numbers the checkout action and the Stripe setup script use.
 */

export const FREE_PEER_REVIEW_CREDITS = 3;

export type PeerReviewCreditPackId = "single" | "thirty" | "monthly";

export interface PeerReviewCreditPack {
  id: PeerReviewCreditPackId;
  /** Credits granted on purchase. Monthly unlimited uses a large pool. */
  credits: number;
  amountJpy: number;
  name: string;
  /** Shown with a highlighted border on the purchase cards. */
  popular?: boolean;
  /** Display/checkout: one-time pack vs monthly unlimited. */
  billingInterval: "one_time" | "month";
}

/** Mirrors the seed rows in `peer_review_credit_prices`. */
export const PEER_REVIEW_CREDIT_PACKS: PeerReviewCreditPack[] = [
  {
    id: "single",
    credits: 1,
    amountJpy: 100,
    name: "1件",
    billingInterval: "one_time",
  },
  {
    id: "thirty",
    credits: 30,
    amountJpy: 2000,
    name: "30件セット",
    popular: true,
    billingInterval: "one_time",
  },
  {
    id: "monthly",
    /** Operational stand-in for “unlimited” until true period gating ships. */
    credits: 10_000,
    amountJpy: 5000,
    name: "無制限",
    billingInterval: "month",
  },
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
