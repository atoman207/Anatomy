"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, DataTable, cx } from "@/components/ui";
import {
  formatAmountShort, formatMoney,
  type ChartRangeId, type Granularity, type RevenueBucket,
  CHART_RANGE_TABS,
} from "@/lib/billing/revenue";

/**
 * Revenue over time — CoinMarketCap-style area chart.
 *
 * The line is green above the opening baseline and red below it. Area fill is
 * drawn only under the baseline, in light blue. Range tabs (1D / 1W / 1M / 1Y)
 * change the look-back window; 表で見る flips to the same numbers as a table.
 */

const HEIGHT = 300;
const VOLUME_H = 32;
const PAD = { top: 16, right: 64, bottom: 28 + VOLUME_H, left: 12 };
const MIN_WIDTH = 320;
const Y_STEPS = 4;

/** CMC bull / bear line colours; below-baseline wash is light blue. */
const GREEN = "#16c784";
const RED = "#ea3943";
const BELOW_BLUE = "#7dd3fc";
const BASELINE = "#9ca3af";

function niceStep(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
  const raw = maxValue / Y_STEPS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / magnitude;
  for (const tier of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (scaled > tier) continue;
    const step = tier * magnitude;
    if (step >= 1 && !Number.isInteger(step)) continue;
    return Math.max(step, 1);
  }
  return Math.max(10 * magnitude, 1);
}

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

type Pt = { x: number; y: number; value: number };

/**
 * Build closed area paths for the regions above / below a horizontal baseline.
 * Handles segments that cross the baseline by inserting the intersection.
 */
function baselineAreas(points: Pt[], baselineY: number): { above: string; below: string } {
  if (points.length === 0) return { above: "", below: "" };

  type Seg = { pts: Pt[]; side: "above" | "below" };
  const segs: Seg[] = [];
  let cur: Seg | null = null;

  const sideOf = (p: Pt): "above" | "below" | "on" => {
    if (Math.abs(p.y - baselineY) < 0.5) return "on";
    return p.y < baselineY ? "above" : "below";
  };

  const push = (p: Pt, side: "above" | "below") => {
    if (!cur || cur.side !== side) {
      cur = { pts: [p], side };
      segs.push(cur);
    } else {
      cur.pts.push(p);
    }
  };

  const cross = (a: Pt, b: Pt): Pt => {
    const t = (baselineY - a.y) / (b.y - a.y);
    return {
      x: a.x + t * (b.x - a.x),
      y: baselineY,
      value: a.value + t * (b.value - a.value),
    };
  };

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const s = sideOf(p);
    if (i === 0) {
      // Stay silent on the baseline until the series leaves it — a zero-height
      // "above" polygon here paints a false wash under flat opening days.
      if (s !== "on") push(p, s);
      continue;
    }
    const prev = points[i - 1];
    const ps = sideOf(prev);
    if (s === "on") {
      if (ps === "above" || ps === "below") push({ ...p, y: baselineY }, ps);
      continue;
    }
    if (ps === "on") {
      push({ ...prev, y: baselineY }, s);
      push(p, s);
      continue;
    }
    if (ps === s) {
      push(p, s);
      continue;
    }
    // Crossed the baseline between prev and p.
    const mid = cross(prev, p);
    push(mid, ps);
    push(mid, s);
    push(p, s);
  }

  const toArea = (seg: Seg): string => {
    // Need a real vertical span; flat baseline-only segments are skipped.
    if (seg.pts.length < 2) return "";
    if (!seg.pts.some((pt) => Math.abs(pt.y - baselineY) > 0.5)) return "";
    const line = seg.pts
      .map((pt, i) => (i === 0 ? "M" : "L") + pt.x.toFixed(1) + " " + pt.y.toFixed(1))
      .join(" ");
    const last = seg.pts[seg.pts.length - 1];
    const first = seg.pts[0];
    return (
      line +
      " L" + last.x.toFixed(1) + " " + baselineY.toFixed(1) +
      " L" + first.x.toFixed(1) + " " + baselineY.toFixed(1) +
      " Z"
    );
  };

  return {
    above: segs.filter((s) => s.side === "above").map(toArea).join(" "),
    below: segs.filter((s) => s.side === "below").map(toArea).join(" "),
  };
}

function linePath(points: Pt[]): string {
  return points
    .map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1))
    .join(" ");
}

/** Stroke segments coloured by which side of the baseline they sit on. */
function colouredStroke(points: Pt[], baselineY: number): { d: string; color: string }[] {
  if (points.length < 2) return [];
  const out: { d: string; color: string }[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const aAbove = a.y <= baselineY;
    const bAbove = b.y <= baselineY;
    if (aAbove === bAbove || Math.abs(a.y - baselineY) < 0.5 || Math.abs(b.y - baselineY) < 0.5) {
      out.push({
        d: "M" + a.x.toFixed(1) + " " + a.y.toFixed(1) + " L" + b.x.toFixed(1) + " " + b.y.toFixed(1),
        color: a.y <= baselineY + 0.5 ? GREEN : RED,
      });
      continue;
    }
    const t = (baselineY - a.y) / (b.y - a.y);
    const mx = a.x + t * (b.x - a.x);
    out.push({
      d: "M" + a.x.toFixed(1) + " " + a.y.toFixed(1) + " L" + mx.toFixed(1) + " " + baselineY.toFixed(1),
      color: aAbove ? GREEN : RED,
    });
    out.push({
      d: "M" + mx.toFixed(1) + " " + baselineY.toFixed(1) + " L" + b.x.toFixed(1) + " " + b.y.toFixed(1),
      color: bAbove ? GREEN : RED,
    });
  }
  return out;
}

export interface RevenueChartProps {
  buckets: RevenueBucket[];
  currency: string;
  granularity: Granularity;
  title: string;
  subtitle?: string;
  stale?: boolean;
  /** Active CoinMarketCap-style range tab. */
  activeRangeId?: ChartRangeId;
  /** Called when the administrator picks a range tab. */
  onRangeChange?: (id: ChartRangeId) => void;
  /** Hide the built-in range tabs (e.g. when filters live elsewhere). */
  hideRangeTabs?: boolean;
}

export function RevenueChart({
  buckets, currency, granularity, title, subtitle, stale = false,
  activeRangeId, onRangeChange, hideRangeTabs = false,
}: RevenueChartProps) {
  const gid = useId().replace(/:/g, "");
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const geometry = useMemo(() => {
    const values = buckets.map((b) => b.net);
    const baselineValue = values[0] ?? 0;
    const lo = Math.min(baselineValue, ...values, 0);
    const hi = Math.max(baselineValue, ...values, 0);
    const span = Math.max(hi - lo, 1);
    const step = niceStep(span);
    // Axis framed around the data + baseline so the opening line sits visibly mid-chart when flat.
    const axisMin = Math.min(lo, 0);
    const axisMax = Math.max(axisMin + step * Y_STEPS, hi, baselineValue);
    const niceMax = axisMin + niceStep(axisMax - axisMin) * Y_STEPS;

    const x = (i: number) =>
      buckets.length <= 1
        ? PAD.left + plotW / 2
        : PAD.left + (i / (buckets.length - 1)) * plotW;
    const y = (v: number) => {
      const t = (v - axisMin) / Math.max(niceMax - axisMin, 1);
      return PAD.top + plotH - t * plotH;
    };

    const points: Pt[] = buckets.map((b, i) => ({
      x: x(i), y: y(b.net), value: b.net,
    }));
    const baselineY = y(baselineValue);
    const areas = baselineAreas(points, baselineY);
    const strokes = colouredStroke(points, baselineY);
    const maxCount = Math.max(...buckets.map((b) => b.count), 1);

    return {
      axisMin, axisMax: niceMax, step: (niceMax - axisMin) / Y_STEPS,
      points, baselineY, baselineValue, areas, strokes, maxCount,
      line: linePath(points),
      base: PAD.top + plotH,
    };
  }, [buckets, plotW, plotH]);

  const tickEvery = Math.max(1, Math.ceil(buckets.length / Math.max(Math.floor(plotW / 72), 2)));

  const yTicks = useMemo(
    () => Array.from({ length: Y_STEPS + 1 }, (_, i) => geometry.axisMin + geometry.step * i),
    [geometry.axisMin, geometry.step],
  );

  const last = geometry.points[geometry.points.length - 1] ?? null;
  const endUp = last ? last.value >= geometry.baselineValue : true;
  const endColor = endUp ? GREEN : RED;

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

  const hovered = active === null ? null : geometry.points[active] ?? null;
  const readout = hovered ?? last;
  const readoutBucket =
    active !== null
      ? buckets[active]
      : buckets[buckets.length - 1];
  const unit = currency.toUpperCase() === "JPY" ? "円" : currency.toUpperCase();
  const summaryText =
    buckets.length === 0
      ? "データがありません。"
      : title + "。" + buckets[0].longLabel + " から " +
        buckets[buckets.length - 1].longLabel + " まで、最大 " +
        formatMoney(Math.max(...buckets.map((b) => b.net)), currency) + "。";

  const rangeTabs = !hideRangeTabs && onRangeChange ? (
    <div role="radiogroup" aria-label="表示期間" className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
      {CHART_RANGE_TABS.map((tab) => {
        const selected = tab.id === activeRangeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onRangeChange(tab.id)}
            className={cx(
              "rounded px-2.5 py-1 text-[12px] font-semibold tabular-nums transition-colors",
              selected
                ? "bg-[var(--text-primary)] text-[var(--surface-1)] shadow-sm"
                : "text-ink-3 hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  ) : null;

  if (asTable) {
    return (
      <figure className="flex flex-col gap-3">
        <ChartHeading
          title={title}
          subtitle={subtitle}
          tabs={rangeTabs}
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

  const volTop = HEIGHT - VOLUME_H - 4;
  const barW = buckets.length > 0 ? Math.max(2, (plotW / buckets.length) * 0.55) : 2;

  return (
    <figure className="flex flex-col gap-3">
      <ChartHeading
        title={title}
        subtitle={subtitle}
        tabs={rangeTabs}
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
            <linearGradient id={"wash-below-" + gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BELOW_BLUE} stopOpacity="0.08" />
              <stop offset="45%" stopColor={BELOW_BLUE} stopOpacity="0.28" />
              <stop offset="100%" stopColor={BELOW_BLUE} stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {yTicks.map((v, i) => {
            const y = PAD.top + plotH - ((v - geometry.axisMin) / Math.max(geometry.axisMax - geometry.axisMin, 1)) * plotH;
            return (
              <g key={i}>
                <line
                  x1={PAD.left} x2={width - PAD.right} y1={y} y2={y}
                  stroke="var(--border)" strokeWidth="1" shapeRendering="crispEdges"
                  opacity={0.7}
                />
                <text
                  x={width - PAD.right + 8} y={y + 4}
                  textAnchor="start"
                  className="fill-[var(--text-muted)] text-[11px] tabular-nums"
                >
                  {formatAmountShort(v)}
                </text>
              </g>
            );
          })}

          {/* Opening baseline (CMC-style dotted). */}
          {geometry.points.length > 0 && (
            <line
              x1={PAD.left} x2={width - PAD.right}
              y1={geometry.baselineY} y2={geometry.baselineY}
              stroke={BASELINE} strokeWidth="1" strokeDasharray="4 4"
              opacity="0.85"
            />
          )}

          {/* Area wash only below the dashed baseline, in light blue. */}
          {geometry.areas.below && (
            <path d={geometry.areas.below} fill={"url(#wash-below-" + gid + ")"} />
          )}

          {geometry.strokes.map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* Volume strip (payment counts). */}
          {geometry.points.map((p, i) => {
            const count = buckets[i]?.count ?? 0;
            const h = (count / geometry.maxCount) * (VOLUME_H - 8);
            return (
              <rect
                key={buckets[i].key + "-vol"}
                x={p.x - barW / 2}
                y={volTop + (VOLUME_H - 8) - h}
                width={barW}
                height={Math.max(h, count > 0 ? 2 : 0)}
                rx={1}
                fill={p.value >= geometry.baselineValue ? GREEN : BELOW_BLUE}
                opacity={0.35}
              />
            );
          })}

          {geometry.points.map((p, i) => {
            const isLast = i === geometry.points.length - 1;
            if (!isLast && i % tickEvery !== 0) return null;
            if (!isLast && p.x > width - PAD.right - 44) return null;
            return (
              <text
                key={buckets[i].key}
                x={p.x}
                y={HEIGHT - VOLUME_H - 10}
                textAnchor={isLast ? "end" : "middle"}
                className="fill-[var(--text-muted)] text-[11px] tabular-nums"
              >
                {buckets[i].label}
              </text>
            );
          })}

          {hovered && (
            <line
              x1={hovered.x} x2={hovered.x} y1={PAD.top} y2={geometry.base}
              stroke="var(--border-strong)" strokeWidth="1" shapeRendering="crispEdges"
              opacity="0.45"
            />
          )}

          {last && (
            <circle
              cx={last.x} cy={last.y} r="4.5"
              fill={endColor}
              stroke="var(--surface-1)"
              strokeWidth="2"
            />
          )}

          {hovered && hovered !== last && (
            <circle
              cx={hovered.x} cy={hovered.y} r="4.5"
              fill={hovered.value >= geometry.baselineValue ? GREEN : RED}
              stroke="var(--surface-1)"
              strokeWidth="2"
            />
          )}

          {/* Current-value tag on the right (CMC style). */}
          {last && buckets.length > 0 && (
            <g>
              <rect
                x={width - PAD.right + 6}
                y={last.y - 10}
                width={Math.max(44, formatMoney(last.value, currency).length * 7.2)}
                height={20}
                rx={3}
                fill={endColor}
              />
              <text
                x={width - PAD.right + 12}
                y={last.y + 4}
                className="fill-white text-[11px] font-semibold tabular-nums"
              >
                {formatMoney(last.value, currency)}
              </text>
            </g>
          )}
        </svg>

        {readout && readoutBucket && (
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
              {readoutBucket.longLabel}
              {readoutBucket.partial && "（進行中）"}
            </p>
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3 rounded"
                style={{
                  background: readout.value >= geometry.baselineValue ? GREEN : BELOW_BLUE,
                }}
              />
              <span className="text-[15px] font-semibold text-ink tabular-nums">
                {formatMoney(readout.value, currency)}
              </span>
            </p>
            <p className="text-[11px] text-ink-3 tabular-nums">{readoutBucket.count} 件</p>
          </div>
        )}

        <p className="sr-only" aria-live="polite">
          {hovered && active !== null
            ? buckets[active].longLabel + " " + formatMoney(hovered.value, currency) +
              " " + buckets[active].count + "件"
            : ""}
        </p>
      </div>

      <figcaption className="text-[11px] text-ink-3">
        単位 {unit}・{periodHeader(granularity)}ごとの純売上（返金差引後）。
        破線より下のみ水色で塗り、線は上で緑・下で赤。矢印キーで期間を移動できます。
      </figcaption>
    </figure>
  );
}

function periodHeader(granularity: Granularity): string {
  return granularity === "day"
    ? "日"
    : granularity === "week"
      ? "週"
      : granularity === "month"
        ? "月"
        : "年";
}

function ChartHeading({
  title, subtitle, tabs, action,
}: {
  title: string;
  subtitle?: string;
  tabs?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tabs}
        {action}
      </div>
    </div>
  );
}
