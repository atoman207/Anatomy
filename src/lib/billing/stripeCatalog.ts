import "server-only";

import type Stripe from "stripe";
import { PLANS, type BillingInterval, type PlanId } from "./plans";
import { getStripe } from "./stripe";

/** Stripe Price id from the environment for one plan and billing cadence. */
export function stripePriceIdFromEnv(plan: PlanId, interval: BillingInterval): string | null {
  if (plan === "solo" && interval === "year") {
    return process.env.STRIPE_PRICE_SOLO || process.env.STRIPE_PRICE_FREE || null;
  }
  if (plan === "solo" && interval === "month") {
    return process.env.STRIPE_PRICE_SOLO_MONTHLY || process.env.STRIPE_PRICE_FREE_MONTHLY || null;
  }
  if (plan === "pro" && interval === "year") return process.env.STRIPE_PRICE_PRO || null;
  if (plan === "pro" && interval === "month") return process.env.STRIPE_PRICE_PRO_MONTHLY || null;
  if (plan === "team" && interval === "month") return process.env.STRIPE_PRICE_TEAM || null;
  if (plan === "team" && interval === "year") return process.env.STRIPE_PRICE_TEAM_YEARLY || null;
  return null;
}

/**
 * The one Stripe Product a plan's prices hang off.
 *
 * Same lookup order as `scripts/stripe-setup.mjs`: a deterministic id first,
 * then metadata search, then create.
 */
export async function findOrCreateStripeProduct(plan: PlanId): Promise<Stripe.Product> {
  const stripe = getStripe();
  const id = `chondro_${plan}`;
  const expectedName = `LABNOTE ${PLANS[plan].name}`;

  try {
    const existing = await stripe.products.retrieve(id);
    if (!existing.active) return stripe.products.update(id, { active: true });
    return existing.name === expectedName ? existing : stripe.products.update(id, { name: expectedName });
  } catch {
    // No product with that id yet - fall through to the search.
  }

  const search = await stripe.products.search({
    query: `metadata['chondro_plan']:'${plan}' AND active:'true'`,
    limit: 1,
  });
  const found = search.data[0];
  if (found) {
    // A product found this way predates the deterministic id above (e.g.
    // one created under an earlier product name before a rebrand) - keep
    // selling from the same object customers already subscribed against,
    // but correct the display name so it doesn't keep showing the old
    // branding on every future checkout, invoice, and receipt.
    return found.name === expectedName
      ? found
      : stripe.products.update(found.id, { name: expectedName });
  }

  return stripe.products.create({
    id,
    name: expectedName,
    metadata: { chondro_plan: plan },
  });
}

/** Finds or creates an active Stripe Price for one amount and cadence. */
export async function findOrCreateStripePrice(
  plan: PlanId,
  amountJpy: number,
  interval: BillingInterval,
): Promise<string> {
  const stripe = getStripe();
  const product = await findOrCreateStripeProduct(plan);
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = existing.data.find(
    (p) =>
      p.currency === "jpy"
      && p.unit_amount === amountJpy
      && p.recurring?.interval === interval,
  );
  if (match) return match.id;

  const created = await stripe.prices.create(
    {
      product: product.id,
      currency: "jpy",
      unit_amount: amountJpy,
      recurring: { interval },
      metadata: { chondro_plan: plan, chondro_interval: interval },
    },
    { idempotencyKey: `plan-price:${product.id}:${amountJpy}:${interval}` },
  );
  return created.id;
}

/** True when a stored Stripe Price matches the checkout amount and cadence. */
export function priceMatchesCheckout(
  price: Stripe.Price,
  amountJpy: number,
  interval: BillingInterval,
): boolean {
  return (
    price.active
    && price.currency === "jpy"
    && price.unit_amount === amountJpy
    && price.recurring?.interval === interval
  );
}
