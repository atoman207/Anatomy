/**
 * Turning a list of Stripe payments into the series a chart can draw.
 *
 * Pure and dependency-free - no Stripe client, no database, no clock of its
 * own - so the bucketing can be tested directly. It is worth testing: the two
 * ways a revenue chart lies to an administrator are dropping empty periods
 * (which makes a quiet week look like a straight line between two good days)
 * and mishandling zero-decimal currencies (which shows 100x or 1/100 of the
 * real figure). Both are handled here rather than in the component that draws
 * the line.
 */

/** Which calendar period one point on the chart covers. */
export type Granularity = "day" | "week" | "month" | "year";

export const GRANULARITIES: Granularity[] = ["day", "week", "month", "year"];

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "日別",
  week: "週別",
  month: "月別",
  year: "年別",
};

/**
 * The application's reporting calendar.
 *
 * Buckets are calendar periods in this zone, not UTC ones: a payment taken at
 * 08:30 on the 1st in Tokyo is 23:30 on the previous day in UTC, and an
 * administrator in Japan reading "1日" expects to see it under the 1st.
 */
export const REPORTING_TIME_ZONE = "Asia/Tokyo";

/**
 * Currencies Stripe reports without a minor unit.
 *
 * For every other currency `amount` is in cents and has to be divided by 100.
 * JPY is the one this application sells in, so getting this wrong would be
 * invisible here and wrong by 100x for anyone who switched.
 *
 * @see https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

/** Stripe's integer amount, converted to the unit a person reads. */
export function majorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? amount : amount / 100;
}

/**
 * An amount with its currency, for a figure a person reads.
 *
 * Zero-decimal currencies are shown without a fractional part - "¥1,200", not
 * "¥1,200.00" - which `Intl` already knows, so the digit count comes from the
 * currency rather than from a hard-coded 0 or 2.
 */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    // An unknown or malformed currency code: show the number and the code
    // rather than throwing inside a render.
    return amount.toLocaleString("ja-JP") + " " + currency.toUpperCase();
  }
}

/** Thousands-separated, no currency - for an axis tick under a labelled unit. */
export function formatAmountShort(amount: number): string {
  if (Math.abs(amount) >= 100_000_000) return (amount / 100_000_000).toFixed(1) + "億";
  if (Math.abs(amount) >= 10_000) {
    return (amount / 10_000).toFixed(amount % 10_000 === 0 ? 0 : 1) + "万";
  }
  return Math.round(amount).toLocaleString("ja-JP");
}

/** One payment, normalised away from Stripe's shape. */
export interface PaymentRecord {
  id: string;
  /** Unix milliseconds. */
  createdAt: number;
  /** Already in major units - yen, not sen. */
  amount: number;
  /** Refunded portion, in major units. */
  refunded: number;
  currency: string;
  status: "succeeded" | "pending" | "failed";
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  receiptUrl: string | null;
}

export interface RevenueBucket {
  /** Sorts lexicographically: 2026-08-21 / 2026-08 / 2026. */
  key: string;
  /** Short form, for an axis tick. */
  label: string;
  /** Full form, for a tooltip or a table row. */
  longLabel: string;
  /** Succeeded payments, less refunds. */
  net: number;
  /** Succeeded payments, before refunds. */
  gross: number;
  refunded: number;
  /** Number of succeeded payments. */
  count: number;
  /**
   * True for a period that has not finished yet.
   *
   * The current month is always lower than a finished one simply because it
   * is shorter, so anything that compares periods has to exclude it or say so.
   */
  partial: boolean;
}

/* ------------------------------------------------------------------ */
/* Calendar arithmetic                                                 */
/* ------------------------------------------------------------------ */

interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

/**
 * The calendar date an instant falls on, in the reporting zone.
 *
 * `en-CA` formats as YYYY-MM-DD, which is the one locale/format pair that
 * hands back an ISO date without reassembling the parts by hand.
 */
function calendarDate(ms: number, timeZone: string): CalendarDate {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function keyOf({ y, m, d }: CalendarDate, granularity: Granularity): string {
  const yy = String(y).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  if (granularity === "year") return yy;
  if (granularity === "month") return yy + "-" + mm;
  // Day and week both key by a calendar date; weeks use the Monday of that week.
  return yy + "-" + mm + "-" + dd;
}

/** Monday (ISO) of the week containing `date`, as a calendar triple. */
function startOfWeek(date: CalendarDate): CalendarDate {
  const utc = new Date(Date.UTC(date.y, date.m - 1, date.d));
  const day = utc.getUTCDay(); // 0 = Sun … 6 = Sat
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(date.y, date.m - 1, date.d + offset));
  return {
    y: monday.getUTCFullYear(),
    m: monday.getUTCMonth() + 1,
    d: monday.getUTCDate(),
  };
}

/** The bucket an instant belongs to. */
export function bucketKey(
  ms: number,
  granularity: Granularity,
  timeZone = REPORTING_TIME_ZONE,
): string {
  const date = calendarDate(ms, timeZone);
  if (granularity === "week") return keyOf(startOfWeek(date), "week");
  return keyOf(date, granularity);
}

/**
 * Steps a calendar date forward by one period.
 *
 * Done on the calendar triple rather than by adding milliseconds, so a day
 * step is always one calendar day even across a daylight-saving boundary in
 * whatever zone the reporting calendar is set to.
 */
function nextPeriod({ y, m, d }: CalendarDate, granularity: Granularity): CalendarDate {
  if (granularity === "year") return { y: y + 1, m: 1, d: 1 };
  if (granularity === "month") {
    return m === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: m + 1, d: 1 };
  }
  // Day and week: calendar arithmetic via UTC so DST never shifts the date.
  const step = granularity === "week" ? 7 : 1;
  const next = new Date(Date.UTC(y, m - 1, d + step));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

/** Every bucket key from `fromMs` to `toMs` inclusive, with none skipped. */
export function bucketKeysBetween(
  fromMs: number,
  toMs: number,
  granularity: Granularity,
  timeZone = REPORTING_TIME_ZONE,
): string[] {
  if (!(fromMs <= toMs)) return [];
  const end = bucketKey(toMs, granularity, timeZone);
  const keys: string[] = [];

  let cursor = calendarDate(fromMs, timeZone);
  // Snap to the first instant of the period, so stepping a month from the
  // 31st does not skip the months that have no 31st.
  if (granularity === "week") cursor = startOfWeek(cursor);
  else if (granularity === "month") cursor = { ...cursor, d: 1 };
  else if (granularity === "year") cursor = { ...cursor, m: 1, d: 1 };

  // A ceiling generous enough for five years of daily buckets. Guards a bad
  // range into a truncated chart rather than a hung request.
  for (let i = 0; i < 2000; i += 1) {
    const key = keyOf(cursor, granularity === "week" ? "day" : granularity);
    keys.push(key);
    if (key >= end) break;
    cursor = nextPeriod(cursor, granularity);
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

const JA_MONTHS = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];

function labelsFor(key: string, granularity: Granularity): { label: string; longLabel: string } {
  const [y, m, d] = key.split("-");
  if (granularity === "year") return { label: y + "年", longLabel: y + "年" };
  if (granularity === "month") {
    const name = JA_MONTHS[Number(m) - 1] ?? m;
    return { label: name, longLabel: y + "年" + name };
  }
  if (granularity === "week") {
    const short = Number(m) + "/" + Number(d);
    return {
      label: short,
      longLabel: y + "年" + Number(m) + "月" + Number(d) + "日週",
    };
  }
  return {
    label: Number(m) + "/" + Number(d),
    longLabel: y + "年" + Number(m) + "月" + Number(d) + "日",
  };
}

/**
 * Buckets payments into a gap-free series.
 *
 * Every period between `fromMs` and `toMs` gets a point, even one in which
 * nothing was paid. A line drawn only through the periods that had payments
 * implies revenue on the days in between, which is the opposite of what
 * happened.
 *
 * Only succeeded payments reach the series - a failed charge is not revenue -
 * but failures stay in the input so a caller can report them separately.
 */
export function bucketPayments(
  payments: readonly PaymentRecord[],
  granularity: Granularity,
  fromMs: number,
  toMs: number,
  nowMs: number = toMs,
  timeZone = REPORTING_TIME_ZONE,
): RevenueBucket[] {
  const keys = bucketKeysBetween(fromMs, toMs, granularity, timeZone);
  const currentKey = bucketKey(nowMs, granularity, timeZone);

  const byKey = new Map<string, RevenueBucket>();
  for (const key of keys) {
    const { label, longLabel } = labelsFor(key, granularity);
    byKey.set(key, {
      key, label, longLabel,
      net: 0, gross: 0, refunded: 0, count: 0,
      partial: key === currentKey,
    });
  }

  for (const p of payments) {
    if (p.status !== "succeeded") continue;
    if (p.createdAt < fromMs || p.createdAt > toMs) continue;
    const bucket = byKey.get(bucketKey(p.createdAt, granularity, timeZone));
    if (!bucket) continue;
    bucket.gross += p.amount;
    bucket.refunded += p.refunded;
    bucket.net += p.amount - p.refunded;
    bucket.count += 1;
  }

  return keys.map((k) => byKey.get(k)!);
}

export interface RevenueSummary {
  /** Net revenue across the whole range. */
  total: number;
  /** Succeeded payments across the whole range. */
  count: number;
  /** Mean net revenue per completed period. */
  averagePerPeriod: number;
  /** The best completed period, or null when none has completed. */
  best: RevenueBucket | null;
  /** The most recent period, which may still be running. */
  latest: RevenueBucket | null;
  /**
   * Change between the last two *completed* periods, as a ratio (0.25 = +25%).
   *
   * Null when there are not two completed periods, or when the earlier one was
   * zero - a percentage change from zero is not a number anyone should be
   * shown. Deliberately skips a period still in progress: comparing a
   * half-finished month against a whole one always reads as a collapse.
   */
  changeRatio: number | null;
  /** The two periods `changeRatio` compares, so it can be labelled. */
  changeFrom: RevenueBucket | null;
  changeTo: RevenueBucket | null;
}

export function summariseRevenue(buckets: readonly RevenueBucket[]): RevenueSummary {
  const completed = buckets.filter((b) => !b.partial);
  const total = buckets.reduce((s, b) => s + b.net, 0);
  const count = buckets.reduce((s, b) => s + b.count, 0);

  const best = completed.reduce<RevenueBucket | null>(
    (acc, b) => (acc === null || b.net > acc.net ? b : acc),
    null,
  );

  const tail = completed.slice(-2);
  const comparable = tail.length === 2 && tail[0].net > 0;

  return {
    total,
    count,
    averagePerPeriod:
      completed.length > 0
        ? completed.reduce((s, b) => s + b.net, 0) / completed.length
        : 0,
    best,
    latest: buckets.length > 0 ? buckets[buckets.length - 1] : null,
    changeRatio: comparable ? (tail[1].net - tail[0].net) / tail[0].net : null,
    changeFrom: comparable ? tail[0] : null,
    changeTo: comparable ? tail[1] : null,
  };
}

/**
 * The customers who paid most recently, one row each.
 *
 * A customer who paid three times this month belongs at the top once, with
 * what they have paid in total - not three times in a row, pushing everyone
 * else off the list.
 */
export interface PayingCustomer {
  customerId: string | null;
  name: string | null;
  email: string | null;
  lastPaymentAt: number;
  total: number;
  currency: string;
  payments: number;
}

export function recentPayingCustomers(
  payments: readonly PaymentRecord[],
  limit = 8,
): PayingCustomer[] {
  const byCustomer = new Map<string, PayingCustomer>();

  for (const p of payments) {
    if (p.status !== "succeeded") continue;
    // Falls back to the payment id so a one-off charge with no customer
    // object still gets a row, rather than every such charge collapsing
    // into a single nameless one.
    const id = p.customerId ?? "payment:" + p.id;
    const existing = byCustomer.get(id);

    if (!existing) {
      byCustomer.set(id, {
        customerId: p.customerId,
        name: p.customerName,
        email: p.customerEmail,
        lastPaymentAt: p.createdAt,
        total: p.amount - p.refunded,
        currency: p.currency,
        payments: 1,
      });
      continue;
    }

    existing.total += p.amount - p.refunded;
    existing.payments += 1;
    if (p.createdAt > existing.lastPaymentAt) {
      existing.lastPaymentAt = p.createdAt;
      existing.name = p.customerName ?? existing.name;
      existing.email = p.customerEmail ?? existing.email;
    }
  }

  return [...byCustomer.values()]
    .sort((a, b) => b.lastPaymentAt - a.lastPaymentAt)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Ranges                                                              */
/* ------------------------------------------------------------------ */

/** The presets on the dashboard's date filter, in the order they are shown. */
export const RANGE_PRESETS = [
  { days: 7, label: "過去7日" },
  { days: 30, label: "過去30日" },
  { days: 90, label: "過去90日" },
  { days: 365, label: "過去12か月" },
  { days: 1095, label: "過去3年" },
] as const;

export type RangeDays = (typeof RANGE_PRESETS)[number]["days"];

export function isRangeDays(value: unknown): value is RangeDays {
  return RANGE_PRESETS.some((r) => r.days === value);
}

export function isGranularity(value: unknown): value is Granularity {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

/**
 * CoinMarketCap-style range tabs on the revenue chart.
 *
 * Each tab picks both the look-back window and the grain that keeps the
 * series readable at that length.
 */
export const CHART_RANGE_TABS = [
  { id: "1D", label: "1D", days: 7, granularity: "day" },
  { id: "1W", label: "1W", days: 90, granularity: "week" },
  { id: "1M", label: "1M", days: 365, granularity: "month" },
  { id: "1Y", label: "1Y", days: 1095, granularity: "year" },
] as const;

export type ChartRangeId = (typeof CHART_RANGE_TABS)[number]["id"];

export function chartTabFor(
  days: number,
  granularity: Granularity,
): ChartRangeId {
  const exact = CHART_RANGE_TABS.find(
    (t) => t.days === days && t.granularity === granularity,
  );
  if (exact) return exact.id;
  if (granularity === "year") return "1Y";
  if (granularity === "month") return "1M";
  if (granularity === "week") return "1W";
  return "1D";
}

/**
 * The granularity a range is worth drawing at.
 *
 * 365 daily points on a card-width chart is a solid block of ink, and three
 * yearly points is a chart with nothing to say. This picks the one that
 * leaves a readable number of points; the administrator can still override it.
 */
export function defaultGranularityFor(days: number): Granularity {
  if (days <= 14) return "day";
  if (days <= 90) return "week";
  if (days <= 1095) return "month";
  return "year";
}
