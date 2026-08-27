import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server";
import { isMockId } from "@/lib/billing/store";

const PAYMENT_EVENT_TYPES = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "charge.succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
] as const;

/**
 * Real Stripe payment / subscription evidence for one laboratory.
 * Mock and complimentary grants do not count.
 * Returns a short Japanese reason when blocked, otherwise null.
 */
export async function labHasPaymentHistory(labId: string): Promise<string | null> {
  if (!labId) return null;
  const admin = createAdminSupabase();

  const { data: sub } = await admin
    .from("lab_subscriptions")
    .select("stripe_subscription_id")
    .eq("lab_id", labId)
    .maybeSingle();

  if (sub?.stripe_subscription_id && !isMockId(sub.stripe_subscription_id)) {
    return "Stripe 購読があります";
  }

  const { data: events } = await admin
    .from("billing_events")
    .select("id")
    .eq("lab_id", labId)
    .in("type", [...PAYMENT_EVENT_TYPES])
    .limit(1);

  if (events && events.length > 0) {
    return "決済イベントがあります";
  }

  return null;
}
