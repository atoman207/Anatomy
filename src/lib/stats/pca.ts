import type { DataMatrix } from "./matrix";

export interface PcaResult {
  /** Sample scores: one row per sample, one column per component. */
  scores: number[][];
  /** Feature loadings: one row per feature, one column per component. */
  loadings: number[][];
  /** Eigenvalue per component, descending. */
  eigenvalues: number[];
  /** Fraction of total variance per component (0-1). */
  explained: number[];
  /** Running total of `explained`. */
  cumulative: number[];
  sampleNames: string[];
  featureNames: string[];
  nComponents: number;
  center: boolean;
  scale: boolean;
  notes: string[];
}

/**
 * Symmetric eigendecomposition by the cyclic Jacobi method.
 *
 * Chosen over a power-iteration SVD because it is unconditionally stable for
 * the small symmetric covariance matrices PCA produces here (samples are
 * rarely more than a few dozen), and returns a full orthogonal basis.
 * Returns eigenvalues sorted descending with matching eigenvector columns.
 */
export function jacobiEigen(
  input: number[][],
  maxSweeps = 100,
): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((r) => [...r]);
  // v accumulates the rotations; its columns end up as eigenvectors.
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    }
    if (off < 1e-22) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({
    value: a[i][i],
    vector: v.map((r) => r[i]),
  }));
  pairs.sort((x, y) => y.value - x.value);
  return {
    values: pairs.map((p) => p.value),
    // Column j of `vectors` is eigenvector j.
    vectors: Array.from({ length: n }, (_, i) => pairs.map((p) => p.vector[i])),
  };
}

/**
 * PCA on samples. The matrix arrives feature x sample, so it is transposed
 * to observations (samples) x variables (features) first, which is what
 * researchers expect a "PCA plot" to show: one point per sample.
 *
 * Missing values are mean-imputed per feature before decomposition; run an
 * explicit impute step first if you want different behaviour.
 */
export function pca(
  m: DataMatrix,
  opts: { center?: boolean; scale?: boolean; nComponents?: number } = {},
): PcaResult {
  const { center = true, scale = false } = opts;
  const notes: string[] = [];
  const nFeatures = m.values.length;
  const nSamples = m.samples.length;

  if (nSamples < 2 || nFeatures < 2) {
    return {
      scores: [], loadings: [], eigenvalues: [], explained: [], cumulative: [],
      sampleNames: [...m.samples], featureNames: [...m.features],
      nComponents: 0, center, scale,
      notes: ["PCAには少なくとも2サンプルと2特徴量が必要です。"],
    };
  }

  // X: samples x features, with per-feature mean imputation of gaps.
  const X: number[][] = Array.from({ length: nSamples }, () =>
    new Array<number>(nFeatures).fill(0),
  );
  let imputed = 0;
  const keptFeatures: number[] = [];
  for (let f = 0; f < nFeatures; f++) {
    const vals = m.values[f];
    const obs = vals.filter((v): v is number => v !== null && Number.isFinite(v));
    if (obs.length === 0) continue;
    const mu = obs.reduce((s, v) => s + v, 0) / obs.length;
    for (let s = 0; s < nSamples; s++) {
      const v = vals[s];
      if (v === null || !Number.isFinite(v)) {
        X[s][f] = mu;
        imputed++;
      } else {
        X[s][f] = v;
      }
    }
    keptFeatures.push(f);
  }
  if (imputed > 0) {
    notes.push(`欠損値 ${imputed} 件を特徴量の平均で埋めました。`);
  }
  if (keptFeatures.length < nFeatures) {
    notes.push(`すべて欠損の特徴量を ${nFeatures - keptFeatures.length} 件除外しました。`);
  }

  const F = keptFeatures.length;
  if (F < 2) {
    return {
      scores: [], loadings: [], eigenvalues: [], explained: [], cumulative: [],
      sampleNames: [...m.samples], featureNames: [],
      nComponents: 0, center, scale,
      notes: [...notes, "使える特徴量が2つ未満です。"],
    };
  }

  // Compact X down to the kept features.
  const Xc: number[][] = X.map((r) => keptFeatures.map((f) => r[f]));

  // Center and optionally scale each feature (column).
  const means = new Array<number>(F).fill(0);
  const sds = new Array<number>(F).fill(1);
  for (let f = 0; f < F; f++) {
    let s = 0;
    for (let i = 0; i < nSamples; i++) s += Xc[i][f];
    means[f] = s / nSamples;
  }
  if (center) {
    for (let i = 0; i < nSamples; i++)
      for (let f = 0; f < F; f++) Xc[i][f] -= means[f];
  }
  if (scale) {
    let constant = 0;
    for (let f = 0; f < F; f++) {
      let s = 0;
      for (let i = 0; i < nSamples; i++) {
        const d = Xc[i][f] - (center ? 0 : means[f]);
        s += d * d;
      }
      const v = Math.sqrt(s / (nSamples - 1));
      if (v === 0 || !Number.isFinite(v)) {
        sds[f] = 1;
        constant++;
      } else {
        sds[f] = v;
        for (let i = 0; i < nSamples; i++) Xc[i][f] /= v;
      }
    }
    if (constant) notes.push(`分散0の特徴量 ${constant} 件はスケールしませんでした。`);
  }

  // With F >> nSamples, decompose the small nSamples x nSamples Gram matrix
  // instead of the F x F covariance matrix. Both share nonzero eigenvalues.
  const useGram = F > nSamples;
  const dim = useGram ? nSamples : F;
  const C: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));

  if (useGram) {
    for (let i = 0; i < nSamples; i++) {
      for (let j = i; j < nSamples; j++) {
        let s = 0;
        for (let f = 0; f < F; f++) s += Xc[i][f] * Xc[j][f];
        const val = s / (nSamples - 1);
        C[i][j] = val;
        C[j][i] = val;
      }
    }
  } else {
    for (let p = 0; p < F; p++) {
      for (let q = p; q < F; q++) {
        let s = 0;
        for (let i = 0; i < nSamples; i++) s += Xc[i][p] * Xc[i][q];
        const val = s / (nSamples - 1);
        C[p][q] = val;
        C[q][p] = val;
      }
    }
  }

  const { values, vectors } = jacobiEigen(C);
  const totalVar = values.reduce((s, v) => s + Math.max(0, v), 0);
  const maxComp = Math.min(
    opts.nComponents ?? Math.min(nSamples - 1, F),
    dim,
    Math.min(nSamples - 1, F),
  );
  const nComponents = Math.max(1, maxComp);

  const eigenvalues: number[] = [];
  const scores: number[][] = Array.from({ length: nSamples }, () => [] as number[]);
  const loadings: number[][] = Array.from({ length: F }, () => [] as number[]);

  for (let k = 0; k < nComponents; k++) {
    const ev = values[k];
    eigenvalues.push(ev);

    if (useGram) {
      // Gram eigenvector u (length nSamples) gives scores directly:
      // score_k = u_k * sqrt(lambda_k * (n-1)).
      const u = vectors.map((r) => r[k]);
      const normFactor = Math.sqrt(Math.max(0, ev) * (nSamples - 1));
      for (let i = 0; i < nSamples; i++) scores[i].push(u[i] * normFactor);
      // Loadings = X^T u / sqrt(lambda*(n-1)), normalized to unit length.
      const load = new Array<number>(F).fill(0);
      for (let f = 0; f < F; f++) {
        let s = 0;
        for (let i = 0; i < nSamples; i++) s += Xc[i][f] * u[i];
        load[f] = s;
      }
      const norm = Math.sqrt(load.reduce((s, v) => s + v * v, 0)) || 1;
      for (let f = 0; f < F; f++) loadings[f].push(load[f] / norm);
    } else {
      const w = vectors.map((r) => r[k]);
      for (let f = 0; f < F; f++) loadings[f].push(w[f]);
      for (let i = 0; i < nSamples; i++) {
        let s = 0;
        for (let f = 0; f < F; f++) s += Xc[i][f] * w[f];
        scores[i].push(s);
      }
    }
  }

  const explained = eigenvalues.map((v) =>
    totalVar > 0 ? Math.max(0, v) / totalVar : 0,
  );
  const cumulative: number[] = [];
  let run = 0;
  for (const e of explained) {
    run += e;
    cumulative.push(run);
  }

  if (nSamples < 3) {
    notes.push("サンプルが2つだけのとき、PCAは最大1成分です。");
  }

  return {
    scores,
    loadings,
    eigenvalues,
    explained,
    cumulative,
    sampleNames: [...m.samples],
    featureNames: keptFeatures.map((f) => m.features[f]),
    nComponents,
    center,
    scale,
    notes,
  };
}
