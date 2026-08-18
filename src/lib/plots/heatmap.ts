import type { DataMatrix } from "../stats/matrix";
import {
  hierarchical, type DendrogramNode, type Linkage, type DistanceMetric,
} from "../stats/clustering";
import { getTheme, divergingColor, sequentialColor, type Mode } from "./theme";
import { esc, n, svgDocument, truncate } from "./svg";

export type HeatmapScaling = "row-zscore" | "column-zscore" | "none";

export interface HeatmapOptions {
  mode?: Mode;
  title?: string;
  /** Standardization applied before colouring. Row z-score is the default
   *  because it is what makes patterns comparable across features. */
  scaling?: HeatmapScaling;
  clusterRows?: boolean;
  clusterColumns?: boolean;
  linkage?: Linkage;
  metric?: DistanceMetric;
  cellWidth?: number;
  cellHeight?: number;
  showRowLabels?: boolean;
  showColumnLabels?: boolean;
  /** Caps rendered rows; callers should pre-filter to top-variable features. */
  maxRows?: number;
  /** Colour ramp: diverging for z-scores, sequential for raw intensity. */
  ramp?: "diverging" | "sequential";
  /** Optional group assignment per column, drawn as an annotation strip. */
  columnGroups?: (string | null)[];
  columnGroupColors?: Record<string, string>;
}

export interface HeatmapRender {
  svg: string;
  width: number;
  height: number;
  rowOrder: number[];
  columnOrder: number[];
  /** The standardized values actually painted, in original row/col indexing. */
  scaled: (number | null)[][];
  colorLimit: number;
  notes: string[];
}

/**
 * Clustered heatmap.
 *
 * Row z-scores get the diverging blue-grey-red ramp, since sign is meaningful
 * once each feature is centred. Raw intensities get the single-hue sequential
 * ramp instead - a diverging ramp on unsigned data invents a midpoint that
 * does not exist.
 */
export function renderHeatmap(
  matrix: DataMatrix,
  options: HeatmapOptions = {},
): HeatmapRender {
  const {
    mode = "light",
    scaling = "row-zscore",
    clusterRows = true,
    clusterColumns = true,
    linkage = "average",
    metric = "euclidean",
    cellWidth = 34,
    cellHeight = 15,
    showRowLabels = true,
    showColumnLabels = true,
    maxRows = 100,
    columnGroups,
    columnGroupColors = {},
  } = options;
  const theme = getTheme(mode);
  const notes: string[] = [];

  const ramp = options.ramp ?? (scaling === "none" ? "sequential" : "diverging");

  let rows = matrix.values.length;
  const cols = matrix.samples.length;
  let work = matrix;
  if (rows > maxRows) {
    notes.push(`Showing the first ${maxRows} of ${rows} features.`);
    work = {
      ...matrix,
      features: matrix.features.slice(0, maxRows),
      featureLabels: matrix.featureLabels?.slice(0, maxRows),
      values: matrix.values.slice(0, maxRows),
    };
    rows = maxRows;
  }

  // --- standardize ---
  const scaled: (number | null)[][] = work.values.map((r) => [...r]);
  if (scaling === "row-zscore") {
    for (let r = 0; r < rows; r++) {
      const vals = scaled[r].filter((v): v is number => v !== null && Number.isFinite(v));
      if (vals.length < 2) {
        scaled[r] = scaled[r].map(() => null);
        continue;
      }
      const mu = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / (vals.length - 1));
      scaled[r] = scaled[r].map((v) => (v === null || sd === 0 ? null : (v - mu) / sd));
    }
  } else if (scaling === "column-zscore") {
    for (let c = 0; c < cols; c++) {
      const vals: number[] = [];
      for (let r = 0; r < rows; r++) {
        const v = scaled[r][c];
        if (v !== null && Number.isFinite(v)) vals.push(v);
      }
      if (vals.length < 2) continue;
      const mu = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / (vals.length - 1));
      for (let r = 0; r < rows; r++) {
        const v = scaled[r][c];
        scaled[r][c] = v === null || sd === 0 ? null : (v - mu) / sd;
      }
    }
  }

  // --- clustering / ordering ---
  const rowVectors = scaled.map((r) => r.map((v) => (v === null ? 0 : v)));
  const colVectors = Array.from({ length: cols }, (_, c) =>
    scaled.map((r) => (r[c] === null ? 0 : (r[c] as number))),
  );

  let rowTree: DendrogramNode | null = null;
  let colTree: DendrogramNode | null = null;
  let rowOrder = Array.from({ length: rows }, (_, i) => i);
  let columnOrder = Array.from({ length: cols }, (_, i) => i);

  if (clusterRows && rows > 1) {
    const h = hierarchical(rowVectors, { linkage, metric });
    rowTree = h.root;
    rowOrder = h.order;
  }
  if (clusterColumns && cols > 1) {
    const h = hierarchical(colVectors, { linkage, metric });
    colTree = h.root;
    columnOrder = h.order;
  }

  // --- colour limits ---
  const finite = scaled.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  let colorLimit = 1;
  let seqMin = 0;
  let seqMax = 1;
  if (finite.length) {
    if (ramp === "diverging") {
      // Symmetric limit at the 98th percentile keeps outliers from washing
      // out the middle of the ramp.
      const sorted = finite.map(Math.abs).sort((a, b) => a - b);
      colorLimit = sorted[Math.floor(sorted.length * 0.98)] || Math.max(...sorted) || 1;
    } else {
      const sorted = [...finite].sort((a, b) => a - b);
      seqMin = sorted[Math.floor(sorted.length * 0.02)];
      seqMax = sorted[Math.floor(sorted.length * 0.98)];
      if (seqMax === seqMin) seqMax = seqMin + 1;
    }
  }

  // --- layout ---
  const rowDendroW = clusterRows && rowTree ? 68 : 0;
  const colDendroH = clusterColumns && colTree ? 56 : 0;
  const rowLabelW = showRowLabels ? 128 : 8;
  const colLabelH = showColumnLabels ? 84 : 8;
  const groupStripH = columnGroups ? 14 : 0;
  const legendW = 132;
  const padding = 22;
  const titleH = 40;

  const gridLeft = padding + rowDendroW + 6;
  const gridTop = titleH + colLabelH + colDendroH + groupStripH + 6;
  const gridW = cols * cellWidth;
  const gridH = rows * cellHeight;
  const width = gridLeft + gridW + rowLabelW + legendW + padding;
  const height = gridTop + gridH + padding + 12;

  const parts: string[] = [];

  parts.push(
    `<text x="${n(padding)}" y="${n(26)}" fill="${theme.textPrimary}" font-size="14" font-weight="600">${esc(options.title ?? "Heatmap")}</text>`,
  );
  const subtitle = [
    scaling === "row-zscore" ? "row z-score" : scaling === "column-zscore" ? "column z-score" : "raw values",
    clusterRows || clusterColumns ? `${linkage} linkage, ${metric}` : "unclustered",
    `${rows} x ${cols}`,
  ].join(" · ");
  parts.push(
    `<text x="${n(padding)}" y="${n(40)}" fill="${theme.textMuted}" font-size="11">${esc(subtitle)}</text>`,
  );

  // --- cells ---
  for (let ri = 0; ri < rowOrder.length; ri++) {
    const r = rowOrder[ri];
    for (let ci = 0; ci < columnOrder.length; ci++) {
      const c = columnOrder[ci];
      const v = scaled[r][c];
      const xPos = gridLeft + ci * cellWidth;
      const yPos = gridTop + ri * cellHeight;
      let fill: string;
      if (v === null || !Number.isFinite(v)) {
        fill = theme.surfaceAlt;
      } else if (ramp === "diverging") {
        fill = divergingColor(v / colorLimit, theme);
      } else {
        fill = sequentialColor((v - seqMin) / (seqMax - seqMin), theme);
      }
      const raw = work.values[r][c];
      const label = work.featureLabels?.[r] || work.features[r];
      const tip =
        `${label} / ${work.samples[c]}` +
        (raw === null ? " — missing" : ` — ${Number(raw).toPrecision(5)}`) +
        (v !== null && scaling !== "none" ? ` (z ${v.toFixed(2)})` : "");
      // A 1px inset leaves the surface visible between cells.
      parts.push(
        `<rect x="${n(xPos + 0.5)}" y="${n(yPos + 0.5)}" width="${n(cellWidth - 1)}" height="${n(cellHeight - 1)}" fill="${fill}">` +
          `<title>${esc(tip)}</title></rect>`,
      );
    }
  }

  // --- dendrograms ---
  if (rowTree) {
    parts.push(
      dendrogram(rowTree, rowOrder, "left", {
        x: padding, y: gridTop, breadth: rowDendroW - 6,
        span: gridH, step: cellHeight, color: theme.axis,
      }),
    );
  }
  if (colTree) {
    parts.push(
      dendrogram(colTree, columnOrder, "top", {
        x: gridLeft, y: gridTop - groupStripH - 6, breadth: colDendroH - 6,
        span: gridW, step: cellWidth, color: theme.axis,
      }),
    );
  }

  // --- column group annotation strip ---
  if (columnGroups) {
    const stripY = gridTop - groupStripH - 2;
    for (let ci = 0; ci < columnOrder.length; ci++) {
      const c = columnOrder[ci];
      const g = columnGroups[c];
      if (!g) continue;
      const fill = columnGroupColors[g] ?? theme.categorical[0];
      parts.push(
        `<rect x="${n(gridLeft + ci * cellWidth + 0.5)}" y="${n(stripY)}" width="${n(cellWidth - 1)}" height="10" fill="${fill}" rx="2">` +
          `<title>${esc(`${matrix.samples[c]}: ${g}`)}</title></rect>`,
      );
    }
  }

  // --- labels ---
  if (showColumnLabels) {
    for (let ci = 0; ci < columnOrder.length; ci++) {
      const c = columnOrder[ci];
      const xPos = gridLeft + ci * cellWidth + cellWidth / 2;
      const yPos = gridTop - groupStripH - colDendroH - 10;
      parts.push(
        `<text x="${n(xPos)}" y="${n(yPos)}" fill="${theme.textSecondary}" font-size="10.5" ` +
          `text-anchor="start" transform="rotate(-55 ${n(xPos)} ${n(yPos)})">${esc(truncate(matrix.samples[c], 16))}</text>`,
      );
    }
  }
  if (showRowLabels) {
    const maxChars = Math.floor(rowLabelW / 6.2);
    for (let ri = 0; ri < rowOrder.length; ri++) {
      const r = rowOrder[ri];
      const label = work.featureLabels?.[r] || work.features[r];
      parts.push(
        `<text x="${n(gridLeft + gridW + 7)}" y="${n(gridTop + ri * cellHeight + cellHeight / 2 + 3.5)}" ` +
          `fill="${theme.textSecondary}" font-size="${n(Math.min(10.5, cellHeight - 3))}">${esc(truncate(label, maxChars))}</text>`,
      );
    }
  }

  // --- colour bar ---
  const barX = gridLeft + gridW + rowLabelW + 16;
  const barY = gridTop + 6;
  const barH = Math.min(150, Math.max(90, gridH * 0.5));
  const barW = 13;
  const stops = 40;
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const fill =
      ramp === "diverging"
        ? divergingColor(1 - 2 * t, theme)
        : sequentialColor(1 - t, theme);
    parts.push(
      `<rect x="${n(barX)}" y="${n(barY + t * barH)}" width="${n(barW)}" height="${n(barH / stops + 0.8)}" fill="${fill}"/>`,
    );
  }
  const barTop = ramp === "diverging" ? colorLimit : seqMax;
  const barMid = ramp === "diverging" ? 0 : (seqMin + seqMax) / 2;
  const barBottom = ramp === "diverging" ? -colorLimit : seqMin;
  const fmtBar = (v: number) => (Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2));
  parts.push(
    `<text x="${n(barX + barW + 6)}" y="${n(barY + 8)}" fill="${theme.textSecondary}" font-size="10">${esc(fmtBar(barTop))}</text>`,
    `<text x="${n(barX + barW + 6)}" y="${n(barY + barH / 2 + 4)}" fill="${theme.textSecondary}" font-size="10">${esc(fmtBar(barMid))}</text>`,
    `<text x="${n(barX + barW + 6)}" y="${n(barY + barH)}" fill="${theme.textSecondary}" font-size="10">${esc(fmtBar(barBottom))}</text>`,
    `<text x="${n(barX)}" y="${n(barY - 8)}" fill="${theme.textPrimary}" font-size="11" font-weight="600">${esc(scaling === "none" ? "Value" : "z-score")}</text>`,
  );

  if (columnGroups) {
    const uniq = [...new Set(columnGroups.filter((g): g is string => !!g))];
    let ly = barY + barH + 34;
    parts.push(
      `<text x="${n(barX)}" y="${n(ly - 14)}" fill="${theme.textPrimary}" font-size="11" font-weight="600">Group</text>`,
    );
    for (const g of uniq) {
      parts.push(
        `<rect x="${n(barX)}" y="${n(ly - 8)}" width="10" height="10" rx="2" fill="${columnGroupColors[g] ?? theme.categorical[0]}"/>`,
        `<text x="${n(barX + 15)}" y="${n(ly + 1)}" fill="${theme.textSecondary}" font-size="10.5">${esc(truncate(g, 12))}</text>`,
      );
      ly += 16;
    }
  }

  return {
    svg: svgDocument(width, height, theme.surface, parts.join(""), options.title ?? "Heatmap"),
    width,
    height,
    rowOrder,
    columnOrder,
    scaled,
    colorLimit,
    notes,
  };
}

/**
 * Draws a dendrogram beside the matrix. Leaf positions follow `order`, so the
 * tree lines up with the rendered rows/columns.
 */
function dendrogram(
  root: DendrogramNode,
  order: number[],
  side: "left" | "top",
  cfg: {
    x: number; y: number; breadth: number; span: number;
    step: number; color: string;
  },
): string {
  const pos = new Map<number, number>();
  order.forEach((leaf, i) => pos.set(leaf, i * cfg.step + cfg.step / 2));

  let maxH = 0;
  const scan = (nd: DendrogramNode) => {
    maxH = Math.max(maxH, nd.height);
    if (nd.left) scan(nd.left);
    if (nd.right) scan(nd.right);
  };
  scan(root);
  if (maxH <= 0) maxH = 1;

  const segs: string[] = [];

  // Returns the along-axis coordinate of a node's connector.
  const walk = (nd: DendrogramNode): number => {
    if (nd.leaf !== null) return pos.get(nd.leaf) ?? 0;
    const a = walk(nd.left!);
    const b = walk(nd.right!);
    const depth = (nd.height / maxH) * cfg.breadth;
    const depthA = nd.left!.leaf !== null ? 0 : (nd.left!.height / maxH) * cfg.breadth;
    const depthB = nd.right!.leaf !== null ? 0 : (nd.right!.height / maxH) * cfg.breadth;

    if (side === "left") {
      // Depth grows leftward from the matrix edge.
      const xj = cfg.x + cfg.breadth - depth;
      const xa = cfg.x + cfg.breadth - depthA;
      const xb = cfg.x + cfg.breadth - depthB;
      segs.push(
        `<path d="M${n(xa)},${n(cfg.y + a)} H${n(xj)} V${n(cfg.y + b)} H${n(xb)}" fill="none"/>`,
      );
    } else {
      // Depth grows upward from the matrix edge, so leaves touch the grid.
      const yj = cfg.y - depth;
      const ya = cfg.y - depthA;
      const yb = cfg.y - depthB;
      segs.push(
        `<path d="M${n(cfg.x + a)},${n(ya)} V${n(yj)} H${n(cfg.x + b)} V${n(yb)}" fill="none"/>`,
      );
    }
    return (a + b) / 2;
  };
  walk(root);

  return `<g stroke="${cfg.color}" stroke-width="1" stroke-linejoin="round">${segs.join("")}</g>`;
}
