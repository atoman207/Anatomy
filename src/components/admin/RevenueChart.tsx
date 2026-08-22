"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DataTable, cx } from "@/components/ui";
import { useThemeMode } from "@/components/useThemeMode";
import { getTheme } from "@/lib/plots/theme";
import {
  formatAmountShort, formatMoney,
  type Granularity, type RevenueBucket,
} from "@/lib/billing/revenue";

/**
 * Revenue over time.
 *
 * One series, so there is no legend - the title names what is plotted, and a
 * legend box with a single swatch would only restate it. The colour is slot 1
 * of the validated plot palette the figures pages already use, so the line is
 * the same hue in both themes and clears contrast against either surface.
 *
 * Everything a hover reveals is also reachable without hovering: the latest
 * value is direct-labelled on the line, the axis carries the scale, and 表で見る
 * switches to the same numbers as a table. A tooltip is never the only way to
 * read a figure on this page.
 */

const HEIGHT = 268;
const PAD = { top: 18, right: 20, bottom: 30, left: 62 };
const MIN_WIDTH = 320;
const Y_STEPS = 4;

/**
 * The gap between gridlines, rounded to a number a person would have chosen.
 *
 * The step is picked first and the axis maximum derived from it, rather than
 * the other way around. Rounding the *maximum* and then dividing by four
 * produces steps like 12,500, which the axis then has to label "1.3万" -
 * and, on a chart with no revenue at all, four ticks that all round to the
 * same digit. Picking the step first keeps every tick distinct and readable.
 */
function niceStep(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
  const raw = maxValue / Y_STEPS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / magnitude;

  // Finer than the usual 1/2/5 ladder on purpose. With only three rungs, a
  // peak just over a power of ten (¥4,100, so a raw step of 1,025) jumps to a
  // step of 2,000 and an axis of ¥8,000 - the data then occupies the bottom
  // half of the plot and every movement in it is squashed to half height.
  for (const tier of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (scaled > tier) continue;
    const step = tier * magnitude;
    // A step of 12.5 labels as 0 / 13 / 25 / 38 / 50: the gaps look uneven
    // because they are rounded for display. Skip any tier that does not land
    // on a whole unit, so the ticks are the numbers they appear to be.
    if (step >= 1 && !Number.isInteger(step)) continue;
    return Math.max(step, 1);
  }
  return Math.max(10 * magnitude, 1);
}

/** Tracks the rendered width, so labels are laid out at the real size. */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(Math.max(next, MIN_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

export interface RevenueChartProps {
  buckets: RevenueBucket[];
  currency: string;
  granularity: Granularity;
  title: string;
  subtitle?: string;
  /** True while newer data is loading; holds the frame at reduced opacity. */
  stale?: boolean;
}

export function RevenueChart({
  buckets, currency, granularity, title, subtitle, stale = false,
}: RevenueChartProps) {
  const mode = useThemeMode();
  const series = getTheme(mode).categorical[0];
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const geometry = useMemo(() => {
    const step = niceStep(Math.max(...buckets.map((b) => b.net), 0));
    const max = step * Y_STEPS;
    const x = (i: number) =>
      buckets.length <= 1
        ? PAD.left + plotW / 2
        : PAD.left + (i / (buckets.length - 1)) * plotW;
    const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

    const points = buckets.map((b, i) => ({ x: x(i), y: y(b.net), bucket: b }));
    const line = points
      .map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1))
      .join(" ");
    const base = PAD.top + plotH;
    const area = points.length > 0
      ? line + " L" + points[points.length - 1].x.toFixed(1) + " " + base +
        " L" + points[0].x.toFixed(1) + " " + base + " Z"
      : "";

    return { max, step, points, line, area, base };
  }, [buckets, plotW, plotH]);

  /**
   * Which x-axis ticks get a label.
   *
   * Every period is a point, but not every point can carry a legible label -
   * 90 daily labels overlap into a grey band. Labels are thinned to roughly
   * one per 72px and the last period always keeps its own, because that is
   * the one the reader is looking for.
   */
  const tickEvery = Math.max(1, Math.ceil(buckets.length / Math.max(Math.floor(plotW / 72), 2)));

  const yTicks = useMemo(
    () => Array.from({ length: Y_STEPS + 1 }, (_, i) => geometry.step * i),
    [geometry.step],
  );

  const pointFromClientX = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el || buckets.length === 0) return null;
      const box = el.getBoundingClientRect();
      const local = clientX - box.left;
      if (buckets.length === 1) return 0;
      const ratio = (local - PAD.left) / plotW;
      return Math.min(buckets.length - 1, Math.max(0, Math.round(ratio * (buckets.length - 1))));
    },
    [buckets.length, plotW, ref],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (buckets.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((prev) => {
        const next = (prev ?? buckets.length - 1) + step;
        return Math.min(buckets.length - 1, Math.max(0, next));
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(buckets.length - 1);
    } else if (e.key === "Escape") {
      setActive(null);
    }
  }

  const last = geometry.points[geometry.points.length - 1] ?? null;
  const hovered = active === null ? null : geometry.points[active] ?? null;
  const readout = hovered ?? last;

  const unit = currency.toUpperCase() === "JPY" ? "円" : currency.toUpperCase();
  const summaryText =
    buckets.length === 0
      ? "データがありません。"
      : title + "。" + buckets[0].longLabel + " から " +
        buckets[buckets.length - 1].longLabel + " まで、最大 " +
        formatMoney(Math.max(...buckets.map((b) => b.net)), currency) + "。";

  if (asTable) {
    return (
      <figure className="flex flex-col gap-3">
        <ChartHeading
          title={title}
          subtitle={subtitle}
          action={
            <Button size="sm" variant="ghost" icon="chart" onClick={() => setAsTable(false)}>
              グラフで見る
            </Button>
          }
        />
        <DataTable
          maxHeight="300px"
          headers={[periodHeader(granularity), "売上", "件数"]}
          align={["left", "right", "right"]}
          rows={buckets.map((b) => [
            b.partial ? b.longLabel + "（進行中）" : b.longLabel,
            formatMoney(b.net, currency),
            b.count,
          ])}
        />
      </figure>
    );
  }

  return (
    <figure className="flex flex-col gap-3">
      <ChartHeading
        title={title}
        subtitle={subtitle}
        action={
          <Button size="sm" variant="ghost" icon="notebook" onClick={() => setAsTable(true)}>
            表で見る
          </Button>
        }
      />

      <div
        ref={ref}
        tabIndex={0}
        role="img"
        aria-label={summaryText}
        onKeyDown={onKeyDown}
        onPointerMove={(e) => setActive(pointFromClientX(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        className={cx(
          "relative w-full rounded-md outline-none transition-opacity duration-200",
          "focus-visible:ring-2 focus-visible:ring-accent",
          stale && "opacity-60",
        )}
        style={{ touchAction: "pan-y" }}
      >
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={"0 0 " + width + " " + HEIGHT}
          className="block overflow-visible"
          aria-hidden
        >
          <defs>
            <linearGradient id="revenue-wash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series} stopOpacity="0.16" />
              <stop offset="100%" stopColor={series} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Gridlines: solid hairlines one step off the surface, never dashed. */}
          {yTicks.map((v, i) => {
            const y = PAD.top + plotH - (v / geometry.max) * plotH;
            return (
              <g key={i}>
                <line
                  x1={PAD.left} x2={width - PAD.right} y1={y} y2={y}
                  stroke="var(--border)" strokeWidth="1" shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 10} y={y + 4}
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-[11px] tabular-nums"
                >
                  {formatAmountShort(v)}
                </text>
              </g>
            );
          })}

          {geometry.points.length > 0 && (
            <>
              <path d={geometry.area} fill="url(#revenue-wash)" />
              <path
                d={geometry.line}
                fill="none"
                stroke={series}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}

          {/* X-axis ticks. The final period always keeps its label. */}
          {geometry.points.map((p, i) => {
            const isLast = i === geometry.points.length - 1;
            if (!isLast && i % tickEvery !== 0) return null;
            // Drop a regular tick that would collide with the final one.
            if (!isLast && p.x > width - PAD.right - 44) return null;
            return (
              <text
                key={p.bucket.key}
                x={p.x}
                y={HEIGHT - 10}
                textAnchor={isLast ? "end" : "middle"}
                className="fill-[var(--text-muted)] text-[11px] tabular-nums"
              >
                {p.bucket.label}
              </text>
            );
          })}

          {hovered && (
            <line
              x1={hovered.x} x2={hovered.x} y1={PAD.top} y2={geometry.base}
              stroke="var(--border-strong)" strokeWidth="1" shapeRendering="crispEdges"
              opacity="0.5"
            />
          )}

          {/*
            End marker, ringed in the surface colour so it stays legible where
            it sits on the line. A period still running is drawn hollow - it is
            not yet a finished figure and should not read as one.
          */}
          {last && (
            <circle
              cx={last.x} cy={last.y} r="4.5"
              fill={last.bucket.partial ? "var(--surface-1)" : series}
              stroke={last.bucket.partial ? series : "var(--surface-1)"}
              strokeWidth="2"
            />
          )}

          {hovered && hovered !== last && (
            <circle
              cx={hovered.x} cy={hovered.y} r="4.5"
              fill={series} stroke="var(--surface-1)" strokeWidth="2"
            />
          )}

          {/* One direct label: the latest value. Everything else is on the axis. */}
          {last && buckets.length > 0 && (
            <text
              // Offset by the marker's radius plus its ring, so the label sits
              // beside the end dot rather than under it.
              x={Math.min(last.x - 8, width - PAD.right)}
              y={Math.max(last.y - 11, PAD.top + 10)}
              textAnchor="end"
              className="fill-[var(--text-primary)] text-[12px] font-semibold tabular-nums"
            >
              {formatMoney(last.bucket.net, currency)}
            </text>
          )}
        </svg>

        {readout && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-md border border-line bg-surface-1 px-3 py-2 shadow-[var(--shadow-md)]"
            style={{
              left: Math.min(Math.max(readout.x - 75, 0), Math.max(width - 160, 0)),
              opacity: hovered ? 1 : 0,
              transition: "opacity 120ms",
            }}
            aria-hidden={!hovered}
          >
            <p className="text-[11px] text-ink-3">
              {readout.bucket.longLabel}
              {readout.bucket.partial && "（進行中）"}
            </p>
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3 rounded"
                style={{ background: series }}
              />
              <span className="text-[15px] font-semibold text-ink tabular-nums">
                {formatMoney(readout.bucket.net, currency)}
              </span>
            </p>
            <p className="text-[11px] text-ink-3 tabular-nums">{readout.bucket.count} 件</p>
          </div>
        )}

        {/* Keyboard and screen-reader readout of the focused period. */}
        <p className="sr-only" aria-live="polite">
          {hovered
            ? hovered.bucket.longLabel + " " + formatMoney(hovered.bucket.net, currency) +
              " " + hovered.bucket.count + "件"
            : ""}
        </p>
      </div>

      <figcaption className="text-[11px] text-ink-3">
        単位 {unit}・{periodHeader(granularity)}ごとの純売上（返金差引後）。
        矢印キーで期間を移動できます。
      </figcaption>
    </figure>
  );
}

function periodHeader(granularity: Granularity): string {
  return granularity === "day" ? "日" : granularity === "month" ? "月" : "年";
}

function ChartHeading({
  title, subtitle, action,
}: {
  title: string;
  subtitle?: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
