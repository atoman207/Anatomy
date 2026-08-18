import { NextResponse } from "next/server";
import { readWorkbook } from "@/lib/data/excel";
import { parseDelimited } from "@/lib/data/csv";
import { profileTable, buildMatrix } from "@/lib/data/table";

// exceljs is a Node library, so this route cannot run on the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Parses an uploaded table into a matrix.
 *
 * CSV/TSV could be handled in the browser, but routing both formats through
 * one endpoint keeps the import result identical whichever file the
 * researcher happens to have.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const sheetName = form.get("sheet");
    const headerRow = Number(form.get("headerRow") ?? 1) || 1;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "ファイルがアップロードされていません。" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "ファイルが空です。" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `ファイルは ${(file.size / 1024 ** 2).toFixed(0)} MB です。上限は ${MAX_BYTES / 1024 ** 2} MB です。` },
        { status: 413 },
      );
    }

    const name = file.name;
    const lower = name.toLowerCase();
    const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || lower.endsWith(".xls");

    let headers: string[] = [];
    let rows: string[][] = [];
    let sheets: string[] = [];
    let usedSheet: string | null = null;
    const notes: string[] = [];

    if (isExcel) {
      if (lower.endsWith(".xls")) {
        return NextResponse.json(
          { error: "旧形式の .xls は非対応です。.xlsx として保存し直してください。" },
          { status: 415 },
        );
      }
      const buf = await file.arrayBuffer();
      const wb = await readWorkbook(buf, { headerRow });
      notes.push(...wb.notes);
      sheets = wb.sheets.map((s) => s.name);

      const chosen =
        (typeof sheetName === "string" && wb.sheets.find((s) => s.name === sheetName)) ||
        wb.sheets.find((s) => !s.empty && s.rows.length > 0) ||
        wb.sheets[0];

      if (!chosen) {
        return NextResponse.json({ error: "このブックに読み取れるシートがありません。" }, { status: 422 });
      }
      headers = chosen.headers;
      rows = chosen.rows;
      usedSheet = chosen.name;
    } else {
      const text = await file.text();
      const parsed = parseDelimited(text);
      headers = parsed.headers;
      rows = parsed.rows;
      if (parsed.raggedRows.length) {
        notes.push(
          `${parsed.raggedRows.length} 行の列数がヘッダーと異なり、埋めました。`,
        );
      }
      notes.push(
        `検出した区切り文字: ${parsed.delimiter === "\t" ? "タブ" : parsed.delimiter}`,
      );
    }

    if (headers.length === 0) {
      return NextResponse.json(
        { error: "ヘッダー行が見つかりません。1行目に列名があるか確認してください。" },
        { status: 422 },
      );
    }

    const profile = profileTable(headers, rows);
    const built = buildMatrix(headers, rows, profile);

    return NextResponse.json({
      fileName: name,
      sheets,
      sheet: usedSheet,
      headers,
      preview: rows.slice(0, 25),
      rowCount: rows.length,
      profile,
      matrix: built.matrix,
      notes: [...notes, ...profile.notes, ...built.notes],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    // A corrupt workbook throws deep inside exceljs; surface something useful.
    return NextResponse.json(
      { error: `ファイルを読み取れませんでした: ${message}` },
      { status: 422 },
    );
  }
}
