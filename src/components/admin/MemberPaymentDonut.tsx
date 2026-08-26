/**
 * Paying vs non-paying members as a pie chart.
 *
 * Static — no interactivity — so this stays a plain server component.
 * People with a payment history are filled green; the rest are light blue.
 */

const GREEN = "#16c784";
const LIGHT_BLUE = "#cfe8f9";

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Closed pie slice from `startAngle` to `endAngle` (degrees, 0 = 12 o'clock). */
function pieSlicePath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return "";
  // Full circle cannot be drawn as a single arc from a point to itself.
  if (sweep >= 359.9) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
  }
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const large = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

export function MemberPaymentDonut({ total, paying }: { total: number; paying: number }) {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const r = 72;
  const unpaid = Math.max(total - paying, 0);
  const ratio = total > 0 ? paying / total : 0;
  const payingEnd = ratio * 360;

  const payingPath = total > 0 && paying > 0 ? pieSlicePath(cx, cy, r, 0, payingEnd) : "";
  const unpaidPath =
    total > 0 && unpaid > 0
      ? pieSlicePath(cx, cy, r, paying > 0 ? payingEnd : 0, 360)
      : "";

  return (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`登録会員 ${total} 名中 ${paying} 名が支払い実績あり（${total > 0 ? Math.round(ratio * 100) : 0}%）`}
        >
          {total === 0 ? (
            <circle cx={cx} cy={cy} r={r} fill={LIGHT_BLUE} />
          ) : (
            <>
              {unpaidPath && <path d={unpaidPath} fill={LIGHT_BLUE} />}
              {payingPath && <path d={payingPath} fill={GREEN} />}
            </>
          )}
        </svg>
        <p className="text-[13px] font-semibold tabular-nums text-ink">
          {total > 0 ? `${Math.round(ratio * 100)}%` : "—"}
          <span className="ml-1 text-[11px] font-normal text-ink-3">支払い実績あり</span>
        </p>
      </div>

      <dl className="flex flex-col gap-2 text-[13px]">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: GREEN }} />
          <dt className="text-ink-2">支払い実績あり</dt>
          <dd className="font-semibold tabular-nums text-ink">{paying} 名</dd>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: LIGHT_BLUE }} />
          <dt className="text-ink-2">支払い実績なし</dt>
          <dd className="font-semibold tabular-nums text-ink">{unpaid} 名</dd>
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--border)] pt-2">
          <dt className="text-ink-2">登録会員合計</dt>
          <dd className="font-semibold tabular-nums text-ink">{total} 名</dd>
        </div>
      </dl>
    </div>
  );
}
