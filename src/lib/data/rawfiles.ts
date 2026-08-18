/**
 * Raw file inventory.
 *
 * Takes whatever a researcher drops in - a folder of .raw / .mzML / .d files,
 * a directory listing, or a pasted list of names - and turns it into a
 * structured, checkable table.
 */

export interface RawFileInput {
  name: string;
  /** Bytes, when known. */
  size?: number | null;
  /** ISO string or Date, when known. */
  modified?: string | Date | null;
  /** Original relative path, when the browser supplied one. */
  path?: string | null;
}

export interface RawFileEntry {
  index: number;
  name: string;
  stem: string;
  extension: string;
  path: string | null;
  size: number | null;
  sizeHuman: string;
  modified: string | null;
  /** Instrument platform guessed from the extension. */
  platform: string;
  /** Tokens split out of the stem, used to propose sample sheet columns. */
  tokens: string[];
  /** Best-guess sample name after stripping run/replicate decorations. */
  inferredSample: string | null;
  inferredGroup: string | null;
  inferredReplicate: number | null;
  inferredBatch: string | null;
  /** Injection/run order parsed from a leading or trailing number. */
  inferredOrder: number | null;
  issues: string[];
}

export interface RawFileInventory {
  entries: RawFileEntry[];
  /** Distinct extensions with counts. */
  extensions: { extension: string; count: number }[];
  totalSize: number;
  duplicateNames: string[];
  /** Groups inferred across the set, with replicate counts. */
  groupSummary: { group: string; replicates: number; files: string[] }[];
  issues: string[];
  notes: string[];
}

const PLATFORM_BY_EXT: Record<string, string> = {
  raw: "Thermo / Waters RAW",
  d: "Agilent / Bruker .d",
  wiff: "SCIEX WIFF",
  mzml: "mzML（オープン）",
  mzxml: "mzXML（オープン）",
  mgf: "Mascot Generic Format",
  fastq: "シーケンス FASTQ",
  "fastq.gz": "シーケンス FASTQ（gz）",
  fcs: "フローサイトメトリー FCS",
  czi: "Zeiss CZI 画像",
  nd2: "Nikon ND2 画像",
  lif: "Leica LIF 画像",
  tif: "TIFF 画像",
  tiff: "TIFF 画像",
  csv: "区切りテキスト",
  tsv: "区切りテキスト",
  txt: "テキスト",
  xlsx: "Excelブック",
  xls: "Excelブック",
};

export function humanSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function splitExtension(name: string): { stem: string; extension: string } {
  const lower = name.toLowerCase();
  // Handle the common double extensions before falling back to the last dot.
  for (const double of [".fastq.gz", ".fq.gz", ".tar.gz", ".mzml.gz"]) {
    if (lower.endsWith(double)) {
      return { stem: name.slice(0, -double.length), extension: double.slice(1) };
    }
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase() };
}

/** Splits a stem into meaningful tokens on the usual separators. */
export function tokenize(stem: string): string[] {
  return stem
    .split(/[_\-\s.]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

const REPLICATE_RE = /^(?:r|rep|replicate|n)?[-_]?(\d{1,3})$/i;
const BATCH_RE = /^(?:b|batch|plate|set)[-_]?(\w{1,8})$/i;

/**
 * Guesses sample / group / replicate from filename tokens.
 *
 * This is deliberately conservative: it proposes, and the sample sheet editor
 * lets the researcher correct anything before it is committed.
 */
function inferFromTokens(tokens: string[]): {
  sample: string | null;
  group: string | null;
  replicate: number | null;
  batch: string | null;
  order: number | null;
} {
  if (tokens.length === 0) {
    return { sample: null, group: null, replicate: null, batch: null, order: null };
  }

  let replicate: number | null = null;
  let batch: string | null = null;
  let order: number | null = null;
  const remaining: string[] = [];

  tokens.forEach((tok, i) => {
    const bm = tok.match(BATCH_RE);
    if (bm && batch === null) {
      batch = bm[1];
      return;
    }
    const rm = tok.match(REPLICATE_RE);
    // A trailing pure number is far more likely a replicate than part of the
    // group name; a leading one is usually injection order.
    if (rm) {
      const value = Number(rm[1]);
      if (i === tokens.length - 1 && replicate === null) {
        replicate = value;
        return;
      }
      if (i === 0 && /^\d+$/.test(tok) && order === null) {
        order = value;
        return;
      }
    }
    remaining.push(tok);
  });

  const group = remaining.length ? remaining.join("_") : null;
  const sample = tokens.join("_");
  return { sample, group, replicate, batch, order };
}

/** Builds the inventory table plus the checks a researcher would run by hand. */
export function buildRawFileInventory(files: readonly RawFileInput[]): RawFileInventory {
  const notes: string[] = [];
  const issues: string[] = [];

  const seen = new Map<string, number>();
  const entries: RawFileEntry[] = files.map((f, index) => {
    const name = (f.name ?? "").trim();
    const { stem, extension } = splitExtension(name);
    const tokens = tokenize(stem);
    const inferred = inferFromTokens(tokens);
    const entryIssues: string[] = [];

    if (name === "") entryIssues.push("ファイル名が空です。");
    if (extension === "") entryIssues.push("拡張子がありません。");
    if (/[^\w.\-+()\[\]]/.test(stem)) {
      entryIssues.push("一部パイプラインが拒否する文字が含まれます。");
    }
    if (f.size !== undefined && f.size !== null && f.size === 0) {
      entryIssues.push("0バイトです。");
    }
    if (name.length > 120) entryIssues.push("ファイル名が非常に長いです。");

    seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) ?? 0) + 1);

    const modified =
      f.modified instanceof Date
        ? f.modified.toISOString()
        : typeof f.modified === "string" && f.modified
          ? f.modified
          : null;

    return {
      index,
      name,
      stem,
      extension,
      path: f.path ?? null,
      size: f.size ?? null,
      sizeHuman: humanSize(f.size),
      modified,
      platform: PLATFORM_BY_EXT[extension] ?? (extension ? `.${extension}` : "不明"),
      tokens,
      inferredSample: inferred.sample,
      inferredGroup: inferred.group,
      inferredReplicate: inferred.replicate,
      inferredBatch: inferred.batch,
      inferredOrder: inferred.order,
      issues: entryIssues,
    };
  });

  const duplicateNames = [...seen.entries()]
    .filter(([, c]) => c > 1)
    .map(([n]) => n);
  if (duplicateNames.length) {
    issues.push(`ファイル名の重複が ${duplicateNames.length} 件あります。`);
  }

  const extCounts = new Map<string, number>();
  for (const e of entries) {
    extCounts.set(e.extension, (extCounts.get(e.extension) ?? 0) + 1);
  }
  const extensions = [...extCounts.entries()]
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count);
  if (extensions.length > 1) {
    notes.push(
      `混在するファイル種類: ${extensions.map((e) => `${e.extension || "なし"} ×${e.count}`).join(", ")}。`,
    );
  }

  const byGroup = new Map<string, string[]>();
  for (const e of entries) {
    const g = e.inferredGroup ?? "(未分類)";
    byGroup.set(g, [...(byGroup.get(g) ?? []), e.name]);
  }
  const groupSummary = [...byGroup.entries()]
    .map(([group, fs]) => ({ group, replicates: fs.length, files: fs }))
    .sort((a, b) => b.replicates - a.replicates);

  const thin = groupSummary.filter((g) => g.group !== "(未分類)" && g.replicates < 2);
  if (thin.length) {
    notes.push(
      `推定グループ ${thin.length} 件がファイル1つだけです。命名を確認するか反復を追加してください。`,
    );
  }

  const totalSize = entries.reduce((s, e) => s + (e.size ?? 0), 0);
  const zero = entries.filter((e) => e.size === 0).length;
  if (zero) issues.push(`${zero} 件が0バイトです。`);

  // Size outliers often mean a truncated acquisition.
  const sizes = entries.map((e) => e.size).filter((s): s is number => s !== null && s > 0);
  if (sizes.length >= 4) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const odd = entries.filter(
      (e) => e.size !== null && e.size > 0 && (e.size < med * 0.25 || e.size > med * 4),
    );
    if (odd.length) {
      notes.push(
        `${odd.length} 件が中央値サイズから4倍以上外れています。途中で切れた測定の可能性があります。`,
      );
    }
  }

  return {
    entries,
    extensions,
    totalSize,
    duplicateNames,
    groupSummary,
    issues,
    notes,
  };
}

export const RAW_FILE_COLUMNS = [
  "index", "name", "extension", "platform", "size_bytes", "size",
  "modified", "path", "inferred_sample", "inferred_group",
  "inferred_replicate", "inferred_batch", "inferred_order", "issues",
] as const;

/** Flattens the inventory into export-ready rows. */
export function inventoryToRows(inv: RawFileInventory): (string | number)[][] {
  return inv.entries.map((e) => [
    e.index + 1,
    e.name,
    e.extension,
    e.platform,
    e.size ?? "",
    e.sizeHuman,
    e.modified ?? "",
    e.path ?? "",
    e.inferredSample ?? "",
    e.inferredGroup ?? "",
    e.inferredReplicate ?? "",
    e.inferredBatch ?? "",
    e.inferredOrder ?? "",
    e.issues.join("; "),
  ]);
}
