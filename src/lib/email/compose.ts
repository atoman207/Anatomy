/**
 * Pure text handling for the administrator mailer.
 *
 * Separate from both smtp.ts (which owns the connection) and adminActions.ts
 * (which is a `"use server"` module, and so may only export async functions):
 * these are ordinary functions with no I/O, which is what lets them be tested
 * directly in tests/email.test.ts.
 */

/** Addresses accepted from the "その他のアドレス" box, and for the reply-to. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Splits a typed-in address list on commas, semicolons, whitespace and
 * newlines, lowercasing and de-duplicating.
 *
 * Deliberately forgiving about the separator: an administrator pasting a
 * column out of a spreadsheet gets newlines, one typing by hand gets commas,
 * and one copying from a mail client gets "a@b.com; c@d.com". Validation of
 * what comes out is the caller's job - splitting and judging are different
 * questions, and the UI wants to show which entries were rejected.
 */
export function parseAddressList(raw: string): string[] {
  const parts = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(parts)];
}

/**
 * A readable plain-text fallback for an HTML body.
 *
 * Every HTML message goes out multipart: some recipients read mail as plain
 * text, and a message whose text part is raw markup is worse than no text
 * part at all. Block-level closing tags become line breaks so the fallback
 * keeps the shape of the original rather than collapsing into one paragraph.
 *
 * Not a general-purpose HTML renderer, and it does not need to be: the input
 * is an announcement an administrator typed, not arbitrary web content.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Last, so a literal "&amp;lt;" survives as "&lt;" rather than decoding twice.
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
