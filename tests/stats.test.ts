import test from "node:test";
import assert from "node:assert/strict";

import {
  erf, normalCdf, normalInv, tCdf, tTwoSidedP, fCdf, fUpperP,
  logGamma, incompleteBeta, studentizedRangeP,
} from "../src/lib/stats/distributions";
import { oneSampleTTest, twoSampleTTest, pairedTTest, mannWhitneyU, tInv } from "../src/lib/stats/ttest";
import { oneWayAnova, kruskalWallis, chiSquareCdf, studentizedRangeCritical } from "../src/lib/stats/anova";
import { adjustPValues } from "../src/lib/stats/multiple";
import { pca, jacobiEigen } from "../src/lib/stats/pca";
import { kMeans, hierarchical, cutTree, distance } from "../src/lib/stats/clustering";
import { differentialAnalysis } from "../src/lib/stats/differential";
import type { DataMatrix } from "../src/lib/stats/matrix";
import { transform, normalize, impute, filterByCompleteness, topVariableFeatures } from "../src/lib/stats/matrix";

const close = (a: number, b: number, tol = 1e-6, msg?: string) =>
  assert.ok(
    Math.abs(a - b) <= tol,
    `${msg ?? "values differ"}: got ${a}, expected ${b} (tol ${tol})`,
  );

/* ------------------------------------------------------------------ */
/* Distributions - checked against closed forms and published values   */
/* ------------------------------------------------------------------ */

test("logGamma matches exact factorials", () => {
  close(logGamma(5), Math.log(24), 1e-10);      // Gamma(5) = 4! = 24
  close(logGamma(1), 0, 1e-10);
  close(logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10);
});

test("erf matches published values", () => {
  close(erf(0), 0, 1e-12);
  close(erf(1), 0.842700792949715, 1e-12);
  close(erf(-1), -0.842700792949715, 1e-12);
  close(erf(2), 0.995322265018953, 1e-12);
});

test("normalCdf and normalInv are consistent and correct", () => {
  close(normalCdf(0), 0.5, 1e-14);
  close(normalCdf(1), 0.841344746068543, 1e-12);
  close(normalCdf(1.959963985), 0.975, 1e-9);
  close(normalInv(0.975), 1.959963985, 1e-6);
  close(normalInv(0.5), 0, 1e-9);
  for (const p of [0.001, 0.05, 0.3, 0.5, 0.8, 0.99]) {
    close(normalCdf(normalInv(p)), p, 1e-6, `roundtrip at p=${p}`);
  }
});

test("incompleteBeta reduces to the uniform CDF when a=b=1", () => {
  close(incompleteBeta(0.5, 1, 1), 0.5, 1e-10);
  close(incompleteBeta(0.25, 1, 1), 0.25, 1e-10);
  // Symmetry: I_x(a,b) = 1 - I_{1-x}(b,a)
  close(incompleteBeta(0.3, 2, 5), 1 - incompleteBeta(0.7, 5, 2), 1e-10);
});

test("t CDF matches the closed forms for df=1 (Cauchy) and df=2", () => {
  // df=1: F(t) = 1/2 + arctan(t)/pi
  close(tCdf(1, 1), 0.75, 1e-8);
  close(tCdf(0, 1), 0.5, 1e-8);
  close(tCdf(-1, 1), 0.25, 1e-8);
  close(tCdf(3, 1), 0.5 + Math.atan(3) / Math.PI, 1e-8);
  // df=2: F(t) = 1/2 + t / (2*sqrt(2 + t^2))
  const f2 = (t: number) => 0.5 + t / (2 * Math.sqrt(2 + t * t));
  close(tCdf(1, 2), f2(1), 1e-8);
  close(tCdf(-2.5, 2), f2(-2.5), 1e-8);
});

test("t CDF converges to the normal at large df", () => {
  close(tCdf(1.96, 100000), normalCdf(1.96), 1e-4);
});

test("tInv reproduces textbook critical values", () => {
  close(tInv(0.975, 10), 2.228138852, 1e-5);
  close(tInv(0.975, 30), 2.042272456, 1e-5);
  close(tInv(0.95, 1), 6.313751515, 1e-4);
});

test("F distribution is consistent with the t distribution: F(1,d) = t(d)^2", () => {
  for (const [t, df] of [[2.0, 5], [1.3, 12], [3.1, 30], [0.7, 8]] as const) {
    close(fUpperP(t * t, 1, df), tTwoSidedP(t, df), 1e-8, `t=${t}, df=${df}`);
  }
  close(fCdf(1, 10, 10), 0.5, 1e-8); // F(1; d, d) is symmetric about 1
});

test("chi-square CDF matches published critical points", () => {
  close(chiSquareCdf(3.841458821, 1), 0.95, 1e-6);
  close(chiSquareCdf(5.991464547, 2), 0.95, 1e-6);
  close(chiSquareCdf(11.070497694, 5), 0.95, 1e-6);
});

test("studentized range critical value reduces to sqrt(2)*t when k=2", () => {
  // q_{alpha}(2, df) = sqrt(2) * t_{1-alpha/2, df}
  for (const df of [10, 20, 60]) {
    const expected = Math.SQRT2 * tInv(0.975, df);
    close(studentizedRangeCritical(0.05, 2, df), expected, 5e-3, `df=${df}`);
  }
});

test("studentized range matches published Tukey table entries", () => {
  // Standard q_{0.05} table values.
  close(studentizedRangeCritical(0.05, 3, 12), 3.773, 0.02);
  close(studentizedRangeCritical(0.05, 4, 20), 3.958, 0.02);
  assert.ok(studentizedRangeP(3.773, 3, 12) > 0.04 && studentizedRangeP(3.773, 3, 12) < 0.06);
});

/* ------------------------------------------------------------------ */
/* t-tests                                                             */
/* ------------------------------------------------------------------ */

test("Welch t-test reproduces the Wikipedia worked example", () => {
  const a1 = [27.5, 21.0, 19.0, 23.6, 17.0, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19.0, 21.7, 21.4];
  const a2 = [27.1, 22.0, 20.8, 23.4, 23.4, 23.5, 25.8, 22.0, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4];
  const r = twoSampleTTest(a1, a2);
  close(r.t, -2.455356, 1e-5, "t statistic");
  close(r.df, 24.988529, 1e-4, "Welch-Satterthwaite df");
  close(r.p, 0.0213, 1e-3, "two-sided p");
});

test("Student t-test with equal variance matches the hand calculation", () => {
  const a = [1, 2, 3, 4, 5];      // mean 3, var 2.5
  const b = [6, 7, 8, 9, 10];     // mean 8, var 2.5
  const r = twoSampleTTest(a, b, { equalVariance: true });
  // sp2 = 2.5, se = sqrt(2.5 * 0.4) = 1, t = (3-8)/1 = -5, df = 8
  close(r.t, -5, 1e-9);
  close(r.df, 8, 1e-12);
  close(r.stderr, 1, 1e-9);
  close(r.p, 2 * (1 - tCdf(5, 8)), 1e-12);
  close(r.cohensD, -5 / Math.sqrt(2.5), 1e-9);
});

test("one-sample t-test and its confidence interval", () => {
  const r = oneSampleTTest([5, 6, 7, 8, 9], 5);
  // mean 7, sd sqrt(2.5)=1.5811, se=0.70711, t=(7-5)/0.70711=2.8284, df=4
  close(r.meanA, 7, 1e-12);
  close(r.stderr, Math.sqrt(2.5 / 5), 1e-12);
  close(r.t, 2 / Math.sqrt(0.5), 1e-9);
  close(r.df, 4, 1e-12);
  const crit = tInv(0.975, 4);
  close(r.ci95[0], 2 - crit * r.stderr, 1e-9);
  close(r.ci95[1], 2 + crit * r.stderr, 1e-9);
});

test("paired t-test equals a one-sample test on the differences", () => {
  const a = [10, 12, 14, 16, 18];
  const b = [8, 11, 13, 14, 17];
  const paired = pairedTTest(a, b);
  const diffs = a.map((v, i) => v - b[i]);
  const one = oneSampleTTest(diffs, 0);
  close(paired.t, one.t, 1e-12);
  close(paired.p, one.p, 1e-12);
  close(paired.df, 4, 1e-12);
});

test("paired t-test drops incomplete pairs and says so", () => {
  const r = pairedTTest([1, 2, 3, null, 5], [0, 1, 2, 4, 4]);
  assert.equal(r.nA, 4);
  assert.ok(r.notes.some((n) => n.includes("incomplete pair")));
});

test("one-sided alternatives split the two-sided p correctly", () => {
  const a = [1, 2, 3, 4, 5];
  const b = [6, 7, 8, 9, 10];
  const two = twoSampleTTest(a, b, { equalVariance: true });
  const less = twoSampleTTest(a, b, { equalVariance: true, alternative: "less" });
  const greater = twoSampleTTest(a, b, { equalVariance: true, alternative: "greater" });
  close(less.p, two.p / 2, 1e-12);
  close(greater.p, 1 - two.p / 2, 1e-12);
});

test("degenerate t-test inputs return NaN with an explanatory note", () => {
  const r = twoSampleTTest([1], [2]);
  assert.ok(Number.isNaN(r.t));
  assert.ok(r.notes.length > 0);
  const z = twoSampleTTest([2, 2, 2], [2, 2, 2]);
  assert.ok(Number.isNaN(z.t));
});

test("Mann-Whitney U on a textbook example", () => {
  // Two clearly separated groups: U should be 0.
  const r = mannWhitneyU([1, 2, 3, 4], [5, 6, 7, 8]);
  close(r.u, 0, 1e-12);
  assert.ok(r.p < 0.05, `expected significant, got p=${r.p}`);
  // Identical groups: U = n1*n2/2.
  const same = mannWhitneyU([1, 2, 3, 4], [1, 2, 3, 4]);
  close(same.u, 8, 1e-12);
  assert.ok(same.p > 0.9);
});

/* ------------------------------------------------------------------ */
/* ANOVA                                                               */
/* ------------------------------------------------------------------ */

test("one-way ANOVA with two groups equals the Student t-test squared", () => {
  const a = [12, 15, 14, 11, 13];
  const b = [18, 21, 19, 22, 20];
  const t = twoSampleTTest(a, b, { equalVariance: true });
  const f = oneWayAnova([{ name: "A", values: a }, { name: "B", values: b }]);
  close(f.f, t.t * t.t, 1e-8, "F = t^2");
  close(f.p, t.p, 1e-9, "p values agree");
  close(f.dfBetween, 1, 1e-12);
  close(f.dfWithin, 8, 1e-12);
});

test("one-way ANOVA sums of squares decompose exactly", () => {
  const groups = [
    { name: "Ctrl", values: [6, 8, 4, 5, 3, 4] },
    { name: "IL1b", values: [8, 12, 9, 11, 6, 8] },
    { name: "TNFa", values: [13, 9, 11, 8, 7, 12] },
  ];
  const r = oneWayAnova(groups);
  close(r.ssTotal, r.ssBetween + r.ssWithin, 1e-9, "SS decomposition");
  close(r.dfTotal, r.dfBetween + r.dfWithin, 1e-12, "df decomposition");
  close(r.dfBetween, 2, 1e-12);
  close(r.dfWithin, 15, 1e-12);
  close(r.msBetween, r.ssBetween / 2, 1e-12);
  close(r.f, r.msBetween / r.msWithin, 1e-12);
  close(r.etaSquared, r.ssBetween / r.ssTotal, 1e-12);
  assert.equal(r.tukey.length, 3); // 3 pairwise comparisons
});

test("Tukey HSD flags the separated pair and not the overlapping one", () => {
  const r = oneWayAnova([
    { name: "A", values: [1, 2, 3, 2, 1] },
    { name: "B", values: [1.5, 2.5, 2, 3, 1] },
    { name: "C", values: [20, 21, 22, 21, 20] },
  ]);
  assert.ok(r.p < 0.001, `omnibus should be significant, got ${r.p}`);
  const ac = r.tukey.find((x) => x.a === "A" && x.b === "C")!;
  const ab = r.tukey.find((x) => x.a === "A" && x.b === "B")!;
  assert.ok(ac.significant, "A vs C should be significant");
  assert.ok(!ab.significant, "A vs B should not be significant");
  // The CI must exclude zero exactly when the pair is flagged significant.
  assert.ok(ac.ci95[0] > 0 || ac.ci95[1] < 0);
  assert.ok(ab.ci95[0] <= 0 && ab.ci95[1] >= 0);
});

test("ANOVA warns on unbalanced designs and tiny groups", () => {
  const r = oneWayAnova([
    { name: "A", values: [1, 2] },
    { name: "B", values: [3, 4, 5, 6, 7, 8] },
  ]);
  assert.ok(r.notes.some((n) => n.includes("Unbalanced")));
  assert.ok(r.notes.some((n) => n.includes("n < 3")));
});

test("Kruskal-Wallis detects a clear group shift", () => {
  const r = kruskalWallis([
    { name: "A", values: [1, 2, 3, 4, 5] },
    { name: "B", values: [11, 12, 13, 14, 15] },
    { name: "C", values: [21, 22, 23, 24, 25] },
  ]);
  close(r.df, 2, 1e-12);
  assert.ok(r.p < 0.01, `expected significant, got p=${r.p}`);
});

/* ------------------------------------------------------------------ */
/* Multiple testing                                                    */
/* ------------------------------------------------------------------ */

test("Benjamini-Hochberg matches the original 1995 worked example", () => {
  const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
  const expected = [0.01, 0.04, 0.084, 0.084, 0.084, 0.1, 0.1057142857, 0.216, 0.216, 0.216];
  const got = adjustPValues(p, "bh");
  got.forEach((v, i) => close(v, expected[i], 1e-9, `index ${i}`));
});

test("BH adjusted values are monotone non-decreasing in p", () => {
  const p = [0.01, 0.02, 0.03, 0.04, 0.05];
  const adj = adjustPValues(p, "bh");
  adj.forEach((v) => close(v, 0.05, 1e-12));
  for (let i = 1; i < adj.length; i++) assert.ok(adj[i] >= adj[i - 1] - 1e-12);
});

test("Bonferroni and Holm behave as defined", () => {
  const p = [0.01, 0.02, 0.03];
  assert.deepEqual(
    adjustPValues(p, "bonferroni").map((v) => Number(v.toFixed(10))),
    [0.03, 0.06, 0.09],
  );
  // Holm: 0.01*3=0.03, 0.02*2=0.04, 0.03*1=0.03 -> monotone -> 0.03,0.04,0.04
  const holm = adjustPValues(p, "holm");
  close(holm[0], 0.03, 1e-12);
  close(holm[1], 0.04, 1e-12);
  close(holm[2], 0.04, 1e-12);
});

test("corrections never exceed 1 and pass NaN through", () => {
  const p = [0.9, 0.95, NaN, 0.99];
  for (const m of ["bonferroni", "holm", "bh", "by"] as const) {
    const adj = adjustPValues(p, m);
    assert.ok(Number.isNaN(adj[2]), `${m} should preserve NaN`);
    adj.filter(Number.isFinite).forEach((v) => assert.ok(v <= 1, `${m} exceeded 1`));
  }
});

test("Benjamini-Yekutieli is uniformly more conservative than BH", () => {
  const p = [0.001, 0.01, 0.02, 0.03, 0.04];
  const bh = adjustPValues(p, "bh");
  const by = adjustPValues(p, "by");
  by.forEach((v, i) => assert.ok(v >= bh[i] - 1e-12, `BY < BH at ${i}`));
});

/* ------------------------------------------------------------------ */
/* PCA                                                                 */
/* ------------------------------------------------------------------ */

test("Jacobi eigendecomposition recovers a known symmetric spectrum", () => {
  // [[2,1],[1,2]] has eigenvalues 3 and 1.
  const { values, vectors } = jacobiEigen([[2, 1], [1, 2]]);
  close(values[0], 3, 1e-10);
  close(values[1], 1, 1e-10);
  // Eigenvectors orthonormal
  const v0 = vectors.map((r) => r[0]);
  const v1 = vectors.map((r) => r[1]);
  close(v0[0] * v1[0] + v0[1] * v1[1], 0, 1e-10, "orthogonality");
  close(Math.hypot(v0[0], v0[1]), 1, 1e-10, "unit length");
});

test("Jacobi handles a diagonal matrix and preserves the trace", () => {
  const m = [[5, 0, 0], [0, 3, 0], [0, 0, 1]];
  const { values } = jacobiEigen(m);
  assert.deepEqual(values.map((v) => Math.round(v)), [5, 3, 1]);
  const bigger = [[4, 1, 2], [1, 5, 3], [2, 3, 6]];
  const spec = jacobiEigen(bigger);
  close(spec.values.reduce((a, b) => a + b, 0), 15, 1e-9, "trace preserved");
});

test("PCA on a rank-1 structure puts all variance on PC1", () => {
  // Every feature is a multiple of the same sample pattern.
  const pattern = [1, 2, 3, 4, 5, 6];
  const matrix: DataMatrix = {
    features: ["f1", "f2", "f3", "f4"],
    samples: ["s1", "s2", "s3", "s4", "s5", "s6"],
    values: [1, 2, 3, 0.5].map((k) => pattern.map((v) => v * k)),
  };
  const r = pca(matrix, { center: true, scale: false });
  close(r.explained[0], 1, 1e-8, "PC1 explains everything");
  assert.ok(r.explained[1] < 1e-8, "PC2 is numerically zero");
});

test("PCA separates two groups along PC1 and explained variance sums to 1", () => {
  const matrix: DataMatrix = {
    features: Array.from({ length: 30 }, (_, i) => `p${i}`),
    samples: ["c1", "c2", "c3", "t1", "t2", "t3"],
    values: Array.from({ length: 30 }, (_, i) =>
      // Controls near 10, treated near 14, with a deterministic ripple.
      [0, 1, 2].map((j) => 10 + Math.sin(i + j) * 0.3)
        .concat([0, 1, 2].map((j) => 14 + Math.cos(i + j) * 0.3)),
    ),
  };
  const r = pca(matrix, { center: true, scale: false });
  const total = r.explained.reduce((a, b) => a + b, 0);
  assert.ok(total > 0.999 && total <= 1.000001, `explained sums to ${total}`);
  const [c1, c2, c3, t1, t2, t3] = r.scores.map((s) => s[0]);
  const ctrlMean = (c1 + c2 + c3) / 3;
  const trtMean = (t1 + t2 + t3) / 3;
  assert.ok(Math.abs(ctrlMean - trtMean) > 1, "groups separate on PC1");
  // Every control is on the same side of the midpoint as its group mean.
  const mid = (ctrlMean + trtMean) / 2;
  assert.ok([c1, c2, c3].every((v) => (v < mid) === (ctrlMean < mid)));
  assert.ok([t1, t2, t3].every((v) => (v < mid) === (trtMean < mid)));
});

test("PCA Gram path and covariance path agree on eigenvalues", () => {
  // 4 samples x 3 features uses the covariance path; transposing the
  // problem shape exercises the Gram path. Build a case with F > n.
  const wide: DataMatrix = {
    features: Array.from({ length: 12 }, (_, i) => `f${i}`),
    samples: ["a", "b", "c", "d"],
    values: Array.from({ length: 12 }, (_, i) =>
      [1, 2, 3, 4].map((s) => Math.sin(i * 1.7 + s) * 5 + s),
    ),
  };
  const r = pca(wide, { center: true });
  // Total variance across components must equal the trace of the covariance.
  assert.ok(r.eigenvalues.every((v) => v >= -1e-9), "no negative eigenvalues");
  const total = r.explained.reduce((a, b) => a + b, 0);
  assert.ok(total > 0.999, `Gram path explained sums to ${total}`);
  assert.equal(r.scores.length, 4);
  assert.ok(r.nComponents <= 3, "at most n-1 components");
});

test("PCA reports rather than throws on degenerate input", () => {
  const r = pca({ features: ["a"], samples: ["s1"], values: [[1]] });
  assert.equal(r.nComponents, 0);
  assert.ok(r.notes.length > 0);
});

test("PCA mean-imputes gaps and notes it", () => {
  const m: DataMatrix = {
    features: ["a", "b", "c"],
    samples: ["s1", "s2", "s3", "s4"],
    values: [[1, 2, null, 4], [2, 4, 6, 8], [1, 1, 2, 3]],
  };
  const r = pca(m);
  assert.ok(r.notes.some((n) => n.includes("missing value")));
  assert.ok(r.scores.every((s) => s.every(Number.isFinite)));
});

/* ------------------------------------------------------------------ */
/* Clustering                                                          */
/* ------------------------------------------------------------------ */

test("distance metrics compute known values", () => {
  close(distance([0, 0], [3, 4], "euclidean"), 5, 1e-12);
  close(distance([0, 0], [3, 4], "manhattan"), 7, 1e-12);
  close(distance([1, 2, 3], [2, 4, 6], "correlation"), 0, 1e-12); // perfectly correlated
  close(distance([1, 0], [1, 0], "cosine"), 0, 1e-12);
  close(distance([1, 0], [0, 1], "cosine"), 1, 1e-12);
});

test("k-means recovers three well-separated blobs", () => {
  const blob = (cx: number, cy: number) =>
    [[cx, cy], [cx + 0.1, cy], [cx, cy + 0.1], [cx - 0.1, cy - 0.1]];
  const data = [...blob(0, 0), ...blob(10, 10), ...blob(0, 10)];
  const r = kMeans(data, 3);
  assert.equal(r.k, 3);
  // Each original blob must land entirely in one cluster.
  for (let b = 0; b < 3; b++) {
    const labels = r.assignments.slice(b * 4, b * 4 + 4);
    assert.equal(new Set(labels).size, 1, `blob ${b} was split`);
  }
  assert.equal(new Set(r.assignments).size, 3, "three distinct clusters");
  assert.ok(r.silhouette > 0.9, `silhouette ${r.silhouette} should be high`);
  assert.deepEqual([...r.sizes].sort(), [4, 4, 4]);
});

test("k-means is deterministic across runs with the same seed", () => {
  const data = Array.from({ length: 40 }, (_, i) => [Math.sin(i) * 5, Math.cos(i * 1.3) * 5]);
  const a = kMeans(data, 4, { seed: 7 });
  const b = kMeans(data, 4, { seed: 7 });
  assert.deepEqual(a.assignments, b.assignments);
  close(a.inertia, b.inertia, 1e-12);
});

test("k-means clamps k to the number of rows", () => {
  const r = kMeans([[1, 1], [2, 2]], 5);
  assert.equal(r.k, 2);
  assert.ok(r.notes.some((n) => n.includes("k reduced")));
});

test("hierarchical clustering builds the expected merge order", () => {
  // Points at 0, 1, 10, 11: {0,1} and {10,11} should merge before the halves join.
  const data = [[0], [1], [10], [11]];
  const r = hierarchical(data, { linkage: "average", metric: "euclidean" });
  assert.ok(r.root);
  close(r.root!.height, 10, 1e-9, "final merge distance");
  const left = r.root!.left!.members.sort();
  const right = r.root!.right!.members.sort();
  const pair = [left, right].map((m) => m.join(",")).sort();
  assert.deepEqual(pair, ["0,1", "2,3"]);
  assert.equal(r.order.length, 4);
  assert.deepEqual([...r.order].sort(), [0, 1, 2, 3]);
});

test("single vs complete linkage give the documented merge heights", () => {
  const data = [[0], [1], [10], [11]];
  const single = hierarchical(data, { linkage: "single" });
  const complete = hierarchical(data, { linkage: "complete" });
  close(single.root!.height, 9, 1e-9);   // min gap between {0,1} and {10,11}
  close(complete.root!.height, 11, 1e-9); // max gap
});

test("cutTree splits a dendrogram into k groups", () => {
  const data = [[0], [1], [10], [11], [20], [21]];
  const r = hierarchical(data, { linkage: "average" });
  const labels = cutTree(r.root, 3);
  assert.equal(new Set(labels).size, 3);
  assert.equal(labels[0], labels[1]);
  assert.equal(labels[2], labels[3]);
  assert.equal(labels[4], labels[5]);
  assert.notEqual(labels[0], labels[2]);
});

test("ward linkage runs and reports Euclidean heights", () => {
  const data = [[0, 0], [0.5, 0.2], [8, 8], [8.2, 7.9]];
  const r = hierarchical(data, { linkage: "ward" });
  assert.ok(r.root);
  assert.ok(r.root!.height > 0);
  assert.equal(r.metric, "euclidean");
});

/* ------------------------------------------------------------------ */
/* Matrix preprocessing                                                */
/* ------------------------------------------------------------------ */

const demo = (): DataMatrix => ({
  features: ["f1", "f2", "f3"],
  samples: ["a", "b", "c", "d"],
  values: [
    [100, 200, 400, 800],
    [10, null, 30, 40],
    [1, 1, 1, 1],
  ],
});

test("log2 transform is exact and rejects non-positive values", () => {
  const t = transform(demo(), "log2");
  close(t.values[0][0] as number, Math.log2(100), 1e-12);
  close(t.values[0][3] as number, Math.log2(800), 1e-12);
  assert.equal(t.values[1][1], null, "null stays null");
  const neg = transform(
    { features: ["x"], samples: ["s"], values: [[-5]] },
    "log2",
  );
  assert.equal(neg.values[0][0], null, "negative becomes null, not NaN");
});

test("z-score transform gives each row mean 0 and sd 1", () => {
  const z = transform(demo(), "zscore");
  const r0 = (z.values[0] as number[]).filter(Number.isFinite);
  const mean = r0.reduce((a, b) => a + b, 0) / r0.length;
  const sd = Math.sqrt(r0.reduce((s, v) => s + (v - mean) ** 2, 0) / (r0.length - 1));
  close(mean, 0, 1e-12);
  close(sd, 1, 1e-12);
  // Constant row cannot be standardized and becomes null rather than NaN.
  assert.ok(z.values[2].every((v) => v === null));
});

test("median normalization equalizes column medians", () => {
  const m: DataMatrix = {
    features: ["a", "b", "c", "d"],
    samples: ["s1", "s2"],
    values: [[1, 10], [2, 20], [3, 30], [4, 40]],
  };
  const n = normalize(m, "median");
  const col = (c: number) => n.values.map((r) => r[c] as number);
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  };
  close(med(col(0)), med(col(1)), 1e-9, "column medians equalized");
});

test("imputation fills every gap without introducing NaN", () => {
  for (const method of ["zero", "min", "half-min", "rowmean", "rowmedian", "knn"] as const) {
    const r = impute(demo(), method);
    const flat = r.values.flat();
    assert.ok(flat.every((v) => v !== null && Number.isFinite(v as number)), `${method} left a gap`);
  }
  const rm = impute(demo(), "rowmean");
  close(rm.values[1][1] as number, (10 + 30 + 40) / 3, 1e-12);
});

test("completeness filter drops sparse features", () => {
  const m: DataMatrix = {
    features: ["keep", "drop"],
    samples: ["a", "b", "c", "d"],
    values: [[1, 2, 3, 4], [1, null, null, null]],
  };
  const { matrix, dropped } = filterByCompleteness(m, 0.75);
  assert.equal(dropped, 1);
  assert.deepEqual(matrix.features, ["keep"]);
});

test("topVariableFeatures keeps the most variable rows", () => {
  const m: DataMatrix = {
    features: ["flat", "wild", "mid"],
    samples: ["a", "b", "c"],
    values: [[5, 5, 5], [1, 50, 100], [4, 5, 6]],
  };
  const r = topVariableFeatures(m, 2);
  assert.equal(r.features.length, 2);
  assert.ok(r.features.includes("wild"));
  assert.ok(!r.features.includes("flat"));
});

/* ------------------------------------------------------------------ */
/* Differential analysis (volcano input)                               */
/* ------------------------------------------------------------------ */

test("differential analysis finds the spiked features and directions", () => {
  // 200 flat features plus 2 spiked up and 1 spiked down, log2 scale.
  const nFlat = 200;
  const features: string[] = [];
  const values: (number | null)[][] = [];
  for (let i = 0; i < nFlat; i++) {
    features.push(`flat${i}`);
    const base = 10 + (i % 5) * 0.01;
    values.push([base, base + 0.02, base - 0.02, base + 0.01, base - 0.01, base]);
  }
  features.push("UP1", "UP2", "DOWN1");
  values.push([10, 10.1, 9.9, 14, 14.1, 13.9]);
  values.push([8, 8.1, 7.9, 12, 12.2, 11.8]);
  values.push([15, 15.1, 14.9, 11, 11.1, 10.9]);

  const m: DataMatrix = { features, samples: ["c1", "c2", "c3", "t1", "t2", "t3"], values };
  // Group A = treated (cols 3,4,5), Group B = control (cols 0,1,2)
  const r = differentialAnalysis(m, [3, 4, 5], [0, 1, 2], "Treated", "Control", {
    test: "welch", correction: "bh", dataIsLog: true, pThreshold: 0.05, fcThreshold: 1,
  });

  const byName = new Map(r.rows.map((x) => [x.feature, x]));
  const up1 = byName.get("UP1")!;
  const down1 = byName.get("DOWN1")!;
  close(up1.log2fc, 4, 1e-9, "UP1 log2FC");
  close(down1.log2fc, -4, 1e-9, "DOWN1 log2FC");
  assert.equal(up1.direction, "up");
  assert.equal(down1.direction, "down");
  assert.equal(byName.get("UP2")!.direction, "up");
  assert.equal(r.counts.up, 2);
  assert.equal(r.counts.down, 1);
  assert.equal(r.rows.length, nFlat + 3);
  // Flat features must not be called significant after FDR control.
  const flatHits = r.rows.filter((x) => x.feature.startsWith("flat") && x.significant);
  assert.equal(flatHits.length, 0, `${flatHits.length} false positives among flat features`);
});

test("fold change on linear data uses the ratio of means", () => {
  const m: DataMatrix = {
    features: ["x"],
    samples: ["a1", "a2", "b1", "b2"],
    values: [[100, 100, 25, 25]],
  };
  const r = differentialAnalysis(m, [0, 1], [2, 3], "A", "B", { dataIsLog: false });
  close(r.rows[0].log2fc, 2, 1e-12); // log2(100/25) = 2
});

test("features without enough replicates are skipped, not crashed on", () => {
  const m: DataMatrix = {
    features: ["ok", "sparse"],
    samples: ["a1", "a2", "b1", "b2"],
    values: [[1, 2, 5, 6], [1, null, null, 6]],
  };
  const r = differentialAnalysis(m, [0, 1], [2, 3], "A", "B");
  assert.equal(r.counts.skipped, 1);
  assert.ok(Number.isNaN(r.rows[1].p));
  assert.ok(r.notes.some((n) => n.includes("replicates")));
});

test("adjusted-vs-raw threshold choice changes the hit count as expected", () => {
  const features = Array.from({ length: 50 }, (_, i) => `f${i}`);
  const values = features.map((_, i) => {
    const shift = i === 0 ? 3 : 0.02 * ((i % 3) - 1);
    return [10, 10.05, 9.95, 10 + shift, 10.05 + shift, 9.95 + shift];
  });
  const m: DataMatrix = { features, samples: ["c1", "c2", "c3", "t1", "t2", "t3"], values };
  const rawHits = differentialAnalysis(m, [3, 4, 5], [0, 1, 2], "T", "C", {
    useAdjusted: false, fcThreshold: 0,
  }).counts;
  const adjHits = differentialAnalysis(m, [3, 4, 5], [0, 1, 2], "T", "C", {
    useAdjusted: true, fcThreshold: 0,
  }).counts;
  assert.ok(
    rawHits.up + rawHits.down >= adjHits.up + adjHits.down,
    "FDR control should not increase the hit count",
  );
});
