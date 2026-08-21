/**
 * The plan catalogue.
 *
 * Pure data and pure functions - no Stripe client, no environment, no
 * database - so the pricing page, the server actions and the tests all read
 * the same definitions, and the numbers can be checked without a network.
 *
 * **These amounts are what customers are charged.** They started as beta
 * prices - deliberately under ¥100 so the subscribe → renew → cancel path
 * could be exercised against real cards for almost nothing - and they are
 * still ¥50 and ¥90. Editing a number here does not change what an existing
 * subscriber pays: Stripe prices are immutable, so a new amount means
 * re-running `npm run stripe:setup` for new price ids, and migrating anyone
 * already subscribed at the old price.
 *
 * The limits below mirror `plan_limits` in supabase/migrations/all.sql.
 * The database is the authority - it is what the quota triggers consult - and
 * these copies exist so the UI can show "3 / 20" without a round trip.
 * `tests/billing.test.ts` parses the migration and fails if the two drift.
 */

export type PlanId = "free" | "pro" | "team";

export const PLAN_IDS: PlanId[] = ["free", "pro", "team"];

/** `null` means unlimited. */
export interface PlanLimits {
  maxMembers: number | null;
  maxExperiments: number | null;
  maxDatasets: number | null;
  aiEnabled: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /**
   * Monthly price in yen.
   *
   * JPY is one of Stripe's zero-decimal currencies, so this number is passed
   * to Stripe as `unit_amount` unchanged - 50 means ¥50, not 50 sen.
   */
  amountJpy: number;
  limits: PlanLimits;
  /** Shown as the bullet list on the pricing card. */
  features: string[];
}

/**
 * Stripe rejects a JPY charge below ¥50, so that is the floor for any paid
 * plan no matter how far the beta prices are discounted.
 */
export const STRIPE_MIN_JPY = 50;

/**
 * A sanity ceiling, not a product decision.
 *
 * The beta deliberately priced under ¥100; live billing has no such limit, so
 * this only exists to catch a typo that would charge a customer a hundred
 * times the intended amount (¥5000 where ¥50 was meant). Raise it when the
 * real prices are set.
 */
export const MAX_REASONABLE_JPY = 100_000;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "フリー",
    tagline: "個人・小規模での試用に。",
    amountJpy: 0,
    limits: { maxMembers: 3, maxExperiments: 20, maxDatasets: 20, aiEnabled: false },
    features: [
      "メンバー 3 名まで",
      "実験 20 件・データセット 20 件まで",
      "統計解析・作図・実験ノートはすべて利用可能",
      "AI機能（音声文字起こし・論文要約）は利用できません",
    ],
  },
  pro: {
    id: "pro",
    name: "プロ",
    tagline: "AI機能を使う研究室に。",
    amountJpy: 50,
    limits: { maxMembers: 10, maxExperiments: 200, maxDatasets: 200, aiEnabled: true },
    features: [
      "メンバー 10 名まで",
      "実験 200 件・データセット 200 件まで",
      "AI機能（音声文字起こし・構造化・論文要約）",
      "フリープランの全機能",
    ],
  },
  team: {
    id: "team",
    name: "チーム",
    tagline: "人数・件数の上限なし。",
    amountJpy: 90,
    limits: { maxMembers: null, maxExperiments: null, maxDatasets: null, aiEnabled: true },
    features: [
      "メンバー数 無制限",
      "実験・データセット 無制限",
      "AI機能（音声文字起こし・構造化・論文要約）",
      "プロプランの全機能",
    ],
  },
};

export const PLAN_LIST: Plan[] = PLAN_IDS.map((id) => PLANS[id]);

/** The paid plans, in the order they are offered. */
export const PAID_PLANS: Plan[] = PLAN_LIST.filter((p) => p.amountJpy > 0);

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as string[]).includes(value);
}

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

/** Falls back to free for anything unrecognised, never throws. */
export function planOrFree(value: unknown): Plan {
  return isPlanId(value) ? PLANS[value] : PLANS.free;
}

/**
 * Subscription statuses, matching Stripe's own vocabulary.
 *
 * @see https://docs.stripe.com/api/subscriptions/object#subscription_object-status
 */
export type SubscriptionStatus =
  | "active" | "trialing" | "past_due" | "canceled"
  | "incomplete" | "incomplete_expired" | "unpaid" | "paused";

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "active", "trialing", "past_due", "canceled",
  "incomplete", "incomplete_expired", "unpaid", "paused",
];

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as string[]).includes(value);
}

/**
 * Whether a status still grants the paid plan.
 *
 * `past_due` is included on purpose: Stripe retries a failed payment for
 * several days, and locking a laboratory out of its own records the morning a
 * card expires is a worse outcome than carrying that retry window. This must
 * stay in step with `public.lab_plan()` in migration 0002.
 */
export function statusGrantsAccess(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

/** The plan actually in force: the subscribed plan, or free once it lapses. */
export function effectivePlan(
  plan: PlanId | null | undefined,
  status: SubscriptionStatus | null | undefined,
): Plan {
  if (!plan || !status) return PLANS.free;
  if (!statusGrantsAccess(status)) return PLANS.free;
  return PLANS[plan];
}

export const STATUS_LABELS: Record<SubscriptionStatus, { ja: string; tone: "good" | "warn" | "danger" | "neutral" }> = {
  active: { ja: "有効", tone: "good" },
  trialing: { ja: "トライアル中", tone: "good" },
  past_due: { ja: "支払い遅延", tone: "warn" },
  canceled: { ja: "解約済み", tone: "neutral" },
  incomplete: { ja: "支払い未完了", tone: "warn" },
  incomplete_expired: { ja: "支払い期限切れ", tone: "danger" },
  unpaid: { ja: "未払い", tone: "danger" },
  paused: { ja: "一時停止", tone: "neutral" },
};

/** `¥50 / 月`. Zero-decimal, so no fractional part is ever shown. */
export function formatJpy(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/**
 * Whether one more row fits under a limit.
 *
 * Mirrors the `used >= allowed` test in the `enforce_lab_quota` trigger, so
 * the UI disables the button on exactly the rows the database would reject.
 */
export function withinLimit(used: number, limit: number | null): boolean {
  if (limit === null) return true;
  return used < limit;
}

/** "3 / 20" or "3 / 無制限", for the usage rows on the billing page. */
export function formatUsage(used: number, limit: number | null): string {
  return `${used} / ${limit === null ? "無制限" : limit}`;
}

/** The cheapest plan that would admit `used` rows of this kind. */
export function smallestPlanFor(
  used: number,
  key: "maxMembers" | "maxExperiments" | "maxDatasets",
): Plan | null {
  for (const plan of PLAN_LIST) {
    if (withinLimit(used, plan.limits[key])) return plan;
  }
  return null;
}
