import "server-only";

import Stripe from "stripe";
import { isPlanId, type PlanId } from "./plans";

/**
 * The Stripe client and the configuration around it.
 *
 * Server-only, and imported nowhere that can reach the browser: the secret key
 * and the price ids have no NEXT_PUBLIC_ prefix, so the bundler would fail
 * rather than ship them, but the `server-only` import makes that a build error
 * with a readable message instead of an undefined value at runtime.
 *
 * Billing is optional. With no keys configured the app behaves exactly as it
 * did before this feature existed - every laboratory is on the free plan and
 * the billing page explains what is missing - rather than erroring on boot.
 */

let cached: Stripe | null = null;

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}

/**
 * Stripe Price ids, one per paid plan.
 *
 * Prices are created in the Stripe dashboard (or by `npm run stripe:setup`)
 * rather than in code, because the amount that gets charged has to be the one
 * Stripe holds - a number in this repository could drift from it silently.
 * `PLANS[*].amountJpy` is only ever used for display.
 */
export function stripePriceIds(): Partial<Record<PlanId, string>> {
  return {
    pro: process.env.STRIPE_PRICE_PRO || undefined,
    team: process.env.STRIPE_PRICE_TEAM || undefined,
  };
}

export function priceIdForPlan(plan: PlanId): string | null {
  return stripePriceIds()[plan] ?? null;
}

/** The plan a Stripe price belongs to, or null if it is not one of ours. */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const [plan, id] of Object.entries(stripePriceIds())) {
    if (id && id === priceId && isPlanId(plan)) return plan;
  }
  return null;
}

export function isStripeConfigured(): boolean {
  return Boolean(stripeSecretKey());
}

export interface StripeConfigStatus {
  configured: boolean;
  /** Environment variable names that still need a value. */
  missing: string[];
  /** True while the configured key is a test-mode key (`sk_test_…`). */
  testMode: boolean;
}

/**
 * What is set and what is not, so the billing page can say precisely which
 * variable is missing instead of failing with a Stripe error.
 */
export function stripeConfigStatus(): StripeConfigStatus {
  const missing: string[] = [];
  const key = stripeSecretKey();
  if (!key) missing.push("STRIPE_SECRET_KEY");
  if (!stripeWebhookSecret()) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!priceIdForPlan("pro")) missing.push("STRIPE_PRICE_PRO");
  if (!priceIdForPlan("team")) missing.push("STRIPE_PRICE_TEAM");
  return {
    configured: missing.length === 0,
    missing,
    testMode: (key ?? "").startsWith("sk_test_"),
  };
}

/**
 * The shared Stripe client.
 *
 * `apiVersion` is deliberately not pinned here: the installed SDK already
 * pins the version it was generated against, and overriding it with a string
 * typed by hand is how a request starts returning fields the types say do not
 * exist. Network retries are on because every call this app makes is either
 * idempotent or carries its own idempotency key.
 */
export function getStripe(): Stripe {
  const key = stripeSecretKey();
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY が設定されていないため、決済機能は利用できません。",
    );
  }
  if (!cached) {
    cached = new Stripe(key, {
      maxNetworkRetries: 2,
      appInfo: { name: "chondro", url: "https://github.com/" },
    });
  }
  return cached;
}

/** Test seam: drops the memoised client so a changed key is picked up. */
export function resetStripeClient(): void {
  cached = null;
}

/**
 * The absolute origin Stripe should send the browser back to.
 *
 * Checkout rejects a relative URL, so this has to be configured rather than
 * inferred; the auth emails already depend on the same variable.
 */
export function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "";
  return raw.replace(/\/+$/, "") || "http://localhost:3000";
}
