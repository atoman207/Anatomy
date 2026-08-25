import "server-only";

import { headers } from "next/headers";
import Stripe from "stripe";
import type { PlanId } from "./plans";

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
 * Stripe Price ids from the environment - the fallback source, not the
 * primary one.
 *
 * Which price a plan sells at now lives in `plan_prices` and is read through
 * `priceStore`, so it can be changed at `/admin/billing` without a redeploy.
 * These variables are still honoured for a deployment configured before that
 * table existed, which is why this function remains: `mergePriceSources`
 * takes what it returns and lets any id stored in the database win.
 *
 * Nothing outside `priceStore` should read these directly. A helper here that
 * answered "the price for plan X" from the environment alone would look
 * authoritative and quietly ignore whatever an administrator had set.
 */
export function stripePriceIds(): Partial<Record<PlanId, string>> {
  return {
    free: process.env.STRIPE_PRICE_FREE || undefined,
    pro: process.env.STRIPE_PRICE_PRO || undefined,
    team: process.env.STRIPE_PRICE_TEAM || undefined,
  };
}

export function isStripeConfigured(): boolean {
  return Boolean(stripeSecretKey());
}

/**
 * True on a deployed build.
 *
 * Used to shut off the mock checkout. That flow grants a paid plan with no
 * payment behind it, which is exactly what is wanted while developing and
 * exactly what must never happen on a live site - if the Stripe environment
 * variables are simply missing from the hosting dashboard, an app that
 * quietly fell back to the mock would hand every visitor a free paid
 * subscription and look like it was working.
 */
export function isProductionBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when the mock (no-payment) checkout may be used at all. */
export function isMockCheckoutAllowed(): boolean {
  return !isStripeConfigured() && !isProductionBuild();
}

export interface StripeConfigStatus {
  configured: boolean;
  /** Environment variable names that still need a value. */
  missing: string[];
  /** True while the configured key is a test-mode key (`sk_test_…`). */
  testMode: boolean;
}

/**
 * Whether the Stripe credentials are in place.
 *
 * Only covers the two secrets, which are environment-only. Whether a plan has
 * a price to sell is a separate question with a separate answer per plan -
 * that lives in `plan_prices` and is read through `priceStore`, so it is not
 * something this synchronous env-only check can report on.
 */
export function stripeConfigStatus(): StripeConfigStatus {
  const missing: string[] = [];
  const key = stripeSecretKey();
  if (!key) missing.push("STRIPE_SECRET_KEY");
  if (!stripeWebhookSecret()) missing.push("STRIPE_WEBHOOK_SECRET");
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

/** True for anything that only resolves on the machine running the server. */
function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(origin);
}

/** Best-effort origin from the proxy headers a host sets in front of the app. */
async function originFromRequest(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? "https";
    const origin = `${proto}://${host}`;
    return isLocalOrigin(origin) ? null : origin;
  } catch {
    // Called outside a request scope; the caller falls through to the error.
    return null;
  }
}

/**
 * The absolute origin Stripe should send the browser back to.
 *
 * Checkout rejects a relative URL, so this has to resolve to a real origin.
 * In production it must never resolve to localhost: `success_url` is where a
 * customer lands *after their card has been charged*, so a stale
 * `NEXT_PUBLIC_SITE_URL` from local development would take real money and
 * then strand the payer on a page that only exists on the deploy machine.
 * Rather than let that happen silently, production prefers the configured
 * value, falls back to the host headers the platform sets, and finally
 * refuses to create the session at all with an error naming the variable to
 * fix.
 */
export async function siteOrigin(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  const production = process.env.NODE_ENV === "production";

  if (configured && !(production && isLocalOrigin(configured))) return configured;

  if (!production) return configured || "http://localhost:3000";

  const derived = await originFromRequest();
  if (derived) return derived;

  throw new Error(
    "NEXT_PUBLIC_SITE_URL に公開URL（https://…）を設定してください。" +
      "未設定のままでは決済後の戻り先が正しく生成できません。",
  );
}
