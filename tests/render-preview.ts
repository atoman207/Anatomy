/**
 * Renders each plot to disk so the layout can be eyeballed.
 * Run with: npx tsx tests/render-preview.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { differentialAnalysis } from "../src/lib/stats/differential";
import { pca } from "../src/lib/stats/pca";
import { renderVolcano } from "../src/lib/plots/volcano";
import { renderHeatmap } from "../src/lib/plots/heatmap";
import { renderPcaPlot } from "../src/lib/plots/pcaPlot";
import { topVariableFeatures, type DataMatrix } from "../src/lib/stats/matrix";
import type { Mode } from "../src/lib/plots/theme";

const OUT = "tmp/preview";
mkdirSync(OUT, { recursive: true });

// Deterministic pseudo-random normal draws so previews are reproducible.
let seed = 12345;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function gauss(mu: number, sd: number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- Build a realistic proteomics-style matrix: 800 proteins, 12 samples ---
const nFeat = 800;
const groupsOf = ["Control", "IL-1b", "TNF-a", "IL-1b+Inhib"];
const samples: string[] = [];
const sampleGroup: string[] = [];
for (const g of groupsOf) {
  for (let r = 1; r <= 3; r++) {
    samples.push(`${g.replace(/[^A-Za-z0-9]/g, "")}_${r}`);
    sampleGroup.push(g);
  }
}

const features: string[] = [];
const labels: string[] = [];
const values: (number | null)[][] = [];
const realNames = ["MMP13", "COL2A1", "ACAN", "SOX9", "IL6", "PTGS2", "NOS2", "ADAMTS5", "TIMP1", "RUNX2"];

for (let i = 0; i < nFeat; i++) {
  features.push(`P${String(i).padStart(5, "0")}`);
  labels.push(i < realNames.length ? realNames[i] : `PROT${i}`);
  const base = gauss(20, 2);
  const row: (number | null)[] = [];
  // First 40 features respond to treatment; the rest are flat.
  const effect = i < 40 ? (i % 2 === 0 ? 2.2 : -2.0) * (1 + (i % 5) * 0.25) : 0;
  for (let s = 0; s < samples.length; s++) {
    const g = sampleGroup[s];
    let mu = base;
    if (g === "IL-1b") mu += effect;
    else if (g === "TNF-a") mu += effect * 0.75;
    else if (g === "IL-1b+Inhib") mu += effect * 0.25;
    // A sprinkle of genuine missingness, as real runs have.
    row.push(rand() < 0.01 ? null : gauss(mu, 0.35));
  }
  values.push(row);
}

const matrix: DataMatrix = { features, featureLabels: labels, samples, values };

const idx = (g: string) => sampleGroup.map((v, i) => (v === g ? i : -1)).filter((i) => i >= 0);

for (const mode of ["light", "dark"] as Mode[]) {
  // --- Volcano ---
  const diff = differentialAnalysis(
    matrix, idx("IL-1b"), idx("Control"), "IL-1b", "Control",
    { test: "welch", correction: "bh", dataIsLog: true, pThreshold: 0.05, fcThreshold: 1 },
  );
  const v = renderVolcano(diff, { mode, labelTop: 10, title: "IL-1b vs Control" });
  writeFileSync(`${OUT}/volcano-${mode}.svg`, v.svg);

  // --- Heatmap ---
  const top = topVariableFeatures(matrix, 40);
  const groupColors: Record<string, string> = {};
  const pal = mode === "dark"
    ? ["#3987e5", "#d95926", "#199e70", "#c98500"]
    : ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
  groupsOf.forEach((g, i) => { groupColors[g] = pal[i]; });
  const h = renderHeatmap(top, {
    mode, title: "Top 40 variable proteins", scaling: "row-zscore",
    clusterRows: true, clusterColumns: true, linkage: "average",
    columnGroups: sampleGroup, columnGroupColors: groupColors,
  });
  writeFileSync(`${OUT}/heatmap-${mode}.svg`, h.svg);

  // --- PCA (4 groups exercises the composite-encoding path) ---
  const p = pca(matrix, { center: true, scale: false });
  const pp = renderPcaPlot(p, {
    mode, groups: sampleGroup, title: "PCA of all samples",
    showEllipses: true, showSampleLabels: true,
  });
  writeFileSync(`${OUT}/pca-${mode}.svg`, pp.svg);

  // --- PCA with 2 groups: colour-only path ---
  const twoIdx = [...idx("Control"), ...idx("IL-1b")];
  const twoMatrix: DataMatrix = {
    features, featureLabels: labels,
    samples: twoIdx.map((i) => samples[i]),
    values: values.map((r) => twoIdx.map((i) => r[i])),
  };
  const p2 = pca(twoMatrix, { center: true });
  const pp2 = renderPcaPlot(p2, {
    mode, groups: twoIdx.map((i) => sampleGroup[i]),
    title: "PCA: Control vs IL-1b",
  });
  writeFileSync(`${OUT}/pca2-${mode}.svg`, pp2.svg);

  console.log(
    `${mode}: volcano ${v.width}x${v.height} (up ${diff.counts.up}, down ${diff.counts.down}), ` +
    `heatmap ${h.width}x${h.height}, pca ${pp.width}x${pp.height} composite=${pp.compositeEncoding}`,
  );
}

console.log(`\nWrote SVGs to ${OUT}/`);
