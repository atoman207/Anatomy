"use server";

/**
 * Billing server actions.
 *
 * Authority: only the laboratory's owner (or a platform administrator) may
 * start a subscription, change a plan or open the billing portal. Lab admins
 * manage members and data, but spending the lab's money is the owner's
 * decision, so `assertIsLabOwner` - not `assertCanManageLab` - guards every
 * action here.
 *
 * Everything exported from a `"use server"` file is an endpoint the browser
 * can call, so each function re-derives the caller's authority from the
 * database rather than trusting the lab id it was handed. The functions that
 * write subscription state live in `store.ts`, which is not exported this way.
 */

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { assertIsLabOwner, getSessionContext, logAudit } from "@/lib/auth/guards";
import { isPlanId, PLANS, type PlanId } from "./plans";
import { getStripe, isStripeConfigured, priceIdForPlan, siteOrigin } from "./stripe";
import { ensureCustomer, isMockId, MOCK_ID_PREFIX, persistSubscription } from "./store";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Either "send the browser to Stripe" or "the change is already applied". */
export type CheckoutOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "updated"; plan: PlanId };

/** Statuses for which a subscription is modified rather than re-created. */
const LIVE_STATUSES = ["active", "trialing", "past_due"];

async function ownerContext(labId: string) {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("ログインしていません。");
  if (!labId) throw new Error("研究室が選択されていません。");
  await assertIsLabOwner(ctx, labId);
  return ctx;
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Starts a plan change.
 *
 * With no subscription yet this returns a Stripe Checkout URL. With one
 * already running it swaps the price on the existing subscription instead of
 * opening Checkout again - a second Checkout against the same customer would
 * leave the laboratory paying for two subscriptions at once, which is the kind
 * of billing bug a customer notices before you do.
 *
 * Before a Stripe account is connected, this sends the browser to the
 * in-app mock checkout at `/billing/checkout` instead - the same redirect
 * shape as a real Checkout URL, so the caller does not need to know which one
 * it got. `isStripeConfigured()` is the single switch between the two: adding
 * real keys later makes every subsequent call take the Stripe branch with no
 * other change required.
 */
export async function startCheckout(
  labId: string,
  plan: string,
): Promise<ActionResult<CheckoutOutcome>> {
  try {
    const ctx = await ownerContext(labId);

    if (!isPlanId(plan) || plan === "free") {
      return { ok: false, error: "有料プランを選択してください。" };
    }

    if (!isStripeConfigured()) {
      await logAudit({
        labId, userId: ctx.user.id, action: "billing.mock_checkout_started",
        entity: "lab_subscription", entityId: labId, detail: { plan },
      });
      return {
        ok: true,
        data: { kind: "redirect", url: `/billing/checkout?lab=${labId}&plan=${plan}` },
      };
    }

    const price = priceIdForPlan(plan);
    if (!price) {
      return {
        ok: false,
        error:
          `${PLANS[plan].name}プランの価格IDが設定されていません` +
          `（STRIPE_PRICE_${plan.toUpperCase()}）。`,
      };
    }

    const stripe = getStripe();
    const customer = await ensureCustomer(labId, ctx.email);

    const admin = createAdminSupabase();
    const { data: row } = await admin
      .from("lab_subscriptions")
      .select("stripe_subscription_id, status")
      .eq("lab_id", labId)
      .maybeSingle();

    const live =
      Boolean(row?.stripe_subscription_id) &&
      !isMockId(row?.stripe_subscription_id) &&
      LIVE_STATUSES.includes(row?.status ?? "");

    if (live && row?.stripe_subscription_id) {
      const current = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const item = current.items.data[0];
      if (item) {
        if (item.price?.id === price) {
          return { ok: false, error: "すでにこのプランをご利用中です。" };
        }
        const updated = await stripe.subscriptions.update(current.id, {
          items: [{ id: item.id, price }],
          proration_behavior: "create_prorations",
          cancel_at_period_end: false,
          metadata: { lab_id: labId, plan },
        });
        await persistSubscription(labId, updated);

        await logAudit({
          labId, userId: ctx.user.id, action: "billing.plan_changed",
          entity: "lab_subscription", entityId: labId, detail: { plan },
        });
        revalidatePath("/billing");
        return { ok: true, data: { kind: "updated", plan } };
      }
    }

    const origin = siteOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: labId,
      metadata: { lab_id: labId, plan },
      subscription_data: { metadata: { lab_id: labId, plan } },
      success_url: `${origin}/billing?checkout=success&lab=${labId}`,
      cancel_url: `${origin}/billing?checkout=cancel&lab=${labId}`,
      allow_promotion_codes: true,
      locale: "ja",
    });

    if (!session.url) {
      return { ok: false, error: "Stripe の決済ページを開けませんでした。" };
    }

    await logAudit({
      labId, userId: ctx.user.id, action: "billing.checkout_started",
      entity: "lab_subscription", entityId: labId, detail: { plan },
    });

    return { ok: true, data: { kind: "redirect", url: session.url } };
  } catch (e) {
    return { ok: false, error: message(e, "決済を開始できませんでした。") };
  }
}

/**
 * Opens the Stripe billing portal.
 *
 * Cancelling, changing the card and downloading receipts all live there
 * rather than being rebuilt here: those flows have to be right, and Stripe's
 * are already localised and PCI-scoped.
 */
export async function openBillingPortal(labId: string): Promise<ActionResult<string>> {
  try {
    const ctx = await ownerContext(labId);
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const customer = await ensureCustomer(labId, ctx.email);
    const session = await getStripe().billingPortal.sessions.create({
      customer,
      return_url: `${siteOrigin()}/billing?lab=${labId}`,
      locale: "ja",
    });

    return { ok: true, data: session.url };
  } catch (e) {
    // The portal needs a configuration saved in the Stripe dashboard. Say so,
    // rather than passing Stripe's raw error through to a researcher.
    const raw = message(e, "請求ポータルを開けませんでした。");
    if (raw.toLowerCase().includes("configuration")) {
      return {
        ok: false,
        error:
          "Stripe の請求ポータル設定が未作成です。Stripe ダッシュボードの" +
          "「設定 → 請求 → カスタマーポータル」で保存してから再度お試しください。",
      };
    }
    return { ok: false, error: raw };
  }
}

/**
 * Re-reads the subscription from Stripe and stores it.
 *
 * The webhook is the normal path. This exists for the seconds right after
 * Checkout returns, when the browser is already back on the billing page and
 * `checkout.session.completed` may not have been delivered yet - and as a
 * manual repair if a delivery was ever missed entirely.
 */
export async function syncSubscription(labId: string): Promise<ActionResult<PlanId>> {
  try {
    await ownerContext(labId);
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const admin = createAdminSupabase();
    const { data: row } = await admin
      .from("lab_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("lab_id", labId)
      .maybeSingle();

    if (!row?.stripe_customer_id) {
      return { ok: false, error: "この研究室にはまだ支払い情報がありません。" };
    }

    const stripe = getStripe();

    if (row.stripe_subscription_id) {
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const plan = await persistSubscription(labId, sub);
      revalidatePath("/billing");
      return { ok: true, data: plan };
    }

    // No subscription id stored yet, so ask Stripe what this customer has.
    // `status: "all"` rather than `active`, so one still finishing its first
    // payment is found too.
    const list = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 10,
    });
    const newest = list.data.slice().sort((a, b) => b.created - a.created)[0];

    if (!newest) {
      await admin
        .from("lab_subscriptions")
        .update({ plan: "free", status: "canceled" })
        .eq("lab_id", labId);
      revalidatePath("/billing");
      return { ok: true, data: "free" };
    }

    const plan = await persistSubscription(labId, newest);
    revalidatePath("/billing");
    return { ok: true, data: plan };
  } catch (e) {
    return { ok: false, error: message(e, "支払い状態を取得できませんでした。") };
  }
}

/**
 * Grants a plan without Stripe, from the mock checkout page.
 *
 * Refuses outright once real keys are configured, so this can never become a
 * free-upgrade path that survives into a production deployment by accident -
 * the only way to reach it is for `isStripeConfigured()` to already be false,
 * and the same check runs again here rather than trusting the page that
 * linked here.
 */
export async function completeMockCheckout(
  labId: string,
  plan: string,
): Promise<ActionResult<PlanId>> {
  try {
    const ctx = await ownerContext(labId);

    if (!isPlanId(plan) || plan === "free") {
      return { ok: false, error: "有料プランを選択してください。" };
    }
    if (isStripeConfigured()) {
      return { ok: false, error: "Stripe が接続されています。決済ページからお手続きください。" };
    }

    const admin = createAdminSupabase();
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    const { error } = await admin.from("lab_subscriptions").upsert(
      {
        lab_id: labId,
        plan,
        status: "active",
        stripe_customer_id: `${MOCK_ID_PREFIX}${randomUUID()}`,
        stripe_subscription_id: `${MOCK_ID_PREFIX}${randomUUID()}`,
        stripe_price_id: null,
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
        last_event_at: new Date().toISOString(),
      },
      { onConflict: "lab_id" },
    );
    if (error) return { ok: false, error: error.message };

    await logAudit({
      labId, userId: ctx.user.id, action: "billing.mock_checkout_completed",
      entity: "lab_subscription", entityId: labId, detail: { plan },
    });
    revalidatePath("/billing");
    return { ok: true, data: plan };
  } catch (e) {
    return { ok: false, error: message(e, "テスト決済を完了できませんでした。") };
  }
}

/** Drops a mock subscription back to free. The Stripe-connected equivalent is the billing portal. */
export async function cancelMockSubscription(labId: string): Promise<ActionResult> {
  try {
    const ctx = await ownerContext(labId);
    if (isStripeConfigured()) {
      return { ok: false, error: "Stripe が接続されています。請求ポータルから解約してください。" };
    }

    const admin = createAdminSupabase();
    const { error } = await admin
      .from("lab_subscriptions")
      .update({
        plan: "free",
        status: "canceled",
        cancel_at_period_end: false,
        last_event_at: new Date().toISOString(),
      })
      .eq("lab_id", labId);
    if (error) return { ok: false, error: error.message };

    await logAudit({
      labId, userId: ctx.user.id, action: "billing.mock_subscription_canceled",
      entity: "lab_subscription", entityId: labId,
    });
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e, "解約できませんでした。") };
  }
}
