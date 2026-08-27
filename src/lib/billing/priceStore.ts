import "server-only";

/**
 * Which Stripe Price each paid plan sells.
 *
 * Read from `plan_prices` in the database, falling back to the
 * `STRIPE_PRICE_*` environment variables when a row has no id yet. The
 * database is the primary source deliberately: env vars have to be set
 * separately on every deployment target, so a local machine and a hosted
 * build could disagree about what a plan costs, and changing a price meant a
 * redeploy. One row read by both fixes that, and the env fallback keeps an
 * existing env-configured deployment working untouched.
 *
 * The precedence rule itself lives in `priceResolution.ts`, which is pure and
 * tested; this file only does the two reads and the one write.
 *
 * Not a `"use server"` module - the write helper here decides what customers
 * are charged, so it stays reachable only from server code.
 */

import { createAdminSupabase } from "@/lib/supabase/server";
import type { PlanId } from "./plans";
import { stripePriceIds } from "./stripe";
import {
  mergePriceSources, planForPriceIdFrom,
  type PlanPrice, type PlanPriceMap,
} from "./priceResolution";

export type { PlanPrice, PlanPriceMap };

/**
 * Every paid plan's price, database first and environment second.
 *
 * Never throws: a missing table (before the migration has run) or an
 * unreachable database degrades to whatever the environment variables say,
 * which is exactly how this worked before `plan_prices` existed.
 */
export async function getPlanPrices(): Promise<PlanPriceMap> {
  const envIds = stripePriceIds();

  try {
    const admin = createAdminSupabase();
    const { data } = await admin
      .from("plan_prices")
      .select("plan, stripe_price_id, amount_jpy, updated_at");
    return mergePriceSources(envIds, data ?? []);
  } catch {
    // Migration not applied, or no service-role key: environment only.
    return mergePriceSources(envIds, []);
  }
}

/** The Stripe price id to sell one plan with, or null when none is configured. */
export async function resolvePriceId(plan: PlanId): Promise<string | null> {
  const prices = await getPlanPrices();
  return prices[plan]?.priceId ?? null;
}

/**
 * A price-id → plan resolver, built once from the current mapping.
 *
 * `labSubscriptionWrite` needs to turn the price on an incoming Stripe
 * subscription back into a plan, and it is a pure function - so it takes a
 * resolver rather than doing the lookup itself. Building that resolver from
 * one awaited read keeps the pure function pure and still lets the mapping
 * live in the database.
 */
export async function buildPlanForPriceId(): Promise<(priceId: string | null) => PlanId | null> {
  return planForPriceIdFrom(await getPlanPrices());
}

/** Stores the price a plan is sold at. Callers must already have checked authority. */
export async function savePlanPrice(
  plan: PlanId,
  priceId: string,
  amountJpy: number | null,
  updatedBy: string | null,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin
    .from("plan_prices")
    .upsert(
      { plan, stripe_price_id: priceId, amount_jpy: amountJpy, updated_by: updatedBy },
      { onConflict: "plan" },
    );
  if (error) throw new Error(error.message);
}
