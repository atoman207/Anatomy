"use server";

/**
 * The administrator's view of what the Stripe account is doing.
 *
 * Platform-admin only. These reads expose every customer's email and every
 * payment on the account, which is the whole point of the page and also
 * exactly why a laboratory owner must not reach it - the guard is the same
 * one `/admin/users` uses.
 *
 * The whole dashboard is assembled by one action rather than by several, so
 * every figure on the page comes from the same instant. Fetching the chart
 * and the customer table separately would let a payment land between the two
 * calls and show a total that does not match the rows under it.
 */

import { revalidatePath } from "next/cache";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { stripeConfigStatus } from "./stripe";
import { isMockId } from "./store";
import {
  bucketPayments, defaultGranularityFor, isGranularity, isRangeDays,
  recentPayingCustomers, summariseRevenue,
  type Granularity, type PaymentRecord,
} from "./revenue";
import {
  createCustomer, describeStripeError, listCustomers, listPayments, subscriptionTotals,
} from "./stripeAdmin";
import type { BillingDashboardData, PlanDistribution } from "./dashboardTypes";

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** How the laboratories in this deployment are provisioned right now. */
async function planDistribution(): Promise<PlanDistribution> {
  const empty: PlanDistribution = {
    free: 0, pro: 0, team: 0, atRisk: 0, mock: 0, labs: 0, members: 0, users: 0,
  };

  try {
    const admin = createAdminSupabase();
    const [subs, labs, members, users] = await Promise.all([
      admin.from("lab_subscriptions").select("plan, status, stripe_subscription_id"),
      admin.from("laboratories").select("id", { count: "exact", head: true }),
      admin.from("lab_members").select("lab_id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }),
    ]);

    const out = {
      ...empty,
      labs: labs.count ?? 0,
      members: members.count ?? 0,
      users: users.count ?? 0,
    };

    for (const row of subs.data ?? []) {
      const entitled =
        row.status === "active" || row.status === "trialing" || row.status === "past_due";
      if (entitled && row.plan === "free" && row.stripe_subscription_id) out.free += 1;
      else if (entitled && row.plan === "pro") out.pro += 1;
      else if (entitled && row.plan === "team") out.team += 1;

      if (row.status === "past_due" || row.status === "unpaid") out.atRisk += 1;
      // A paid plan with no real Stripe object behind it: granted by the
      // in-app mock checkout, or comped by an administrator. Worth counting
      // separately, because it is entitlement the revenue chart never shows.
      if (entitled && isMockId(row.stripe_subscription_id)) {
        out.mock += 1;
      }
    }

    return out;
  } catch {
    return empty;
  }
}

/**
 * One snapshot of the billing dashboard.
 *
 * Never throws for a Stripe problem: each read reports its own failure and
 * the page renders what it could get, with the rest named in `notices`. An
 * empty chart and an unreadable chart look identical, so the difference has
 * to be stated rather than implied.
 */
export async function loadBillingDashboard(
  rangeDays: number,
  granularity: string,
): Promise<ActionResult<BillingDashboardData>> {
  try {
    await platformAdmin();

    const days = isRangeDays(rangeDays) ? rangeDays : 30;
    const grain: Granularity = isGranularity(granularity)
      ? granularity
      : defaultGranularityFor(days);

    const now = Date.now();
    const from = now - days * DAY_MS;
    const status = stripeConfigStatus();

    const [payments, customers, subs, plans] = await Promise.all([
      listPayments(from),
      listCustomers(50),
      subscriptionTotals(),
      planDistribution(),
    ]);

    const notices: string[] = [];
    if (status.missing.length > 0) {
      notices.push(
        "Stripe の設定が未完了です（" + status.missing.join(", ") + "）。",
      );
    }
    if (payments.error) notices.push("決済履歴を取得できませんでした: " + payments.error);
    if (customers.error) notices.push("顧客一覧を取得できませんでした: " + customers.error);
    if (subs.error) notices.push("サブスクリプションを取得できませんでした: " + subs.error);
    if (payments.truncated) {
      notices.push(
        "決済件数が多いため、期間の一部のみを集計しています。期間を短くすると全件になります。",
      );
    }

    const succeeded = payments.data.filter((p) => p.status === "succeeded");
    const buckets = bucketPayments(payments.data, grain, from, now, now);

    return {
      ok: true,
      data: {
        generatedAt: now,
        rangeDays: days,
        granularity: grain,
        buckets,
        summary: summariseRevenue(buckets),
        recentCustomers: recentPayingCustomers(payments.data, 8),
        recentPayments: sortNewestFirst(payments.data).slice(0, 12),
        customers: customers.data,
        subscriptions: subs.data,
        plans,
        currency: succeeded[0]?.currency ?? subs.data.currency,
        failedCount: payments.data.filter((p) => p.status === "failed").length,
        testMode: status.testMode,
        notices,
      },
    };
  } catch (e) {
    return { ok: false, error: describeStripeError(e) };
  }
}

function sortNewestFirst(payments: readonly PaymentRecord[]): PaymentRecord[] {
  return [...payments].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Creates a Stripe customer, behind the "Add customer" button.
 *
 * The same operation the button performs on Stripe's own customers page. It
 * creates a billing record only - no charge, no subscription - so the worst
 * outcome of a mistake is an unused customer object, which is why this is
 * offered inline rather than sending the administrator to the dashboard.
 */
export async function addStripeCustomer(
  name: string,
  email: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await platformAdmin();

    const trimmedEmail = email.trim();
    // Deliberately loose. Stripe is the authority on whether it will accept an
    // address; this only catches the obvious empty or malformed case before
    // spending a round trip on it.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return { ok: false, error: "メールアドレスの形式が正しくありません。" };
    }
    // Only the secret key matters here. `configured` also covers the webhook
    // secret, which creating a customer does not need, so testing that would
    // refuse a request Stripe would have accepted.
    if (stripeConfigStatus().missing.includes("STRIPE_SECRET_KEY")) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const created = await createCustomer(name, trimmedEmail);

    await logAudit({
      labId: null, userId: ctx.user.id, action: "billing.customer_created",
      entity: "stripe_customer", entityId: created.id,
      detail: { email: trimmedEmail, name: name.trim() || null },
    });

    revalidatePath("/admin/billing");
    return { ok: true, data: created };
  } catch (e) {
    return { ok: false, error: describeStripeError(e) };
  }
}
