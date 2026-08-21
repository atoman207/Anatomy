/**
 * Minimal Markdown to HTML renderer for notebook previews.
 *
 * Supports exactly what the templates and report generators emit: headings,
 * bold/italic, inline code, lists, tables, blockquotes and horizontal rules.
 *
 * Every input is HTML-escaped before any markup is inserted, so notebook text
 * - which can contain anything a researcher typed - can never inject markup.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Inline formatting, applied to already-escaped text.
 *
 * Underscore emphasis is deliberately restricted to word boundaries.
 * Filenames like `pca_plot.svg` and identifiers like `sample_id` are
 * everywhere in this app, and treating their underscores as emphasis
 * mangles the text.
 */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[\s(["'])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableDivider = (line: string) => /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const closeList = (stack: string[]) => {
    while (stack.length) out.push(`</${stack.pop()}>`);
  };
  const listStack: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      closeList(listStack);
      i++;
      continue;
    }

    // --- table ---
    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      closeList(listStack);
      const headers = splitRow(trimmed);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        body.push(splitRow(lines[i].trim()));
        i++;
      }
      out.push(
        "<table><thead><tr>" +
          headers.map((h) => `<th>${inline(escapeHtml(h))}</th>`).join("") +
          "</tr></thead><tbody>" +
          body
            .map(
              (r) =>
                "<tr>" +
                r.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join("") +
                "</tr>",
            )
            .join("") +
          "</tbody></table>",
      );
      continue;
    }

    // --- heading ---
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(listStack);
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    // --- horizontal rule ---
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList(listStack);
      out.push("<hr/>");
      i++;
      continue;
    }

    // --- blockquote ---
    if (trimmed.startsWith("> ")) {
      closeList(listStack);
      out.push(`<blockquote>${inline(escapeHtml(trimmed.slice(2)))}</blockquote>`);
      i++;
      continue;
    }

    // --- image ---
    // Restricted to data: URIs. A figure is embedded once, at save time, as
    // its own base64 payload - never a remote URL - so opening an old note
    // later can never trigger a network request or show a different image
    // than what was actually saved.
    const image = trimmed.match(/^!\[([^\]]*)\]\((data:image\/[a-z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\)$/);
    if (image) {
      closeList(listStack);
      out.push(
        `<img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" style="max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line);" />`,
      );
      i++;
      continue;
    }

    // --- lists ---
    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (listStack[listStack.length - 1] !== want) {
        closeList(listStack);
        listStack.push(want);
        out.push(`<${want}>`);
      }
      out.push(`<li>${inline(escapeHtml((ul ?? ol)![1]))}</li>`);
      i++;
      continue;
    }

    // --- paragraph ---
    closeList(listStack);
    const buf: string[] = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\|)/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    // Single newlines become hard breaks. In a lab notebook the author's line
    // breaks are meaningful - reflowing "Operator / Purpose / Samples" into one
    // paragraph, as strict Markdown would, loses the record's structure.
    out.push(`<p>${buf.map((l) => inline(escapeHtml(l))).join("<br />")}</p>`);
  }

  closeList(listStack);
  return out.join("\n");
}
