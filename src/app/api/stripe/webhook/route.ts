import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { logAudit } from "@/lib/auth/guards";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured, stripeWebhookSecret } from "@/lib/billing/stripe";
import {
  labIdForCustomer, markSubscriptionCanceled, persistSubscription, storedLastEventAt,
} from "@/lib/billing/store";
import { eventTimestamp, isFresherThan } from "@/lib/billing/sync";
import { grantPeerReviewCredits } from "@/lib/peerReview/creditsStore";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook.
 *
 * This is the only writer of `lab_subscriptions` that runs without a signed-in
 * user, so it defends itself on three fronts:
 *
 * 1. **Signature.** The raw body is verified against `STRIPE_WEBHOOK_SECRET`
 *    before it is parsed. Nothing is read out of an unverified payload - the
 *    endpoint is public, and without this anyone could post themselves a
 *    subscription.
 * 2. **Idempotency.** Stripe retries deliveries, and will send the same event
 *    twice given the chance. Each event id is inserted into `billing_events`
 *    first; a duplicate key means "already handled" and the handler stops.
 * 3. **Ordering.** Deliveries are not ordered. Each write records the event's
 *    own timestamp, and an event older than what is stored is discarded rather
 *    than applied - otherwise a retried `updated` from ten minutes ago would
 *    resurrect a subscription that has since been cancelled.
 *
 * A 200 is returned for anything that is not a transient server fault,
 * including events this build ignores, so Stripe does not retry deliveries
 * that will never succeed.
 */

/** The events that change entitlement. Anything else is recorded and ignored. */
const HANDLED = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function POST(request: Request) {
  const secret = stripeWebhookSecret();
  if (!isStripeConfigured() || !secret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature." }, { status: 400 });
  }

  // Must be the exact bytes Stripe signed, so the body is read as text and
  // never as JSON before verification.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: `Signature verification failed: ${detail}` }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const at = eventTimestamp(event.created);

  // Claim the event before doing any work. A duplicate delivery loses the race
  // on the primary key and returns without touching subscription state.
  const { error: claimError } = await admin.from("billing_events").insert({
    id: event.id,
    type: event.type,
    payload: { object: event.data.object } as unknown as Json,
  });
  if (claimError) {
    if (claimError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Recording failed for some other reason - let Stripe retry rather than
    // processing an event we cannot mark as seen.
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    const { labId, userId } = await handleEvent(event, at);
    if (labId || userId) {
      await admin.from("billing_events").update({ lab_id: labId, user_id: userId }).eq("id", event.id);
    }
    return NextResponse.json({ received: true, labId: labId ?? null, userId: userId ?? null });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    // Delete the claim so Stripe's retry is allowed to try again.
    await admin.from("billing_events").delete().eq("id", event.id);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}

interface EventEffect {
  labId: string | null;
  userId: string | null;
}

const NO_EFFECT: EventEffect = { labId: null, userId: null };

/** Applies one verified event. Returns who/what it affected, if anything. */
async function handleEvent(event: Stripe.Event, at: Date): Promise<EventEffect> {
  const stripe = getStripe();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      // A credit-pack purchase: one-time payment, identified by the buyer's
      // user id rather than by a laboratory. Handled separately from the
      // subscription branch below because it has no `session.subscription`
      // to retrieve.
      if (session.mode === "payment") {
        const userId = session.metadata?.user_id || session.client_reference_id || null;
        const credits = Number(session.metadata?.credits ?? 0);
        if (!userId || !Number.isFinite(credits) || credits <= 0) {
          return { labId: null, userId };
        }

        await grantPeerReviewCredits(userId, credits);

        await logAudit({
          labId: null, userId, action: "peer_review_credits.purchased",
          entity: "peer_review_credits", entityId: userId,
          detail: {
            pack_id: session.metadata?.pack_id ?? null,
            credits,
            session_id: session.id,
          },
        });
        return { labId: null, userId };
      }

      const labId =
        session.metadata?.lab_id ||
        session.client_reference_id ||
        (await labIdForCustomer(customerIdOf(session.customer)));
      const subscriptionId = idOf(session.subscription);
      if (!labId || !subscriptionId) return { labId: labId ?? null, userId: null };

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await applySubscription(labId, subscription, at);

      await logAudit({
        labId, userId: null, action: "billing.checkout_completed",
        entity: "lab_subscription", entityId: labId,
        detail: { subscription_id: subscriptionId },
      });
      return { labId, userId: null };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const labId =
        subscription.metadata?.lab_id ||
        (await labIdForCustomer(customerIdOf(subscription.customer)));
      if (!labId) return NO_EFFECT;
      await applySubscription(labId, subscription, at);
      return { labId, userId: null };
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const labId =
        subscription.metadata?.lab_id ||
        (await labIdForCustomer(customerIdOf(subscription.customer)));
      if (!labId) return NO_EFFECT;
      if (!isFresherThan(at, await storedLastEventAt(labId))) return { labId, userId: null };

      await markSubscriptionCanceled(labId, at);
      await logAudit({
        labId, userId: null, action: "billing.subscription_canceled",
        entity: "lab_subscription", entityId: labId,
        detail: { subscription_id: subscription.id },
      });
      return { labId, userId: null };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const labId = await labIdForCustomer(customerIdOf(invoice.customer));
      if (!labId) return NO_EFFECT;
      // The status change itself arrives as customer.subscription.updated;
      // this only records that a payment failed, so it is visible in the audit
      // trail rather than only in Stripe.
      await logAudit({
        labId, userId: null, action: "billing.payment_failed",
        entity: "lab_subscription", entityId: labId,
        detail: { invoice_id: invoice.id, amount_due: invoice.amount_due },
      });
      return { labId, userId: null };
    }

    default:
      return NO_EFFECT;
  }
}

async function applySubscription(
  labId: string,
  subscription: Stripe.Subscription,
  at: Date,
): Promise<void> {
  if (!isFresherThan(at, await storedLastEventAt(labId))) return;
  await persistSubscription(labId, subscription, at);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function customerIdOf(value: Stripe.Checkout.Session["customer"]): string {
  return idOf(value as string | { id: string } | null) ?? "";
}
