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
import { isPlanId, PLANS, planAmountFor, type BillingInterval, type PlanId } from "./plans";
import { getStripe, isMockCheckoutAllowed, isStripeConfigured, siteOrigin } from "./stripe";
import { resolvePriceId, savePlanPrice } from "./priceStore";
import { describeStripeError } from "./stripeAdmin";
import {
  findOrCreateStripePrice,
  priceMatchesCheckout,
  stripePriceIdFromEnv,
} from "./stripeCatalog";
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
  if (e === null || e === undefined) return fallback;
  // Stripe's own failures get translated into something the reader can act
  // on - a bare "resource_missing" or an unexplained 401 tells a researcher
  // nothing about which knob is wrong.
  const described = describeStripeError(e);
  return described || fallback;
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
  interval?: BillingInterval,
): Promise<ActionResult<CheckoutOutcome>> {
  try {
    const ctx = await ownerContext(labId);

    if (!isPlanId(plan)) {
      return { ok: false, error: "プランを選択してください。" };
    }

    const catalogue = PLANS[plan];
    const billingInterval = interval ?? catalogue.billingInterval;
    const amountJpy = planAmountFor(catalogue, billingInterval);

    if (!isStripeConfigured()) {
      if (!isMockCheckoutAllowed()) {
        return {
          ok: false,
          error: "決済が設定されていません（STRIPE_SECRET_KEY）。管理者にお問い合わせください。",
        };
      }
      await logAudit({
        labId, userId: ctx.user.id, action: "billing.mock_checkout_started",
        entity: "lab_subscription", entityId: labId,
        detail: { plan, interval: billingInterval, amount_jpy: amountJpy },
      });
      return {
        ok: true,
        data: {
          kind: "redirect",
          url: `/billing/checkout?lab=${labId}&plan=${plan}&interval=${billingInterval}`,
        },
      };
    }

    const price = await resolveCheckoutPriceId(plan, billingInterval, amountJpy);
    if (!price) {
      return {
        ok: false,
        error:
          `${catalogue.name}プランの価格を準備できませんでした。` +
          "しばらくしてから再度お試しください。解決しない場合は管理者にお問い合わせください。",
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
          metadata: { lab_id: labId, plan, interval: billingInterval },
        });
        await persistSubscription(labId, updated);

        await logAudit({
          labId, userId: ctx.user.id, action: "billing.plan_changed",
          entity: "lab_subscription", entityId: labId,
          detail: { plan, interval: billingInterval },
        });
        revalidatePath("/billing");
        return { ok: true, data: { kind: "updated", plan } };
      }
    }

    const origin = await siteOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: labId,
      metadata: { lab_id: labId, plan, interval: billingInterval },
      subscription_data: {
        metadata: { lab_id: labId, plan, interval: billingInterval },
      },
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
      entity: "lab_subscription", entityId: labId,
      detail: { plan, interval: billingInterval },
    });

    return { ok: true, data: { kind: "redirect", url: session.url } };
  } catch (e) {
    return { ok: false, error: message(e, "決済を開始できませんでした。") };
  }
}

/**
 * Which Stripe price this checkout actually charges.
 *
 * Always charges the catalogue amount for the selected plan and interval
 * (`plans.ts` / `planAmountFor`). A stored `plan_prices` id or env fallback
 * is reused only when it already matches that amount and cadence; otherwise
 * a matching Stripe Price is found or created on the fly. That keeps checkout
 * accurate without an administrator visiting a price-settings page first.
 */
async function resolveCheckoutPriceId(
  plan: PlanId,
  interval: BillingInterval,
  amountJpy: number,
): Promise<string | null> {
  const fromEnv = stripePriceIdFromEnv(plan, interval);
  if (fromEnv) {
    try {
      const price = await getStripe().prices.retrieve(fromEnv);
      if (priceMatchesCheckout(price, amountJpy, interval)) return fromEnv;
    } catch {
      // Env id is stale or unreachable - fall through to find-or-create.
    }
  }

  if (interval === PLANS[plan].billingInterval) {
    const stored = await resolvePriceId(plan);
    if (stored) {
      try {
        const price = await getStripe().prices.retrieve(stored);
        if (priceMatchesCheckout(price, amountJpy, interval)) return stored;
      } catch {
        // Stored id is stale or unreachable - fall through to find-or-create.
      }
    }
  }

  try {
    const priceId = await findOrCreateStripePrice(plan, amountJpy, interval);

    if (interval === PLANS[plan].billingInterval) {
      try {
        await savePlanPrice(plan, priceId, amountJpy, null);
      } catch {
        // Display still works from catalogue; charging already uses priceId.
      }
    }

    return priceId;
  } catch {
    return null;
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
    const returnUrl = `${await siteOrigin()}/billing?lab=${labId}`;
    const session = await getStripe().billingPortal.sessions.create({
      customer,
      return_url: returnUrl,
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

    /*
     * A customer id written by the mock checkout is not a Stripe object.
     * Handing it to `subscriptions.list` returns "No such customer", which
     * reads like the subscription was lost rather than like the laboratory
     * was never really charged. Say what actually happened instead.
     */
    if (isMockId(row.stripe_customer_id)) {
      return {
        ok: false,
        error:
          "この研究室のプランは、Stripe 接続前の擬似決済で付与されたものです。" +
          "Stripe 上に契約が存在しないため取得できません。" +
          "改めて有料プランをお申し込みいただくと、正式な契約に切り替わります。",
      };
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
 * Guarded twice over, because this is the one function in the app that hands
 * out a paid plan for nothing: it refuses once real keys are configured, and
 * it refuses on any production build even without keys. Both checks run here
 * rather than being trusted from the page that linked in, since a
 * `"use server"` export is an endpoint the browser can call directly by name.
 */
export async function completeMockCheckout(
  labId: string,
  plan: string,
): Promise<ActionResult<PlanId>> {
  try {
    const ctx = await ownerContext(labId);

    if (!isPlanId(plan)) {
      return { ok: false, error: "プランを選択してください。" };
    }
    if (isStripeConfigured()) {
      return { ok: false, error: "Stripe が接続されています。決済ページからお手続きください。" };
    }
    if (!isMockCheckoutAllowed()) {
      return { ok: false, error: "この環境ではテスト決済を利用できません。" };
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
