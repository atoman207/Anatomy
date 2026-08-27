/**
 * The plan catalogue.
 *
 * Pure data and pure functions - no Stripe client, no environment, no
 * database - so the pricing page, the server actions and the tests all read
 * the same definitions, and the numbers can be checked without a network.
 *
 * **The amounts here are defaults, not the live prices.** What a customer is
 * actually charged is the Stripe Price recorded in `plan_prices`, set at
 * `/admin/billing` and read through `priceStore`; these numbers are the
 * starting point `npm run stripe:setup` creates prices at, and the label the
 * pricing page falls back to for a plan whose amount has never been fetched
 * from Stripe. Editing one changes neither an existing subscriber's bill nor
 * a configured plan's price - see `planOffers` for which number is shown.
 *
 * The limits below mirror `plan_limits` in supabase/migrations/all.sql.
 * The database is the authority - it is what the quota triggers consult - and
 * these copies exist so the UI can show "3 / 20" without a round trip.
 * `tests/billing.test.ts` parses the migration and fails if the two drift.
 */

export type PlanId = "free" | "solo" | "pro" | "team";

export type BillingInterval = "month" | "year";

export const PLAN_IDS: PlanId[] = ["free", "solo", "pro", "team"];

/** `null` means unlimited. */
export interface PlanLimits {
  maxLabs: number | null;
  maxMembers: number | null;
  maxExperiments: number | null;
  maxDatasets: number | null;
  /** Full AI: high-precision transcription, structuring, literature, etc. */
  aiEnabled: boolean;
  /** Notebook AI image generation (available on the free plan too). */
  aiImageEnabled: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /**
   * Price in yen for one billing period (month or year).
   *
   * JPY is one of Stripe's zero-decimal currencies, so this number is passed
   * to Stripe as `unit_amount` unchanged - 3000 means ¥3,000, not 30 sen.
   * Zero means the plan is free and never creates a Checkout Session.
   */
  amountJpy: number;
  billingInterval: BillingInterval;
  /**
   * Second price shown on the card (e.g. monthly alongside yearly).
   * When `alternateSelectable` is true, the customer can check out at either.
   */
  alternateAmountJpy?: number;
  alternateBillingInterval?: BillingInterval;
  /** When true, the alternate cadence is a real checkout choice, not just a label. */
  alternateSelectable?: boolean;
  /** Highlighted as the recommended / most-chosen tier. */
  popular?: boolean;
  /** Short reason shown under the popular badge. */
  popularReason?: string;
  limits: PlanLimits;
  /** Shown as the bullet list on the pricing card. */
  features: string[];
}

/**
 * Stripe rejects a JPY charge below ¥50, so that is the floor for any paid
 * plan no matter how far the beta prices are discounted.
 */
export const STRIPE_MIN_JPY = 50;

/** Sanity ceiling for admin price edits and setup scripts. */
export const MAX_REASONABLE_JPY = 1_000_000;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "無料",
    tagline: "1研究室・メンバー2名・実験3件まで。",
    amountJpy: 0,
    billingInterval: "month",
    limits: {
      maxLabs: 1,
      maxMembers: 2,
      maxExperiments: 3,
      maxDatasets: null,
      aiEnabled: false,
      aiImageEnabled: false,
    },
    features: [
      "研究室 1 つまで",
      "メンバー 2 名まで",
      "実験 3 件まで",
    ],
  },
  solo: {
    id: "solo",
    name: "個人研究者",
    tagline: "1研究室・メンバー5名・実験10件まで。AI機能すべて利用可。",
    amountJpy: 30_000,
    billingInterval: "year",
    alternateAmountJpy: 3_000,
    alternateBillingInterval: "month",
    alternateSelectable: true,
    limits: {
      maxLabs: 1,
      maxMembers: 5,
      maxExperiments: 10,
      maxDatasets: null,
      aiEnabled: true,
      aiImageEnabled: true,
    },
    features: [
      "研究室 1 つまで",
      "メンバー 5 名まで",
      "実験 10 件まで",
      "AI機能すべて（音声文字起こし・構造化・論文要約・画像生成）",
      "統計解析・作図・実験ノートはすべて利用可能",
    ],
  },
  pro: {
    id: "pro",
    name: "研究室",
    tagline: "10研究室・メンバー100名・実験200件まで。",
    amountJpy: 50_000,
    billingInterval: "year",
    alternateAmountJpy: 5_000,
    alternateBillingInterval: "month",
    alternateSelectable: true,
    popular: true,
    popularReason:
      "研究室規模にちょうどよく、個人プランより枠が大きく増える一方、機関プランより手頃なため、最も選ばれています。年額なら月額換算よりお得です。",
    limits: {
      maxLabs: 10,
      maxMembers: 100,
      maxExperiments: 200,
      maxDatasets: null,
      aiEnabled: true,
      aiImageEnabled: true,
    },
    features: [
      "研究室 10 まで",
      "メンバー 100 名まで（全体）",
      "実験 200 件まで（全体）",
      "AI機能すべて（音声文字起こし・構造化・論文要約・画像生成）",
      "個人研究者プランの全機能",
    ],
  },
  team: {
    id: "team",
    name: "大学・研究機関",
    tagline: "研究室・メンバー・実験数に上限なし。",
    amountJpy: 50_000,
    billingInterval: "month",
    alternateAmountJpy: 400_000,
    alternateBillingInterval: "year",
    alternateSelectable: true,
    limits: {
      maxLabs: null,
      maxMembers: null,
      maxExperiments: null,
      maxDatasets: null,
      aiEnabled: true,
      aiImageEnabled: true,
    },
    features: [
      "研究室・メンバー・実験数 無制限",
      "AI機能すべて（音声文字起こし・構造化・論文要約・画像生成）",
      "研究室プランの全機能",
      "機関向けサポート",
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

/** Distinct badge colours per plan so the admin lab list is scannable. */
export const PLAN_BADGE_TONE: Record<PlanId, "neutral" | "good" | "accent" | "warn"> = {
  free: "neutral",
  solo: "good",
  pro: "accent",
  team: "warn",
};

/** `¥3,000`. Zero-decimal, so no fractional part is ever shown. */
export function formatJpy(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/** Human label for the billing cadence shown on pricing cards. */
export function formatBillingPeriod(interval: BillingInterval): string {
  return interval === "year" ? "年" : "月";
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

/** Amount charged for a plan at a given cadence (primary or alternate). */
export function planAmountFor(
  plan: Plan,
  interval: BillingInterval,
): number {
  if (interval === plan.billingInterval) return plan.amountJpy;
  if (
    plan.alternateBillingInterval === interval
    && plan.alternateAmountJpy != null
  ) {
    return plan.alternateAmountJpy;
  }
  return plan.amountJpy;
}

/** The cheapest plan that would admit `used` rows of this kind. */
export function smallestPlanFor(
  used: number,
  key: "maxMembers" | "maxExperiments" | "maxDatasets" | "maxLabs",
): Plan | null {
  for (const plan of PLAN_LIST) {
    if (withinLimit(used, plan.limits[key])) return plan;
  }
  return null;
}
