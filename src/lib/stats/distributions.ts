/**
 * Probability distributions used for p-value computation.
 *
 * Everything here is pure and dependency-free so the numbers can be unit
 * tested against published reference values (see tests/stats.test.ts).
 */

/** Lanczos approximation of ln|Gamma(x)|. Accurate to ~15 significant digits. */
export function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula: Gamma(x)Gamma(1-x) = pi / sin(pi*x)
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** ln B(a,b) - the log of the beta function. */
export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/**
 * Continued-fraction expansion for the incomplete beta integral, evaluated
 * with the modified Lentz algorithm (Numerical Recipes 6.4).
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  const EPS = 3e-16;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    // Even step
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    // Odd step
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a,b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // The continued fraction converges quickly only for x < (a+1)/(a+b+2);
  // outside that range use the symmetry I_x(a,b) = 1 - I_{1-x}(b,a).
  if (x < (a + 1) / (a + b + 2)) {
    const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b));
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  const front = Math.exp(b * Math.log(1 - x) + a * Math.log(x) - logBeta(b, a));
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * Regularized lower incomplete gamma P(a,x), by series below the transition
 * point and by continued fraction above it (Numerical Recipes 6.2).
 */
export function lowerGammaP(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  const lg = logGamma(a);

  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lg);
  }

  const TINY = 1e-300;
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lg) * h;
}

/** Regularized upper incomplete gamma Q(a,x) = 1 - P(a,x). */
export function upperGammaQ(a: number, x: number): number {
  return 1 - lowerGammaP(a, x);
}

/**
 * Error function, via erf(x) = P(1/2, x^2).
 *
 * The usual rational approximation only reaches ~1e-7, which is visible as
 * a wrong 8th digit in normalCdf(0). Routing through the incomplete gamma
 * costs a few iterations and lands near machine precision.
 */
export function erf(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  return sign * lowerGammaP(0.5, x * x);
}

/** Complementary error function. */
export function erfc(x: number): number {
  return 1 - erf(x);
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Inverse standard normal CDF (Acklam algorithm, ~1e-9 accuracy). */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pl = 0.02425;
  let q: number;
  let r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** CDF of Student t with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  const p = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - p : p;
}

/** Two-sided p-value for a t statistic. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return NaN;
  return Math.min(1, 2 * (1 - tCdf(Math.abs(t), df)));
}

/** CDF of the F distribution with (df1, df2) degrees of freedom. */
export function fCdf(f: number, df1: number, df2: number): number {
  if (f <= 0) return 0;
  if (!Number.isFinite(f)) return 1;
  return incompleteBeta((df1 * f) / (df1 * f + df2), df1 / 2, df2 / 2);
}

/** Upper-tail p-value for an F statistic. */
export function fUpperP(f: number, df1: number, df2: number): number {
  if (!Number.isFinite(f) || f < 0) return NaN;
  return Math.min(1, Math.max(0, 1 - fCdf(f, df1, df2)));
}

/**
 * Upper-tail probability of the studentized range distribution, used for
 * Tukey HSD. Simpson quadrature over the chi density of s, with an inner
 * Simpson integral for the range CDF of k standard normals.
 */
export function studentizedRangeP(q: number, k: number, df: number): number {
  if (!(q > 0) || k < 2 || df < 1) return NaN;

  const rangeCdf = (qq: number): number => {
    if (qq <= 0) return 0;
    const lo = -8.5;
    const hi = 8.5 + qq;
    const n = 360;
    const h = (hi - lo) / n;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const z = lo + i * h;
      const inner = normalCdf(z) - normalCdf(z - qq);
      if (inner <= 0) continue;
      const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
      const val = k * phi * Math.pow(inner, k - 1);
      const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
      sum += w * val;
    }
    return Math.min(1, Math.max(0, (sum * h) / 3));
  };

  // Integrate over the sampling distribution of s = sqrt(chi2_df / df).
  const n = 240;
  const lo = 1e-9;
  const hi = 1 + 6 / Math.sqrt(df);
  const h = (hi - lo) / n;
  const logConst =
    (1 - df / 2) * Math.log(2) + (df / 2) * Math.log(df) - logGamma(df / 2);
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const s = lo + i * h;
    const logDens = logConst + (df - 1) * Math.log(s) - (df * s * s) / 2;
    const dens = Math.exp(logDens);
    if (!Number.isFinite(dens) || dens === 0) continue;
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    acc += w * dens * rangeCdf(q * s);
  }
  const cdf = (acc * h) / 3;
  return Math.min(1, Math.max(0, 1 - cdf));
}
