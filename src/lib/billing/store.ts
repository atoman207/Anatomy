import "server-only";

/**
 * Writes to `lab_subscriptions`.
 *
 * Deliberately *not* a `"use server"` module. Every export of a `"use server"`
 * file becomes an endpoint the browser can call by name, and a function that
 * takes a subscription object and grants the plan it describes is the last
 * thing that should be reachable that way. Keeping it here means only server
 * code - the actions and the webhook handler - can reach it.
 */

import { createAdminSupabase } from "@/lib/supabase/server";
import type { PlanId } from "./plans";
import { getStripe } from "./stripe";
import { buildPlanForPriceId } from "./priceStore";
import { labSubscriptionWrite, snapshotFromStripe } from "./sync";

/**
 * Marks an id written by the mock checkout (`/billing/checkout`, used while
 * no Stripe account is connected yet) rather than by Stripe itself.
 *
 * Once real keys are added, `isStripeConfigured()` flips to true and every
 * function below stops treating a mock-prefixed id as a real customer or
 * subscription - a laboratory that "paid" through the mock flow gets a fresh
 * real Checkout session instead of this app trying to hand Stripe an id it
 * has never heard of.
 */
export const MOCK_ID_PREFIX = "mock_";

export function isMockId(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(MOCK_ID_PREFIX));
}

/** Writes one Stripe subscription into `lab_subscriptions`. Returns the stored plan. */
export async function persistSubscription(
  labId: string,
  subscription: Parameters<typeof snapshotFromStripe>[0],
  eventAt: Date = new Date(),
): Promise<PlanId> {
  const snapshot = snapshotFromStripe(subscription);
  const planForPriceId = await buildPlanForPriceId();
  const write = labSubscriptionWrite(snapshot, labId, planForPriceId, eventAt);

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("lab_subscriptions")
    .upsert(write, { onConflict: "lab_id" });
  if (error) throw new Error(error.message);

  return write.plan;
}

/** Drops a laboratory back to free, keeping the Stripe ids for its history. */
export async function markSubscriptionCanceled(
  labId: string,
  eventAt: Date = new Date(),
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin
    .from("lab_subscriptions")
    .update({
      plan: "free",
      status: "canceled",
      cancel_at_period_end: false,
      last_event_at: eventAt.toISOString(),
    })
    .eq("lab_id", labId);
  if (error) throw new Error(error.message);
}

/**
 * The laboratory a Stripe customer belongs to.
 *
 * Subscription metadata carries `lab_id` for everything this app creates, but
 * a subscription started from the Stripe dashboard has none - so the stored
 * customer id is the fallback route back to a laboratory.
 */
export async function labIdForCustomer(customerId: string): Promise<string | null> {
  if (!customerId) return null;
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("lab_subscriptions")
    .select("lab_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.lab_id ?? null;
}

/** `last_event_at` as stored, used to discard out-of-order webhook deliveries. */
export async function storedLastEventAt(labId: string): Promise<string | null> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("lab_subscriptions")
    .select("last_event_at")
    .eq("lab_id", labId)
    .maybeSingle();
  return data?.last_event_at ?? null;
}

/**
 * The Stripe customer for a laboratory, created on first use.
 *
 * One customer per laboratory rather than per user, so the billing history
 * follows the lab even after ownership is transferred to someone else.
 */
export async function ensureCustomer(labId: string, ownerEmail: string): Promise<string> {
  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("lab_subscriptions")
    .select("stripe_customer_id")
    .eq("lab_id", labId)
    .maybeSingle();

  if (existing?.stripe_customer_id && !isMockId(existing.stripe_customer_id)) {
    return existing.stripe_customer_id;
  }

  const { data: lab } = await admin
    .from("laboratories")
    .select("name")
    .eq("id", labId)
    .maybeSingle();

  const customer = await getStripe().customers.create({
    name: lab?.name ?? undefined,
    email: ownerEmail || undefined,
    metadata: { lab_id: labId },
  });

  const { error } = await admin
    .from("lab_subscriptions")
    .upsert({ lab_id: labId, stripe_customer_id: customer.id }, { onConflict: "lab_id" });
  if (error) throw new Error(error.message);

  return customer.id;
}
