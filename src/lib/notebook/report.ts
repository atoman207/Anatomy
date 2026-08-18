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
  return `\n**注意**\n${notes.map((n) => `- ${n}`).join("\n")}\n`;
}

export function tTestToMarkdown(r: TTestResult, label?: string): string {
  const title = label ? `### ${label}` : `### ${r.test}`;
  const rows: string[][] = [
    ["検定", r.test],
    ["対立仮説", r.alternative === "two-sided" ? "両側" : r.alternative === "greater" ? "大きい" : "小さい"],
    ["n", r.nB === null ? String(r.nA) : `${r.nA} vs ${r.nB}`],
    ["平均", r.meanB === null ? num(r.meanA) : `${num(r.meanA)} vs ${num(r.meanB)}`],
    ["差", num(r.diff)],
    ["95% CI", `${num(r.ci95[0])} ～ ${num(r.ci95[1])}`],
    ["t", num(r.t)],
    ["df", num(r.df, 2)],
    ["p", formatP(r.p) + stars(r.p)],
    ["Cohen's d", num(r.cohensD, 2)],
  ];
  return [
    title,
    "",
    mdTable(["項目", "値"], rows),
    notesBlock(r.notes),
  ].join("\n");
}

export function anovaToMarkdown(r: AnovaResult, label?: string): string {
  const groupRows = r.groups.map((g) => [
    g.name, String(g.n), num(g.mean), num(g.sd),
  ]);

  const anovaRows = [
    ["群間", num(r.dfBetween, 0), num(r.ssBetween), num(r.msBetween), num(r.f), formatP(r.p) + stars(r.p)],
    ["群内", num(r.dfWithin, 0), num(r.ssWithin), num(r.msWithin), "", ""],
    ["全体", num(r.dfTotal, 0), num(r.ssTotal), "", "", ""],
  ];

  const parts = [
    label ? `### ${label}` : `### ${r.test}`,
    "",
    "**群**",
    "",
    mdTable(["群", "n", "平均", "SD"], groupRows),
    "",
    "**分散分析表**",
    "",
    mdTable(["要因", "df", "SS", "MS", "F", "p"], anovaRows),
    "",
    `効果量: eta² = ${num(r.etaSquared, 3)}, omega² = ${num(r.omegaSquared, 3)}`,
  ];

  if (r.tukey.length) {
    parts.push(
      "",
      "**Tukey HSD 事後検定**",
      "",
      mdTable(
        ["比較", "差", "95% CI", "q", "p", ""],
        r.tukey.map((t) => [
          `${t.a} vs ${t.b}`,
          num(t.diff),
          `${num(t.ci95[0])} ～ ${num(t.ci95[1])}`,
          num(t.q, 2),
          formatP(t.p),
          t.significant ? "有意" : "ns",
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
    label ? `### ${label}` : "### 主成分分析（PCA）",
    "",
    `${r.sampleNames.length} サンプル × ${r.featureNames.length} 特徴量 · ` +
      `${r.center ? "中心化あり" : "中心化なし"}${r.scale ? "、スケールあり" : ""}`,
    "",
    mdTable(["成分", "固有値", "分散", "累積"], rows),
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
      `クラスタ ${c + 1}`,
      String(ms.length),
      ms.slice(0, 8).join(", ") + (ms.length > 8 ? `、他 ${ms.length - 8}` : ""),
    ]);
  return [
    "### k-meansクラスタリング",
    "",
    `k = ${r.k} · inertia = ${num(r.inertia)} · 平均シルエット = ${num(r.silhouette, 3)} · ` +
      `${r.converged ? "収束" : "反復上限に到達"}（${r.iterations} 回）`,
    "",
    mdTable(["クラスタ", "n", "メンバー"], rows),
    notesBlock(r.notes),
  ].join("\n");
}

export function hierarchicalToMarkdown(
  r: HierarchicalResult,
  names?: readonly string[],
): string {
  const order = r.order.map((i) => names?.[i] ?? `row_${i + 1}`);
  return [
    "### 階層クラスタリング",
    "",
    `連結法: ${r.linkage} · 距離: ${r.metric} · ` +
      `根の結合高さ = ${num(r.root?.height ?? NaN)}`,
    "",
    `**並び順:** ${order.join(" → ")}`,
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
    `### 差次発現解析 — ${r.groupA} vs ${r.groupB}`,
    "",
    `検定: ${r.test} · 補正: ${CORRECTION_LABELS[r.correction]} · ` +
      `閾値: |log2FC| ≥ ${r.fcThreshold}、${r.useAdjusted ? "調整" : ""}p < ${r.pThreshold}`,
    "",
    `**${r.counts.tested}** 特徴量を検定 — ` +
      `**${r.counts.up}** 上昇、**${r.counts.down}** 低下、${r.counts.ns} 変化なし。`,
    "",
  ];

  if (hits.length) {
    parts.push(
      `**上位ヒット ${hits.length} 件**`,
      "",
      mdTable(
        ["特徴量", "log2FC", "p", "調整p", "方向"],
        hits.map((h) => [
          h.label,
          num(h.log2fc, 2),
          formatP(h.p),
          formatP(h.padj),
          h.direction === "up" ? "上昇" : h.direction === "down" ? "低下" : "ns",
        ]),
      ),
    );
  } else {
    parts.push("_閾値を満たす特徴量はありません。_");
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
    "### Rawファイル一覧",
    "",
    `${inv.entries.length} ファイル · 合計 ${(inv.totalSize / 1024 ** 3).toFixed(2)} GB · ` +
      inv.extensions.map((e) => `${e.extension || "なし"} ×${e.count}`).join(", "),
    "",
    mdTable(["#", "ファイル", "プラットフォーム", "サイズ", "群", "反復"], rows),
  ];
  if (inv.entries.length > 50) {
    parts.push("", `_… ほか ${inv.entries.length - 50} ファイル。_`);
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
    "### サンプルシート",
    "",
    `${sheet.groups.length} 群、${sheet.rows.length} サンプル: ` +
      sheet.groups.map((g) => `${g.name} (n=${g.n})`).join(", "),
    "",
    mdTable(
      ["サンプルID", "ファイル", "群", "反復", "バッチ", "順"],
      rows,
    ),
  ];
  if (errors.length) {
    parts.push(
      "",
      "**エラー**",
      ...errors.map((e) => `- ${e.row !== null ? `${e.row + 1} 行目: ` : ""}${e.message}`),
    );
  }
  if (warnings.length) {
    parts.push(
      "",
      "**警告**",
      ...warnings.map((e) => `- ${e.row !== null ? `${e.row + 1} 行目: ` : ""}${e.message}`),
    );
  }
  return parts.join("\n");
}

export function renameToMarkdown(preview: RenamePreview): string {
  const changed = preview.rows.filter((r) => r.changed);
  return [
    "### ファイル名変更",
    "",
    `${preview.rows.length} 件中 ${changed.length} 件を変更。`,
    "",
    mdTable(
      ["変更前", "変更後"],
      changed.slice(0, 60).map((r) => [r.original, r.proposed]),
    ),
    changed.length > 60 ? `\n_… ほか ${changed.length - 60} 件。_` : "",
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
    `*生成日: ${stamp}*` +
      (meta.operator ? ` · *担当: ${meta.operator}*` : "") +
      (meta.source ? ` · *データ: ${meta.source}*` : ""),
    "",
  ].join("\n");
  return header + sections.filter(Boolean).join("\n\n") + "\n";
}
