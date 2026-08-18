/**
 * Chart palette and tokens.
 *
 * Slots 1-3 come from the reference palette and clear every all-pairs gate in
 * both modes on their own, so three groups can be separated by colour alone.
 *
 * Slots 4-5 were found by sweeping hue/lightness and re-running the palette
 * validator; the five-slot set passes all-pairs in both modes with CVD in the
 * 6-8 warn band. That band is only legal alongside secondary encoding, so any
 * chart using more than three groups also varies marker shape and ships direct
 * labels plus a table view. Past five, groups fold into "Other" rather than
 * inventing a sixth hue.
 */

export type Mode = "light" | "dark";

export interface PlotTheme {
  mode: Mode;
  surface: string;
  surfaceAlt: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  grid: string;
  axis: string;
  /** Diverging poles + neutral midpoint. */
  divergingLow: string;
  divergingMid: string;
  divergingHigh: string;
  /** Neutral for "not significant" marks. */
  neutral: string;
  /** Categorical slots, in fixed order. Never cycle these. */
  categorical: string[];
  /** Single-hue sequential ramp, light to dark. */
  sequential: string[];
}

export const LIGHT_THEME: PlotTheme = {
  mode: "light",
  surface: "#fcfcfb",
  surfaceAlt: "#f0efec",
  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  textMuted: "#78776f",
  grid: "#e6e5e1",
  axis: "#b8b7b0",
  divergingLow: "#2a78d6",
  divergingMid: "#f0efec",
  divergingHigh: "#e34948",
  neutral: "#a9a8a1",
  categorical: ["#2a78d6", "#eb6834", "#1baf7a", "#cc33cc", "#5822c3"],
  sequential: [
    "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
    "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab",
    "#184f95", "#104281", "#0d366b",
  ],
};

export const DARK_THEME: PlotTheme = {
  mode: "dark",
  surface: "#1a1a19",
  surfaceAlt: "#252523",
  textPrimary: "#ffffff",
  textSecondary: "#c3c2b7",
  textMuted: "#8f8e85",
  grid: "#33322f",
  axis: "#4d4c48",
  divergingLow: "#3987e5",
  divergingMid: "#383835",
  divergingHigh: "#e66767",
  neutral: "#6f6e68",
  categorical: ["#3987e5", "#d95926", "#199e70", "#d742d7", "#682fda"],
  sequential: [
    "#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf",
    "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef",
    "#9ec5f4", "#b7d3f6", "#cde2fb",
  ],
};

export function getTheme(mode: Mode): PlotTheme {
  return mode === "dark" ? DARK_THEME : LIGHT_THEME;
}

/** Marker shapes used as the secondary channel past three groups. */
export const MARKER_SHAPES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "cross",
  "triangle-down",
] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

/** Groups separable by colour alone; the first three slots clear every gate. */
export const COLOR_ONLY_LIMIT = 3;

/** Hard cap on distinct hues. Extra groups fold into "Other". */
export const MAX_GROUPS = 5;

export const OTHER_GROUP = "Other";

export interface GroupStyle {
  name: string;
  color: string;
  shape: MarkerShape;
}

/**
 * Assigns a colour and shape per group.
 *
 * Three or fewer groups are separated by colour alone. Past three, marker
 * shape becomes a second, redundant identity channel, which is what makes the
 * 6-8 CVD band legal and keeps greyscale prints readable. Hues are never
 * cycled: a sixth group folds into "Other" instead of reusing slot 1.
 */
export function groupStyles(
  groups: readonly string[],
  theme: PlotTheme,
): GroupStyle[] {
  const composite = groups.length > COLOR_ONLY_LIMIT;
  return groups.map((name, i) => {
    if (name === OTHER_GROUP || i >= MAX_GROUPS) {
      return { name, color: theme.neutral, shape: "cross" as MarkerShape };
    }
    return {
      name,
      color: theme.categorical[i],
      shape: composite ? MARKER_SHAPES[i] : ("circle" as MarkerShape),
    };
  });
}

/**
 * Folds group labels past the hue cap into a single "Other" bucket, keeping
 * the most frequent groups. Returns labels aligned with the input.
 */
export function foldGroups(labels: readonly string[]): {
  labels: string[];
  order: string[];
  folded: number;
} {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  // Keep first-appearance order among equally common groups so repeated
  // renders of the same data stay stable.
  const firstSeen = new Map<string, number>();
  labels.forEach((l, i) => {
    if (!firstSeen.has(l)) firstSeen.set(l, i);
  });
  const ranked = [...counts.keys()].sort((a, b) => {
    const d = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    return d !== 0 ? d : (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
  });

  if (ranked.length <= MAX_GROUPS) {
    const order = [...ranked].sort(
      (a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0),
    );
    return { labels: [...labels], order, folded: 0 };
  }

  const keep = new Set(ranked.slice(0, MAX_GROUPS - 1));
  const out = labels.map((l) => (keep.has(l) ? l : OTHER_GROUP));
  const order = [
    ...[...keep].sort((a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0)),
    OTHER_GROUP,
  ];
  return { labels: out, order, folded: ranked.length - keep.size };
}

/** True when a legend must also encode shape, not just colour. */
export function usesCompositeEncoding(groupCount: number): boolean {
  return groupCount > COLOR_ONLY_LIMIT;
}

/** Linear interpolation between two hex colours in sRGB. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const k = Math.min(1, Math.max(0, t));
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * k);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * k);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * k);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Maps a value in [-1, 1] onto the diverging ramp, with the neutral midpoint
 * at zero. Used for z-scored heatmaps where sign carries meaning.
 */
export function divergingColor(t: number, theme: PlotTheme): string {
  const k = Math.min(1, Math.max(-1, t));
  if (k >= 0) return mixHex(theme.divergingMid, theme.divergingHigh, k);
  return mixHex(theme.divergingMid, theme.divergingLow, -k);
}

/** Maps a value in [0, 1] onto the single-hue sequential ramp. */
export function sequentialColor(t: number, theme: PlotTheme): string {
  const ramp = theme.sequential;
  const k = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const lo = Math.floor(k);
  const hi = Math.min(ramp.length - 1, lo + 1);
  return mixHex(ramp[lo], ramp[hi], k - lo);
}
