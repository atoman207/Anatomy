import { tCdf, tTwoSidedP, normalCdf } from "./distributions";
import { clean, mean, variance, sd } from "./descriptive";

export type Alternative = "two-sided" | "greater" | "less";

export interface TTestResult {
  test: string;
  t: number;
  df: number;
  p: number;
  alternative: Alternative;
  meanA: number;
  meanB: number | null;
  /** meanA - meanB for two-sample tests; meanA - mu for one-sample. */
  diff: number;
  stderr: number;
  ci95: [number, number];
  nA: number;
  nB: number | null;
  /** Cohen's d (pooled sd for Student, average sd for Welch). */
  cohensD: number;
  notes: string[];
}

function pFromAlternative(t: number, df: number, alt: Alternative): number {
  if (!Number.isFinite(t)) return NaN;
  if (alt === "two-sided") return tTwoSidedP(t, df);
  if (alt === "greater") return 1 - tCdf(t, df);
  return tCdf(t, df);
}

/** Inverse t CDF by bisection - used only for confidence intervals. */
export function tInv(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -400;
  let hi = 400;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** One-sample t-test against a hypothesized mean `mu`. */
export function oneSampleTTest(
  values: readonly (number | null | undefined)[],
  mu = 0,
  alternative: Alternative = "two-sided",
): TTestResult {
  const xs = clean(values);
  const n = xs.length;
  const notes: string[] = [];
  if (n < 2) {
    notes.push("少なくとも2つの観測値が必要です。");
    return {
      test: "1標本t検定", t: NaN, df: NaN, p: NaN, alternative,
      meanA: mean(xs), meanB: null, diff: NaN, stderr: NaN,
      ci95: [NaN, NaN], nA: n, nB: null, cohensD: NaN, notes,
    };
  }
  const m = mean(xs);
  const s = sd(xs);
  const stderr = s / Math.sqrt(n);
  const df = n - 1;
  const t = stderr === 0 ? NaN : (m - mu) / stderr;
  if (stderr === 0) notes.push("分散が0のため、t統計量は定義できません。");
  const crit = tInv(0.975, df);
  return {
    test: "1標本t検定",
    t, df,
    p: pFromAlternative(t, df, alternative),
    alternative,
    meanA: m, meanB: null,
    diff: m - mu,
    stderr,
    ci95: [m - mu - crit * stderr, m - mu + crit * stderr],
    nA: n, nB: null,
    cohensD: s === 0 ? NaN : (m - mu) / s,
    notes,
  };
}

/**
 * Two-sample t-test. Welch (unequal variance) by default, which is the
 * safer choice for typical bench data with unbalanced groups.
 */
export function twoSampleTTest(
  a: readonly (number | null | undefined)[],
  b: readonly (number | null | undefined)[],
  opts: { equalVariance?: boolean; alternative?: Alternative } = {},
): TTestResult {
  const { equalVariance = false, alternative = "two-sided" } = opts;
  const xs = clean(a);
  const ys = clean(b);
  const n1 = xs.length;
  const n2 = ys.length;
  const notes: string[] = [];
  const label = equalVariance ? "Studentのt検定" : "Welchのt検定";

  if (n1 < 2 || n2 < 2) {
    notes.push("各群に少なくとも2つの観測値が必要です。");
    return {
      test: label, t: NaN, df: NaN, p: NaN, alternative,
      meanA: mean(xs), meanB: mean(ys), diff: NaN, stderr: NaN,
      ci95: [NaN, NaN], nA: n1, nB: n2, cohensD: NaN, notes,
    };
  }

  const m1 = mean(xs);
  const m2 = mean(ys);
  const v1 = variance(xs);
  const v2 = variance(ys);
  const diff = m1 - m2;

  let stderr: number;
  let df: number;
  let pooledSd: number;

  if (equalVariance) {
    const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
    stderr = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
    pooledSd = Math.sqrt(sp2);
  } else {
    const s1 = v1 / n1;
    const s2 = v2 / n2;
    stderr = Math.sqrt(s1 + s2);
    const num = (s1 + s2) * (s1 + s2);
    const den = (s1 * s1) / (n1 - 1) + (s2 * s2) / (n2 - 1);
    df = den === 0 ? NaN : num / den; // Welch-Satterthwaite
    pooledSd = Math.sqrt((v1 + v2) / 2);
  }

  if (stderr === 0) notes.push("両群の分散が0のため、tは定義できません。");
  if (!equalVariance && Number.isFinite(v1) && Number.isFinite(v2)) {
    const ratio = Math.max(v1, v2) / Math.min(v1, v2 || Number.EPSILON);
    if (ratio > 4) {
      notes.push(
        "群間の分散が4倍以上異なります。Welch補正が実質的に効いています。",
      );
    }
  }
  if (n1 < 3 || n2 < 3) {
    notes.push("nが非常に小さいため、p値の解釈は慎重にしてください。");
  }

  const t = stderr === 0 ? NaN : diff / stderr;
  const crit = tInv(0.975, df);
  return {
    test: label,
    t, df,
    p: pFromAlternative(t, df, alternative),
    alternative,
    meanA: m1, meanB: m2,
    diff, stderr,
    ci95: [diff - crit * stderr, diff + crit * stderr],
    nA: n1, nB: n2,
    cohensD: pooledSd === 0 ? NaN : diff / pooledSd,
    notes,
  };
}

/** Paired t-test. Pairs with a missing value on either side are dropped. */
export function pairedTTest(
  a: readonly (number | null | undefined)[],
  b: readonly (number | null | undefined)[],
  alternative: Alternative = "two-sided",
): TTestResult {
  const diffs: number[] = [];
  const av: number[] = [];
  const bv: number[] = [];
  const n = Math.min(a.length, b.length);
  let dropped = 0;
  for (let i = 0; i < n; i++) {
    // Guard the null/undefined cases explicitly: Number(null) is 0, which
    // would silently turn a missing measurement into a real zero.
    const rawA = a[i];
    const rawB = b[i];
    const x = rawA === null || rawA === undefined ? NaN : Number(rawA);
    const y = rawB === null || rawB === undefined ? NaN : Number(rawB);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      diffs.push(x - y);
      av.push(x);
      bv.push(y);
    } else {
      dropped++;
    }
  }
  const res = oneSampleTTest(diffs, 0, alternative);
  const notes = [...res.notes];
  if (dropped > 0) notes.push(`不完全なペアを ${dropped} 組除外しました。`);
  if (a.length !== b.length) {
    notes.push("入力の長さが異なるため、短い方までで比較しました。");
  }
  return {
    ...res,
    test: "対応のあるt検定",
    meanA: mean(av),
    meanB: mean(bv),
    nA: diffs.length,
    nB: diffs.length,
    notes,
  };
}

/** Mann-Whitney U (Wilcoxon rank-sum) with a normal approximation and tie correction. */
export function mannWhitneyU(
  a: readonly (number | null | undefined)[],
  b: readonly (number | null | undefined)[],
): { u: number; z: number; p: number; nA: number; nB: number; notes: string[] } {
  const xs = clean(a);
  const ys = clean(b);
  const n1 = xs.length;
  const n2 = ys.length;
  const notes: string[] = [];
  if (n1 < 1 || n2 < 1) {
    return { u: NaN, z: NaN, p: NaN, nA: n1, nB: n2, notes: ["空の群があります。"] };
  }
  const all = [...xs.map((v) => ({ v, g: 0 })), ...ys.map((v) => ({ v, g: 1 }))];
  all.sort((p, q) => p.v - q.v);

  // Average ranks across ties, collecting tie-group sizes for the variance fix.
  const ranks = new Array<number>(all.length);
  const tieGroups: number[] = [];
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avg;
    if (j > i) tieGroups.push(j - i + 1);
    i = j + 1;
  }

  let r1 = 0;
  for (let k = 0; k < all.length; k++) if (all[k].g === 0) r1 += ranks[k];

  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);
  const mu = (n1 * n2) / 2;
  const nTot = n1 + n2;
  const tieSum = tieGroups.reduce((s, t) => s + (t * t * t - t), 0);
  const sigma2 =
    ((n1 * n2) / 12) * (nTot + 1 - tieSum / (nTot * (nTot - 1)));
  const sigma = Math.sqrt(sigma2);
  if (tieGroups.length) notes.push("タイがあるため、分散をタイ補正しました。");
  if (n1 < 5 || n2 < 5) {
    notes.push("群あたり n < 5 のため、正規近似は粗いです。");
  }
  // Continuity-corrected z
  const z = sigma === 0 ? NaN : (u1 - mu - Math.sign(u1 - mu) * 0.5) / sigma;
  const p = Number.isFinite(z) ? Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) : NaN;
  return { u, z, p, nA: n1, nB: n2, notes };
}
