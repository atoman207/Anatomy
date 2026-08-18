import type { DataMatrix } from "../stats/matrix";

/**
 * Deterministic demo dataset, so the tools can be tried without hunting for a
 * file and so screenshots and tests stay reproducible.
 *
 * Shape mirrors a small chondrocyte proteomics experiment: log2 intensities,
 * four conditions in triplicate, a handful of genuinely regulated proteins,
 * and a realistic sprinkle of missing values.
 */
export interface DemoData {
  matrix: DataMatrix;
  groups: string[];
  name: string;
}

/**
 * Named regulated proteins, followed by anonymous ones.
 *
 * The count matters as much as the effect size: Benjamini-Hochberg is a
 * step-up procedure, so a handful of true positives among hundreds of tests
 * struggles to clear an FDR of 0.05 at n=3. A real inflammation experiment
 * moves dozens of proteins, and the demo reflects that - otherwise the
 * volcano plot renders empty and looks broken.
 */
const NAMED_REGULATED: { label: string; effect: number }[] = [
  { label: "MMP13", effect: 3.4 },
  { label: "MMP3", effect: 2.9 },
  { label: "IL6", effect: 3.1 },
  { label: "PTGS2", effect: 2.6 },
  { label: "NOS2", effect: 2.2 },
  { label: "ADAMTS5", effect: 1.9 },
  { label: "TIMP1", effect: 1.6 },
  { label: "CXCL8", effect: 2.4 },
  { label: "MMP1", effect: 2.7 },
  { label: "IL1B", effect: 2.3 },
  { label: "CCL2", effect: 2.0 },
  { label: "SAA1", effect: 2.8 },
  { label: "COL2A1", effect: -2.8 },
  { label: "ACAN", effect: -2.5 },
  { label: "SOX9", effect: -2.1 },
  { label: "COMP", effect: -1.8 },
  { label: "PRG4", effect: -1.9 },
  { label: "COL9A1", effect: -1.7 },
  { label: "COL11A1", effect: -1.6 },
  { label: "CHAD", effect: -2.2 },
];

/** How many features carry a real treatment effect. */
const REGULATED_COUNT = 45;

/** Mulberry32 keeps the dataset identical between runs and between machines. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemoData(featureCount = 600, seed = 20260818): DemoData {
  const rand = rng(seed);
  const gauss = (mu: number, sd: number) => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const conditions = ["Control", "IL-1b", "TNF-a", "IL-1b_Inhib"];
  const samples: string[] = [];
  const groups: string[] = [];
  for (const c of conditions) {
    for (let r = 1; r <= 3; r++) {
      samples.push(`${c.replace(/[^A-Za-z0-9]/g, "")}_${r}`);
      groups.push(c);
    }
  }

  const features: string[] = [];
  const featureLabels: string[] = [];
  const values: (number | null)[][] = [];

  for (let i = 0; i < featureCount; i++) {
    let reg: { label: string; effect: number } | undefined = NAMED_REGULATED[i];
    if (!reg && i < REGULATED_COUNT) {
      // Unnamed regulated proteins, alternating direction with a spread of
      // effect sizes so the volcano has a realistic shape rather than two
      // tight clumps.
      const magnitude = 1.3 + ((i * 7) % 11) * 0.18;
      reg = { label: `PROT${i + 1}`, effect: i % 2 === 0 ? magnitude : -magnitude };
    }

    features.push(`P${String(i + 1).padStart(5, "0")}`);
    featureLabels.push(NAMED_REGULATED[i]?.label ?? `PROT${i + 1}`);

    // Baseline abundance spans the usual few orders of magnitude in log2.
    const base = 14 + rand() * 10;
    // A per-sample loading offset gives normalization something real to fix.
    const row: (number | null)[] = [];
    for (let s = 0; s < samples.length; s++) {
      const loading = ((s % 4) - 1.5) * 0.18;
      let mu = base + loading;
      if (reg) {
        const g = groups[s];
        if (g === "IL-1b") mu += reg.effect;
        else if (g === "TNF-a") mu += reg.effect * 0.8;
        else if (g === "IL-1b_Inhib") mu += reg.effect * 0.3;
      }
      // Technical noise typical of a well-run TMT quantification.
      const noise = 0.22;
      // Missing values concentrate at low abundance, as in real acquisitions.
      const missing = rand() < (base < 16 ? 0.03 : 0.005);
      row.push(missing ? null : Number(gauss(mu, noise).toFixed(4)));
    }
    values.push(row);
  }

  return {
    matrix: { features, featureLabels, samples, values },
    groups,
    name: "Demo: chondrocyte inflammation (log2)",
  };
}
