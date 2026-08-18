/** Delimited-text parsing and serialization with no external dependencies. */

export type Delimiter = "," | "\t" | ";" | "|";

/** Guesses the delimiter from the first few lines by consistency of field count. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.split(/\r?\n/).slice(0, 12).filter((l) => l.trim() !== "");
  if (sample.length === 0) return ",";
  const candidates: Delimiter[] = [",", "\t", ";", "|"];
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.map((l) => splitLine(l, d).length);
    const first = counts[0];
    if (first < 2) continue;
    // Prefer the delimiter that yields the most columns, consistently.
    const consistent = counts.every((c) => c === first);
    const score = (consistent ? 1000 : 0) + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Splits one line, honouring double-quoted fields with "" escapes. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
  /** Rows whose field count did not match the header. */
  raggedRows: number[];
}

/**
 * Parses delimited text into a header + rows table.
 *
 * Handles quoted fields containing the delimiter or newlines, a UTF-8 BOM,
 * and CRLF endings - all of which turn up in instrument exports.
 */
export function parseDelimited(
  text: string,
  delimiter?: Delimiter,
): ParsedTable {
  const clean = text.replace(/^﻿/, "");
  const d = delimiter ?? detectDelimiter(clean);

  // Split into logical lines, keeping quoted newlines together.
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      lines.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur !== "") lines.push(cur);

  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [], delimiter: d, raggedRows: [] };
  }

  const headers = splitLine(nonEmpty[0], d).map((h) => h.trim());
  const rows: string[][] = [];
  const raggedRows: number[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = splitLine(nonEmpty[i], d).map((c) => c.trim());
    if (cells.length !== headers.length) raggedRows.push(i);
    // Pad or trim so downstream code can index by column safely.
    while (cells.length < headers.length) cells.push("");
    rows.push(cells.slice(0, headers.length));
  }
  return { headers, rows, delimiter: d, raggedRows };
}

/** Serializes a table back to delimited text, quoting only where needed. */
export function toDelimited(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
  delimiter: Delimiter = ",",
): string {
  const q = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /["\n\r]|^\s|\s$/.test(s) || s.includes(delimiter)
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const out = [headers.map(q).join(delimiter)];
  for (const r of rows) out.push(r.map(q).join(delimiter));
  return out.join("\r\n");
}

/** Placeholders instrument software writes instead of leaving a cell blank. */
const MISSING_TOKENS = new Set([
  "na", "n/a", "nan", "null", "nd", "n.d.", "-", "--", "#n/a", "#na",
  "filtered", "missing", "none", "inf", "-inf", "#div/0!", "#value!",
]);

/** True when a cell means "no measurement" rather than carrying text. */
export function isMissingToken(raw: string): boolean {
  const s = String(raw ?? "").trim();
  return s === "" || MISSING_TOKENS.has(s.toLowerCase());
}

/**
 * Parses a numeric cell, tolerating the formats instrument software emits:
 * thousands separators, a trailing percent, scientific notation, and the
 * placeholders used for missing values.
 */
export function parseNumber(raw: string): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (MISSING_TOKENS.has(s.toLowerCase())) return null;
  let t = s.replace(/,/g, "");
  let scale = 1;
  if (t.endsWith("%")) {
    t = t.slice(0, -1);
    scale = 0.01;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v * scale : null;
}

export type ColumnType = "numeric" | "text" | "date" | "empty";

/**
 * Infers a column's type from its values, used to pick numeric data columns.
 *
 * Missing-value placeholders count as absent rather than as text. Otherwise a
 * measurement column with a few "NA" cells is classified as text and silently
 * dropped from the analysis matrix - which is exactly how a real export
 * arrives.
 */
export function inferColumnType(values: readonly string[]): ColumnType {
  let numeric = 0;
  let date = 0;
  let filled = 0;
  for (const v of values) {
    const s = (v ?? "").trim();
    if (isMissingToken(s)) continue;
    filled++;
    if (parseNumber(s) !== null) numeric++;
    else if (looksLikeDate(s)) date++;
  }
  if (filled === 0) return "empty";
  if (numeric / filled >= 0.8) return "numeric";
  if (date / filled >= 0.8) return "date";
  return "text";
}

export function looksLikeDate(s: string): boolean {
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2})?/.test(s)) return true;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(s)) return true;
  return false;
}
