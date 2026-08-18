import type { DiffResult, DiffRow } from "../stats/differential";
import { getTheme, type Mode } from "./theme";
import {
  axes, esc, legend, linearScale, marker, n, niceTicks,
  svgDocument, DEFAULT_MARGINS, type Margins,
} from "./svg";

export interface VolcanoOptions {
  width?: number;
  height?: number;
  mode?: Mode;
  title?: string;
  margins?: Margins;
  /** Number of top hits to label directly on the plot. */
  labelTop?: number;
  /** Explicit features to always label, by feature id or label. */
  highlight?: string[];
  pointSize?: number;
  showThresholdLines?: boolean;
}

export interface VolcanoPoint extends DiffRow {
  cx: number;
  cy: number;
}

export interface VolcanoRender {
  svg: string;
  width: number;
  height: number;
  /** Pixel positions, so a React layer can host hover targets. */
  points: VolcanoPoint[];
  xDomain: [number, number];
  yDomain: [number, number];
  plot: { left: number; right: number; top: number; bottom: number };
}

/**
 * Volcano plot: log2 fold change against significance.
 *
 * Colour is diverging by direction (down / not significant / up) rather than
 * categorical, because the encoded quantity is polarity around zero. The
 * neutral grey midpoint is what "no change" should look like.
 */
export function renderVolcano(
  result: DiffResult,
  options: VolcanoOptions = {},
): VolcanoRender {
  const {
    width = 760,
    height = 560,
    mode = "light",
    labelTop = 12,
    pointSize = 7,
    showThresholdLines = true,
  } = options;
  const theme = getTheme(mode);
  const m = options.margins ?? DEFAULT_MARGINS;
  const title =
    options.title ?? `${result.groupA} vs ${result.groupB}`;

  const plotLeft = m.left;
  const plotRight = width - m.right;
  const plotTop = m.top;
  const plotBottom = height - m.bottom;

  const usable = result.rows.filter(
    (r) => Number.isFinite(r.log2fc) && Number.isFinite(r.negLog10P),
  );

  // Symmetric x domain keeps zero centred, which is what makes the two
  // arms visually comparable.
  const maxAbsFc = usable.reduce(
    (mx, r) => Math.max(mx, Math.abs(r.log2fc)),
    result.fcThreshold || 1,
  );
  const xPad = maxAbsFc * 0.08;
  const xDomain: [number, number] = [-(maxAbsFc + xPad), maxAbsFc + xPad];

  const maxY = usable.reduce((mx, r) => Math.max(mx, r.negLog10P), 1);
  const yDomain: [number, number] = [0, maxY * 1.08 || 1];

  const x = linearScale(xDomain, [plotLeft, plotRight]);
  const y = linearScale(yDomain, [plotBottom, plotTop]);

  const points: VolcanoPoint[] = usable.map((r) => ({
    ...r,
    cx: x(r.log2fc),
    cy: y(r.negLog10P),
  }));

  const colorFor = (d: DiffRow) =>
    d.direction === "up"
      ? theme.divergingHigh
      : d.direction === "down"
        ? theme.divergingLow
        : theme.neutral;

  const parts: string[] = [];

  parts.push(
    axes({
      x, y,
      xTicks: niceTicks(xDomain, 7),
      yTicks: niceTicks(yDomain, 6),
      plotLeft, plotRight, plotTop, plotBottom,
      gridColor: theme.grid,
      axisColor: theme.axis,
      textColor: theme.textSecondary,
      labelColor: theme.textSecondary,
      xLabel: `log2 fold change  (${result.groupA} / ${result.groupB})`,
      yLabel: result.useAdjusted ? "-log10 adjusted p" : "-log10 p",
    }),
  );

  if (showThresholdLines) {
    const dash = `stroke="${theme.axis}" stroke-width="1" stroke-dasharray="4 4"`;
    if (result.fcThreshold > 0) {
      for (const v of [-result.fcThreshold, result.fcThreshold]) {
        const px = x(v);
        if (px >= plotLeft && px <= plotRight) {
          parts.push(`<line x1="${n(px)}" y1="${n(plotTop)}" x2="${n(px)}" y2="${n(plotBottom)}" ${dash}/>`);
        }
      }
    }
    const pyThresh = y(-Math.log10(result.pThreshold));
    if (pyThresh >= plotTop && pyThresh <= plotBottom) {
      parts.push(`<line x1="${n(plotLeft)}" y1="${n(pyThresh)}" x2="${n(plotRight)}" y2="${n(pyThresh)}" ${dash}/>`);
    }
  }

  // Draw non-significant points first so hits sit on top.
  parts.push(`<g clip-path="url(#volcano-clip)">`);
  const ordered = [
    ...points.filter((p) => p.direction === "ns"),
    ...points.filter((p) => p.direction !== "ns"),
  ];
  for (const p of ordered) {
    const isHit = p.direction !== "ns";
    const size = isHit ? pointSize + 1 : pointSize - 1.5;
    const tip = `${p.label} — log2FC ${p.log2fc.toFixed(2)}, p ${fmtP(p.p)}, adj.p ${fmtP(p.padj)}`;
    parts.push(
      marker(
        "circle", p.cx, p.cy, size,
        colorFor(p),
        theme.surface,
        isHit ? 1.5 : 0.75,
        `opacity="${isHit ? 0.95 : 0.5}"`,
        tip,
      ),
    );
  }
  parts.push(`</g>`);

  // Direct labels on the strongest hits, alternating sides to reduce overlap.
  const labelled = pickLabels(points, labelTop, options.highlight ?? []);
  for (const p of labelled) {
    const toRight = p.cx < (plotLeft + plotRight) / 2;
    const lx = p.cx + (toRight ? 9 : -9);
    parts.push(
      `<text x="${n(lx)}" y="${n(p.cy + 3.5)}" text-anchor="${toRight ? "start" : "end"}" ` +
        `fill="${theme.textPrimary}" font-size="10.5" font-weight="500" ` +
        `paint-order="stroke" stroke="${theme.surface}" stroke-width="3" stroke-linejoin="round">${esc(p.label)}</text>`,
    );
  }

  parts.push(
    `<text x="${n(plotLeft)}" y="${n(plotTop - 22)}" fill="${theme.textPrimary}" font-size="14" font-weight="600">${esc(title)}</text>`,
    `<text x="${n(plotLeft)}" y="${n(plotTop - 7)}" fill="${theme.textMuted}" font-size="11">` +
      `${esc(testLabel(result))} · ${esc(correctionLabel(result))} · ${result.counts.tested} features tested</text>`,
  );

  parts.push(
    legend({
      items: [
        { label: `Up (${result.counts.up})`, color: theme.divergingHigh },
        { label: `Down (${result.counts.down})`, color: theme.divergingLow },
        { label: `Not significant (${result.counts.ns})`, color: theme.neutral },
      ],
      x: plotRight + 22,
      y: plotTop + 12,
      textColor: theme.textSecondary,
      titleColor: theme.textPrimary,
      ring: theme.surface,
      title: "Direction",
    }),
  );

  const thresholdNote =
    `|log2FC| ≥ ${result.fcThreshold}` +
    `\n${result.useAdjusted ? "adj. p" : "p"} < ${result.pThreshold}`;
  thresholdNote.split("\n").forEach((line, i) => {
    parts.push(
      `<text x="${n(plotRight + 22)}" y="${n(plotTop + 108 + i * 15)}" fill="${theme.textMuted}" font-size="10.5">${esc(line)}</text>`,
    );
  });

  const defs =
    `<defs><clipPath id="volcano-clip">` +
    `<rect x="${n(plotLeft)}" y="${n(plotTop)}" width="${n(plotRight - plotLeft)}" height="${n(plotBottom - plotTop)}"/>` +
    `</clipPath></defs>`;

  return {
    svg: svgDocument(width, height, theme.surface, defs + parts.join(""), `Volcano plot: ${title}`),
    width,
    height,
    points,
    xDomain,
    yDomain,
    plot: { left: plotLeft, right: plotRight, top: plotTop, bottom: plotBottom },
  };
}

function testLabel(r: DiffResult): string {
  switch (r.test) {
    case "welch": return "Welch t-test";
    case "student": return "Student t-test";
    case "paired": return "Paired t-test";
    case "mannwhitney": return "Mann-Whitney U";
    default: return r.test;
  }
}

function correctionLabel(r: DiffResult): string {
  switch (r.correction) {
    case "bh": return "BH FDR";
    case "by": return "BY FDR";
    case "bonferroni": return "Bonferroni";
    case "holm": return "Holm";
    default: return "no correction";
  }
}

function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "n/a";
  if (p < 1e-4) return p.toExponential(1);
  return p.toFixed(4);
}

/**
 * Chooses which points get a direct label: any explicitly highlighted
 * feature, then the significant hits ranked by combined effect and
 * significance. Never labels every point.
 */
function pickLabels(
  points: VolcanoPoint[],
  topN: number,
  highlight: string[],
): VolcanoPoint[] {
  const wanted = new Set(highlight.map((h) => h.toLowerCase()));
  const forced = points.filter(
    (p) => wanted.has(p.feature.toLowerCase()) || wanted.has(p.label.toLowerCase()),
  );
  const rest = points
    .filter((p) => p.significant && !forced.includes(p))
    .sort(
      (a, b) =>
        Math.abs(b.log2fc) * b.negLog10P - Math.abs(a.log2fc) * a.negLog10P,
    )
    .slice(0, Math.max(0, topN));

  // Drop labels that would collide with one already placed.
  const placed: VolcanoPoint[] = [];
  for (const p of [...forced, ...rest]) {
    const clash = placed.some(
      (q) => Math.abs(q.cx - p.cx) < 44 && Math.abs(q.cy - p.cy) < 12,
    );
    if (!clash) placed.push(p);
  }
  return placed;
}
