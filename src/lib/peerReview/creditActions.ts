"use server";

/**
 * Browser-facing actions for AI査読 credits.
 *
 * `getMyPeerReviewCredits` is a safe read (RLS already limits it to the
 * caller's own row); `startCreditCheckout` only ever sends the browser to a
 * Stripe-hosted page - the actual crediting happens in the webhook, once
 * Stripe confirms the card was charged, never here.
 */

import { getSessionContext, logAudit } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured, siteOrigin } from "@/lib/billing/stripe";
import { describeStripeError } from "@/lib/billing/stripeAdmin";
import { creditPackById } from "./creditPacks";
import {
  getMyPeerReviewCredits as readMyCredits,
  type PeerReviewCredits,
} from "./credits";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function message(e: unknown, fallback: string): string {
  const described = describeStripeError(e);
  return described || fallback;
}

export async function getMyPeerReviewCredits(): Promise<ActionResult<PeerReviewCredits>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  return { ok: true, data: await readMyCredits() };
}

/**
 * Starts a one-time Stripe Checkout for a credit pack.
 *
 * Unlike `startCheckout` for lab subscriptions, there is no mock-checkout
 * fallback here: the caller already confirmed a live integration, and a
 * pay-per-use credit granted for nothing is exactly the failure mode the
 * subscription mock guards against in production.
 */
export async function startCreditCheckout(packId: string): Promise<ActionResult<string>> {
  try {
    const ctx = await getSessionContext();
    if (!ctx) return { ok: false, error: "ログインしていません。" };

    const pack = creditPackById(packId);
    if (!pack) return { ok: false, error: "不明なパックです。" };

    if (!isStripeConfigured()) {
      return {
        ok: false,
        error: "決済が設定されていません（STRIPE_SECRET_KEY）。管理者にお問い合わせください。",
      };
    }

    const admin = createAdminSupabase();
    const { data: row } = await admin
      .from("peer_review_credit_prices")
      .select("stripe_price_id")
      .eq("pack_id", pack.id)
      .maybeSingle();

    if (!row?.stripe_price_id) {
      return {
        ok: false,
        error:
          `${pack.name}の価格がまだ作成されていません。` +
          "システム管理者が `npm run stripe:credits:setup` を実行してください。",
      };
    }

    const origin = await siteOrigin();
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: ctx.email,
      line_items: [{ price: row.stripe_price_id, quantity: 1 }],
      client_reference_id: ctx.user.id,
      metadata: { user_id: ctx.user.id, pack_id: pack.id, credits: String(pack.credits) },
      success_url: `${origin}/peer-review?checkout=success`,
      cancel_url: `${origin}/peer-review?checkout=cancel`,
      allow_promotion_codes: true,
      locale: "ja",
    });

    if (!session.url) {
      return { ok: false, error: "Stripe の決済ページを開けませんでした。" };
    }

    await logAudit({
      labId: null, userId: ctx.user.id, action: "peer_review_credits.checkout_started",
      entity: "peer_review_credits", entityId: ctx.user.id,
      detail: { pack_id: pack.id, credits: pack.credits, amount_jpy: pack.amountJpy },
    });

    return { ok: true, data: session.url };
  } catch (e) {
    return { ok: false, error: message(e, "決済を開始できませんでした。") };
  }
}
