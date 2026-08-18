/**
 * A feature x sample expression matrix - the shared currency between the
 * import, statistics and plotting layers.
 *
 * Rows are features (proteins / genes / metabolites / measurements),
 * columns are samples. `values[r][c]` may be null for a missing measurement.
 */
export interface DataMatrix {
  /** Row identifiers, e.g. protein accessions. */
  features: string[];
  /** Optional human-readable label per row, e.g. gene symbol. */
  featureLabels?: string[];
  /** Column identifiers, e.g. sample names. */
  samples: string[];
  values: (number | null)[][];
}

export type TransformMethod =
  | "none"
  | "log2"
  | "log10"
  | "ln"
  | "zscore"
  | "sqrt";

export type NormalizeMethod = "none" | "median" | "sum" | "quantile" | "vsn-lite";

export type ImputeMethod = "none" | "zero" | "min" | "half-min" | "rowmean" | "rowmedian" | "knn";

/** Extracts one row as a plain number array, preserving nulls as NaN. */
export function row(m: DataMatrix, r: number): number[] {
  return m.values[r].map((v) => (v === null ? NaN : v));
}

/** Extracts one column. */
export function column(m: DataMatrix, c: number): number[] {
  return m.values.map((rw) => {
    const v = rw[c];
    return v === null ? NaN : v;
  });
}

export function cloneMatrix(m: DataMatrix): DataMatrix {
  return {
    features: [...m.features],
    featureLabels: m.featureLabels ? [...m.featureLabels] : undefined,
    samples: [...m.samples],
    values: m.values.map((r) => [...r]),
  };
}

/** Applies a per-value transform. Non-positive values become null under logs. */
export function transform(m: DataMatrix, method: TransformMethod): DataMatrix {
  if (method === "none") return cloneMatrix(m);
  const out = cloneMatrix(m);

  if (method === "zscore") {
    // Row-wise standardization.
    for (let r = 0; r < out.values.length; r++) {
      const vals = out.values[r].filter((v): v is number => v !== null && Number.isFinite(v));
      if (vals.length < 2) continue;
      const mu = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(
        vals.reduce((s, v) => s + (v - mu) ** 2, 0) / (vals.length - 1),
      );
      for (let c = 0; c < out.values[r].length; c++) {
        const v = out.values[r][c];
        out.values[r][c] = v === null || sd === 0 ? null : (v - mu) / sd;
      }
    }
    return out;
  }

  const fn: (v: number) => number =
    method === "log2"
      ? (v) => Math.log2(v)
      : method === "log10"
        ? (v) => Math.log10(v)
        : method === "ln"
          ? (v) => Math.log(v)
          : (v) => Math.sqrt(v);

  const needsPositive = method !== "sqrt";
  for (let r = 0; r < out.values.length; r++) {
    for (let c = 0; c < out.values[r].length; c++) {
      const v = out.values[r][c];
      if (v === null) continue;
      if (needsPositive && v <= 0) {
        out.values[r][c] = null;
        continue;
      }
      if (!needsPositive && v < 0) {
        out.values[r][c] = null;
        continue;
      }
      const t = fn(v);
      out.values[r][c] = Number.isFinite(t) ? t : null;
    }
  }
  return out;
}

/** Column-wise normalization to remove loading / injection differences. */
export function normalize(m: DataMatrix, method: NormalizeMethod): DataMatrix {
  if (method === "none") return cloneMatrix(m);
  const out = cloneMatrix(m);
  const nCols = out.samples.length;

  if (method === "quantile") {
    // Rank each column, then map every rank to the mean of that rank across columns.
    const cols: { v: number; r: number }[][] = [];
    for (let c = 0; c < nCols; c++) {
      const entries: { v: number; r: number }[] = [];
      for (let r = 0; r < out.values.length; r++) {
        const v = out.values[r][c];
        if (v !== null && Number.isFinite(v)) entries.push({ v, r });
      }
      entries.sort((a, b) => a.v - b.v);
      cols.push(entries);
    }
    const depth = Math.min(...cols.map((c) => c.length));
    if (depth === 0) return out;
    const refMeans: number[] = [];
    for (let i = 0; i < depth; i++) {
      let s = 0;
      for (let c = 0; c < nCols; c++) {
        // Interpolate when columns have different numbers of observations.
        const pos = (i * (cols[c].length - 1)) / (depth - 1 || 1);
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        s += cols[c][lo].v + (pos - lo) * (cols[c][hi].v - cols[c][lo].v);
      }
      refMeans.push(s / nCols);
    }
    for (let c = 0; c < nCols; c++) {
      const entries = cols[c];
      entries.forEach((e, i) => {
        const pos = (i * (depth - 1)) / (entries.length - 1 || 1);
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        const val = refMeans[lo] + (pos - lo) * (refMeans[hi] - refMeans[lo]);
        out.values[e.r][c] = val;
      });
    }
    return out;
  }

  // median / sum / vsn-lite all rescale each column by a single factor.
  const factors: number[] = [];
  for (let c = 0; c < nCols; c++) {
    const vals: number[] = [];
    for (let r = 0; r < out.values.length; r++) {
      const v = out.values[r][c];
      if (v !== null && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length === 0) {
      factors.push(1);
      continue;
    }
    if (method === "sum") {
      factors.push(vals.reduce((s, v) => s + v, 0));
    } else {
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      factors.push(
        sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
      );
    }
  }
  const usable = factors.filter((f) => Number.isFinite(f) && f !== 0);
  if (usable.length === 0) return out;
  const target = usable.reduce((s, f) => s + f, 0) / usable.length;

  for (let c = 0; c < nCols; c++) {
    const f = factors[c];
    if (!Number.isFinite(f) || f === 0) continue;
    if (method === "vsn-lite") {
      // Additive shift, appropriate once data is already log-scaled.
      const shift = target - f;
      for (let r = 0; r < out.values.length; r++) {
        const v = out.values[r][c];
        if (v !== null) out.values[r][c] = v + shift;
      }
    } else {
      const scale = target / f;
      for (let r = 0; r < out.values.length; r++) {
        const v = out.values[r][c];
        if (v !== null) out.values[r][c] = v * scale;
      }
    }
  }
  return out;
}

/** Fills missing values so downstream PCA/clustering can run. */
export function impute(m: DataMatrix, method: ImputeMethod, k = 5): DataMatrix {
  if (method === "none") return cloneMatrix(m);
  const out = cloneMatrix(m);
  const finite = out.values.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  const globalMin = finite.length ? Math.min(...finite) : 0;

  if (method === "knn") {
    return imputeKnn(out, k);
  }

  for (let r = 0; r < out.values.length; r++) {
    const rowVals = out.values[r].filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    let fill: number;
    switch (method) {
      case "zero":
        fill = 0;
        break;
      case "min":
        fill = globalMin;
        break;
      case "half-min":
        fill = globalMin / 2;
        break;
      case "rowmean":
        fill = rowVals.length ? rowVals.reduce((s, v) => s + v, 0) / rowVals.length : 0;
        break;
      case "rowmedian": {
        if (!rowVals.length) {
          fill = 0;
          break;
        }
        const s = [...rowVals].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        fill = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
        break;
      }
      default:
        fill = 0;
    }
    for (let c = 0; c < out.values[r].length; c++) {
      if (out.values[r][c] === null) out.values[r][c] = fill;
    }
  }
  return out;
}

/** k-nearest-neighbour imputation over features, using observed-column distance. */
function imputeKnn(m: DataMatrix, k: number): DataMatrix {
  const nRows = m.values.length;
  const rowMeans = m.values.map((r) => {
    const v = r.filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
  });

  for (let r = 0; r < nRows; r++) {
    const missingCols = m.values[r]
      .map((v, c) => (v === null ? c : -1))
      .filter((c) => c >= 0);
    if (missingCols.length === 0) continue;

    const neighbours: { d: number; idx: number }[] = [];
    for (let o = 0; o < nRows; o++) {
      if (o === r) continue;
      let s = 0;
      let n = 0;
      for (let c = 0; c < m.samples.length; c++) {
        const a = m.values[r][c];
        const b = m.values[o][c];
        if (a === null || b === null) continue;
        s += (a - b) ** 2;
        n++;
      }
      if (n === 0) continue;
      neighbours.push({ d: Math.sqrt(s / n), idx: o });
    }
    neighbours.sort((a, b) => a.d - b.d);

    for (const c of missingCols) {
      const donors: number[] = [];
      for (const nb of neighbours) {
        const v = m.values[nb.idx][c];
        if (v !== null && Number.isFinite(v)) donors.push(v);
        if (donors.length >= k) break;
      }
      m.values[r][c] = donors.length
        ? donors.reduce((s, v) => s + v, 0) / donors.length
        : rowMeans[r];
    }
  }
  return m;
}

/** Drops features whose observed-value count falls below a fraction of samples. */
export function filterByCompleteness(
  m: DataMatrix,
  minFraction: number,
): { matrix: DataMatrix; dropped: number } {
  const keep: number[] = [];
  const nCols = m.samples.length;
  for (let r = 0; r < m.values.length; r++) {
    const observed = m.values[r].filter(
      (v) => v !== null && Number.isFinite(v),
    ).length;
    if (nCols === 0 || observed / nCols >= minFraction) keep.push(r);
  }
  return {
    matrix: {
      features: keep.map((r) => m.features[r]),
      featureLabels: m.featureLabels ? keep.map((r) => m.featureLabels![r]) : undefined,
      samples: [...m.samples],
      values: keep.map((r) => [...m.values[r]]),
    },
    dropped: m.values.length - keep.length,
  };
}

/** Keeps the N most variable features - the usual pre-step for heatmaps. */
export function topVariableFeatures(m: DataMatrix, n: number): DataMatrix {
  const scored = m.values.map((r, i) => {
    const vals = r.filter((v): v is number => v !== null && Number.isFinite(v));
    if (vals.length < 2) return { i, v: -1 };
    const mu = vals.reduce((s, x) => s + x, 0) / vals.length;
    const varr = vals.reduce((s, x) => s + (x - mu) ** 2, 0) / (vals.length - 1);
    return { i, v: varr };
  });
  scored.sort((a, b) => b.v - a.v);
  const keep = scored.slice(0, Math.max(1, n)).map((s) => s.i).sort((a, b) => a - b);
  return {
    features: keep.map((r) => m.features[r]),
    featureLabels: m.featureLabels ? keep.map((r) => m.featureLabels![r]) : undefined,
    samples: [...m.samples],
    values: keep.map((r) => [...m.values[r]]),
  };
}
