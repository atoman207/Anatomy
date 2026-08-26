import test from "node:test";
import assert from "node:assert/strict";

import {
  bucketKey, bucketKeysBetween, bucketPayments, defaultGranularityFor,
  formatAmountShort, majorUnits, recentPayingCustomers, summariseRevenue,
  type PaymentRecord,
} from "../src/lib/billing/revenue";

/**
 * The reporting calendar is Asia/Tokyo, so these fixtures are written as UTC
 * instants whose Tokyo date is the interesting part.
 */
const TZ = "Asia/Tokyo";

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "ch_1",
    createdAt: Date.parse("2026-08-15T03:00:00Z"),
    amount: 500,
    refunded: 0,
    currency: "jpy",
    status: "succeeded",
    customerId: "cus_1",
    customerName: "宮田研究室",
    customerEmail: "miyata@example.ac.jp",
    description: null,
    receiptUrl: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Currency                                                            */
/* ------------------------------------------------------------------ */

test("zero-decimal currencies are not divided by 100", () => {
  // ¥5000 arrives from Stripe as 5000, not 500000. Dividing would show ¥50.
  assert.equal(majorUnits(5000, "jpy"), 5000);
  assert.equal(majorUnits(5000, "JPY"), 5000);
  assert.equal(majorUnits(1200, "krw"), 1200);
});

test("ordinary currencies are converted from minor units", () => {
  assert.equal(majorUnits(5000, "usd"), 50);
  assert.equal(majorUnits(1999, "eur"), 19.99);
});

test("large amounts are abbreviated the way Japanese figures are read", () => {
  assert.equal(formatAmountShort(0), "0");
  assert.equal(formatAmountShort(9_500), "9,500");
  assert.equal(formatAmountShort(20_000), "2万");
  assert.equal(formatAmountShort(125_000), "12.5万");
  assert.equal(formatAmountShort(300_000_000), "3.0億");
});

/* ------------------------------------------------------------------ */
/* Calendar bucketing                                                  */
/* ------------------------------------------------------------------ */

test("a payment is bucketed by its Tokyo calendar date, not its UTC one", () => {
  // 23:30 UTC on the 20th is 08:30 on the 21st in Tokyo. An administrator in
  // Japan looking at "8/21" expects to find this payment there.
  const lateUtc = Date.parse("2026-08-20T23:30:00Z");
  assert.equal(bucketKey(lateUtc, "day", TZ), "2026-08-21");
  assert.equal(bucketKey(lateUtc, "month", TZ), "2026-08");
  assert.equal(bucketKey(lateUtc, "year", TZ), "2026");
});

test("day buckets cover every date in the range with none skipped", () => {
  const keys = bucketKeysBetween(
    Date.parse("2026-02-26T00:00:00Z"),
    Date.parse("2026-03-02T00:00:00Z"),
    "day",
    TZ,
  );
  // 2026 is not a leap year, so February ends on the 28th.
  assert.deepEqual(keys, [
    "2026-02-26", "2026-02-27", "2026-02-28",
    "2026-03-01", "2026-03-02",
  ]);
});

test("month buckets do not skip a month when the range starts on the 31st", () => {
  // Stepping a month from 1/31 by naive date arithmetic lands on 3/2 and
  // loses February entirely.
  const keys = bucketKeysBetween(
    Date.parse("2026-01-31T00:00:00Z"),
    Date.parse("2026-04-05T00:00:00Z"),
    "month",
    TZ,
  );
  assert.deepEqual(keys, ["2026-01", "2026-02", "2026-03", "2026-04"]);
});

test("year buckets span whole years", () => {
  const keys = bucketKeysBetween(
    Date.parse("2024-06-01T00:00:00Z"),
    Date.parse("2026-02-01T00:00:00Z"),
    "year",
    TZ,
  );
  assert.deepEqual(keys, ["2024", "2025", "2026"]);
});

test("an inverted range produces nothing rather than looping", () => {
  assert.deepEqual(
    bucketKeysBetween(
      Date.parse("2026-08-10T00:00:00Z"),
      Date.parse("2026-08-01T00:00:00Z"),
      "day",
      TZ,
    ),
    [],
  );
});

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

test("a period with no payments is a zero point, not a missing one", () => {
  // A line drawn only through the days that had payments implies revenue on
  // the days in between - the opposite of what happened.
  const from = Date.parse("2026-08-10T00:00:00Z");
  const to = Date.parse("2026-08-14T00:00:00Z");
  const buckets = bucketPayments(
    [payment({ createdAt: Date.parse("2026-08-12T03:00:00Z"), amount: 900 })],
    "day", from, to, to, TZ,
  );

  assert.equal(buckets.length, 5);
  assert.deepEqual(buckets.map((b) => b.net), [0, 0, 900, 0, 0]);
  assert.deepEqual(buckets.map((b) => b.count), [0, 0, 1, 0, 0]);
});

test("only succeeded payments count as revenue", () => {
  const from = Date.parse("2026-08-15T00:00:00Z");
  const to = Date.parse("2026-08-15T23:00:00Z");
  const buckets = bucketPayments(
    [
      payment({ id: "ch_ok", amount: 500 }),
      payment({ id: "ch_fail", amount: 9000, status: "failed" }),
      payment({ id: "ch_pending", amount: 7000, status: "pending" }),
    ],
    "day", from, to, to, TZ,
  );

  assert.equal(buckets[0].net, 500);
  assert.equal(buckets[0].count, 1);
});

test("refunds are subtracted from net but left in gross", () => {
  const from = Date.parse("2026-08-15T00:00:00Z");
  const to = Date.parse("2026-08-15T23:00:00Z");
  const [bucket] = bucketPayments(
    [payment({ amount: 1000, refunded: 400 })],
    "day", from, to, to, TZ,
  );

  assert.equal(bucket.gross, 1000);
  assert.equal(bucket.refunded, 400);
  assert.equal(bucket.net, 600);
});

test("payments outside the range are ignored", () => {
  const from = Date.parse("2026-08-10T00:00:00Z");
  const to = Date.parse("2026-08-12T00:00:00Z");
  const buckets = bucketPayments(
    [payment({ createdAt: Date.parse("2026-07-01T00:00:00Z"), amount: 9999 })],
    "day", from, to, to, TZ,
  );

  assert.equal(buckets.reduce((s, b) => s + b.net, 0), 0);
});

test("the period containing now is marked as still running", () => {
  const from = Date.parse("2026-08-01T00:00:00Z");
  const now = Date.parse("2026-08-15T03:00:00Z");
  const buckets = bucketPayments([], "day", from, now, now, TZ);

  const partial = buckets.filter((b) => b.partial);
  assert.equal(partial.length, 1, "exactly one period is in progress");
  assert.equal(partial[0].key, "2026-08-15");
});

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

test("the period-over-period change ignores the period still running", () => {
  // A month that is three days old always looks like a collapse next to a
  // finished one. Comparing against it would report a false crash every
  // month, so the comparison uses the last two completed periods.
  const from = Date.parse("2026-06-01T00:00:00Z");
  const now = Date.parse("2026-08-03T00:00:00Z");
  const buckets = bucketPayments(
    [
      payment({ id: "a", createdAt: Date.parse("2026-06-10T00:00:00Z"), amount: 1000 }),
      payment({ id: "b", createdAt: Date.parse("2026-07-10T00:00:00Z"), amount: 1500 }),
      payment({ id: "c", createdAt: Date.parse("2026-08-01T00:00:00Z"), amount: 50 }),
    ],
    "month", from, now, now, TZ,
  );

  const summary = summariseRevenue(buckets);
  assert.equal(summary.total, 2550, "the running month still counts toward the total");
  assert.equal(summary.changeFrom?.key, "2026-06");
  assert.equal(summary.changeTo?.key, "2026-07");
  assert.equal(summary.changeRatio, 0.5);
});

test("a change from zero is reported as unknown rather than as infinity", () => {
  const from = Date.parse("2026-06-01T00:00:00Z");
  const now = Date.parse("2026-08-03T00:00:00Z");
  const buckets = bucketPayments(
    [payment({ createdAt: Date.parse("2026-07-10T00:00:00Z"), amount: 1500 })],
    "month", from, now, now, TZ,
  );

  const summary = summariseRevenue(buckets);
  assert.equal(summary.changeRatio, null);
  assert.equal(summary.changeFrom, null);
});

test("the best period never reports one that has not finished", () => {
  const from = Date.parse("2026-07-01T00:00:00Z");
  const now = Date.parse("2026-08-20T00:00:00Z");
  const buckets = bucketPayments(
    [
      payment({ id: "a", createdAt: Date.parse("2026-07-10T00:00:00Z"), amount: 1000 }),
      payment({ id: "b", createdAt: Date.parse("2026-08-10T00:00:00Z"), amount: 8000 }),
    ],
    "month", from, now, now, TZ,
  );

  const summary = summariseRevenue(buckets);
  assert.equal(summary.best?.key, "2026-07", "August is still running");
  assert.equal(summary.latest?.key, "2026-08");
});

test("an empty series summarises to zeros rather than NaN", () => {
  const summary = summariseRevenue([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.count, 0);
  assert.equal(summary.averagePerPeriod, 0);
  assert.equal(summary.best, null);
  assert.equal(summary.latest, null);
  assert.equal(summary.changeRatio, null);
});

/* ------------------------------------------------------------------ */
/* Recent paying customers                                             */
/* ------------------------------------------------------------------ */

test("a customer who paid repeatedly gets one row with the total", () => {
  const rows = recentPayingCustomers([
    payment({ id: "ch_1", customerId: "cus_a", amount: 500, createdAt: 1_000 }),
    payment({ id: "ch_2", customerId: "cus_a", amount: 500, createdAt: 3_000 }),
    payment({ id: "ch_3", customerId: "cus_b", amount: 900, createdAt: 2_000 }),
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].customerId, "cus_a", "newest payment first");
  assert.equal(rows[0].total, 1000);
  assert.equal(rows[0].payments, 2);
  assert.equal(rows[0].lastPaymentAt, 3_000);
});

test("charges with no customer object stay separate rows", () => {
  // Collapsing them on a null id would merge unrelated one-off payments into
  // a single nameless row whose total belongs to nobody.
  const rows = recentPayingCustomers([
    payment({ id: "ch_1", customerId: null, customerName: null, amount: 500 }),
    payment({ id: "ch_2", customerId: null, customerName: null, amount: 700 }),
  ]);

  assert.equal(rows.length, 2);
});

test("failed payments never appear as a paying customer", () => {
  const rows = recentPayingCustomers([
    payment({ id: "ch_1", customerId: "cus_a", status: "failed" }),
  ]);
  assert.deepEqual(rows, []);
});

/* ------------------------------------------------------------------ */
/* Granularity defaults                                                */
/* ------------------------------------------------------------------ */

test("the default granularity keeps the point count readable", () => {
  // 365 daily points on a card-width chart is a solid block of ink; three
  // yearly points is a chart with nothing to say.
  assert.equal(defaultGranularityFor(7), "day");
  assert.equal(defaultGranularityFor(90), "week");
  assert.equal(defaultGranularityFor(365), "month");
  assert.equal(defaultGranularityFor(1095), "month");
  assert.equal(defaultGranularityFor(3650), "year");
});

test("week buckets snap to Monday and step by seven days", () => {
  // Thursday 2026-08-20 (Tokyo) belongs to the week starting Monday 8/17.
  const thu = Date.parse("2026-08-20T03:00:00Z");
  assert.equal(bucketKey(thu, "week", TZ), "2026-08-17");

  const keys = bucketKeysBetween(
    Date.parse("2026-08-16T15:00:00Z"), // Monday 8/17 00:00 JST
    Date.parse("2026-08-30T15:00:00Z"), // Monday 8/31 00:00 JST
    "week",
    TZ,
  );
  assert.deepEqual(keys, ["2026-08-17", "2026-08-24", "2026-08-31"]);
});
