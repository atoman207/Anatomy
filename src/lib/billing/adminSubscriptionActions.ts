"use server";

/**
 * Administering any laboratory's contract.
 *
 * Platform-admin only, and separate from `actions.ts` on purpose. Those
 * actions are scoped to a laboratory the caller owns; these are scoped to
 * every laboratory, and mixing the two would mean one `assertIsLabOwner` slip
 * away from letting an owner re-price somebody else's subscription. Every
 * export here re-checks the platform role rather than trusting the page that
 * linked in, because a `"use server"` export is an endpoint the browser can
 * call directly by name.
 *
 * Everything that changes money is written to the audit log with the
 * administrator's own id, so a plan somebody was moved onto can always be
 * traced back to who moved them.
 */

import { revalidatePath } from "next/cache";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { isPlanId, PLANS, type PlanId } from "./plans";
import { getStripe, isStripeConfigured, siteOrigin } from "./stripe";
import { resolvePriceId } from "./priceStore";
import { describeStripeError } from "./stripeAdmin";
import {
  isMockId, markSubscriptionCanceled, MOCK_ID_PREFIX, persistSubscription,
} from "./store";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function platformAdmin() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("ログインしていません。");
  if (!ctx.isPlatformAdmin) throw new Error("システム管理者のみ利用できます。");
  return ctx;
}

/** Statuses for which Stripe still holds a modifiable subscription. */
const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid"];

interface SubRow {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null;
  plan: string | null;
}

async function subscriptionRow(labId: string): Promise<SubRow | null> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("lab_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status, plan")
    .eq("lab_id", labId)
    .maybeSingle();
  return data ?? null;
}

/** True when Stripe holds a real, still-modifiable subscription for this lab. */
function hasLiveStripeSubscription(row: SubRow | null): boolean {
  return Boolean(
    row?.stripe_subscription_id &&
    !isMockId(row.stripe_subscription_id) &&
    LIVE_STATUSES.includes(row.status ?? ""),
  );
}

function refreshAdminViews() {
  revalidatePath("/admin/subscriptions");
  revalidatePath("/admin/billing");
  revalidatePath("/billing");
}

/* ------------------------------------------------------------------ */
/* Changing a plan                                                     */
/* ------------------------------------------------------------------ */

/**
 * Moves a laboratory to another plan through Stripe.
 *
 * Only touches a subscription Stripe actually holds. A laboratory with no
 * subscription cannot be moved onto a paid plan from here, because there is
 * no card to charge - Stripe would have to collect payment details, which is
 * a Checkout flow the owner has to complete themselves. Rather than silently
 * granting the plan for free, that case is refused with the reason, and
 * `grantPlanWithoutPayment` below exists for when comping it really is what
 * the administrator meant.
 *
 * Cancellation is a separate action (`adminCancelLabPlan`): every catalogue
 * plan including 個人研究者 is a paid product, so selecting it must change
 * the Stripe price rather than end the subscription.
 */
export async function adminChangeLabPlan(
  labId: string,
  plan: string,
): Promise<ActionResult<PlanId>> {
  try {
    const ctx = await platformAdmin();
    if (!labId) return { ok: false, error: "研究室が指定されていません。" };
    if (!isPlanId(plan)) return { ok: false, error: "不明なプランです。" };
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const row = await subscriptionRow(labId);
    const stripe = getStripe();

    const price = await resolvePriceId(plan);
    if (!price) {
      return {
        ok: false,
        error:
          PLANS[plan].name + "プランの価格がまだ作成されていません。" +
          "「料金設定」で価格を作成するか、npm run stripe:setup を実行してください。",
      };
    }

    if (!hasLiveStripeSubscription(row) || !row?.stripe_subscription_id) {
      return {
        ok: false,
        error:
          "この研究室には Stripe 上の有効な契約がないため、プランを変更できません。" +
          "支払い方法の登録が必要なので、研究室オーナーに申し込んでいただくか、" +
          "「手動付与」で無償付与してください。",
      };
    }

    const current = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const item = current.items.data[0];
    if (!item) {
      return { ok: false, error: "Stripe の契約に明細がありません。同期してから再度お試しください。" };
    }
    if (item.price?.id === price) {
      return { ok: false, error: "すでにこのプランです。" };
    }

    const updated = await stripe.subscriptions.update(current.id, {
      items: [{ id: item.id, price }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: { ...(current.metadata ?? {}), lab_id: labId, plan },
    });
    const stored = await persistSubscription(labId, updated);

    await logAudit({
      labId, userId: ctx.user.id, action: "billing.admin_plan_changed",
      entity: "lab_subscription", entityId: labId,
      detail: { plan, price_id: price, subscription_id: current.id },
    });
    refreshAdminViews();
    return { ok: true, data: stored };
  } catch (e) {
    return { ok: false, error: describeStripeError(e) };
  }
}

/**
 * Schedules cancellation at period end (or revokes a manual grant immediately).
 */
export async function adminCancelLabPlan(labId: string): Promise<ActionResult<PlanId>> {
  try {
    const ctx = await platformAdmin();
    if (!labId) return { ok: false, error: "研究室が指定されていません。" };
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const row = await subscriptionRow(labId);
    const stripe = getStripe();

    if (!hasLiveStripeSubscription(row) || !row?.stripe_subscription_id) {
      await markSubscriptionCanceled(labId);
      await logAudit({
        labId, userId: ctx.user.id, action: "billing.admin_grant_revoked",
        entity: "lab_subscription", entityId: labId, detail: { canceled: true },
      });
      refreshAdminViews();
      return { ok: true, data: "free" };
    }

    const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    await persistSubscription(labId, updated);
    await logAudit({
      labId, userId: ctx.user.id, action: "billing.admin_plan_canceled",
      entity: "lab_subscription", entityId: labId,
      detail: { subscription_id: row.stripe_subscription_id, at_period_end: true },
    });
    refreshAdminViews();
    return { ok: true, data: "free" };
  } catch (e) {
    return { ok: false, error: describeStripeError(e) };
  }
}

/**
 * Grants a paid plan with no payment behind it.
 *
 * A real thing administrators need - a partner laboratory, a pilot, a
 * goodwill month after an outage - and also the one operation here that
 * hands out revenue for free, so it is a separate action from
 * `adminChangeLabPlan` rather than a branch inside it. Nobody reaches this by
 * mis-clicking a plan dropdown.
 *
 * The subscription id is written with the mock prefix, which is what makes
 * these rows countable: the dashboards report them as 手動付与 instead of
 * folding them into paid conversions and overstating revenue.
 */
export async function grantPlanWithoutPayment(
  labId: string,
  plan: string,
  reason: string,
): Promise<ActionResult<PlanId>> {
  try {
    const ctx = await platformAdmin();
    if (!labId) return { ok: false, error: "研究室が指定されていません。" };
    if (!isPlanId(plan)) {
      return { ok: false, error: "付与するプランを選択してください。" };
    }
    const note = reason.trim();
    if (note.length < 3) {
      // Not bureaucracy: a free paid plan with no stated reason is
      // indistinguishable from a mistake when somebody reviews the audit log
      // six months later.
      return { ok: false, error: "付与の理由を入力してください（監査ログに記録されます）。" };
    }

    const row = await subscriptionRow(labId);
    if (hasLiveStripeSubscription(row)) {
      return {
        ok: false,
        error:
          "この研究室は Stripe で課金中です。無償付与するとその契約と食い違うため、" +
          "先に Stripe 側の契約を解約してください。",
      };
    }

    const admin = createAdminSupabase();
    const { error } = await admin.from("lab_subscriptions").upsert(
      {
        lab_id: labId,
        plan,
        status: "active",
        stripe_subscription_id: MOCK_ID_PREFIX + "grant_" + labId,
        cancel_at_period_end: false,
        current_period_end: null,
        last_event_at: new Date().toISOString(),
      },
      { onConflict: "lab_id" },
    );
    if (error) throw new Error(error.message);

    await logAudit({
      labId, userId: ctx.user.id, action: "billing.admin_plan_granted",
      entity: "lab_subscription", entityId: labId,
      detail: { plan, reason: note },
    });
    refreshAdminViews();
    return { ok: true, data: plan };
  } catch (e) {
    return { ok: false, error: describeStripeError(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Reconciling and inspecting                                          */
/* ------------------------------------------------------------------ */

/**
 * Re-reads one laboratory's subscription from Stripe and stores it.
 *
 * The webhook is the normal path; this is the repair for a delivery that was
 * missed, and the way to confirm that what the table says still matches what
 * Stripe holds.
 */
export async function adminSyncLab(labId: string): Promise<ActionResult<PlanId>> {
  try {
    await platformAdmin();
    if (!labId) return { ok: false, error: "研究室が指定されていません。" };
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const row = await subscriptionRow(labId);
    if (!row?.stripe_customer_id) {
      return { ok: false, error: "この研究室にはまだ Stripe の顧客情報がありません。" };
    }
    if (isMockId(row.stripe_customer_id)) {
      return {
        ok: false,
        error: "擬似決済で付与された契約のため、Stripe 上に同期できる情報がありません。",
      };
    }

    const stripe = getStripe();

    if (row.stripe_subscription_id && !isMockId(row.stripe_subscription_id)) {
      const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const plan = await persistSubscription(labId, sub);
      refreshAdminViews();
      return { ok: true, data: plan };
    }

    const list = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 10,
    });
    const newest = list.data.slice().sort((a, b) => b.created - a.created)[0];
    if (!newest) {
      await markSubscriptionCanceled(labId);
      refreshAdminViews();
      return { ok: true, data: "free" };
    }

    const plan = await persistSubscription(labId, newest);
    refreshAdminViews();
    return { ok: true, data: plan };
  } catch (e) {
    return { ok: false, error: describeStripeError(e) };
  }
}

/**
 * A Stripe billing-portal link for one laboratory.
 *
 * Card changes, invoices and receipts live there rather than being rebuilt
 * here. Unlike the owner-facing version this never creates a customer: an
 * administrator opening the portal for a laboratory that has never paid
 * should be told so, not have an empty Stripe customer created as a side
 * effect of looking.
 */
export async function adminBillingPortal(labId: string): Promise<ActionResult<string>> {
  try {
    await platformAdmin();
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const row = await subscriptionRow(labId);
    if (!row?.stripe_customer_id || isMockId(row.stripe_customer_id)) {
      return { ok: false, error: "この研究室には Stripe の顧客がありません。" };
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: (await siteOrigin()) + "/admin/subscriptions",
      locale: "ja",
    });
    return { ok: true, data: session.url };
  } catch (e) {
    const raw = describeStripeError(e);
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
