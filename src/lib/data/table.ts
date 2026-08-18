/**
 * Turns an imported table into the feature x sample matrix the statistics
 * layer consumes, plus the column-role detection that makes the import
 * one click instead of a manual mapping exercise.
 */
import { inferColumnType, parseNumber, type ColumnType } from "./csv";
import type { DataMatrix } from "../stats/matrix";

export interface ColumnProfile {
  index: number;
  name: string;
  type: ColumnType;
  /** Fraction of non-empty cells. */
  filled: number;
  uniqueCount: number;
  sample: string[];
  /** Proposed role in the matrix. */
  role: "feature_id" | "feature_label" | "sample_value" | "annotation" | "ignore";
}

export interface TableProfile {
  columns: ColumnProfile[];
  rowCount: number;
  /** Column indices holding per-sample measurements. */
  valueColumns: number[];
  featureIdColumn: number | null;
  featureLabelColumn: number | null;
  notes: string[];
}

const ID_HINTS = [
  "protein", "accession", "uniprot", "proteinid", "protein_id", "id",
  "feature", "featureid", "gene_id", "ensembl", "transcript", "peptide", "compound",
];
const LABEL_HINTS = [
  "gene", "genename", "gene_name", "genes", "symbol", "description",
  "name", "label", "metabolite",
];
const ANNOTATION_HINTS = [
  "pvalue", "p_value", "qvalue", "fdr", "score", "coverage", "peptides",
  "unique", "mw", "pi", "length", "razor", "intensity_total", "contaminant",
  "reverse", "potential",
];

const norm = (s: string) => s.toLowerCase().replace(/[\s_.-]+/g, "");

/**
 * Profiles each column and proposes a role.
 *
 * The heuristic: numeric columns with many distinct values are measurements;
 * the first mostly-unique text column is the feature id; a second text column
 * with gene-like naming becomes the display label.
 */
export function profileTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): TableProfile {
  const notes: string[] = [];
  const rowCount = rows.length;

  const columns: ColumnProfile[] = headers.map((name, index) => {
    const values = rows.map((r) => r[index] ?? "");
    const nonEmpty = values.filter((v) => v.trim() !== "");
    const type = inferColumnType(values);
    return {
      index,
      name,
      type,
      filled: rowCount === 0 ? 0 : nonEmpty.length / rowCount,
      uniqueCount: new Set(nonEmpty).size,
      sample: nonEmpty.slice(0, 4),
      role: "ignore",
    };
  });

  // --- feature id ---
  let featureIdColumn: number | null = null;
  const byHintId = columns.find(
    (c) => c.type !== "numeric" && ID_HINTS.includes(norm(c.name)),
  );
  if (byHintId) {
    featureIdColumn = byHintId.index;
  } else {
    // Fall back to the first text column that is nearly unique per row.
    const candidate = columns.find(
      (c) =>
        c.type === "text" &&
        c.filled > 0.9 &&
        rowCount > 0 &&
        c.uniqueCount / rowCount > 0.9,
    );
    featureIdColumn = candidate ? candidate.index : null;
  }

  // --- feature label ---
  let featureLabelColumn: number | null = null;
  const byHintLabel = columns.find(
    (c) =>
      c.index !== featureIdColumn &&
      c.type !== "numeric" &&
      LABEL_HINTS.includes(norm(c.name)),
  );
  if (byHintLabel) featureLabelColumn = byHintLabel.index;

  // --- value columns ---
  const valueColumns: number[] = [];
  for (const c of columns) {
    if (c.index === featureIdColumn || c.index === featureLabelColumn) continue;
    if (c.type !== "numeric") continue;
    if (ANNOTATION_HINTS.some((h) => norm(c.name).includes(h))) {
      c.role = "annotation";
      continue;
    }
    // A numeric column that is empty for most rows is not a measurement.
    if (c.filled < 0.15) {
      c.role = "ignore";
      continue;
    }
    valueColumns.push(c.index);
  }

  for (const c of columns) {
    if (c.index === featureIdColumn) c.role = "feature_id";
    else if (c.index === featureLabelColumn) c.role = "feature_label";
    else if (valueColumns.includes(c.index)) c.role = "sample_value";
    else if (c.role === "ignore" && c.type !== "numeric") c.role = "annotation";
  }

  if (valueColumns.length === 0) {
    notes.push("数値の測定列が検出されませんでした。ヘッダー行を確認してください。");
  } else if (valueColumns.length < 2) {
    notes.push("測定列が1つだけです。多くの解析には複数列が必要です。");
  }
  if (featureIdColumn === null) {
    notes.push("特徴量ID列が検出されませんでした。行番号を代わりに使います。");
  }

  return {
    columns,
    rowCount,
    valueColumns,
    featureIdColumn,
    featureLabelColumn,
    notes,
  };
}

export interface MatrixBuildOptions {
  featureIdColumn?: number | null;
  featureLabelColumn?: number | null;
  valueColumns?: number[];
  /** Renames sample columns, e.g. from a sample sheet. */
  sampleNames?: Record<number, string>;
}

export interface MatrixBuildResult {
  matrix: DataMatrix;
  /** Rows skipped because they had no id and no values. */
  skippedRows: number;
  duplicateFeatures: string[];
  notes: string[];
}

/** Builds the analysis matrix from a table using the profiled roles. */
export function buildMatrix(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  profile: TableProfile,
  opts: MatrixBuildOptions = {},
): MatrixBuildResult {
  const notes: string[] = [];
  const idCol = opts.featureIdColumn !== undefined ? opts.featureIdColumn : profile.featureIdColumn;
  const labelCol =
    opts.featureLabelColumn !== undefined ? opts.featureLabelColumn : profile.featureLabelColumn;
  const valueCols = opts.valueColumns ?? profile.valueColumns;

  const samples = valueCols.map(
    (c) => opts.sampleNames?.[c] ?? headers[c] ?? `sample_${c + 1}`,
  );

  const features: string[] = [];
  const featureLabels: string[] = [];
  const values: (number | null)[][] = [];
  const seen = new Map<string, number>();
  const duplicateFeatures: string[] = [];
  let skippedRows = 0;

  rows.forEach((r, ri) => {
    const rowValues = valueCols.map((c) => parseNumber(r[c] ?? ""));
    const hasAnyValue = rowValues.some((v) => v !== null);
    const rawId = idCol !== null && idCol !== undefined ? (r[idCol] ?? "").trim() : "";

    if (!hasAnyValue && rawId === "") {
      skippedRows++;
      return;
    }

    let id = rawId || `row_${ri + 1}`;
    const count = seen.get(id) ?? 0;
    if (count > 0) {
      // Keep both rows rather than silently dropping one - duplicated
      // accessions are common and the researcher should decide.
      duplicateFeatures.push(id);
      id = `${id}__${count + 1}`;
    }
    seen.set(rawId || `row_${ri + 1}`, count + 1);

    features.push(id);
    featureLabels.push(
      labelCol !== null && labelCol !== undefined && (r[labelCol] ?? "").trim() !== ""
        ? (r[labelCol] as string).trim()
        : id,
    );
    values.push(rowValues);
  });

  if (skippedRows > 0) notes.push(`${skippedRows} 件の空行をスキップしました。`);
  if (duplicateFeatures.length > 0) {
    const uniq = [...new Set(duplicateFeatures)];
    notes.push(
      `重複した特徴量ID ${uniq.length} 件に接尾辞を付けて全行を残しました: ${uniq.slice(0, 3).join(", ")}${uniq.length > 3 ? "…" : ""}。`,
    );
  }

  const totalCells = features.length * samples.length;
  const missing = values.flat().filter((v) => v === null).length;
  if (totalCells > 0 && missing / totalCells > 0.3) {
    notes.push(
      `値の ${((missing / totalCells) * 100).toFixed(0)}% が欠損です。解析前に完全性フィルタを検討してください。`,
    );
  }

  return {
    matrix: { features, featureLabels, samples, values },
    skippedRows,
    duplicateFeatures: [...new Set(duplicateFeatures)],
    notes,
  };
}

/** Summary statistics per sample column, for the QC panel after import. */
export function sampleQc(matrix: DataMatrix): {
  sample: string;
  observed: number;
  missing: number;
  median: number;
  mean: number;
  min: number;
  max: number;
}[] {
  return matrix.samples.map((sample, c) => {
    const col = matrix.values
      .map((r) => r[c])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const sorted = [...col].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return {
      sample,
      observed: col.length,
      missing: matrix.values.length - col.length,
      median: sorted.length
        ? sorted.length % 2
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2
        : NaN,
      mean: col.length ? col.reduce((s, v) => s + v, 0) / col.length : NaN,
      min: sorted.length ? sorted[0] : NaN,
      max: sorted.length ? sorted[sorted.length - 1] : NaN,
    };
  });
}
