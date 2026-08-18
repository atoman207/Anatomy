/** Multiple-testing corrections for omics-scale comparisons. */

export type CorrectionMethod = "none" | "bonferroni" | "holm" | "bh" | "by";

export const CORRECTION_LABELS: Record<CorrectionMethod, string> = {
  none: "なし（生のp）",
  bonferroni: "Bonferroni（FWER）",
  holm: "Holm-Bonferroni（FWER）",
  bh: "Benjamini-Hochberg（FDR）",
  by: "Benjamini-Yekutieli（FDR）",
};

/**
 * Adjusts p-values in place-order. NaN entries are passed through untouched
 * and excluded from the test count, which matters when some features fail
 * their test because of missing replicates.
 */
export function adjustPValues(
  pValues: readonly number[],
  method: CorrectionMethod = "bh",
): number[] {
  const out = new Array<number>(pValues.length).fill(NaN);
  const valid: { p: number; i: number }[] = [];
  pValues.forEach((p, i) => {
    if (Number.isFinite(p)) valid.push({ p, i });
  });
  const m = valid.length;
  if (m === 0) return out;

  if (method === "none") {
    for (const { p, i } of valid) out[i] = p;
    return out;
  }

  if (method === "bonferroni") {
    for (const { p, i } of valid) out[i] = Math.min(1, p * m);
    return out;
  }

  if (method === "holm") {
    const asc = [...valid].sort((a, b) => a.p - b.p);
    let running = 0;
    asc.forEach((entry, rank) => {
      const adj = Math.min(1, entry.p * (m - rank));
      running = Math.max(running, adj); // enforce monotonicity
      out[entry.i] = running;
    });
    return out;
  }

  // Benjamini-Hochberg, and Benjamini-Yekutieli which scales by the
  // harmonic number to stay valid under arbitrary dependence.
  let cm = 1;
  if (method === "by") {
    cm = 0;
    for (let i = 1; i <= m; i++) cm += 1 / i;
  }
  const desc = [...valid].sort((a, b) => b.p - a.p);
  let prev = 1;
  desc.forEach((entry, k) => {
    const rank = m - k; // rank in ascending order
    const adj = Math.min(1, (entry.p * m * cm) / rank);
    prev = Math.min(prev, adj); // step-up monotonicity
    out[entry.i] = prev;
  });
  return out;
}

/** Count of hypotheses below a threshold, ignoring NaN. */
export function countBelow(values: readonly number[], threshold: number): number {
  let n = 0;
  for (const v of values) if (Number.isFinite(v) && v < threshold) n++;
  return n;
}
