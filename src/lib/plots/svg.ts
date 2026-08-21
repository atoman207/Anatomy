import type { MarkerShape } from "./theme";

/**
 * Encodes an SVG string as a base64 data URI, for embedding a figure
 * directly in the notebook rather than only linking to an exported file.
 *
 * `btoa` only accepts Latin-1, and every plot title or axis label here can
 * contain Japanese text, so the string is UTF-8 encoded first.
 */
export function svgToDataUri(svg: string): string {
  const utf8 = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return `data:image/svg+xml;base64,${btoa(utf8)}`;
}

/** Escapes text destined for SVG markup. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Rounds to a sane number of decimals so SVG output stays compact. */
export function n(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "0";
  return String(Number(v.toFixed(digits)));
}

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert: (px: number) => number;
}

/** Linear scale from a data domain onto a pixel range. */
export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  let [d0, d1] = domain;
  if (!Number.isFinite(d0) || !Number.isFinite(d1)) {
    d0 = 0;
    d1 = 1;
  }
  if (d0 === d1) {
    // Give a degenerate domain some width so marks do not stack on one pixel.
    const pad = Math.abs(d0) > 0 ? Math.abs(d0) * 0.1 : 1;
    d0 -= pad;
    d1 += pad;
  }
  const [r0, r1] = range;
  const fn = ((value: number) =>
    r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)) as Scale;
  fn.domain = [d0, d1];
  fn.range = range;
  fn.invert = (px: number) => d0 + ((px - r0) / (r1 - r0)) * (d1 - d0);
  return fn;
}

/**
 * Human-friendly axis ticks at 1/2/5 x 10^k spacing, always inside the domain.
 */
export function niceTicks(
  domain: [number, number],
  target = 6,
): number[] {
  const [a, b] = domain;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [a];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const raw = (hi - lo) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) {
    // Kill floating point dust like 0.30000000000000004
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}

/** Formats an axis tick compactly. */
export function fmtTick(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-3) return v.toExponential(1).replace("e+", "e");
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(4)));
}

/**
 * Emits a marker path centred at (x, y).
 *
 * Every marker carries a surface-coloured ring so overlapping points stay
 * countable, which matters in a dense volcano or a tight PCA cluster.
 */
export function marker(
  shape: MarkerShape,
  x: number,
  y: number,
  size: number,
  fill: string,
  ring: string,
  ringWidth = 1,
  extra = "",
  title?: string,
): string {
  const r = size / 2;
  const common = `fill="${fill}" stroke="${ring}" stroke-width="${n(ringWidth)}"${extra ? " " + extra : ""}`;
  // A <title> child gives every mark a native browser tooltip, so the SVG
  // stays informative even when exported and opened on its own.
  const tip = title ? `<title>${esc(title)}</title>` : "";
  const wrap = (open: string, tag: string) =>
    tip ? `${open}>${tip}</${tag}>` : `${open}/>`;

  switch (shape) {
    case "square":
      return wrap(
        `<rect x="${n(x - r)}" y="${n(y - r)}" width="${n(size)}" height="${n(size)}" rx="1" ${common}`,
        "rect",
      );
    case "triangle":
      return wrap(
        `<polygon points="${n(x)},${n(y - r)} ${n(x + r)},${n(y + r)} ${n(x - r)},${n(y + r)}" ${common}`,
        "polygon",
      );
    case "triangle-down":
      return wrap(
        `<polygon points="${n(x)},${n(y + r)} ${n(x + r)},${n(y - r)} ${n(x - r)},${n(y - r)}" ${common}`,
        "polygon",
      );
    case "diamond":
      return wrap(
        `<polygon points="${n(x)},${n(y - r)} ${n(x + r)},${n(y)} ${n(x)},${n(y + r)} ${n(x - r)},${n(y)}" ${common}`,
        "polygon",
      );
    case "cross":
      return wrap(
        `<path d="M${n(x - r)},${n(y)} H${n(x + r)} M${n(x)},${n(y - r)} V${n(y + r)}" fill="none" stroke="${fill}" stroke-width="${n(Math.max(2, size / 3))}" stroke-linecap="round"`,
        "path",
      );
    default:
      return wrap(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" ${common}`, "circle");
  }
}

/** Wraps generated content in a complete, standalone SVG document. */
export function svgDocument(
  width: number,
  height: number,
  background: string,
  body: string,
  title: string,
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" `,
    `viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-label="${esc(title)}" `,
    `font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif">`,
    `<title>${esc(title)}</title>`,
    `<rect width="${n(width)}" height="${n(height)}" fill="${background}"/>`,
    body,
    `</svg>`,
  ].join("");
}

/** Standard plot margins. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGINS: Margins = { top: 44, right: 150, bottom: 56, left: 68 };

/**
 * Draws x and y axes with recessive grid lines and tick labels.
 * Returns the markup; the caller positions data marks in the same space.
 */
export function axes(opts: {
  x: Scale;
  y: Scale;
  xTicks: number[];
  yTicks: number[];
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  gridColor: string;
  axisColor: string;
  textColor: string;
  xLabel: string;
  yLabel: string;
  labelColor: string;
  fmt?: (v: number) => string;
}): string {
  const f = opts.fmt ?? fmtTick;
  const parts: string[] = [];

  parts.push(`<g stroke="${opts.gridColor}" stroke-width="1">`);
  for (const t of opts.xTicks) {
    const px = opts.x(t);
    if (px < opts.plotLeft - 0.5 || px > opts.plotRight + 0.5) continue;
    parts.push(`<line x1="${n(px)}" y1="${n(opts.plotTop)}" x2="${n(px)}" y2="${n(opts.plotBottom)}"/>`);
  }
  for (const t of opts.yTicks) {
    const py = opts.y(t);
    if (py < opts.plotTop - 0.5 || py > opts.plotBottom + 0.5) continue;
    parts.push(`<line x1="${n(opts.plotLeft)}" y1="${n(py)}" x2="${n(opts.plotRight)}" y2="${n(py)}"/>`);
  }
  parts.push(`</g>`);

  parts.push(
    `<g stroke="${opts.axisColor}" stroke-width="1">`,
    `<line x1="${n(opts.plotLeft)}" y1="${n(opts.plotBottom)}" x2="${n(opts.plotRight)}" y2="${n(opts.plotBottom)}"/>`,
    `<line x1="${n(opts.plotLeft)}" y1="${n(opts.plotTop)}" x2="${n(opts.plotLeft)}" y2="${n(opts.plotBottom)}"/>`,
    `</g>`,
  );

  parts.push(`<g fill="${opts.textColor}" font-size="11">`);
  for (const t of opts.xTicks) {
    const px = opts.x(t);
    if (px < opts.plotLeft - 0.5 || px > opts.plotRight + 0.5) continue;
    parts.push(
      `<text x="${n(px)}" y="${n(opts.plotBottom + 16)}" text-anchor="middle">${esc(f(t))}</text>`,
    );
  }
  for (const t of opts.yTicks) {
    const py = opts.y(t);
    if (py < opts.plotTop - 0.5 || py > opts.plotBottom + 0.5) continue;
    parts.push(
      `<text x="${n(opts.plotLeft - 8)}" y="${n(py + 4)}" text-anchor="end">${esc(f(t))}</text>`,
    );
  }
  parts.push(`</g>`);

  const cx = (opts.plotLeft + opts.plotRight) / 2;
  const cy = (opts.plotTop + opts.plotBottom) / 2;
  parts.push(
    `<text x="${n(cx)}" y="${n(opts.plotBottom + 40)}" text-anchor="middle" fill="${opts.labelColor}" font-size="12">${esc(opts.xLabel)}</text>`,
    `<text x="${n(opts.plotLeft - 48)}" y="${n(cy)}" text-anchor="middle" fill="${opts.labelColor}" font-size="12" transform="rotate(-90 ${n(opts.plotLeft - 48)} ${n(cy)})">${esc(opts.yLabel)}</text>`,
  );

  return parts.join("");
}

/** Renders a legend column at the right edge. */
export function legend(opts: {
  items: { label: string; color: string; shape?: MarkerShape }[];
  x: number;
  y: number;
  textColor: string;
  ring: string;
  title?: string;
  titleColor?: string;
}): string {
  const parts: string[] = [];
  let cursor = opts.y;
  if (opts.title) {
    parts.push(
      `<text x="${n(opts.x)}" y="${n(cursor)}" fill="${opts.titleColor ?? opts.textColor}" font-size="11" font-weight="600">${esc(opts.title)}</text>`,
    );
    cursor += 18;
  }
  for (const item of opts.items) {
    parts.push(marker(item.shape ?? "circle", opts.x + 5, cursor - 4, 9, item.color, opts.ring, 1));
    parts.push(
      `<text x="${n(opts.x + 16)}" y="${n(cursor)}" fill="${opts.textColor}" font-size="11">${esc(item.label)}</text>`,
    );
    cursor += 18;
  }
  return parts.join("");
}

/** Truncates a label to fit a pixel width at a given font size. */
export function truncate(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  if (maxChars <= 1) return label.slice(0, 1);
  return label.slice(0, maxChars - 1) + "…";
}
