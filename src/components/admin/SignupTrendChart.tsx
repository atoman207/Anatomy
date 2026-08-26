"use client";

import { useMemo, useState } from "react";
import { cx } from "@/components/ui";
import {
  bucketKey,
  bucketKeysBetween,
  REPORTING_TIME_ZONE,
  type Granularity,
} from "@/lib/billing/revenue";

const LINE = "#5ba4d9";
const FILL = "#cfe8f9";
const HEIGHT = 140;
const PAD = { top: 12, right: 8, bottom: 24, left: 28 };

type TabId = "day" | "week" | "month" | "year";

const TABS: { id: TabId; label: string; granularity: Granularity; days: number }[] = [
  { id: "day", label: "日", granularity: "day", days: 14 },
  { id: "week", label: "週", granularity: "week", days: 84 },
  { id: "month", label: "月", granularity: "month", days: 365 },
  { id: "year", label: "年", granularity: "year", days: 1825 },
];

function shortLabel(key: string, granularity: Granularity): string {
  const [y, m, d] = key.split("-");
  if (granularity === "year") return y + "年";
  if (granularity === "month") return Number(m) + "月";
  return Number(m) + "/" + Number(d);
}

function buildSeries(
  signedUpAts: string[],
  granularity: Granularity,
  days: number,
  nowMs: number,
): { key: string; label: string; count: number }[] {
  const fromMs = nowMs - days * 24 * 60 * 60 * 1000;
  const keys = bucketKeysBetween(fromMs, nowMs, granularity, REPORTING_TIME_ZONE);
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, 0);

  for (const iso of signedUpAts) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || ms < fromMs || ms > nowMs) continue;
    const key = bucketKey(ms, granularity, REPORTING_TIME_ZONE);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return keys.map((key) => ({
    key,
    label: shortLabel(key, granularity),
    count: counts.get(key) ?? 0,
  }));
}

/**
 * Sign-ups over time under the payment breakdown card.
 *
 * Tabs switch the bucket size (day / week / month / year). Drawn as a light
 * blue area + bar hybrid so sparse counts stay readable.
 */
export function SignupTrendChart({ signedUpAts }: { signedUpAts: string[] }) {
  const [tab, setTab] = useState<TabId>("day");
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const nowMs = useMemo(() => Date.now(), []);
  const series = useMemo(
    () => buildSeries(signedUpAts, active.granularity, active.days, nowMs),
    [signedUpAts, active.granularity, active.days, nowMs],
  );

  const max = Math.max(...series.map((s) => s.count), 1);
  const width = Math.max(series.length * 28, 280);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const points = series.map((s, i) => {
    const x =
      series.length <= 1
        ? PAD.left + plotW / 2
        : PAD.left + (i / (series.length - 1)) * plotW;
    const y = PAD.top + plotH - (s.count / max) * plotH;
    return { ...s, x, y };
  });

  const line =
    points.length === 0
      ? ""
      : points
          .map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1))
          .join(" ");
  const area =
    points.length === 0
      ? ""
      : line +
        " L" +
        points[points.length - 1].x.toFixed(1) +
        " " +
        (PAD.top + plotH).toFixed(1) +
        " L" +
        points[0].x.toFixed(1) +
        " " +
        (PAD.top + plotH).toFixed(1) +
        " Z";

  const tickEvery = Math.max(1, Math.ceil(series.length / 6));
  const totalInRange = series.reduce((s, b) => s + b.count, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink">新規登録の推移</p>
          <p className="text-[11px] text-ink-3">
            この期間の登録 {totalInRange} 名
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="表示単位"
          className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5"
        >
          {TABS.map((t) => {
            const selected = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTab(t.id)}
                className={cx(
                  "rounded px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  selected
                    ? "bg-[var(--text-primary)] text-[var(--surface-1)] shadow-sm"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block min-w-full"
          role="img"
          aria-label={`${active.label}別の新規登録数。期間内合計 ${totalInRange} 名。`}
        >
          {[0, 0.5, 1].map((t) => {
            const y = PAD.top + plotH * (1 - t);
            const v = Math.round(max * t);
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-[10px] tabular-nums"
                >
                  {v}
                </text>
              </g>
            );
          })}

          {area && <path d={area} fill={FILL} opacity="0.85" />}
          {line && (
            <path
              d={line}
              fill="none"
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {points.map((p) => (
            <circle
              key={p.key}
              cx={p.x}
              cy={p.y}
              r={p.count > 0 ? 3 : 2}
              fill={p.count > 0 ? LINE : "var(--surface-1)"}
              stroke={LINE}
              strokeWidth="1.5"
            />
          ))}

          {points.map((p, i) => {
            const isLast = i === points.length - 1;
            if (!isLast && i % tickEvery !== 0) return null;
            return (
              <text
                key={p.key + "-lbl"}
                x={p.x}
                y={HEIGHT - 6}
                textAnchor={isLast ? "end" : "middle"}
                className="fill-[var(--text-muted)] text-[10px] tabular-nums"
              >
                {p.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
