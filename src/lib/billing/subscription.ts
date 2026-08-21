import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/guards";
import {
  effectivePlan, isPlanId, isSubscriptionStatus,
  type Plan, type PlanId, type SubscriptionStatus,
} from "./plans";
import type { LabSubscription } from "@/lib/supabase/types";

/**
 * Reading a laboratory's entitlement.
 *
 * Every check here is a local database read. The webhook keeps
 * `lab_subscriptions` in step with Stripe, so no request path has to wait on
 * a Stripe API call to find out whether a feature is allowed - which also
 * means a Stripe outage degrades to "the plan we last knew about" rather than
 * to a broken app.
 */

export interface LabEntitlement {
  labId: string;
  plan: Plan;
  /** The plan actually in force, after the status is taken into account. */
  planId: PlanId;
  /** The plan Stripe has on file, which may be ahead of what is in force. */
  subscribedPlanId: PlanId | null;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeSubscription: boolean;
  aiEnabled: boolean;
}

const FREE: Omit<LabEntitlement, "labId"> = {
  plan: effectivePlan(null, null),
  planId: "free",
  subscribedPlanId: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  hasStripeSubscription: false,
  aiEnabled: effectivePlan(null, null).limits.aiEnabled,
};

/** The raw row, or null when the caller may not read it or none exists. */
export async function getLabSubscriptionRow(
  labId: string,
): Promise<LabSubscription | null> {
  if (!labId) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("lab_subscriptions")
    .select("*")
    .eq("lab_id", labId)
    .maybeSingle();
  return data ?? null;
}

/**
 * What one laboratory is entitled to right now.
 *
 * Falls back to the free plan for a missing row, an unreadable row, or a
 * lapsed status - the three cases are indistinguishable to a caller, and all
 * three mean the same thing.
 */
export async function getLabEntitlement(labId: string): Promise<LabEntitlement> {
  const row = await getLabSubscriptionRow(labId);
  if (!row) return { labId, ...FREE };

  const subscribedPlanId = isPlanId(row.plan) ? row.plan : null;
  const status = isSubscriptionStatus(row.status) ? row.status : null;
  const plan = effectivePlan(subscribedPlanId, status);

  return {
    labId,
    plan,
    planId: plan.id,
    subscribedPlanId,
    status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    hasStripeSubscription: Boolean(row.stripe_subscription_id),
    aiEnabled: plan.limits.aiEnabled,
  };
}

export interface LabUsage {
  members: number;
  experiments: number;
  datasets: number;
}

/** Current row counts, for the usage meters next to each quota. */
export async function getLabUsage(labId: string): Promise<LabUsage> {
  const supabase = await createServerSupabase();
  const count = async (table: "lab_members" | "experiments" | "datasets") => {
    const { count: n } = await supabase
      .from(table)
      .select("lab_id", { count: "exact", head: true })
      .eq("lab_id", labId);
    return n ?? 0;
  };
  const [members, experiments, datasets] = await Promise.all([
    count("lab_members"), count("experiments"), count("datasets"),
  ]);
  return { members, experiments, datasets };
}

/**
 * A non-blocking version of the gate, for features that degrade instead of
 * failing.
 *
 * Literature search is the case this exists for: PubMed itself costs nothing,
 * and only the query builder calls a model. A free laboratory should still get
 * its search results, with the question passed through literally - which is
 * already what the route does when no API key is configured.
 */
export async function hasAiAccess(labId: string | null | undefined): Promise<boolean> {
  const gate = await requireAiAccess(labId);
  return gate.ok;
}

export type AiAccess =
  | { ok: true; labId: string }
  | { ok: false; status: number; error: string };

/**
 * The gate in front of every AI route.
 *
 * These routes spend money per call on someone else's API key, so they are
 * the one place where an entitlement check has to be authoritative rather
 * than cosmetic. It runs in the route handler because the database cannot
 * refuse an HTTP request - unlike the row quotas, which are triggers.
 *
 * A missing `labId` is resolved only when the answer is unambiguous: a user
 * who belongs to exactly one laboratory gets that one. With several, the
 * caller has to say which, because picking for them would silently spend a
 * different lab's entitlement.
 */
export async function requireAiAccess(labId: string | null | undefined): Promise<AiAccess> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return { ok: false, status: 401, error: "AI機能の利用にはログインが必要です。" };
  }

  let resolved = (labId ?? "").trim();
  if (!resolved) {
    if (ctx.memberships.length === 1) {
      resolved = ctx.memberships[0].labId;
    } else if (ctx.memberships.length === 0) {
      return {
        ok: false, status: 403,
        error: "研究室に所属していないため、AI機能を利用できません。管理者に追加を依頼してください。",
      };
    } else {
      return { ok: false, status: 400, error: "研究室を選択してください。" };
    }
  }

  const isMember = ctx.memberships.some((m) => m.labId === resolved);
  if (!isMember && !ctx.isPlatformAdmin) {
    return { ok: false, status: 403, error: "この研究室のデータにアクセスする権限がありません。" };
  }

  const entitlement = await getLabEntitlement(resolved);
  if (!entitlement.aiEnabled) {
    return {
      ok: false,
      status: 402,
      error:
        `AI機能は${entitlement.plan.name}プランではご利用いただけません。` +
        "「料金・支払い」からプロプラン以上にアップグレードしてください。",
    };
  }

  return { ok: true, labId: resolved };
}
