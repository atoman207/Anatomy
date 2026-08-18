/** Descriptive statistics helpers shared by every analysis module. */

/** Drops null/undefined/NaN/Infinity, returning only usable observations. */
export function clean(values: readonly (number | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample variance (n-1 denominator). */
export function variance(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - 1);
}

export function sd(xs: readonly number[]): number {
  return Math.sqrt(variance(xs));
}

/** Standard error of the mean. */
export function sem(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  return sd(xs) / Math.sqrt(xs.length);
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/** Linear-interpolation quantile (matches R type 7 / numpy default). */
export function quantile(xs: readonly number[], p: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (n === 1) return xs[0];
  const s = [...xs].sort((a, b) => a - b);
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export function min(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => (b < a ? b : a), xs[0]) : NaN;
}

export function max(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => (b > a ? b : a), xs[0]) : NaN;
}

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  sem: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
}

export function summarize(values: readonly (number | null | undefined)[]): Summary {
  const xs = clean(values);
  return {
    n: xs.length,
    mean: mean(xs),
    sd: sd(xs),
    sem: sem(xs),
    median: median(xs),
    q1: quantile(xs, 0.25),
    q3: quantile(xs, 0.75),
    min: min(xs),
    max: max(xs),
  };
}

/** Pearson correlation coefficient. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

/** Ranks with ties averaged - the basis for Spearman correlation. */
export function rank(xs: readonly number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k].i] = avg;
    i = j + 1;
  }
  return out;
}

export function spearman(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  return pearson(rank(a.slice(0, n)), rank(b.slice(0, n)));
}
