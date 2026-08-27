/**
 * Deciding which Stripe Price each plan is sold at, given what the database
 * and the environment each say.
 *
 * Pure and dependency-free so the precedence rule can be tested directly:
 * it decides what a customer's card is charged, and getting it backwards
 * would mean selling at a stale price with nothing visibly broken.
 */

import { PAID_PLANS, PLAN_LIST, type PlanId } from "./plans";

export interface PlanPrice {
  plan: PlanId;
  priceId: string | null;
  /** Cached from Stripe for display; null until a price exists. */
  amountJpy: number | null;
  /** Where `priceId` came from, so the admin page can say so. */
  source: "database" | "environment" | "none";
  updatedAt: string | null;
}

export type PlanPriceMap = Partial<Record<PlanId, PlanPrice>>;

/** One `plan_prices` row, narrowed to what the merge actually reads. */
export interface PlanPriceRowInput {
  plan: string;
  stripe_price_id: string | null;
  amount_jpy: number | null;
  updated_at: string | null;
}

/**
 * Merges the two sources into one price per paid plan.
 *
 * The database wins whenever it actually holds an id, because that is the
 * value an administrator set most recently through `/admin/billing`. A row
 * that exists but has no id yet - every plan starts that way - does *not*
 * shadow a working environment variable, so a deployment configured the old
 * way keeps selling at exactly the price it did before the table existed.
 */
export function mergePriceSources(
  envIds: Partial<Record<PlanId, string | undefined>>,
  rows: readonly PlanPriceRowInput[],
): PlanPriceMap {
  const map: PlanPriceMap = {};

  for (const plan of PAID_PLANS) {
    const envId = envIds[plan.id] ?? null;
    map[plan.id] = {
      plan: plan.id,
      priceId: envId,
      amountJpy: null,
      source: envId ? "environment" : "none",
      updatedAt: null,
    };
  }

  for (const row of rows) {
    const plan = row.plan as PlanId;
    if (!map[plan]) continue;
    if (!row.stripe_price_id) continue;
    map[plan] = {
      plan,
      priceId: row.stripe_price_id,
      amountJpy: row.amount_jpy,
      source: "database",
      updatedAt: row.updated_at,
    };
  }

  return map;
}

/** Builds the price-id → plan resolver the webhook path needs. */
export function planForPriceIdFrom(prices: PlanPriceMap): (priceId: string | null) => PlanId | null {
  const byPriceId = new Map<string, PlanId>();
  for (const entry of Object.values(prices)) {
    if (entry?.priceId) byPriceId.set(entry.priceId, entry.plan);
  }
  return (priceId) => (priceId ? byPriceId.get(priceId) ?? null : null);
}

/**
 * What each plan is advertised and sold at, for the customer-facing pages.
 *
 * The pricing cards used to read `PLANS[*].amountJpy` straight from the
 * catalogue, which was correct only for as long as nobody changed a price:
 * an administrator who set ¥480 at `/admin/billing` would have had the site
 * advertise ¥50 while Stripe charged ¥480. So the amount shown comes from
 * whatever Stripe actually holds whenever that is known.
 *
 * `amountJpy` can still be null for a plan configured through the old
 * environment variables - the id is known but the amount was never fetched -
 * and that is the one case where the catalogue number is used as the label.
 * `/admin/billing` offers "Stripeから再取得" to fill it in.
 *
 * `purchasable` exists so a plan with no price behind it is not offered with
 * a button that can only fail. The mock checkout sells without a Stripe price
 * at all, so it makes every plan purchasable; when Stripe keys are configured,
 * checkout creates missing prices on demand, so those plans are purchasable too.
 */
export interface PlanOffer {
  plan: PlanId;
  /** The amount to advertise: Stripe's own, or the catalogue's default. */
  amountJpy: number;
  /** True when `amountJpy` is Stripe's figure rather than the catalogue's. */
  fromStripe: boolean;
  /** False when nothing can be sold for this plan yet. */
  purchasable: boolean;
}

export type PlanOfferMap = Record<PlanId, PlanOffer>;

export function planOffers(
  prices: PlanPriceMap,
  {
    mockCheckout = false,
    stripeConfigured = false,
  }: { mockCheckout?: boolean; stripeConfigured?: boolean } = {},
): PlanOfferMap {
  const offers = {} as PlanOfferMap;

  for (const plan of PLAN_LIST) {
    const stored = prices[plan.id];
    // Ignore leftover list prices from earlier catalogues so the cards show
    // the current amounts until Stripe prices are re-created via stripe:setup.
    const staleLegacy = new Set([50, 90, 3_000, 100_000, 800_000]);
    const staleBeta =
      stored?.amountJpy != null
      && staleLegacy.has(stored.amountJpy)
      && stored.amountJpy !== plan.amountJpy;
    const amountJpy =
      stored?.amountJpy != null && !staleBeta
        ? stored.amountJpy
        : plan.amountJpy;
    offers[plan.id] = {
      plan: plan.id,
      amountJpy,
      fromStripe: stored?.amountJpy != null && !staleBeta,
      purchasable:
        plan.amountJpy > 0
        && (mockCheckout
          || stripeConfigured
          || Boolean(stored?.priceId)
          || staleBeta),
    };
  }

  return offers;
}
