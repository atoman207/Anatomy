/**
 * Converts analysis results into notebook-ready Markdown.
 *
 * This is what makes "paste the results into the notebook" a single action:
 * every statistic that gets reported carries its n, its test, and its
 * correction, so the notebook entry is self-describing months later.
 */
import type { TTestResult } from "../stats/ttest";
import type { AnovaResult } from "../stats/anova";
import type { PcaResult } from "../stats/pca";
import type { KMeansResult, HierarchicalResult } from "../stats/clustering";
import type { DiffResult } from "../stats/differential";
import type { RawFileInventory } from "../data/rawfiles";
import type { SampleSheet } from "../data/samplesheet";
import type { RenamePreview } from "../data/rename";
import { CORRECTION_LABELS } from "../stats/multiple";

/** Formats a p-value the way it should appear in a results section. */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return "n/a";
  if (p < 0.001) return p < 1e-16 ? "< 1e-16" : p.toExponential(2);
  return p.toFixed(4);
}

function num(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "n/a";
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6)) return v.toExponential(2);
  return v.toFixed(digits);
}

function stars(p: number): string {
  if (!Number.isFinite(p)) return "";
  if (p < 0.001) return " ***";
  if (p < 0.01) return " **";
  if (p < 0.05) return " *";
  return " (ns)";
}

function mdTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return rows.length ? `${head}\n${sep}\n${body}` : `${head}\n${sep}`;
}

function notesBlock(notes: readonly string[]): string {
  if (!notes.length) return "";
  return `\n**注意 / Notes**\n${notes.map((n) => `- ${n}`).join("\n")}\n`;
}

export function tTestToMarkdown(r: TTestResult, label?: string): string {
  const title = label ? `### ${label}` : `### ${r.test}`;
  const rows: string[][] = [
    ["Test", r.test],
    ["Alternative", r.alternative],
    ["n", r.nB === null ? String(r.nA) : `${r.nA} vs ${r.nB}`],
    ["Mean", r.meanB === null ? num(r.meanA) : `${num(r.meanA)} vs ${num(r.meanB)}`],
    ["Difference", num(r.diff)],
    ["95% CI", `${num(r.ci95[0])} to ${num(r.ci95[1])}`],
    ["t", num(r.t)],
    ["df", num(r.df, 2)],
    ["p", formatP(r.p) + stars(r.p)],
    ["Cohen's d", num(r.cohensD, 2)],
  ];
  return [
    title,
    "",
    mdTable(["項目 / Item", "値 / Value"], rows),
    notesBlock(r.notes),
  ].join("\n");
}

export function anovaToMarkdown(r: AnovaResult, label?: string): string {
  const groupRows = r.groups.map((g) => [
    g.name, String(g.n), num(g.mean), num(g.sd),
  ]);

  const anovaRows = [
    ["Between groups", num(r.dfBetween, 0), num(r.ssBetween), num(r.msBetween), num(r.f), formatP(r.p) + stars(r.p)],
    ["Within groups", num(r.dfWithin, 0), num(r.ssWithin), num(r.msWithin), "", ""],
    ["Total", num(r.dfTotal, 0), num(r.ssTotal), "", "", ""],
  ];

  const parts = [
    label ? `### ${label}` : `### ${r.test}`,
    "",
    "**群 / Groups**",
    "",
    mdTable(["Group", "n", "Mean", "SD"], groupRows),
    "",
    "**分散分析表 / ANOVA table**",
    "",
    mdTable(["Source", "df", "SS", "MS", "F", "p"], anovaRows),
    "",
    `効果量 / Effect size: eta² = ${num(r.etaSquared, 3)}, omega² = ${num(r.omegaSquared, 3)}`,
  ];

  if (r.tukey.length) {
    parts.push(
      "",
      "**Tukey HSD 事後検定 / post-hoc**",
      "",
      mdTable(
        ["Comparison", "Diff", "95% CI", "q", "p", ""],
        r.tukey.map((t) => [
          `${t.a} vs ${t.b}`,
          num(t.diff),
          `${num(t.ci95[0])} to ${num(t.ci95[1])}`,
          num(t.q, 2),
          formatP(t.p),
          t.significant ? "significant" : "ns",
        ]),
      ),
    );
  }
  parts.push(notesBlock(r.notes));
  return parts.join("\n");
}

export function pcaToMarkdown(r: PcaResult, label?: string): string {
  const rows = r.eigenvalues.map((ev, i) => [
    `PC${i + 1}`,
    num(ev),
    `${(r.explained[i] * 100).toFixed(1)}%`,
    `${(r.cumulative[i] * 100).toFixed(1)}%`,
  ]);
  return [
    label ? `### ${label}` : "### 主成分分析 / PCA",
    "",
    `${r.sampleNames.length} samples × ${r.featureNames.length} features · ` +
      `${r.center ? "centred" : "uncentred"}${r.scale ? ", scaled" : ""}`,
    "",
    mdTable(["Component", "Eigenvalue", "Variance", "Cumulative"], rows),
    notesBlock(r.notes),
  ].join("\n");
}

export function kMeansToMarkdown(r: KMeansResult, names?: readonly string[]): string {
  const members = new Map<number, string[]>();
  r.assignments.forEach((c, i) => {
    members.set(c, [...(members.get(c) ?? []), names?.[i] ?? `row_${i + 1}`]);
  });
  const rows = [...members.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, ms]) => [
      `Cluster ${c + 1}`,
      String(ms.length),
      ms.slice(0, 8).join(", ") + (ms.length > 8 ? `, +${ms.length - 8} more` : ""),
    ]);
  return [
    "### k-means クラスタリング / clustering",
    "",
    `k = ${r.k} · inertia = ${num(r.inertia)} · mean silhouette = ${num(r.silhouette, 3)} · ` +
      `${r.converged ? "converged" : "hit iteration limit"} in ${r.iterations} iterations`,
    "",
    mdTable(["Cluster", "n", "Members"], rows),
    notesBlock(r.notes),
  ].join("\n");
}

export function hierarchicalToMarkdown(
  r: HierarchicalResult,
  names?: readonly string[],
): string {
  const order = r.order.map((i) => names?.[i] ?? `row_${i + 1}`);
  return [
    "### 階層クラスタリング / Hierarchical clustering",
    "",
    `Linkage: ${r.linkage} · Distance: ${r.metric} · ` +
      `merge height at root = ${num(r.root?.height ?? NaN)}`,
    "",
    `**並び順 / Leaf order:** ${order.join(" → ")}`,
    notesBlock(r.notes),
  ].join("\n");
}

export function differentialToMarkdown(
  r: DiffResult,
  opts: { topN?: number } = {},
): string {
  const { topN = 20 } = opts;
  const hits = r.rows
    .filter((x) => x.significant)
    .sort((a, b) => Math.abs(b.log2fc) * b.negLog10P - Math.abs(a.log2fc) * a.negLog10P)
    .slice(0, topN);

  const parts = [
    `### 差次発現解析 / Differential analysis — ${r.groupA} vs ${r.groupB}`,
    "",
    `Test: ${r.test} · Correction: ${CORRECTION_LABELS[r.correction]} · ` +
      `Thresholds: |log2FC| ≥ ${r.fcThreshold}, ${r.useAdjusted ? "adjusted " : ""}p < ${r.pThreshold}`,
    "",
    `**${r.counts.tested}** features tested — ` +
      `**${r.counts.up}** up, **${r.counts.down}** down, ${r.counts.ns} unchanged.`,
    "",
  ];

  if (hits.length) {
    parts.push(
      `**上位ヒット / Top ${hits.length} hits**`,
      "",
      mdTable(
        ["Feature", "log2FC", "p", "adj. p", "Direction"],
        hits.map((h) => [
          h.label,
          num(h.log2fc, 2),
          formatP(h.p),
          formatP(h.padj),
          h.direction,
        ]),
      ),
    );
  } else {
    parts.push("_閾値を満たす特徴量はありません / No features passed the thresholds._");
  }
  parts.push(notesBlock(r.notes));
  return parts.join("\n");
}

export function inventoryToMarkdown(inv: RawFileInventory): string {
  const rows = inv.entries
    .slice(0, 50)
    .map((e) => [
      String(e.index + 1), e.name, e.platform, e.sizeHuman,
      e.inferredGroup ?? "—", e.inferredReplicate?.toString() ?? "—",
    ]);
  const parts = [
    "### Rawファイル一覧 / Raw file inventory",
    "",
    `${inv.entries.length} files · ${(inv.totalSize / 1024 ** 3).toFixed(2)} GB total · ` +
      inv.extensions.map((e) => `${e.extension || "none"} ×${e.count}`).join(", "),
    "",
    mdTable(["#", "File", "Platform", "Size", "Group", "Rep"], rows),
  ];
  if (inv.entries.length > 50) {
    parts.push("", `_… and ${inv.entries.length - 50} more files._`);
  }
  parts.push(notesBlock([...inv.issues, ...inv.notes]));
  return parts.join("\n");
}

export function sampleSheetToMarkdown(sheet: SampleSheet): string {
  const rows = sheet.rows.map((r) => [
    r.sample_id, r.file_name || "—", r.group,
    r.replicate?.toString() ?? "—", r.batch ?? "—", r.run_order?.toString() ?? "—",
  ]);
  const errors = sheet.issues.filter((i) => i.level === "error");
  const warnings = sheet.issues.filter((i) => i.level === "warning");
  const parts = [
    "### サンプルシート / Sample sheet",
    "",
    `${sheet.rows.length} samples across ${sheet.groups.length} group(s): ` +
      sheet.groups.map((g) => `${g.name} (n=${g.n})`).join(", "),
    "",
    mdTable(
      ["Sample ID", "File", "Group", "Rep", "Batch", "Order"],
      rows,
    ),
  ];
  if (errors.length) {
    parts.push(
      "",
      "**エラー / Errors**",
      ...errors.map((e) => `- ${e.row !== null ? `Row ${e.row + 1}: ` : ""}${e.message}`),
    );
  }
  if (warnings.length) {
    parts.push(
      "",
      "**警告 / Warnings**",
      ...warnings.map((e) => `- ${e.row !== null ? `Row ${e.row + 1}: ` : ""}${e.message}`),
    );
  }
  return parts.join("\n");
}

export function renameToMarkdown(preview: RenamePreview): string {
  const changed = preview.rows.filter((r) => r.changed);
  return [
    "### ファイル名変更 / File rename",
    "",
    `${changed.length} of ${preview.rows.length} files renamed.`,
    "",
    mdTable(
      ["Before", "After"],
      changed.slice(0, 60).map((r) => [r.original, r.proposed]),
    ),
    changed.length > 60 ? `\n_… and ${changed.length - 60} more._` : "",
    notesBlock(preview.issues),
  ].join("\n");
}

/** Wraps any set of sections with a provenance header. */
export function buildReport(
  title: string,
  sections: readonly string[],
  meta: { operator?: string; date?: string; source?: string } = {},
): string {
  const stamp = meta.date ?? new Date().toISOString().slice(0, 10);
  const header = [
    `## ${title}`,
    "",
    `*生成日 / Generated: ${stamp}*` +
      (meta.operator ? ` · *担当 / Operator: ${meta.operator}*` : "") +
      (meta.source ? ` · *データ / Source: ${meta.source}*` : ""),
    "",
  ].join("\n");
  return header + sections.filter(Boolean).join("\n\n") + "\n";
}
