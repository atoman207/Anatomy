import { fUpperP, studentizedRangeP, lowerGammaP } from "./distributions";
import { clean, mean, variance } from "./descriptive";

export interface AnovaGroup {
  name: string;
  values: number[];
  n: number;
  mean: number;
  sd: number;
}

export interface TukeyPair {
  a: string;
  b: string;
  diff: number;
  se: number;
  q: number;
  p: number;
  ci95: [number, number];
  significant: boolean;
}

export interface AnovaResult {
  test: string;
  groups: AnovaGroup[];
  /** Between-groups (treatment) terms. */
  dfBetween: number;
  ssBetween: number;
  msBetween: number;
  /** Within-groups (residual/error) terms. */
  dfWithin: number;
  ssWithin: number;
  msWithin: number;
  dfTotal: number;
  ssTotal: number;
  f: number;
  p: number;
  /** Proportion of variance explained. */
  etaSquared: number;
  omegaSquared: number;
  grandMean: number;
  tukey: TukeyPair[];
  notes: string[];
}

/**
 * One-way ANOVA across two or more groups, with Tukey HSD post-hoc
 * comparisons computed on the same residual mean square.
 */
export function oneWayAnova(
  input: readonly { name: string; values: readonly (number | null | undefined)[] }[],
  opts: { alpha?: number; tukey?: boolean } = {},
): AnovaResult {
  const { alpha = 0.05, tukey: runTukey = true } = opts;
  const notes: string[] = [];

  const groups: AnovaGroup[] = input
    .map((g) => {
      const values = clean(g.values);
      return {
        name: g.name,
        values,
        n: values.length,
        mean: mean(values),
        sd: Math.sqrt(variance(values)),
      };
    })
    .filter((g) => {
      if (g.n === 0) {
        notes.push(`群「${g.name}」に使える値がなく、除外しました。`);
        return false;
      }
      return true;
    });

  const k = groups.length;
  const empty = (): AnovaResult => ({
    test: "一元配置ANOVA", groups,
    dfBetween: NaN, ssBetween: NaN, msBetween: NaN,
    dfWithin: NaN, ssWithin: NaN, msWithin: NaN,
    dfTotal: NaN, ssTotal: NaN,
    f: NaN, p: NaN, etaSquared: NaN, omegaSquared: NaN,
    grandMean: NaN, tukey: [], notes,
  });

  if (k < 2) {
    notes.push("ANOVAには少なくとも2群が必要です。");
    return empty();
  }

  const all = groups.flatMap((g) => g.values);
  const N = all.length;
  if (N - k < 1) {
    notes.push("群内誤差項を計算できる観測値が足りません。");
    return empty();
  }

  const grandMean = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    ssBetween += g.n * (g.mean - grandMean) ** 2;
    for (const v of g.values) ssWithin += (v - g.mean) ** 2;
  }
  const ssTotal = ssBetween + ssWithin;
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const f = msWithin === 0 ? NaN : msBetween / msWithin;
  const p = Number.isFinite(f) ? fUpperP(f, dfBetween, dfWithin) : NaN;

  if (msWithin === 0) {
    notes.push("群内分散が0のため、Fは定義できません。");
  }
  if (groups.some((g) => g.n < 3)) {
    notes.push("少なくとも1群で n < 3 です。結果は不安定です。");
  }
  const ns = groups.map((g) => g.n);
  if (Math.max(...ns) !== Math.min(...ns)) {
    notes.push("不均衡デザインです。Tukey HSDは群サイズの調和平均を使います。");
  }
  const vars = groups.filter((g) => g.n > 1).map((g) => g.sd ** 2);
  if (vars.length > 1) {
    const ratio = Math.max(...vars) / (Math.min(...vars) || Number.EPSILON);
    if (ratio > 4) {
      notes.push(
        "最大/最小の群分散が4倍を超えます。等分散の仮定は疑わしいです。",
      );
    }
  }

  const etaSquared = ssTotal === 0 ? NaN : ssBetween / ssTotal;
  const omegaSquared =
    ssTotal + msWithin === 0
      ? NaN
      : (ssBetween - dfBetween * msWithin) / (ssTotal + msWithin);

  const tukey: TukeyPair[] = [];
  if (runTukey && Number.isFinite(msWithin) && msWithin > 0) {
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const gi = groups[i];
        const gj = groups[j];
        const diff = gi.mean - gj.mean;
        // Tukey-Kramer standard error handles unequal n.
        const se = Math.sqrt((msWithin / 2) * (1 / gi.n + 1 / gj.n));
        const q = se === 0 ? NaN : Math.abs(diff) / se;
        const pq = Number.isFinite(q) ? studentizedRangeP(q, k, dfWithin) : NaN;
        const qCrit = studentizedRangeCritical(alpha, k, dfWithin);
        const margin = qCrit * se;
        tukey.push({
          a: gi.name,
          b: gj.name,
          diff,
          se,
          q,
          p: pq,
          ci95: [diff - margin, diff + margin],
          significant: Number.isFinite(pq) ? pq < alpha : false,
        });
      }
    }
  }

  return {
    test: "一元配置ANOVA",
    groups,
    dfBetween, ssBetween, msBetween,
    dfWithin, ssWithin, msWithin,
    dfTotal: N - 1, ssTotal,
    f, p, etaSquared, omegaSquared,
    grandMean, tukey, notes,
  };
}

/** Critical value of the studentized range, found by bisection on its p-value. */
export function studentizedRangeCritical(
  alpha: number,
  k: number,
  df: number,
): number {
  let lo = 0.01;
  let hi = 30;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (studentizedRangeP(mid, k, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Kruskal-Wallis H - the rank-based alternative when ANOVA assumptions
 * do not hold. Uses the chi-square approximation.
 */
export function kruskalWallis(
  input: readonly { name: string; values: readonly (number | null | undefined)[] }[],
): { h: number; df: number; p: number; notes: string[] } {
  const notes: string[] = [];
  const groups = input
    .map((g) => ({ name: g.name, values: clean(g.values) }))
    .filter((g) => g.values.length > 0);
  const k = groups.length;
  if (k < 2) return { h: NaN, df: NaN, p: NaN, notes: ["少なくとも2群が必要です。"] };

  const flat: { v: number; g: number }[] = [];
  groups.forEach((g, gi) => g.values.forEach((v) => flat.push({ v, g: gi })));
  flat.sort((a, b) => a.v - b.v);

  const ranks = new Array<number>(flat.length);
  let tieSum = 0;
  let i = 0;
  while (i < flat.length) {
    let j = i;
    while (j + 1 < flat.length && flat[j + 1].v === flat[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let m = i; m <= j; m++) ranks[m] = avg;
    const t = j - i + 1;
    if (t > 1) tieSum += t * t * t - t;
    i = j + 1;
  }

  const N = flat.length;
  const rankSums = new Array<number>(k).fill(0);
  const ns = new Array<number>(k).fill(0);
  for (let m = 0; m < flat.length; m++) {
    rankSums[flat[m].g] += ranks[m];
    ns[flat[m].g]++;
  }

  let acc = 0;
  for (let g = 0; g < k; g++) acc += (rankSums[g] * rankSums[g]) / ns[g];
  let h = (12 / (N * (N + 1))) * acc - 3 * (N + 1);
  if (tieSum > 0) {
    h /= 1 - tieSum / (N * N * N - N);
    notes.push("タイがあるため、Hをタイ補正しました。");
  }
  const df = k - 1;
  // Chi-square upper tail = regularized upper incomplete gamma.
  const p = 1 - chiSquareCdf(h, df);
  return { h, df, p, notes };
}

/** Chi-square CDF via the regularized lower incomplete gamma function. */
export function chiSquareCdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return lowerGammaP(df / 2, x / 2);
}
