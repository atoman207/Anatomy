/**
 * `mammoth` ships no TypeScript types. This declares only the one function
 * this app actually calls (see src/lib/peerReview/docx.ts).
 */
declare module "mammoth" {
  export interface ExtractRawTextResult {
    value: string;
    messages: unknown[];
  }

  export function extractRawText(input: { buffer: Buffer } | { path: string }): Promise<ExtractRawTextResult>;
}
