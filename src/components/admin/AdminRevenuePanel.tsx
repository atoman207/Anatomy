"use client";

import { useCallback, useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { RevenueChart } from "@/components/admin/RevenueChart";
import { loadBillingDashboard } from "@/lib/billing/dashboardActions";
import {
  CHART_RANGE_TABS,
  chartTabFor,
  formatMoney,
  GRANULARITY_LABELS,
  type ChartRangeId,
} from "@/lib/billing/revenue";
import type { BillingDashboardData } from "@/lib/billing/dashboardTypes";

/**
 * Overview revenue card with CoinMarketCap-style range tabs.
 *
 * The server renders the initial 1D snapshot; switching tabs refetches via
 * the same dashboard action the billing page uses.
 */
export function AdminRevenuePanel({ initial }: { initial: BillingDashboardData }) {
  const [data, setData] = useState(initial);
  const [rangeId, setRangeId] = useState<ChartRangeId>(
    chartTabFor(initial.rangeDays, initial.granularity),
  );
  const [pending, startTransition] = useTransition();

  const onRangeChange = useCallback((id: ChartRangeId) => {
    const tab = CHART_RANGE_TABS.find((t) => t.id === id);
    if (!tab) return;
    setRangeId(id);
    startTransition(async () => {
      const res = await loadBillingDashboard(tab.days, tab.granularity);
      if (res.ok && res.data) setData(res.data);
    });
  }, []);

  const { summary, currency, buckets, granularity } = data;
  const grainLabel = GRANULARITY_LABELS[granularity];

  return (
    <Card>
      <RevenueChart
        buckets={buckets}
        currency={currency}
        granularity={granularity}
        title={`${grainLabel}の売上推移`}
        subtitle={
          summary.best && summary.best.net > 0
            ? `最高は ${summary.best.longLabel} の ${formatMoney(summary.best.net, currency)}`
            : undefined
        }
        stale={pending}
        activeRangeId={rangeId}
        onRangeChange={onRangeChange}
      />
    </Card>
  );
}
