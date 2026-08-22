import "server-only";

/**
 * Every laboratory's contract, for the administrator.
 *
 * The user-facing `/billing` page answers "what is *my* laboratory on"; this
 * answers "what is every laboratory on", which is a different query and a
 * different authority level. Keeping them apart is the point: an
 * administrator should never have to sign in as an owner, pick a lab from a
 * dropdown, and read one row at a time to find the three labs whose card
 * expired.
 *
 * Reads the local mirror rather than Stripe. That is deliberate here even
 * though the payments dashboard does the opposite: this is a list of *every*
 * laboratory, and one Stripe round trip per row would take seconds and hit
 * rate limits. Each row carries its Stripe ids so a single lab can be
 * reconciled on demand, which is what the 同期 action does.
 */

import { createAdminSupabase } from "@/lib/supabase/server";
import {
  effectivePlan, isPlanId, isSubscriptionStatus, withinLimit,
  type PlanId, type SubscriptionStatus,
} from "./plans";
import { isMockId } from "./store";

export interface LabSubscriptionRow {
  labId: string;
  labName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  /** The plan actually in force, after the status is taken into account. */
  plan: PlanId;
  /** What the row stores, which may be ahead of what is in force. */
  storedPlan: PlanId;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  /**
   * True when the paid plan has no Stripe object behind it - granted by the
   * mock checkout before Stripe was connected, or comped by an administrator.
   * Entitlement the revenue chart will never account for, so it is called out
   * rather than blended into the paid counts.
   */
  manualGrant: boolean;
  members: number;
  experiments: number;
  datasets: number;
  aiEnabled: boolean;
  /** True when the lab already holds more rows than its plan allows. */
  overLimit: boolean;
}

/** Rows keyed by lab id, counted in memory from one pass per table. */
async function countsByLab(): Promise<Record<string, { members: number; experiments: number; datasets: number }>> {
  const admin = createAdminSupabase();
  const out: Record<string, { members: number; experiments: number; datasets: number }> = {};

  const bump = (labId: string | null, key: "members" | "experiments" | "datasets") => {
    if (!labId) return;
    out[labId] ??= { members: 0, experiments: 0, datasets: 0 };
    out[labId][key] += 1;
  };

  // One column per table rather than a count query per laboratory: a
  // per-lab count would be three round trips times the number of labs.
  const [members, experiments, datasets] = await Promise.all([
    admin.from("lab_members").select("lab_id"),
    admin.from("experiments").select("lab_id"),
    admin.from("datasets").select("lab_id"),
  ]);

  for (const r of members.data ?? []) bump(r.lab_id, "members");
  for (const r of experiments.data ?? []) bump(r.lab_id, "experiments");
  for (const r of datasets.data ?? []) bump(r.lab_id, "datasets");

  return out;
}

export async function listLabSubscriptions(): Promise<LabSubscriptionRow[]> {
  const admin = createAdminSupabase();

  const [labsRes, subsRes, counts] = await Promise.all([
    admin.from("laboratories").select("id, name, owner_id").order("created_at", { ascending: true }),
    admin.from("lab_subscriptions").select("*"),
    countsByLab(),
  ]);

  const labs = labsRes.data ?? [];
  const subs = new Map((subsRes.data ?? []).map((s) => [s.lab_id, s]));

  // One lookup for every owner, rather than one query per laboratory.
  const ownerIds = [...new Set(labs.map((l) => l.owner_id).filter(Boolean))] as string[];
  const owners = new Map<string, { name: string | null; email: string | null }>();
  if (ownerIds.length > 0) {
    const { data } = await admin
      .from("profiles")
      .select("id, display_name, email")
      .in("id", ownerIds);
    for (const p of data ?? []) {
      owners.set(p.id, { name: p.display_name ?? null, email: p.email ?? null });
    }
  }

  return labs.map((lab) => {
    const sub = subs.get(lab.id);
    const storedPlan: PlanId = isPlanId(sub?.plan) ? sub.plan : "free";
    const status = isSubscriptionStatus(sub?.status) ? sub.status : null;
    const inForce = effectivePlan(storedPlan, status);
    const owner = lab.owner_id ? owners.get(lab.owner_id) : undefined;
    const c = counts[lab.id] ?? { members: 0, experiments: 0, datasets: 0 };

    const limits = inForce.limits;
    const overLimit =
      !withinLimit(c.members - 1, limits.maxMembers) ||
      !withinLimit(c.experiments - 1, limits.maxExperiments) ||
      !withinLimit(c.datasets - 1, limits.maxDatasets);

    return {
      labId: lab.id,
      labName: lab.name,
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
      plan: inForce.id,
      storedPlan,
      status,
      currentPeriodEnd: sub?.current_period_end ?? null,
      cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
      stripeCustomerId: sub?.stripe_customer_id ?? null,
      stripeSubscriptionId: sub?.stripe_subscription_id ?? null,
      stripePriceId: sub?.stripe_price_id ?? null,
      manualGrant:
        inForce.id !== "free" &&
        (isMockId(sub?.stripe_subscription_id) || !sub?.stripe_subscription_id),
      members: c.members,
      experiments: c.experiments,
      datasets: c.datasets,
      aiEnabled: limits.aiEnabled,
      overLimit,
    } satisfies LabSubscriptionRow;
  });
}
