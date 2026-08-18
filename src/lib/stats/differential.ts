import type { DataMatrix } from "./matrix";
import { twoSampleTTest, pairedTTest, mannWhitneyU } from "./ttest";
import { adjustPValues, type CorrectionMethod } from "./multiple";
import { clean, mean } from "./descriptive";

export type DiffTest = "welch" | "student" | "paired" | "mannwhitney";

export interface DiffRow {
  feature: string;
  label: string;
  meanA: number;
  meanB: number;
  /** log2(meanA / meanB) - already a difference when data is log-scaled. */
  log2fc: number;
  p: number;
  padj: number;
  t: number;
  df: number;
  nA: number;
  nB: number;
  /** -log10(p) or -log10(padj), whichever the volcano is plotted against. */
  negLog10P: number;
  direction: "up" | "down" | "ns";
  significant: boolean;
}

export interface DiffResult {
  rows: DiffRow[];
  groupA: string;
  groupB: string;
  test: DiffTest;
  correction: CorrectionMethod;
  /** True when input was already log-scaled, so fold change is a subtraction. */
  dataIsLog: boolean;
  pThreshold: number;
  fcThreshold: number;
  useAdjusted: boolean;
  counts: { up: number; down: number; ns: number; tested: number; skipped: number };
  notes: string[];
}

export interface DiffOptions {
  test?: DiffTest;
  correction?: CorrectionMethod;
  /** Set true when values are already log2 - fold change becomes meanA - meanB. */
  dataIsLog?: boolean;
  pThreshold?: number;
  /** Threshold on |log2FC|. */
  fcThreshold?: number;
  /** Apply thresholds to the adjusted p rather than the raw p. */
  useAdjusted?: boolean;
}

/**
 * Per-feature differential test between two sample groups.
 *
 * `groupAIndices` / `groupBIndices` are column indices into `matrix.samples`,
 * so the caller controls the design without this module knowing about
 * sample-sheet semantics.
 */
export function differentialAnalysis(
  matrix: DataMatrix,
  groupAIndices: readonly number[],
  groupBIndices: readonly number[],
  groupALabel: string,
  groupBLabel: string,
  opts: DiffOptions = {},
): DiffResult {
  const {
    test = "welch",
    correction = "bh",
    dataIsLog = true,
    pThreshold = 0.05,
    fcThreshold = 1,
    useAdjusted = true,
  } = opts;

  const notes: string[] = [];
  if (groupAIndices.length < 2 || groupBIndices.length < 2) {
    notes.push("At least 2 replicates per group are needed for a p-value.");
  }
  if (test === "paired" && groupAIndices.length !== groupBIndices.length) {
    notes.push("Paired test requires equal group sizes; falling back to Welch.");
  }
  const effTest: DiffTest =
    test === "paired" && groupAIndices.length !== groupBIndices.length
      ? "welch"
      : test;

  const raw: {
    feature: string;
    label: string;
    meanA: number;
    meanB: number;
    log2fc: number;
    p: number;
    t: number;
    df: number;
    nA: number;
    nB: number;
  }[] = [];
  let skipped = 0;

  for (let r = 0; r < matrix.values.length; r++) {
    const rowVals = matrix.values[r];
    const a = groupAIndices.map((i) => rowVals[i]);
    const b = groupBIndices.map((i) => rowVals[i]);
    const ca = clean(a);
    const cb = clean(b);

    const mA = mean(ca);
    const mB = mean(cb);

    let log2fc: number;
    if (dataIsLog) {
      log2fc = mA - mB;
    } else if (mA > 0 && mB > 0) {
      log2fc = Math.log2(mA / mB);
    } else {
      log2fc = NaN;
    }

    let p = NaN;
    let t = NaN;
    let df = NaN;

    if (ca.length >= 2 && cb.length >= 2) {
      if (effTest === "mannwhitney") {
        const res = mannWhitneyU(a, b);
        p = res.p;
        t = res.z;
        df = NaN;
      } else if (effTest === "paired") {
        const res = pairedTTest(a, b);
        p = res.p;
        t = res.t;
        df = res.df;
      } else {
        const res = twoSampleTTest(a, b, { equalVariance: effTest === "student" });
        p = res.p;
        t = res.t;
        df = res.df;
      }
    } else {
      skipped++;
    }

    raw.push({
      feature: matrix.features[r],
      label: matrix.featureLabels?.[r] || matrix.features[r],
      meanA: mA,
      meanB: mB,
      log2fc,
      p,
      t,
      df,
      nA: ca.length,
      nB: cb.length,
    });
  }

  const padj = adjustPValues(raw.map((x) => x.p), correction);

  const rows: DiffRow[] = raw.map((x, i) => {
    const pUsed = useAdjusted ? padj[i] : x.p;
    const passesP = Number.isFinite(pUsed) && pUsed < pThreshold;
    const passesFc = Number.isFinite(x.log2fc) && Math.abs(x.log2fc) >= fcThreshold;
    const significant = passesP && passesFc;
    return {
      ...x,
      padj: padj[i],
      negLog10P: Number.isFinite(pUsed) ? -Math.log10(Math.max(pUsed, Number.MIN_VALUE)) : NaN,
      direction: significant ? (x.log2fc > 0 ? "up" : "down") : "ns",
      significant,
    };
  });

  const counts = {
    up: rows.filter((r) => r.direction === "up").length,
    down: rows.filter((r) => r.direction === "down").length,
    ns: rows.filter((r) => r.direction === "ns").length,
    tested: rows.filter((r) => Number.isFinite(r.p)).length,
    skipped,
  };

  if (skipped > 0) {
    notes.push(`${skipped} feature(s) lacked enough replicates and have no p-value.`);
  }
  if (counts.tested > 0 && counts.up + counts.down === 0) {
    notes.push("Nothing passed both thresholds - try relaxing them or check normalization.");
  }
  if (!dataIsLog) {
    notes.push("Fold change computed on the linear scale from group means.");
  }

  return {
    rows,
    groupA: groupALabel,
    groupB: groupBLabel,
    test: effTest,
    correction,
    dataIsLog,
    pThreshold,
    fcThreshold,
    useAdjusted,
    counts,
    notes,
  };
}
