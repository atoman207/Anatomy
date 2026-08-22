import "server-only";

/**
 * Writes credits onto an account after a completed purchase.
 *
 * Deliberately not a `"use server"` module, for the same reason as
 * `billing/store.ts`: a function that hands out spendable credits given only
 * a user id and an amount is the last thing that should be an endpoint the
 * browser can call by name. Only the Stripe webhook calls this.
 */

import { createAdminSupabase } from "@/lib/supabase/server";

/** Idempotency is the webhook's job (the `billing_events` claim), not this function's. */
export async function grantPeerReviewCredits(userId: string, credits: number): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("grant_peer_review_credits", {
    target_user: userId,
    amount: credits,
  });
  if (error) throw new Error(error.message);
}
