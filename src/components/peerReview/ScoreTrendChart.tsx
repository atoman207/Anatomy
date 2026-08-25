import { Badge, Card, cx } from "@/components/ui";
import {
  CATEGORY_LABELS, scoreTone, type CategoryScores,
} from "@/lib/ai/peerReviewReport";
import type { ReviewChainEntry } from "@/lib/peerReview/actions";

const TONE_VAR: Record<"good" | "warn" | "danger", string> = {
  good: "var(--good)", warn: "var(--warn)", danger: "var(--danger)",
};

/**
 * "修正前後でスコア推移を可視化する" - a revised draft's re-review chains back
 * to the version it revised (`previous_review_id`), so this renders the
 * whole chain's overall score as a simple line, plus a category-by-category
 * before/after between the two most recent versions. No charting library:
 * a handful of points on a fixed axis is well within what a hand-rolled
 * inline SVG polyline can do clearly.
 */
export function ScoreTrendCard({ chain }: { chain: ReviewChainEntry[] }) {
  if (chain.length < 2) return null;

  const prev = chain[chain.length - 2];
  const current = chain[chain.length - 1];
  const categories = Object.keys(CATEGORY_LABELS) as (keyof CategoryScores)[];

  return (
    <Card
      title="スコア推移（修正前後）"
      subtitle={`これまでの ${chain.length} 回分の査読を比較しています。`}
    >
      <div className="flex flex-col gap-5">
        <OverallScoreLine chain={chain} />

        <div>
          <p className="text-[12px] font-semibold text-ink-2">カテゴリ別の変化（直前の版 → 今回）</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((key) => {
              const before = prev.category_scores[key];
              const after = current.category_scores[key];
              const delta = after - before;
              return (
                <div key={key} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                  <span className="text-[12px] text-ink-2">{CATEGORY_LABELS[key]}</span>
                  <span className="flex items-center gap-1.5 text-[13px] tabular-nums">
                    <span className="text-ink-3">{before}</span>
                    <span className="text-ink-3">→</span>
                    <span className="font-semibold text-ink">{after}</span>
                    <Badge tone={delta > 0 ? "good" : delta < 0 ? "danger" : "neutral"}>
                      {delta > 0 ? `+${delta}` : delta}
                    </Badge>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

const CHART_W = 640;
const CHART_H = 140;
const PAD_X = 24;
const PAD_Y = 16;

function OverallScoreLine({ chain }: { chain: ReviewChainEntry[] }) {
  const n = chain.length;
  const x = (i: number) => (n === 1 ? CHART_W / 2 : PAD_X + (i / (n - 1)) * (CHART_W - 2 * PAD_X));
  const y = (score: number) => PAD_Y + (1 - score / 100) * (CHART_H - 2 * PAD_Y);
  const points = chain.map((c, i) => ({ x: x(i), y: y(c.overall_score), entry: c }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const first = chain[0].overall_score;
  const last = chain[chain.length - 1].overall_score;
  const totalDelta = last - first;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-ink-2">総合評価の推移</p>
        <Badge tone={totalDelta > 0 ? "good" : totalDelta < 0 ? "danger" : "neutral"}>
          {chain.length}回目までの変化: {totalDelta > 0 ? `+${totalDelta}` : totalDelta}
        </Badge>
      </div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-32 w-full" role="img" aria-label="総合評価の推移グラフ">
        {[0, 50, 100].map((gy) => (
          <line
            key={gy}
            x1={PAD_X} x2={CHART_W - PAD_X} y1={y(gy)} y2={y(gy)}
            stroke="var(--border)" strokeWidth={1} strokeDasharray={gy === 0 || gy === 100 ? undefined : "3 3"}
          />
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
        {points.map((p, i) => (
          <circle
            key={i} cx={p.x} cy={p.y} r={4}
            fill={TONE_VAR[scoreTone(p.entry.overall_score)]}
            stroke="var(--surface-1)" strokeWidth={1.5}
          />
        ))}
      </svg>
      <div className={cx("grid text-[10px] text-ink-3", n <= 6 ? "grid-flow-col auto-cols-fr" : "hidden")}>
        {chain.map((c, i) => (
          <span key={c.id} className={cx("truncate", i === 0 ? "text-left" : i === n - 1 ? "text-right" : "text-center")}>
            {new Date(c.created_at).toLocaleDateString("ja-JP")}（{c.overall_score}）
          </span>
        ))}
      </div>
    </div>
  );
}
