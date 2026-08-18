/**
 * Sample sheet construction and validation.
 *
 * The sample sheet is the contract between raw files and every downstream
 * analysis: it says which file is which sample, which group it belongs to,
 * and in what order it ran. Getting it wrong silently invalidates everything
 * after it, so this module validates hard and explains every complaint.
 */
import type { RawFileInventory } from "./rawfiles";

export interface SampleRow {
  sample_id: string;
  file_name: string;
  group: string;
  replicate: number | null;
  batch: string | null;
  /** Acquisition / injection order. */
  run_order: number | null;
  /** Free-form extras the researcher adds, e.g. concentration or timepoint. */
  extra: Record<string, string>;
}

export interface SampleSheetIssue {
  level: "error" | "warning";
  row: number | null;
  column: string | null;
  message: string;
}

export interface SampleSheet {
  rows: SampleRow[];
  extraColumns: string[];
  issues: SampleSheetIssue[];
  groups: { name: string; n: number }[];
  valid: boolean;
}

/** Seeds a sample sheet from a raw file inventory's inferences. */
export function sampleSheetFromInventory(inv: RawFileInventory): SampleSheet {
  const rows: SampleRow[] = inv.entries.map((e, i) => ({
    sample_id: e.inferredSample || e.stem || `sample_${i + 1}`,
    file_name: e.name,
    group: e.inferredGroup || "",
    replicate: e.inferredReplicate,
    batch: e.inferredBatch,
    run_order: e.inferredOrder ?? i + 1,
    extra: {},
  }));
  return validateSampleSheet(rows, []);
}

/** Builds a sample sheet from a parsed table, mapping columns by name. */
export function sampleSheetFromTable(
  headers: readonly string[],
  dataRows: readonly (readonly string[])[],
  mapping: Partial<Record<keyof Omit<SampleRow, "extra">, string>> = {},
): SampleSheet {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const findCol = (
    explicit: string | undefined,
    aliases: string[],
  ): number => {
    if (explicit) {
      const i = headers.findIndex((h) => h === explicit);
      if (i >= 0) return i;
    }
    for (const a of aliases) {
      const i = headers.findIndex((h) => norm(h) === norm(a));
      if (i >= 0) return i;
    }
    return -1;
  };

  const cSample = findCol(mapping.sample_id, ["sample_id", "sample", "sampleid", "name", "id"]);
  const cFile = findCol(mapping.file_name, ["file_name", "filename", "file", "rawfile", "raw_file"]);
  const cGroup = findCol(mapping.group, ["group", "condition", "treatment", "class", "genotype"]);
  const cRep = findCol(mapping.replicate, ["replicate", "rep", "bioreplicate", "n"]);
  const cBatch = findCol(mapping.batch, ["batch", "plate", "set", "block"]);
  const cOrder = findCol(mapping.run_order, ["run_order", "order", "injection", "injectionorder", "runorder"]);

  const claimed = new Set([cSample, cFile, cGroup, cRep, cBatch, cOrder].filter((i) => i >= 0));
  const extraColumns = headers.filter((_, i) => !claimed.has(i));

  const rows: SampleRow[] = dataRows.map((r, i) => {
    const extra: Record<string, string> = {};
    headers.forEach((h, ci) => {
      if (!claimed.has(ci)) extra[h] = r[ci] ?? "";
    });
    const repRaw = cRep >= 0 ? r[cRep] : "";
    const orderRaw = cOrder >= 0 ? r[cOrder] : "";
    return {
      sample_id: (cSample >= 0 ? r[cSample] : "") || `sample_${i + 1}`,
      file_name: cFile >= 0 ? r[cFile] ?? "" : "",
      group: (cGroup >= 0 ? r[cGroup] : "") ?? "",
      replicate: toInt(repRaw),
      batch: cBatch >= 0 && r[cBatch] ? r[cBatch] : null,
      run_order: toInt(orderRaw) ?? i + 1,
      extra,
    };
  });

  return validateSampleSheet(rows, extraColumns);
}

function toInt(v: string | undefined): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Validates a sample sheet.
 *
 * Errors block analysis (duplicate ids, missing group). Warnings are things a
 * reviewer would question - n < 3, one group, confounded batches.
 */
export function validateSampleSheet(
  rows: readonly SampleRow[],
  extraColumns: readonly string[],
): SampleSheet {
  const issues: SampleSheetIssue[] = [];

  if (rows.length === 0) {
    issues.push({ level: "error", row: null, column: null, message: "サンプルシートが空です。" });
  }

  // --- identity checks ---
  const idCount = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const id = r.sample_id.trim();
    if (id === "") {
      issues.push({ level: "error", row: i, column: "sample_id", message: "sample_id がありません。" });
      return;
    }
    idCount.set(id, [...(idCount.get(id) ?? []), i]);
    if (/[^\w.\-+]/.test(id)) {
      issues.push({
        level: "warning", row: i, column: "sample_id",
        message: `"${id}" には一部ツールで問題になる文字が含まれます。英数字と _ . - + を使ってください。`,
      });
    }
  });
  for (const [id, idxs] of idCount) {
    if (idxs.length > 1) {
      issues.push({
        level: "error", row: idxs[1], column: "sample_id",
        message: `sample_id "${id}" が ${idxs.map((i) => i + 1).join(", ")} 行目で重複しています。`,
      });
    }
  }

  const fileCount = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const f = r.file_name.trim();
    if (f === "") return;
    fileCount.set(f, [...(fileCount.get(f) ?? []), i]);
  });
  for (const [f, idxs] of fileCount) {
    if (idxs.length > 1) {
      issues.push({
        level: "error", row: idxs[1], column: "file_name",
        message: `ファイル "${f}" が ${idxs.length} サンプルに割り当てられています。`,
      });
    }
  }

  // --- design checks ---
  const groupMap = new Map<string, number>();
  rows.forEach((r, i) => {
    const g = r.group.trim();
    if (g === "") {
      issues.push({ level: "error", row: i, column: "group", message: "群がありません。" });
      return;
    }
    groupMap.set(g, (groupMap.get(g) ?? 0) + 1);
  });
  const groups = [...groupMap.entries()].map(([name, n]) => ({ name, n }));

  if (groups.length === 1) {
    issues.push({
      level: "warning", row: null, column: "group",
      message: "群が1つだけです。比較できません。",
    });
  }
  for (const g of groups) {
    if (g.n < 2) {
      issues.push({
        level: "error", row: null, column: "group",
        message: `群 "${g.name}" は ${g.n} サンプルです。p値には少なくとも2つ必要です。`,
      });
    } else if (g.n < 3) {
      issues.push({
        level: "warning", row: null, column: "group",
        message: `群 "${g.name}" の反復は2つだけです。分散の推定は不安定になります。`,
      });
    }
  }

  // Batch confounding: a batch that contains exactly one group means batch
  // effect and biology cannot be told apart.
  const batchGroups = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.batch) continue;
    const set = batchGroups.get(r.batch) ?? new Set<string>();
    set.add(r.group.trim());
    batchGroups.set(r.batch, set);
  }
  if (batchGroups.size > 1) {
    const confounded = [...batchGroups.entries()].filter(([, gs]) => gs.size === 1);
    if (confounded.length === batchGroups.size) {
      issues.push({
        level: "warning", row: null, column: "batch",
        message:
          "すべてのバッチが1群しか含みません。バッチ効果と生物学的効果が完全に交絡しています。",
      });
    }
  }

  // Run order should interleave groups, otherwise drift mimics treatment.
  const ordered = rows
    .filter((r) => r.run_order !== null && r.group.trim() !== "")
    .sort((a, b) => (a.run_order ?? 0) - (b.run_order ?? 0));
  if (ordered.length > 3 && groups.length > 1) {
    let switches = 0;
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].group !== ordered[i - 1].group) switches++;
    }
    if (switches === groups.length - 1) {
      issues.push({
        level: "warning", row: null, column: "run_order",
        message:
          "サンプルが群ごとに連続して測定されています。装置ドリフトが処理効果に見えます。",
      });
    }
  }

  const orderSeen = new Map<number, number>();
  rows.forEach((r, i) => {
    if (r.run_order === null) return;
    if (orderSeen.has(r.run_order)) {
      issues.push({
        level: "warning", row: i, column: "run_order",
        message: `run_order ${r.run_order} が重複しています。`,
      });
    }
    orderSeen.set(r.run_order, i);
  });

  return {
    rows: [...rows],
    extraColumns: [...extraColumns],
    issues,
    groups,
    valid: !issues.some((i) => i.level === "error"),
  };
}

export const SAMPLE_SHEET_BASE_COLUMNS = [
  "sample_id", "file_name", "group", "replicate", "batch", "run_order",
] as const;

/** Flattens a sample sheet to export rows, with extras appended. */
export function sampleSheetToTable(
  sheet: SampleSheet,
): { headers: string[]; rows: (string | number)[][] } {
  const headers = [...SAMPLE_SHEET_BASE_COLUMNS, ...sheet.extraColumns];
  const rows = sheet.rows.map((r) => [
    r.sample_id,
    r.file_name,
    r.group,
    r.replicate ?? "",
    r.batch ?? "",
    r.run_order ?? "",
    ...sheet.extraColumns.map((c) => r.extra[c] ?? ""),
  ]);
  return { headers: [...headers], rows };
}
