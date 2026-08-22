"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Callout, Card, DataTable, EmptyState, StatTile, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { RevenueChart } from "./RevenueChart";
import { StripeCustomersPanel } from "./StripeCustomersPanel";
import { loadBillingDashboard } from "@/lib/billing/dashboardActions";
import {
  formatMoney, GRANULARITY_LABELS, GRANULARITIES, RANGE_PRESETS,
  type Granularity,
} from "@/lib/billing/revenue";
import type { BillingDashboardData } from "@/lib/billing/dashboardTypes";

/**
 * The administrator's payments view.
 *
 * One filter row scopes everything below it, so every figure on the page is
 * for the same window and the totals always agree with the rows under them.
 * The whole snapshot is refetched as a unit for the same reason - fetching
 * the chart and the tables separately would let a payment land between the
 * two calls and produce a total that does not match its own rows.
 *
 * "Real time" here means a poll, not a socket: Stripe pushes to the webhook,
 * not to a browser, and a 30-second poll of one server action is the honest
 * version of live for a page an administrator leaves open. While a refetch is
 * in flight the previous render is held at reduced opacity rather than
 * replaced by a skeleton, so nothing jumps.
 */

const REFRESH_MS = 30_000;

export function BillingDashboard({ initial }: { initial: BillingDashboardData }) {
  const { toast } = useToast();
  const [data, setData] = useState(initial);
  const [range, setRange] = useState<number>(initial.rangeDays);
  const [granularity, setGranularity] = useState<Granularity>(initial.granularity);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(true);

  /**
   * The filter values are passed in rather than read from a ref, so the
   * polling interval below can depend on them: an interval that closed over
   * the values it was created with would keep refetching the range the
   * administrator had already moved off.
   */
  const load = useCallback(
    async (days: number, grain: Granularity, opts: { quiet?: boolean } = {}) => {
      setBusy(true);
      try {
        const res = await loadBillingDashboard(days, grain);
        if (res.ok && res.data) setData(res.data);
        else if (!opts.quiet) {
          toast(res.error ?? "決済データを取得できませんでした。", { tone: "danger" });
        }
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  // Re-read whenever the filter changes. The first pass is skipped: the
  // server already rendered this exact snapshot.
  const rendered = useRef(false);
  useEffect(() => {
    if (!rendered.current) {
      rendered.current = true;
      return;
    }
    void load(range, granularity);
  }, [range, granularity, load]);

  // The poll. Quiet on failure: a transient Stripe blip must not stack up
  // error toasts on a page somebody left open on a second monitor.
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => void load(range, granularity, { quiet: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [live, range, granularity, load]);

  const { summary, plans, subscriptions, currency } = data;
  const grainLabel = GRANULARITY_LABELS[data.granularity];

  return (
    <div className="flex flex-col gap-4">
      {/* One filter row, above everything it scopes. Date range first. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface-1 px-3 py-2.5 shadow-[var(--shadow-sm)]">
        <SegmentedControl
          label="期間"
          options={RANGE_PRESETS.map((r) => ({ value: String(r.days), label: r.label }))}
          value={String(range)}
          onChange={(v) => setRange(Number(v))}
          disabled={busy}
        />
        <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
        <SegmentedControl
          label="表示単位"
          options={GRANULARITIES.map((g) => ({ value: g, label: GRANULARITY_LABELS[g] }))}
          value={granularity}
          onChange={(v) => setGranularity(v as Granularity)}
          disabled={busy}
        />

        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            自動更新（30秒）
          </label>
          <span className="text-[11px] tabular-nums text-ink-3">
            {new Date(data.generatedAt).toLocaleTimeString("ja-JP")} 時点
          </span>
          <Button
            size="sm" variant="ghost" icon="refresh"
            disabled={busy}
            onClick={() => void load(range, granularity)}
          >
            {busy ? "取得中…" : "更新"}
          </Button>
        </div>
      </div>

      {data.notices.map((n) => (
        <Callout key={n} tone="warn" title="一部のデータを取得できませんでした">
          {n}
        </Callout>
      ))}

      {/* Hero figure: the one number the page leads with. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-line bg-surface-1 px-5 py-4 shadow-[var(--shadow-sm)]">
          <p className="text-[12px] font-medium uppercase tracking-wider text-ink-3">
            期間の売上（返金差引後）
          </p>
          <p className={cx("mt-1 text-[46px] font-semibold leading-tight text-ink", busy && "opacity-60")}>
            {formatMoney(summary.total, currency)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
            <span className="tabular-nums">{summary.count} 件の決済</span>
            {summary.changeRatio !== null && summary.changeTo && (
              <Badge tone={summary.changeRatio >= 0 ? "good" : "danger"}>
                {summary.changeRatio >= 0 ? "▲" : "▼"}{" "}
                {Math.abs(summary.changeRatio * 100).toFixed(1)}% 前{grainLabel.replace("別", "")}比
              </Badge>
            )}
            {data.failedCount > 0 && <Badge tone="warn">失敗 {data.failedCount} 件</Badge>}
          </div>
          {summary.changeFrom && summary.changeTo && (
            <p className="mt-2 text-[11px] leading-snug text-ink-3">
              比較対象は完了した期間のみ（{summary.changeFrom.longLabel} →{" "}
              {summary.changeTo.longLabel}）。進行中の期間は途中の数字なので除外しています。
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="MRR"
            value={formatMoney(subscriptions.mrr, subscriptions.currency)}
            hint="継続課金の月額換算"
            tone="accent"
          />
          <StatTile
            label="有効な契約"
            value={subscriptions.active}
            hint={"トライアル " + subscriptions.trialing}
          />
          <StatTile
            label="支払い遅延"
            value={subscriptions.pastDue}
            tone={subscriptions.pastDue > 0 ? "warn" : undefined}
            hint="past_due / unpaid"
          />
          <StatTile label="解約済み" value={subscriptions.canceled} />
          <StatTile label="研究室" value={plans.labs} hint={plans.members + " メンバー"} />
          <StatTile label="プロ" value={plans.pro} />
          <StatTile label="チーム" value={plans.team} />
          <StatTile
            label="フリー"
            value={plans.free}
            hint={plans.mock > 0 ? "うち手動付与 " + plans.mock : undefined}
            tone={plans.mock > 0 ? "warn" : undefined}
          />
        </div>
      </div>

      <Card>
        <RevenueChart
          buckets={data.buckets}
          currency={currency}
          granularity={data.granularity}
          title={grainLabel + "の売上推移"}
          subtitle={
            summary.best && summary.best.net > 0
              ? "最高は " + summary.best.longLabel + " の " + formatMoney(summary.best.net, currency)
              : undefined
          }
          stale={busy}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="最近お支払いいただいた顧客"
          subtitle="同じ顧客の複数回の決済は1行にまとめ、期間内の合計を表示します。"
        >
          {data.recentCustomers.length === 0 ? (
            <EmptyState title="この期間に決済はありません" />
          ) : (
            <ul className={cx("flex flex-col divide-y divide-[var(--border)]", busy && "opacity-60")}>
              {data.recentCustomers.map((c) => (
                <li
                  key={c.customerId ?? c.email ?? String(c.lastPaymentAt)}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {c.name?.trim() || c.email || "（無名の顧客）"}
                    </p>
                    <p className="truncate text-[11px] text-ink-3">
                      {c.email && c.name ? c.email + " · " : ""}
                      {new Date(c.lastPaymentAt).toLocaleString("ja-JP")}
                      {c.payments > 1 ? " · " + c.payments + " 回" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[14px] font-semibold tabular-nums text-ink">
                    {formatMoney(c.total, c.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="最近の決済" subtitle="1件ずつの明細です。領収書は Stripe が発行したものを開きます。">
          <div className={cx(busy && "opacity-60")}>
            <DataTable
              maxHeight="300px"
              headers={["日時", "顧客", "金額", "状態"]}
              align={["left", "left", "right", "left"]}
              rows={data.recentPayments.map((p) => [
                new Date(p.createdAt).toLocaleString("ja-JP", {
                  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                }),
                p.customerName?.trim() || p.customerEmail || "—",
                p.receiptUrl ? (
                  <a
                    href={p.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline underline-offset-2"
                  >
                    {formatMoney(p.amount - p.refunded, p.currency)}
                  </a>
                ) : (
                  formatMoney(p.amount - p.refunded, p.currency)
                ),
                <Badge
                  key={p.id}
                  tone={p.status === "succeeded" ? "good" : p.status === "pending" ? "warn" : "danger"}
                >
                  {p.status === "succeeded" ? "成功" : p.status === "pending" ? "保留" : "失敗"}
                </Badge>,
              ])}
            />
          </div>
        </Card>
      </div>

      <StripeCustomersPanel customers={data.customers} testMode={data.testMode} stale={busy} />
    </div>
  );
}

/**
 * A labelled row of mutually exclusive choices.
 *
 * A radio group rather than a set of buttons, so the arrow keys move between
 * options and a screen reader announces which one is selected - a row of
 * `<button>`s looks identical and reports nothing.
 */
function SegmentedControl({
  label, options, value, onChange, disabled,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[12px] font-medium text-ink-3">{label}</span>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors duration-150",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-accent text-accent-contrast"
                : "border border-line bg-surface-1 text-ink-2 hover:border-accent hover:text-accent",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
