import "server-only";

/**
 * Personal, pay-per-use entitlement for AI査読.
 *
 * Replaces the lab-Pro-plan gate (`requireAiAccess`) for this one feature:
 * every account gets a small free allowance, then spends a purchased balance
 * bought in packs, regardless of which laboratory (if any) it belongs to.
 * `consumePeerReviewCredit` is deliberately not exported from a `"use server"`
 * file - it is the entitlement gate itself, reachable only from
 * `/api/peer-review/analyze`, the same way `requireAiAccess` lives in
 * `subscription.ts` rather than being directly callable from the browser.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/guards";
import {
  FREE_PEER_REVIEW_CREDITS,
  PEER_REVIEW_CREDIT_PACKS,
  creditPackById,
  type PeerReviewCreditPack,
  type PeerReviewCredits,
} from "./creditPacks";

export {
  FREE_PEER_REVIEW_CREDITS,
  PEER_REVIEW_CREDIT_PACKS,
  creditPackById,
  type PeerReviewCreditPack,
  type PeerReviewCredits,
};

const DEFAULT_CREDITS: Omit<PeerReviewCredits, "remaining"> = {
  freeRemaining: FREE_PEER_REVIEW_CREDITS,
  purchasedBalance: 0,
  usedCount: 0,
  totalPurchased: 0,
};

/**
 * The signed-in caller's own balance.
 *
 * A missing row (migration not yet applied, or a very old account somehow
 * skipped the backfill) degrades to the default allowance rather than
 * throwing - the same "never block on a billing read" reasoning as
 * `getLabEntitlement`.
 */
export async function getMyPeerReviewCredits(): Promise<PeerReviewCredits> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("peer_review_credits")
    .select("free_remaining, purchased_balance, used_count, total_purchased")
    .maybeSingle();

  const row = data
    ? {
        freeRemaining: data.free_remaining,
        purchasedBalance: data.purchased_balance,
        usedCount: data.used_count,
        totalPurchased: data.total_purchased,
      }
    : DEFAULT_CREDITS;

  return { ...row, remaining: row.freeRemaining + row.purchasedBalance };
}

export type ConsumeCreditResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * The gate in front of the AI査読 route - same shape and same reasoning as
 * `requireAiAccess` for the subscription-gated AI routes (this spends money
 * per call on a third-party API key, so the check has to be authoritative),
 * but here the entitlement is a personal, depletable credit rather than a
 * plan flag: a successful call here has already spent the credit.
 */
export async function consumePeerReviewCredit(): Promise<ConsumeCreditResult> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return { ok: false, status: 401, error: "AI査読の利用にはログインが必要です。" };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("consume_peer_review_credit");
  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  if (!data) {
    return {
      ok: false,
      status: 402,
      error: "AI査読の残り回数がありません。ページ下部から追加してください。",
    };
  }
  return { ok: true };
}
