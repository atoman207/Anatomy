/**
 * Excel workbook reading.
 *
 * Runs server-side only (exceljs is a Node library), so the route handlers
 * that use it must not be on the edge runtime.
 */
import ExcelJS from "exceljs";

export interface SheetPreview {
  name: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  /** True when the sheet looked empty. */
  empty: boolean;
}

export interface WorkbookPreview {
  sheets: SheetPreview[];
  notes: string[];
}

/** Renders one cell to the string form the rest of the pipeline expects. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    // Formula cells carry both the formula and its cached result; the result
    // is what a researcher means by "the value".
    if ("result" in value && value.result !== undefined) {
      return cellToString(value.result as ExcelJS.CellValue);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("error" in value) return "";
    if ("hyperlink" in value && "text" in value) return String(value.text ?? "").trim();
  }
  return String(value).trim();
}

/**
 * Reads every worksheet into a header + rows preview.
 *
 * `maxRows` caps what is materialized so a 200k-row export cannot exhaust
 * memory during an interactive preview; pass Infinity for a full import.
 */
export async function readWorkbook(
  data: ArrayBuffer | Buffer,
  opts: { maxRows?: number; headerRow?: number } = {},
): Promise<WorkbookPreview> {
  const { maxRows = 5000, headerRow = 1 } = opts;
  const notes: string[] = [];
  const workbook = new ExcelJS.Workbook();

  const buffer =
    data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : data;
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: SheetPreview[] = [];
  workbook.eachSheet((worksheet) => {
    const allRows: string[][] = [];
    let widest = 0;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // row.values is 1-indexed with a leading hole.
      const values = row.values as ExcelJS.CellValue[];
      for (let c = 1; c < values.length; c++) {
        cells.push(cellToString(values[c]));
      }
      widest = Math.max(widest, cells.length);
      allRows.push(cells);
    });

    // Normalize ragged rows to the widest row.
    for (const r of allRows) while (r.length < widest) r.push("");

    const hIdx = Math.max(0, headerRow - 1);
    const headerCells = allRows[hIdx] ?? [];
    const bodyAll = allRows.slice(hIdx + 1);
    const truncated = bodyAll.length > maxRows;
    const body = truncated ? bodyAll.slice(0, maxRows) : bodyAll;
    if (truncated) {
      notes.push(
        `シート「${worksheet.name}」: ${bodyAll.length} 行中、先頭 ${maxRows} 行を表示しています。`,
      );
    }

    const headers = headerCells.map((h, i) => (h.trim() === "" ? `column_${i + 1}` : h.trim()));
    sheets.push({
      name: worksheet.name,
      headers,
      rows: body,
      rowCount: bodyAll.length,
      columnCount: widest,
      empty: allRows.length === 0,
    });
  });

  if (sheets.length === 0) notes.push("ブックに読み取れるシートがありませんでした。");
  const nonEmpty = sheets.filter((s) => !s.empty);
  if (sheets.length > 1 && nonEmpty.length > 1) {
    notes.push(`ブックに空でないシートが ${nonEmpty.length} あります。取り込むシートを選んでください。`);
  }

  return { sheets, notes };
}

/** Writes a set of tables to an .xlsx buffer for download. */
export async function writeWorkbook(
  tables: readonly {
    name: string;
    headers: readonly string[];
    rows: readonly (readonly (string | number | null)[])[];
  }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "研究データワークベンチ";
  workbook.created = new Date();

  for (const t of tables) {
    // Excel rejects sheet names over 31 chars or containing []:*?/\
    const safeName = t.name.replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet";
    const ws = workbook.addWorksheet(safeName);
    ws.addRow([...t.headers]);
    ws.getRow(1).font = { bold: true };
    for (const r of t.rows) ws.addRow([...r]);
    ws.columns?.forEach((col, i) => {
      const header = t.headers[i] ?? "";
      let width = String(header).length + 2;
      for (const r of t.rows) {
        const v = r[i];
        if (v !== null && v !== undefined) {
          width = Math.max(width, String(v).length + 2);
        }
      }
      col.width = Math.min(48, Math.max(10, width));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
