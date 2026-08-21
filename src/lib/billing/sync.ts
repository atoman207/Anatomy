/**
 * Translating a Stripe subscription into the row this app stores.
 *
 * Kept as pure functions over a small snapshot type rather than over
 * `Stripe.Subscription` directly, so the mapping - which is where the real
 * decisions live - can be tested without an API key or a fixture the size of a
 * webhook payload.
 *
 * The one Stripe detail worth stating out loud: as of API version
 * 2025-03-31 `current_period_end` is no longer a field on the subscription.
 * It lives on each subscription item, and a subscription with several items
 * can in principle have several. `snapshotFromStripe` takes the latest one,
 * which is the date a customer would recognise as "paid until".
 */

import type Stripe from "stripe";
import {
  isPlanId, isSubscriptionStatus, type PlanId, type SubscriptionStatus,
} from "./plans";

export interface StripeSubscriptionSnapshot {
  subscriptionId: string;
  customerId: string;
  status: SubscriptionStatus;
  priceId: string | null;
  /** Unix seconds, or null when Stripe reports no current period. */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** `metadata.lab_id`, set when the Checkout Session was created. */
  labId: string | null;
  /** `metadata.plan`, kept as a fallback when the price id is unrecognised. */
  planHint: PlanId | null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Reads the fields this app stores off a Stripe subscription.
 *
 * An unrecognised status is reported as `incomplete` rather than thrown away:
 * that is the most conservative of Stripe's values, so a status this build has
 * never heard of degrades to "not entitled" instead of silently granting a
 * plan.
 */
export function snapshotFromStripe(sub: Stripe.Subscription): StripeSubscriptionSnapshot {
  const items = sub.items?.data ?? [];

  let periodEnd: number | null = null;
  for (const item of items) {
    const end = item.current_period_end;
    if (typeof end === "number" && (periodEnd === null || end > periodEnd)) {
      periodEnd = end;
    }
  }

  const metadata = sub.metadata ?? {};
  const planHint = metadata.plan;

  return {
    subscriptionId: sub.id,
    customerId: idOf(sub.customer) ?? "",
    status: isSubscriptionStatus(sub.status) ? sub.status : "incomplete",
    priceId: idOf(items[0]?.price ?? null),
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    labId: metadata.lab_id || null,
    planHint: isPlanId(planHint) ? planHint : null,
  };
}

/** The shape written to `lab_subscriptions`. */
export interface LabSubscriptionWrite {
  lab_id: string;
  plan: PlanId;
  status: SubscriptionStatus;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_event_at: string;
}

/**
 * Builds the row for one subscription.
 *
 * `planFromPriceId` is injected rather than imported so this stays free of
 * environment access - the price → plan mapping comes from environment
 * variables, and a pure function must not read them.
 *
 * The price id decides the plan. `metadata.plan` is only a fallback for the
 * case where a price was rotated in Stripe but the subscription still refers
 * to the old id; falling back to free rather than guessing is the safe end of
 * that trade, since an under-granted plan is a support ticket and an
 * over-granted one is revenue given away silently.
 */
export function labSubscriptionWrite(
  snapshot: StripeSubscriptionSnapshot,
  labId: string,
  planFromPriceId: (priceId: string | null) => PlanId | null,
  eventAt: Date,
): LabSubscriptionWrite {
  const plan = planFromPriceId(snapshot.priceId) ?? snapshot.planHint ?? "free";
  return {
    lab_id: labId,
    plan,
    status: snapshot.status,
    stripe_customer_id: snapshot.customerId,
    stripe_subscription_id: snapshot.subscriptionId,
    stripe_price_id: snapshot.priceId,
    current_period_end:
      snapshot.currentPeriodEnd === null
        ? null
        : new Date(snapshot.currentPeriodEnd * 1000).toISOString(),
    cancel_at_period_end: snapshot.cancelAtPeriodEnd,
    last_event_at: eventAt.toISOString(),
  };
}

/**
 * Whether an incoming event is newer than what is already stored.
 *
 * Stripe does not guarantee delivery order, and a retried `subscription.updated`
 * from ten minutes ago must not overwrite a `subscription.deleted` that landed
 * since. Equal timestamps are treated as applicable so a first write, and two
 * events within the same second, are not dropped.
 */
export function isFresherThan(
  eventAt: Date,
  storedLastEventAt: string | null | undefined,
): boolean {
  if (!storedLastEventAt) return true;
  const stored = Date.parse(storedLastEventAt);
  if (Number.isNaN(stored)) return true;
  return eventAt.getTime() >= stored;
}

/** Stripe event timestamps are unix seconds. */
export function eventTimestamp(created: number | null | undefined): Date {
  if (typeof created !== "number" || !Number.isFinite(created)) return new Date();
  return new Date(created * 1000);
}
