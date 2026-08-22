/**
 * The shapes the billing dashboard passes from the server to the browser.
 *
 * Kept in their own module, with no `server-only` import and no Stripe
 * client, because both sides need them: the server action builds these and
 * the client components render them. A client component importing a type out
 * of a `server-only` module works only because `import type` is erased, which
 * is a footgun waiting for someone to drop the `type` keyword.
 */

import type {
  Granularity, PayingCustomer, PaymentRecord, RevenueBucket, RevenueSummary,
} from "./revenue";

/**
 * One row of the customers table, in the shape Stripe's own dashboard lists.
 *
 * `cardBrand` / `cardLast4` are the card Stripe would charge next - the same
 * "Default payment method" column the dashboard shows, and the one an
 * administrator looks at when a renewal fails.
 */
export interface CustomerRecord {
  id: string;
  name: string | null;
  email: string | null;
  /** Unix milliseconds. */
  createdAt: number;
  cardBrand: string | null;
  cardLast4: string | null;
  /** True once Stripe has an unpaid invoice past its due date. */
  delinquent: boolean;
  /** Negative for account credit, positive for money owed. Major units. */
  balance: number;
  currency: string;
  /** The laboratory this customer pays for, when the metadata says. */
  labId: string | null;
}

export interface SubscriptionTotals {
  active: number;
  trialing: number;
  pastDue: number;
  canceled: number;
  /** Monthly recurring revenue, in major units, from live subscriptions. */
  mrr: number;
  currency: string;
}

/** How each laboratory in this deployment is provisioned, from the database. */
export interface PlanDistribution {
  free: number;
  pro: number;
  team: number;
  /** Laboratories whose subscription is past due or unpaid. */
  atRisk: number;
  /** Laboratories on a paid plan with no real Stripe subscription behind it. */
  mock: number;
  labs: number;
  members: number;
  users: number;
}

/** Everything one render of the billing dashboard needs. */
export interface BillingDashboardData {
  /** When this snapshot was taken, so the page can say how fresh it is. */
  generatedAt: number;
  rangeDays: number;
  granularity: Granularity;
  /** Gap-free series for the chart. */
  buckets: RevenueBucket[];
  summary: RevenueSummary;
  /** Newest first, one row per customer. */
  recentCustomers: PayingCustomer[];
  /** Newest first, individual payments. */
  recentPayments: PaymentRecord[];
  customers: CustomerRecord[];
  subscriptions: SubscriptionTotals;
  plans: PlanDistribution;
  /** The currency the figures are in - the account's, not a guess. */
  currency: string;
  /** Charges in the window that did not succeed. */
  failedCount: number;
  /** True while a `sk_test_` key is in use. */
  testMode: boolean;
  /**
   * Non-fatal problems, shown above the figures.
   *
   * A dashboard that quietly renders zeros because Stripe refused the read is
   * worse than one that says so: zero revenue and unreadable revenue look
   * identical on a chart.
   */
  notices: string[];
}
