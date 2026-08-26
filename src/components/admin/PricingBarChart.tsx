import { formatJpy } from "@/lib/billing/plans";

export interface PriceBar {
  label: string;
  amountJpy: number;
  /** e.g. "月額" / "1回" - shown under the label. */
  unit: string;
  /** Highlighted bar (e.g. the most-selected plan/pack). */
  highlighted?: boolean;
}

const TRACK = "#e8f3fb";
const LINE = "#7db8e0";
const LINE_EMPHASIS = "#4f9ad0";

/**
 * A static horizontal bar chart of current prices - no interactivity, so
 * this stays a plain server component (unlike RevenueChart, which needs
 * hover/keyboard readouts over a time series). Bars are scaled against the
 * highest amount in the set passed in, so a lab-plan chart and a credit-pack
 * chart each get their own sensible scale rather than sharing one axis.
 *
 * Drawn as thin light-blue lines on a hairline track — not thick pills.
 */
export function PricingBarChart({ bars, currency = "円" }: { bars: PriceBar[]; currency?: string }) {
  const max = Math.max(...bars.map((b) => b.amountJpy), 1);

  return (
    <div className="flex flex-col gap-4">
      {bars.map((b) => {
        const pct = Math.max((b.amountJpy / max) * 100, b.amountJpy > 0 ? 2 : 0);
        return (
          <div key={b.label} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-right">
              <p className="truncate text-[13px] font-medium text-ink">{b.label}</p>
              <p className="text-[10px] text-ink-3">{b.unit}</p>
            </div>
            <div
              className="relative h-[3px] flex-1 overflow-hidden rounded-full"
              style={{ background: TRACK }}
              role="img"
              aria-label={`${b.label} ${formatJpy(b.amountJpy)}`}
            >
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${pct}%`,
                  background: b.highlighted ? LINE_EMPHASIS : LINE,
                }}
              />
            </div>
            <p className="w-20 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink">
              {formatJpy(b.amountJpy)}
            </p>
          </div>
        );
      })}
      <p className="text-[11px] text-ink-3">単位: {currency}。現在設定されている料金です。</p>
    </div>
  );
}
