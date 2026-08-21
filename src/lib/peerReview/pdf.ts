import "server-only";

/**
 * PDF text extraction.
 *
 * Runs server-side only (unpdf wraps a WebAssembly build of PDF.js that
 * needs Node), so the route handler that uses this must not be on the edge
 * runtime - the same constraint `lib/data/excel.ts` documents for exceljs.
 *
 * Nothing about the uploaded file is persisted here or by the route that
 * calls this: only the extracted text comes back, and the PDF bytes are
 * never written to disk or to the database. The extracted text is what gets
 * saved (in `peer_reviews.extracted_text`), for exactly the reason
 * `saveRawFileInventory` keeps a raw-file inventory instead of the files
 * themselves - the review has to be traceable to what was actually read, and
 * a 20 MB PDF is not something a database row should carry.
 */
import { getDocumentProxy, extractText } from "unpdf";

export interface PdfTextResult {
  text: string;
  pageCount: number;
}

export class PdfExtractionError extends Error {}

/** Extracts and concatenates the text of every page, in reading order. */
export async function extractPdfText(bytes: ArrayBuffer): Promise<PdfTextResult> {
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    throw new PdfExtractionError(
      `PDFを読み取れませんでした。ファイルが破損しているか、パスワードで保護されている可能性があります: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const { totalPages, text } = await extractText(doc, { mergePages: true });

  if (!text.trim()) {
    throw new PdfExtractionError(
      "PDFからテキストを抽出できませんでした。スキャン画像のみのPDF（OCR未処理）である可能性があります。",
    );
  }

  return { text: text.trim(), pageCount: totalPages };
}
