import "server-only";

/**
 * Word (.docx) text extraction, alongside `pdf.ts`'s PDF path - the same
 * "researcher wants to upload the manuscript file they already have"
 * request, just a second container format. `.doc` (the pre-2007 binary
 * format) is out of scope: mammoth only reads the Office Open XML format.
 *
 * Same non-persistence property as extractPdfText: only the extracted text
 * comes back, nothing about the uploaded file itself is written anywhere.
 */
import mammoth from "mammoth";

export interface DocxTextResult {
  text: string;
}

export class DocxExtractionError extends Error {}

export async function extractDocxText(bytes: ArrayBuffer): Promise<DocxTextResult> {
  let text: string;
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    text = result.value;
  } catch (e) {
    throw new DocxExtractionError(
      `Wordファイルを読み取れませんでした。ファイルが破損しているか、対応していない形式（.doc など）の可能性があります: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  if (!text.trim()) {
    throw new DocxExtractionError("Wordファイルからテキストを抽出できませんでした。");
  }

  return { text: text.trim() };
}
