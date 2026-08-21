/**
 * Citation formatting and export.
 *
 * Deliberately has no `"server-only"` import (unlike pubmed.ts) so it can be
 * used from client components: formatting a citation string or a BibTeX/RIS
 * file needs no network access, and the literature page renders these live
 * as the researcher selects articles.
 *
 * `CitationSource` is a structural shape rather than `PubMedArticle` itself
 * so the same functions work for a freshly searched article and for a row
 * already persisted to `saved_papers` (whose `authors` column comes back as
 * `Json`, not `string[]`).
 */

export interface CitationSource {
  title: string;
  journal?: string | null;
  year?: number | null;
  authors: string[];
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  doi?: string | null;
  pmid?: string | null;
}

/** Vancouver style lists up to six authors, then "et al." */
export function formatAuthorsVancouver(authors: string[]): string {
  if (authors.length === 0) return "";
  const shown = authors.slice(0, 6);
  return authors.length > 6 ? `${shown.join(", ")}, et al.` : shown.join(", ");
}

/**
 * One reference-list line in Vancouver style (ICMJE), the convention PubMed's
 * own data maps onto directly: `Authors. Title. Journal. Year;Vol(Issue):Pages. doi:...`
 */
export function formatCitation(a: CitationSource): string {
  const parts: string[] = [];

  const authors = formatAuthorsVancouver(a.authors);
  if (authors) parts.push(authors);
  parts.push(a.title.replace(/\.+\s*$/, ""));

  let tail = (a.journal ?? "").trim();
  const volIssue = a.volume ? `${a.volume}${a.issue ? `(${a.issue})` : ""}` : "";
  const yearVolIssue = [a.year ?? null, volIssue || null].filter(Boolean).join(";");
  if (yearVolIssue) tail = tail ? `${tail}. ${yearVolIssue}` : yearVolIssue;
  if (a.pages) tail = tail ? `${tail}:${a.pages}` : `:${a.pages}`;
  if (tail) parts.push(tail);

  const idPart = a.doi ? `doi:${a.doi}` : a.pmid ? `PMID: ${a.pmid}` : null;
  if (idPart) parts.push(idPart);

  return `${parts.join(". ")}.`;
}

/**
 * PubMed author names arrive as "Surname AB" (surname, then up to a few
 * capital initials, no comma). Reference-manager formats need the surname
 * and given-name parts separated, so this splits on that convention and
 * falls back to treating the whole string as the surname when it does not
 * hold (a single-word name, an organisation as author, etc.).
 */
function splitAuthor(name: string): { family: string; given: string } {
  const trimmed = name.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { family: trimmed, given: "" };
  const family = trimmed.slice(0, idx);
  const initials = trimmed.slice(idx + 1);
  if (/^[A-Z]{1,4}$/.test(initials)) {
    return { family, given: `${initials.split("").join(". ")}.` };
  }
  return { family: trimmed, given: "" };
}

function splitPages(pages: string | null | undefined): { start: string | null; end: string | null } {
  if (!pages) return { start: null, end: null };
  const m = pages.trim().match(/^([A-Za-z]*\d+)\s*[-–]\s*([A-Za-z]*\d+)$/);
  return m ? { start: m[1], end: m[2] } : { start: pages.trim(), end: null };
}

/** A short, human-legible BibTeX key: first author's surname + year. */
function citationKey(a: CitationSource, fallback: string): string {
  const family = a.authors.length ? splitAuthor(a.authors[0]).family : "";
  const base = `${family}${a.year ?? ""}`.replace(/[^A-Za-z0-9]/g, "");
  return base || fallback;
}

function escapeBibtex(s: string): string {
  return s.replace(/[{}]/g, "").replace(/\n+/g, " ");
}

/** One `@article{...}` entry, importable into EndNote, Zotero, Mendeley, or LaTeX/BibTeX directly. */
export function toBibTeX(a: CitationSource, fallbackKey = "ref"): string {
  const key = citationKey(a, fallbackKey);
  const fields: [string, string | null | undefined][] = [
    ["author", a.authors.length
      ? a.authors.map((n) => { const s = splitAuthor(n); return s.given ? `${s.family}, ${s.given}` : s.family; }).join(" and ")
      : null],
    ["title", a.title],
    ["journal", a.journal],
    ["year", a.year != null ? String(a.year) : null],
    ["volume", a.volume],
    ["number", a.issue],
    ["pages", a.pages],
    ["doi", a.doi],
    ["pmid", a.pmid],
  ];
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${escapeBibtex(String(v))}}`)
    .join(",\n");
  return `@article{${key},\n${body}\n}`;
}

/** RIS format — the other format every reference manager reads. */
export function toRis(a: CitationSource): string {
  const lines = ["TY  - JOUR"];
  for (const name of a.authors) {
    const s = splitAuthor(name);
    lines.push(`AU  - ${s.given ? `${s.family}, ${s.given}` : s.family}`);
  }
  lines.push(`TI  - ${a.title}`);
  if (a.journal) lines.push(`JO  - ${a.journal}`);
  if (a.year != null) lines.push(`PY  - ${a.year}`);
  if (a.volume) lines.push(`VL  - ${a.volume}`);
  if (a.issue) lines.push(`IS  - ${a.issue}`);
  const { start, end } = splitPages(a.pages);
  if (start) lines.push(`SP  - ${start}`);
  if (end) lines.push(`EP  - ${end}`);
  if (a.doi) lines.push(`DO  - ${a.doi}`);
  if (a.pmid) lines.push(`AN  - ${a.pmid}`);
  lines.push("ER  - ");
  return lines.join("\n");
}

/** Joins several entries into one importable file, with a blank line between records. */
export function toBibTeXFile(articles: CitationSource[]): string {
  return articles.map((a, i) => toBibTeX(a, `ref${i + 1}`)).join("\n\n");
}

export function toRisFile(articles: CitationSource[]): string {
  return articles.map((a) => toRis(a)).join("\n\n");
}
