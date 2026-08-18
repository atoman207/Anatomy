import type { PcaResult } from "../stats/pca";
import {
  getTheme, groupStyles, foldGroups, usesCompositeEncoding,
  type Mode, type MarkerShape,
} from "./theme";
import {
  axes, esc, legend, linearScale, marker, n, niceTicks,
  svgDocument, DEFAULT_MARGINS, type Margins,
} from "./svg";

export interface PcaPlotOptions {
  width?: number;
  height?: number;
  mode?: Mode;
  title?: string;
  margins?: Margins;
  /** Component indices to plot, zero-based. Defaults to PC1 vs PC2. */
  xComponent?: number;
  yComponent?: number;
  /** Group label per sample, in `result.sampleNames` order. */
  groups?: (string | null)[];
  showSampleLabels?: boolean;
  /** Draws a 95% normal-theory confidence ellipse per group with n >= 3. */
  showEllipses?: boolean;
  pointSize?: number;
}

export interface PcaPlotRender {
  svg: string;
  width: number;
  height: number;
  points: { sample: string; group: string; x: number; y: number; cx: number; cy: number }[];
  /** True when marker shape carries identity because there are >3 groups. */
  compositeEncoding: boolean;
  notes: string[];
}

/**
 * PCA score plot - one point per sample, positioned by two components.
 *
 * Axis labels always carry the explained variance, because a PCA plot without
 * it invites over-reading separation on a component that holds almost nothing.
 */
export function renderPcaPlot(
  result: PcaResult,
  options: PcaPlotOptions = {},
): PcaPlotRender {
  const {
    width = 720,
    height = 560,
    mode = "light",
    xComponent = 0,
    yComponent = 1,
    showSampleLabels = true,
    showEllipses = true,
    pointSize = 11,
  } = options;
  const theme = getTheme(mode);
  const m = options.margins ?? DEFAULT_MARGINS;
  const notes = [...result.notes];

  const plotLeft = m.left;
  const plotRight = width - m.right;
  const plotTop = m.top;
  const plotBottom = height - m.bottom;

  if (result.nComponents === 0 || result.scores.length === 0) {
    const body =
      `<text x="${n(width / 2)}" y="${n(height / 2)}" text-anchor="middle" fill="${theme.textMuted}" font-size="13">` +
      `Not enough data for a PCA plot</text>`;
    return {
      svg: svgDocument(width, height, theme.surface, body, "PCA plot"),
      width, height, points: [], compositeEncoding: false,
      notes: [...notes, "PCA produced no components."],
    };
  }

  const yc = Math.min(yComponent, result.nComponents - 1);
  const xc = Math.min(xComponent, result.nComponents - 1);
  if (yc === xc) notes.push("Only one component available; both axes show it.");

  const rawGroups = (options.groups ?? result.sampleNames.map(() => null)).map(
    (g) => g ?? "Ungrouped",
  );
  const folded = foldGroups(rawGroups);
  const groups = folded.labels;
  const uniqueGroups = folded.order;
  if (folded.folded > 0) {
    notes.push(
      `${folded.folded} less common group(s) folded into "Other" to avoid reusing a hue.`,
    );
  }
  const styles = groupStyles(uniqueGroups, theme);
  const styleFor = new Map(styles.map((s) => [s.name, s]));
  const composite = usesCompositeEncoding(uniqueGroups.length);
  if (composite) {
    notes.push(
      "More than 3 groups: marker shape carries identity alongside colour.",
    );
  }

  const xs = result.scores.map((s) => s[xc] ?? 0);
  const ys = result.scores.map((s) => s[yc] ?? 0);
  const pad = (arr: number[]) => {
    const lo = Math.min(...arr);
    const hi = Math.max(...arr);
    const span = hi - lo || Math.abs(hi) || 1;
    return [lo - span * 0.12, hi + span * 0.12] as [number, number];
  };
  const xDomain = pad(xs);
  const yDomain = pad(ys);
  const x = linearScale(xDomain, [plotLeft, plotRight]);
  const y = linearScale(yDomain, [plotBottom, plotTop]);

  const points = result.sampleNames.map((sample, i) => ({
    sample,
    group: groups[i],
    x: xs[i],
    y: ys[i],
    cx: x(xs[i]),
    cy: y(ys[i]),
  }));

  const parts: string[] = [];
  const pct = (k: number) =>
    result.explained[k] !== undefined ? (result.explained[k] * 100).toFixed(1) : "0.0";

  parts.push(
    axes({
      x, y,
      xTicks: niceTicks(xDomain, 6),
      yTicks: niceTicks(yDomain, 6),
      plotLeft, plotRight, plotTop, plotBottom,
      gridColor: theme.grid,
      axisColor: theme.axis,
      textColor: theme.textSecondary,
      labelColor: theme.textSecondary,
      xLabel: `PC${xc + 1}  (${pct(xc)}% variance)`,
      yLabel: `PC${yc + 1}  (${pct(yc)}% variance)`,
    }),
  );

  // Zero reference lines: the origin is the centroid of the centred data.
  const zeroDash = `stroke="${theme.axis}" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"`;
  if (x(0) >= plotLeft && x(0) <= plotRight) {
    parts.push(`<line x1="${n(x(0))}" y1="${n(plotTop)}" x2="${n(x(0))}" y2="${n(plotBottom)}" ${zeroDash}/>`);
  }
  if (y(0) >= plotTop && y(0) <= plotBottom) {
    parts.push(`<line x1="${n(plotLeft)}" y1="${n(y(0))}" x2="${n(plotRight)}" y2="${n(y(0))}" ${zeroDash}/>`);
  }

  // Everything data-driven is clipped to the plot rect so a wide ellipse
  // cannot bleed into the title or legend.
  parts.push(`<g clip-path="url(#pca-clip)">`);

  // Confidence ellipses sit under the points so they never hide a sample.
  if (showEllipses) {
    for (const g of uniqueGroups) {
      const members = points.filter((p) => p.group === g);
      if (members.length < 3) continue;
      const ell = confidenceEllipse(members.map((p) => [p.x, p.y]));
      if (!ell) continue;
      const style = styleFor.get(g)!;
      const cxp = x(ell.cx);
      const cyp = y(ell.cy);
      // Convert data-space radii to pixels; the y axis is inverted so the
      // rotation angle flips sign.
      const sx = (x(1) - x(0));
      const sy = (y(1) - y(0));
      const rx = Math.abs(ell.rx * sx);
      const ry = Math.abs(ell.ry * sy);
      const angleDeg = -(ell.angle * 180) / Math.PI;
      parts.push(
        `<ellipse cx="${n(cxp)}" cy="${n(cyp)}" rx="${n(rx)}" ry="${n(ry)}" ` +
          `transform="rotate(${n(angleDeg)} ${n(cxp)} ${n(cyp)})" ` +
          `fill="${style.color}" fill-opacity="0.09" stroke="${style.color}" stroke-opacity="0.45" stroke-width="1.25"/>`,
      );
    }
  }

  for (const p of points) {
    const style = styleFor.get(p.group)!;
    const tip = `${p.sample} — ${p.group} · PC${xc + 1} ${p.x.toFixed(2)}, PC${yc + 1} ${p.y.toFixed(2)}`;
    parts.push(
      marker(style.shape as MarkerShape, p.cx, p.cy, pointSize, style.color, theme.surface, 2, "", tip),
    );
  }

  parts.push(`</g>`);

  if (showSampleLabels) {
    const placed: { cx: number; cy: number }[] = [];
    for (const p of points) {
      const clash = placed.some(
        (q) => Math.abs(q.cx - p.cx) < 40 && Math.abs(q.cy - p.cy) < 11,
      );
      if (clash) continue;
      placed.push({ cx: p.cx, cy: p.cy });
      parts.push(
        `<text x="${n(p.cx)}" y="${n(p.cy - pointSize / 2 - 5)}" text-anchor="middle" ` +
          `fill="${theme.textPrimary}" font-size="10" ` +
          `paint-order="stroke" stroke="${theme.surface}" stroke-width="3" stroke-linejoin="round">${esc(p.sample)}</text>`,
      );
    }
  }

  parts.push(
    `<text x="${n(plotLeft)}" y="${n(plotTop - 22)}" fill="${theme.textPrimary}" font-size="14" font-weight="600">${esc(options.title ?? "PCA score plot")}</text>`,
    `<text x="${n(plotLeft)}" y="${n(plotTop - 7)}" fill="${theme.textMuted}" font-size="11">` +
      `${result.sampleNames.length} samples · ${result.featureNames.length} features · ` +
      `${result.center ? "centred" : "uncentred"}${result.scale ? ", scaled" : ""} · ` +
      `PC1+PC2 = ${((result.cumulative[Math.min(1, result.cumulative.length - 1)] ?? 0) * 100).toFixed(1)}%</text>`,
  );

  // A legend is always present when there is real grouping.
  if (uniqueGroups.length > 1 || uniqueGroups[0] !== "Ungrouped") {
    parts.push(
      legend({
        items: styles.map((s) => ({
          label: `${s.name} (${points.filter((p) => p.group === s.name).length})`,
          color: s.color,
          shape: s.shape,
        })),
        x: plotRight + 22,
        y: plotTop + 12,
        textColor: theme.textSecondary,
        titleColor: theme.textPrimary,
        ring: theme.surface,
        title: "Group",
      }),
    );
  }

  if (showEllipses && uniqueGroups.some((g) => points.filter((p) => p.group === g).length >= 3)) {
    parts.push(
      `<text x="${n(plotRight + 22)}" y="${n(plotTop + 24 + styles.length * 18 + 14)}" fill="${theme.textMuted}" font-size="10">95% ellipse</text>`,
    );
  }

  const defs =
    `<defs><clipPath id="pca-clip">` +
    `<rect x="${n(plotLeft)}" y="${n(plotTop)}" width="${n(plotRight - plotLeft)}" height="${n(plotBottom - plotTop)}"/>` +
    `</clipPath></defs>`;

  return {
    svg: svgDocument(
      width, height, theme.surface, defs + parts.join(""),
      options.title ?? "PCA score plot",
    ),
    width,
    height,
    points,
    compositeEncoding: composite,
    notes,
  };
}

/**
 * 95% confidence ellipse for a 2-D point cloud, from the eigenvectors of its
 * covariance matrix scaled by the chi-square(2) quantile.
 */
function confidenceEllipse(
  pts: [number, number][],
): { cx: number; cy: number; rx: number; ry: number; angle: number } | null {
  const n0 = pts.length;
  if (n0 < 3) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n0;
  const my = pts.reduce((s, p) => s + p[1], 0) / n0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [px, py] of pts) {
    sxx += (px - mx) ** 2;
    syy += (py - my) ** 2;
    sxy += (px - mx) * (py - my);
  }
  sxx /= n0 - 1;
  syy /= n0 - 1;
  sxy /= n0 - 1;

  // Closed-form eigenvalues of the symmetric 2x2 covariance matrix.
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  if (!Number.isFinite(l1) || l1 <= 0) return null;

  // chi-square(2) 95% quantile = -2 ln(0.05) = 5.991
  const k = Math.sqrt(5.991464547);
  const angle = Math.abs(sxy) < 1e-12 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(l1 - sxx, sxy);
  return {
    cx: mx,
    cy: my,
    rx: k * Math.sqrt(Math.max(l1, 0)),
    ry: k * Math.sqrt(Math.max(l2, 0)),
    angle,
  };
}
