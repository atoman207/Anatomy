import "server-only";

/**
 * Reading the Stripe account for the administrator's dashboard.
 *
 * Everything here is a live read against Stripe rather than against
 * `lab_subscriptions`. That is the opposite of what `subscription.ts` does,
 * and deliberately so: entitlement checks sit on the request path and must
 * never wait on a third party, but an administrator who opened the payments
 * page is asking *about Stripe*, and a figure mirrored from a webhook minutes
 * ago is not an answer to that question.
 *
 * Every function degrades instead of throwing. A Stripe outage, a missing
 * key, or a restricted key without the right permission turns into an empty
 * result and a message on the page - an admin dashboard that 500s is worse
 * than one that says which part it could not load.
 */

import type Stripe from "stripe";
import { getStripe, isStripeConfigured } from "./stripe";
import { majorUnits, type PaymentRecord } from "./revenue";
import type { CustomerRecord, SubscriptionTotals } from "./dashboardTypes";

/**
 * How many pages of 100 to walk before giving up.
 *
 * Stripe paginates at 100, and a three-year range on a busy account is more
 * than a dashboard needs to read synchronously. Hitting this cap is reported
 * (`truncated`) rather than silently drawing a chart that is missing its
 * oldest data.
 */
const MAX_PAGES = 12;
const PAGE_SIZE = 100;

export interface StripeReadResult<T> {
  data: T;
  /** Present when the read failed; the caller shows it and carries on. */
  error: string | null;
  /** True when the page cap was reached before the range was exhausted. */
  truncated: boolean;
}

function failure<T>(empty: T, e: unknown): StripeReadResult<T> {
  return { data: empty, error: describeStripeError(e), truncated: false };
}

/**
 * A Stripe failure in words an administrator can act on.
 *
 * The raw messages are written for whoever wrote the integration, not for
 * whoever has to fix the account: a restricted key missing one permission
 * reports a bare "resource_missing", and a test key pointed at live data
 * reports nothing about modes at all. Naming the actual cause here is the
 * difference between a dashboard that says what to do and one that says
 * something went wrong.
 */
export function describeStripeError(e: unknown): string {
  const err = e as { type?: string; code?: string; message?: string; statusCode?: number } | null;
  const raw = err?.message ?? (e instanceof Error ? e.message : String(e));

  if (err?.type === "StripeAuthenticationError" || err?.statusCode === 401) {
    return "Stripe の認証に失敗しました。STRIPE_SECRET_KEY が正しいか、失効していないかを確認してください。";
  }
  if (err?.type === "StripePermissionError" || err?.statusCode === 403) {
    return "この API キーには必要な権限がありません。制限付きキーの場合は、対象リソースの読み取り権限を付与してください。";
  }
  if (err?.code === "api_key_expired") {
    return "Stripe の API キーが失効しています。ダッシュボードで新しいキーを発行してください。";
  }
  if (err?.type === "StripeConnectionError") {
    return "Stripe に接続できませんでした。ネットワークまたは Stripe 側の障害の可能性があります。";
  }
  if (err?.type === "StripeRateLimitError" || err?.statusCode === 429) {
    return "Stripe のレート制限に達しました。しばらく待ってから再度お試しください。";
  }
  return raw;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

/** The customer fields, whether Stripe expanded the object or not. */
function customerOf(charge: Stripe.Charge): {
  id: string | null;
  name: string | null;
  email: string | null;
} {
  const c = charge.customer;
  if (c && typeof c === "object" && !("deleted" in c && c.deleted)) {
    const customer = c as Stripe.Customer;
    return {
      id: customer.id,
      name: customer.name ?? charge.billing_details?.name ?? null,
      email: customer.email ?? charge.billing_details?.email ?? charge.receipt_email ?? null,
    };
  }
  return {
    id: typeof c === "string" ? c : null,
    name: charge.billing_details?.name ?? null,
    email: charge.billing_details?.email ?? charge.receipt_email ?? null,
  };
}

function paymentFromCharge(charge: Stripe.Charge): PaymentRecord {
  const { id, name, email } = customerOf(charge);
  return {
    id: charge.id,
    createdAt: charge.created * 1000,
    amount: majorUnits(charge.amount, charge.currency),
    refunded: majorUnits(charge.amount_refunded ?? 0, charge.currency),
    currency: charge.currency,
    status:
      charge.status === "succeeded" ? "succeeded" :
      charge.status === "pending" ? "pending" : "failed",
    customerId: id,
    customerName: name,
    customerEmail: email,
    description: charge.description ?? null,
    receiptUrl: charge.receipt_url ?? null,
  };
}

/**
 * Every charge created at or after `sinceMs`, newest first.
 *
 * Charges rather than invoices or payment intents: a charge is the point at
 * which money actually moved, it carries the refunded amount on the same
 * object, and it covers a one-off payment as well as a subscription invoice.
 */
export async function listPayments(sinceMs: number): Promise<StripeReadResult<PaymentRecord[]>> {
  if (!isStripeConfigured()) {
    return { data: [], error: null, truncated: false };
  }

  try {
    const stripe = getStripe();
    const payments: PaymentRecord[] = [];
    let startingAfter: string | undefined;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch: Stripe.ApiList<Stripe.Charge> = await stripe.charges.list({
        limit: PAGE_SIZE,
        created: { gte: Math.floor(sinceMs / 1000) },
        expand: ["data.customer"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const charge of batch.data) payments.push(paymentFromCharge(charge));

      if (!batch.has_more || batch.data.length === 0) break;
      startingAfter = batch.data[batch.data.length - 1].id;
      truncated = page === MAX_PAGES - 1;
    }

    return { data: payments, error: null, truncated };
  } catch (e) {
    return failure([], e);
  }
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

function cardOf(customer: Stripe.Customer): { brand: string | null; last4: string | null } {
  const pm = customer.invoice_settings?.default_payment_method;
  if (pm && typeof pm === "object" && pm.card) {
    return { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null };
  }
  const source = customer.default_source;
  if (source && typeof source === "object" && "brand" in source) {
    const card = source as Stripe.Card;
    return { brand: card.brand ?? null, last4: card.last4 ?? null };
  }
  return { brand: null, last4: null };
}

/** The most recently created customers, newest first. */
export async function listCustomers(limit = 50): Promise<StripeReadResult<CustomerRecord[]>> {
  if (!isStripeConfigured()) {
    return { data: [], error: null, truncated: false };
  }

  try {
    const stripe = getStripe();
    const batch = await stripe.customers.list({
      limit: Math.min(limit, PAGE_SIZE),
      expand: ["data.invoice_settings.default_payment_method"],
    });

    const data = batch.data.map((c) => {
      const { brand, last4 } = cardOf(c);
      const currency = c.currency ?? "jpy";
      return {
        id: c.id,
        name: c.name ?? null,
        email: c.email ?? null,
        createdAt: c.created * 1000,
        cardBrand: brand,
        cardLast4: last4,
        delinquent: Boolean(c.delinquent),
        balance: majorUnits(c.balance ?? 0, currency),
        currency,
        labId: typeof c.metadata?.lab_id === "string" ? c.metadata.lab_id : null,
      } satisfies CustomerRecord;
    });

    return { data, error: null, truncated: batch.has_more };
  } catch (e) {
    return failure([], e);
  }
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

const EMPTY_TOTALS: SubscriptionTotals = {
  active: 0, trialing: 0, pastDue: 0, canceled: 0, mrr: 0, currency: "jpy",
};

/**
 * Live subscription counts and monthly recurring revenue.
 *
 * MRR is computed from what Stripe holds rather than from the plan catalogue,
 * because a subscriber grandfathered on an old price still pays the old
 * amount - which is exactly the number that would be wrong if this read the
 * current price instead.
 *
 * Annual and weekly intervals are normalised to a monthly figure so the total
 * is comparable; a subscription in a currency other than the account's first
 * one is counted but not added to the total, since summing across currencies
 * would produce a number that means nothing.
 */
export async function subscriptionTotals(): Promise<StripeReadResult<SubscriptionTotals>> {
  if (!isStripeConfigured()) {
    return { data: EMPTY_TOTALS, error: null, truncated: false };
  }

  try {
    const stripe = getStripe();
    const totals: SubscriptionTotals = { ...EMPTY_TOTALS };
    let currency: string | null = null;
    let startingAfter: string | undefined;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list({
        limit: PAGE_SIZE,
        status: "all",
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of batch.data) {
        if (sub.status === "active") totals.active += 1;
        else if (sub.status === "trialing") totals.trialing += 1;
        else if (sub.status === "past_due" || sub.status === "unpaid") totals.pastDue += 1;
        else if (sub.status === "canceled") totals.canceled += 1;

        if (sub.status !== "active" && sub.status !== "trialing") continue;

        for (const item of sub.items.data) {
          const price = item.price;
          if (!price?.unit_amount || !price.recurring) continue;
          currency ??= price.currency;
          if (price.currency !== currency) continue;

          const perMonth = monthlyEquivalent(
            majorUnits(price.unit_amount, price.currency),
            price.recurring.interval,
            price.recurring.interval_count ?? 1,
          );
          totals.mrr += perMonth * (item.quantity ?? 1);
        }
      }

      if (!batch.has_more || batch.data.length === 0) break;
      startingAfter = batch.data[batch.data.length - 1].id;
      truncated = page === MAX_PAGES - 1;
    }

    totals.currency = currency ?? "jpy";
    totals.mrr = Math.round(totals.mrr);
    return { data: totals, error: null, truncated };
  } catch (e) {
    return failure(EMPTY_TOTALS, e);
  }
}

/** One billing period's amount, expressed per month. */
function monthlyEquivalent(
  amount: number,
  interval: Stripe.Price.Recurring.Interval,
  intervalCount: number,
): number {
  const perInterval = amount / Math.max(intervalCount, 1);
  switch (interval) {
    case "day": return perInterval * 30;
    case "week": return perInterval * (52 / 12);
    case "year": return perInterval / 12;
    default: return perInterval;
  }
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Creates a customer, the way the "Add customer" button on Stripe's own
 * customers page does.
 *
 * Kept deliberately minimal - a name and an email. Stripe's dialog carries a
 * dozen more fields (address, tax ids, shipping), and reproducing them here
 * would be a worse version of a form that already exists one click away, so
 * the panel links out for the rest.
 */
export async function createCustomer(
  name: string,
  email: string,
): Promise<{ id: string }> {
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: name.trim() || undefined,
    email: email.trim(),
    metadata: { created_via: "chondro_admin" },
  });
  return { id: customer.id };
}

/* ------------------------------------------------------------------ */
/* Dashboard links                                                     */
/* ------------------------------------------------------------------ */

/**
 * A deep link into the Stripe dashboard for the same object.
 *
 * Test-mode objects live under `/test/`, and a link that drops that prefix
 * lands on a live-mode page showing "not found" - which reads as data loss
 * rather than as a wrong URL.
 */
export function stripeDashboardUrl(path: string, testMode: boolean): string {
  const clean = path.replace(/^\/+/, "");
  return "https://dashboard.stripe.com/" + (testMode ? "test/" : "") + clean;
}
