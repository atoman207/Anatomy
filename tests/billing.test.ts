import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type Stripe from "stripe";

import {
  BETA_MAX_JPY, PLANS, PLAN_IDS, PLAN_LIST, PAID_PLANS, STRIPE_MIN_JPY,
  effectivePlan, formatJpy, formatUsage, isPlanId, isSubscriptionStatus,
  planOrFree, smallestPlanFor, statusGrantsAccess, withinLimit,
  type PlanId,
} from "../src/lib/billing/plans";
import {
  eventTimestamp, isFresherThan, labSubscriptionWrite, snapshotFromStripe,
} from "../src/lib/billing/sync";

/* ------------------------------------------------------------------ */
/* Plan catalogue                                                      */
/* ------------------------------------------------------------------ */

test("every plan price is a beta price: under ¥100, and never below Stripe's JPY floor", () => {
  for (const plan of PLAN_LIST) {
    assert.ok(
      plan.amountJpy < BETA_MAX_JPY,
      `${plan.id} is ¥${plan.amountJpy}, which is not under the ¥${BETA_MAX_JPY} beta ceiling`,
    );
    assert.ok(Number.isInteger(plan.amountJpy), `${plan.id} must be a whole yen amount`);
    if (plan.amountJpy > 0) {
      assert.ok(
        plan.amountJpy >= STRIPE_MIN_JPY,
        `${plan.id} is ¥${plan.amountJpy}; Stripe rejects JPY charges under ¥${STRIPE_MIN_JPY}`,
      );
    }
  }
});

test("the catalogue is internally consistent", () => {
  assert.deepEqual(PLAN_IDS, ["free", "pro", "team"]);
  for (const id of PLAN_IDS) assert.equal(PLANS[id].id, id);
  assert.deepEqual(PAID_PLANS.map((p) => p.id), ["pro", "team"]);
  // Ordered cheapest first, which is what the pricing grid and
  // smallestPlanFor() both rely on.
  const amounts = PLAN_LIST.map((p) => p.amountJpy);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => a - b));
});

test("only the paid plans include AI", () => {
  assert.equal(PLANS.free.limits.aiEnabled, false);
  assert.equal(PLANS.pro.limits.aiEnabled, true);
  assert.equal(PLANS.team.limits.aiEnabled, true);
});

test("plan ids are validated rather than trusted", () => {
  assert.ok(isPlanId("pro"));
  assert.ok(!isPlanId("enterprise"));
  assert.ok(!isPlanId(null));
  assert.equal(planOrFree("team").id, "team");
  assert.equal(planOrFree("nonsense").id, "free");
  assert.equal(planOrFree(undefined).id, "free");
});

/* ------------------------------------------------------------------ */
/* Entitlement                                                         */
/* ------------------------------------------------------------------ */

test("a paid plan survives a failed payment but not a cancellation", () => {
  // past_due is inside the retry window: Stripe is still trying the card, and
  // locking the lab out of its own records would be the worse failure.
  for (const status of ["active", "trialing", "past_due"] as const) {
    assert.ok(statusGrantsAccess(status), `${status} should still grant access`);
  }
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"] as const) {
    assert.ok(!statusGrantsAccess(status), `${status} must not grant access`);
  }
});

test("effectivePlan falls back to free whenever the subscription has lapsed", () => {
  assert.equal(effectivePlan("team", "active").id, "team");
  assert.equal(effectivePlan("team", "past_due").id, "team");
  assert.equal(effectivePlan("team", "canceled").id, "free");
  assert.equal(effectivePlan("pro", "unpaid").id, "free");
  assert.equal(effectivePlan(null, null).id, "free");
  assert.equal(effectivePlan("pro", null).id, "free");
});

test("subscription statuses are validated against Stripe's vocabulary", () => {
  assert.ok(isSubscriptionStatus("incomplete_expired"));
  assert.ok(!isSubscriptionStatus("expired"));
  assert.ok(!isSubscriptionStatus(42));
});

/* ------------------------------------------------------------------ */
/* Quotas                                                              */
/* ------------------------------------------------------------------ */

test("withinLimit matches the trigger's used >= allowed test", () => {
  assert.ok(withinLimit(0, 3));
  assert.ok(withinLimit(2, 3));
  assert.ok(!withinLimit(3, 3), "at the limit, one more must not fit");
  assert.ok(!withinLimit(4, 3));
  assert.ok(withinLimit(9999, null), "null means unlimited");
});

test("usage is rendered with the unlimited case spelled out", () => {
  assert.equal(formatUsage(3, 20), "3 / 20");
  assert.equal(formatUsage(3, null), "3 / 無制限");
  assert.equal(formatJpy(50), "¥50");
  assert.equal(formatJpy(1000), "¥1,000");
});

test("smallestPlanFor names the cheapest plan that would fit the usage", () => {
  assert.equal(smallestPlanFor(2, "maxMembers")?.id, "free");
  assert.equal(smallestPlanFor(3, "maxMembers")?.id, "pro");
  assert.equal(smallestPlanFor(50, "maxMembers")?.id, "team");
  assert.equal(smallestPlanFor(10_000, "maxExperiments")?.id, "team");
});

/* ------------------------------------------------------------------ */
/* The limits table is the authority; TypeScript only mirrors it        */
/* ------------------------------------------------------------------ */

test("plans.ts limits match the plan_limits rows seeded by migration", () => {
  const sql = readFileSync(new URL("../supabase/migrations/all.sql", import.meta.url), "utf8");

  const rowPattern =
    /\('(free|pro|team)',\s*(null|\d+),\s*(null|\d+),\s*(null|\d+),\s*(true|false)\)/g;
  const seeded = new Map<string, { members: number | null; experiments: number | null; datasets: number | null; ai: boolean }>();
  for (const m of sql.matchAll(rowPattern)) {
    const num = (v: string) => (v === "null" ? null : Number(v));
    seeded.set(m[1], {
      members: num(m[2]), experiments: num(m[3]), datasets: num(m[4]), ai: m[5] === "true",
    });
  }

  assert.equal(seeded.size, 3, "expected one seeded row per plan");
  for (const id of PLAN_IDS) {
    const row = seeded.get(id)!;
    const limits = PLANS[id].limits;
    assert.equal(limits.maxMembers, row.members, `${id}: max_members drifted`);
    assert.equal(limits.maxExperiments, row.experiments, `${id}: max_experiments drifted`);
    assert.equal(limits.maxDatasets, row.datasets, `${id}: max_datasets drifted`);
    assert.equal(limits.aiEnabled, row.ai, `${id}: ai_enabled drifted`);
  }
});

test("the SQL entitlement window matches statusGrantsAccess", () => {
  const sql = readFileSync(new URL("../supabase/migrations/all.sql", import.meta.url), "utf8");
  const match = sql.match(/s\.status in \(([^)]*)\)/);
  assert.ok(match, "lab_plan() should test the status against a list");
  const inSql = match[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  const inTs = (["active", "trialing", "past_due", "canceled", "unpaid", "paused", "incomplete", "incomplete_expired"] as const)
    .filter(statusGrantsAccess)
    .sort();
  assert.deepEqual(inSql, inTs);
});

test("the setup script charges exactly what the catalogue advertises", () => {
  const js = readFileSync(new URL("../scripts/stripe-setup.mjs", import.meta.url), "utf8");
  for (const plan of PAID_PLANS) {
    const pattern = new RegExp(`id: "${plan.id}"[^}]*amountJpy: (\\d+)`);
    const found = js.match(pattern);
    assert.ok(found, `stripe-setup.mjs has no amount for ${plan.id}`);
    assert.equal(
      Number(found[1]), plan.amountJpy,
      `${plan.id}: the script would create a price Stripe charges but the app does not show`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Stripe → row mapping                                                */
/* ------------------------------------------------------------------ */

/** Enough of a Stripe subscription for the mapping under test. */
function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    cancel_at_period_end: false,
    created: 1_700_000_000,
    metadata: { lab_id: "lab-1", plan: "pro" },
    items: {
      data: [
        { id: "si_1", price: { id: "price_pro" }, current_period_end: 1_800_000_000 },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

test("the renewal date is read from the subscription items, not the subscription", () => {
  // Stripe moved current_period_end onto the items in API version 2025-03-31;
  // reading it off the subscription root silently yields undefined.
  const snap = snapshotFromStripe(subscription());
  assert.equal(snap.currentPeriodEnd, 1_800_000_000);
});

test("with several items the latest period end wins", () => {
  const snap = snapshotFromStripe(subscription({
    items: {
      data: [
        { id: "si_1", price: { id: "price_pro" }, current_period_end: 1_800_000_000 },
        { id: "si_2", price: { id: "price_extra" }, current_period_end: 1_900_000_000 },
      ],
    },
  }));
  assert.equal(snap.currentPeriodEnd, 1_900_000_000);
});

test("a subscription with no items yields no renewal date rather than a bogus one", () => {
  const snap = snapshotFromStripe(subscription({ items: { data: [] } }));
  assert.equal(snap.currentPeriodEnd, null);
  assert.equal(snap.priceId, null);
});

test("expanded customer objects and bare ids both resolve to the id", () => {
  assert.equal(snapshotFromStripe(subscription()).customerId, "cus_123");
  assert.equal(
    snapshotFromStripe(subscription({ customer: { id: "cus_expanded" } })).customerId,
    "cus_expanded",
  );
});

test("an unrecognised status degrades to incomplete, never to an entitled one", () => {
  const snap = snapshotFromStripe(subscription({ status: "something_new" }));
  assert.equal(snap.status, "incomplete");
  assert.ok(!statusGrantsAccess(snap.status));
});

test("the price id decides the plan", () => {
  const priceToPlan = (id: string | null): PlanId | null => (id === "price_team" ? "team" : null);
  const write = labSubscriptionWrite(
    snapshotFromStripe(subscription({
      items: { data: [{ id: "si_1", price: { id: "price_team" }, current_period_end: 1_800_000_000 }] },
      metadata: { lab_id: "lab-1", plan: "pro" },
    })),
    "lab-1",
    priceToPlan,
    new Date("2026-08-20T00:00:00Z"),
  );
  // metadata says pro, the price says team: the price is what Stripe bills.
  assert.equal(write.plan, "team");
  assert.equal(write.lab_id, "lab-1");
  assert.equal(write.current_period_end, new Date(1_800_000_000 * 1000).toISOString());
  assert.equal(write.last_event_at, "2026-08-20T00:00:00.000Z");
});

test("an unknown price falls back to the metadata hint, then to free", () => {
  const none = () => null;
  const hinted = labSubscriptionWrite(
    snapshotFromStripe(subscription()), "lab-1", none, new Date(),
  );
  assert.equal(hinted.plan, "pro", "metadata.plan is the fallback");

  const blind = labSubscriptionWrite(
    snapshotFromStripe(subscription({ metadata: {} })), "lab-1", none, new Date(),
  );
  assert.equal(blind.plan, "free", "an unidentifiable subscription must not grant a paid plan");
});

/* ------------------------------------------------------------------ */
/* Webhook ordering                                                    */
/* ------------------------------------------------------------------ */

test("an out-of-order webhook delivery is discarded", () => {
  const stored = "2026-08-20T12:00:00.000Z";
  assert.ok(!isFresherThan(new Date("2026-08-20T11:59:59Z"), stored), "older event must not apply");
  assert.ok(isFresherThan(new Date("2026-08-20T12:00:00Z"), stored), "same instant still applies");
  assert.ok(isFresherThan(new Date("2026-08-20T12:00:01Z"), stored));
});

test("a laboratory with no recorded event accepts the first one", () => {
  assert.ok(isFresherThan(new Date(), null));
  assert.ok(isFresherThan(new Date(), undefined));
  assert.ok(isFresherThan(new Date(), "not a date"));
});

test("Stripe event timestamps are unix seconds", () => {
  assert.equal(eventTimestamp(1_700_000_000).toISOString(), new Date(1_700_000_000_000).toISOString());
  // A missing timestamp becomes "now" rather than 1970, which would make every
  // subsequent event look stale.
  assert.ok(eventTimestamp(null).getTime() > Date.now() - 5_000);
  assert.ok(eventTimestamp(undefined).getTime() > Date.now() - 5_000);
});
