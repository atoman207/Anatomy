/**
 * The content tables a platform administrator can browse and delete from
 * this page - every table that holds what a researcher produced, as opposed
 * to structural tables (laboratories, members, templates, billing) that
 * already have their own admin page or are configuration rather than
 * content.
 *
 * Two of these - `notebook_entries` and `voice_notes` - are deliberately
 * append-only for ordinary users: the notebook feature's whole value is that
 * a saved entry is a permanent record, and a confirmed voice note is locked
 * by a database trigger so its content can never quietly change after the
 * fact. Deleting one here is an explicit administrative override of that
 * guarantee, not a normal edit, which is why the manager marks both as
 * "保護されたレコード" and asks for a distinct, more serious confirmation
 * before removing one - see `contentActions.ts` for how the delete itself
 * reaches the database.
 *
 * Plain module, not `"use server"`: this is data and formatting logic the
 * client component also needs directly, the same reason
 * `notebook/templateFields.ts` is a plain module next to its actions file.
 */

export const CONTENT_KINDS = [
  "datasets", "analyses", "figures", "raw_files", "sample_sheets",
  "rename_operations", "notebook_entries", "voice_notes", "saved_papers",
  "reagents", "peer_reviews",
] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];

export interface ContentTypeConfig {
  label: string;
  /** Column checked to build each row's display title. */
  titleColumn: string;
  /** True for the two tables an ordinary user can never edit or delete once saved. */
  protectedByDesign: boolean;
  /** Extra columns worth showing as a subtitle line, in order. */
  detailColumns: string[];
}

export const CONTENT_CONFIG: Record<ContentKind, ContentTypeConfig> = {
  datasets: {
    label: "データセット", titleColumn: "name", protectedByDesign: false,
    detailColumns: ["source_filename", "feature_count", "sample_count"],
  },
  analyses: {
    label: "統計解析", titleColumn: "title", protectedByDesign: false,
    detailColumns: ["kind"],
  },
  figures: {
    label: "図", titleColumn: "title", protectedByDesign: false,
    detailColumns: ["kind"],
  },
  raw_files: {
    label: "Rawファイル", titleColumn: "name", protectedByDesign: false,
    detailColumns: ["platform", "size_bytes"],
  },
  sample_sheets: {
    label: "サンプルシート", titleColumn: "name", protectedByDesign: false,
    detailColumns: ["is_valid"],
  },
  rename_operations: {
    label: "ファイル名変更", titleColumn: "file_count", protectedByDesign: false,
    detailColumns: ["applied"],
  },
  notebook_entries: {
    label: "実験ノート", titleColumn: "title", protectedByDesign: true,
    detailColumns: ["template_slug"],
  },
  voice_notes: {
    label: "音声メモ", titleColumn: "engine", protectedByDesign: true,
    detailColumns: ["confirmed_at"],
  },
  saved_papers: {
    label: "保存済み論文", titleColumn: "title", protectedByDesign: false,
    detailColumns: ["journal", "pub_year"],
  },
  reagents: {
    label: "試薬・Lot", titleColumn: "name", protectedByDesign: false,
    detailColumns: ["lot", "category"],
  },
  peer_reviews: {
    label: "AI査読", titleColumn: "title", protectedByDesign: false,
    detailColumns: ["overall_score"],
  },
};

/** A readable title for one row, falling back gracefully when the title column is empty. */
export function titleOf(kind: ContentKind, row: Record<string, unknown>): string {
  const config = CONTENT_CONFIG[kind];
  const raw = row[config.titleColumn];
  if (kind === "voice_notes") {
    const engine = typeof raw === "string" && raw ? raw : "音声メモ";
    return `${engine} メモ`;
  }
  if (kind === "rename_operations") {
    return `${String(raw ?? 0)} 件のリネーム`;
  }
  if (typeof raw === "string" && raw.trim()) return raw;
  return "（無題）";
}

/** A short "key: value · key: value" line of the configured detail columns. */
export function detailOf(kind: ContentKind, row: Record<string, unknown>): string {
  const config = CONTENT_CONFIG[kind];
  const parts: string[] = [];
  for (const col of config.detailColumns) {
    const v = row[col];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "boolean") {
      parts.push(v ? col : `${col}: —`);
    } else {
      parts.push(String(v));
    }
  }
  return parts.join(" · ");
}

/** True when this specific row is currently locked against ordinary edits. */
export function isLockedRow(kind: ContentKind, row: Record<string, unknown>): boolean {
  if (kind === "notebook_entries") return true;
  if (kind === "voice_notes") return Boolean(row.confirmed_at);
  return false;
}
