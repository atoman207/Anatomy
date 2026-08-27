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

/** Known display sizes for an embedded figure, as a fraction of the content width. */
type FigureSize = "small" | "medium" | "large" | "full";

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let figureCount = 0;
  // True immediately after a `# YYYY-MM-DD Title` masthead line, so the very
  // next paragraph (the "担当/記録時刻/目的" byline every template emits
  // right below the title) can be styled as a byline rather than body text.
  let justEmittedMasthead = false;

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
      justEmittedMasthead = false;
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
    // A level-1 heading whose text starts with an ISO date is what every
    // template emits for its title line (`# {{experiment_date}}
    // {{experiment_name}}`) - split it into a small date eyebrow above a
    // large title, the masthead treatment a research paper's own title
    // block uses, rather than one plain <h1> mashing both together.
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(listStack);
      const level = heading[1].length;
      const text = heading[2];
      const dated = level === 1 ? text.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/) : null;
      if (dated) {
        out.push(
          '<div class="note-masthead">' +
            `<p class="note-eyebrow">${inline(escapeHtml(dated[1]))}</p>` +
            `<h1 class="note-title">${inline(escapeHtml(dated[2]))}</h1>` +
            "</div>",
        );
        justEmittedMasthead = true;
      } else {
        out.push(`<h${level}>${inline(escapeHtml(text))}</h${level}>`);
        justEmittedMasthead = false;
      }
      i++;
      continue;
    }

    // --- horizontal rule ---
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList(listStack);
      justEmittedMasthead = false;
      out.push("<hr/>");
      i++;
      continue;
    }

    // --- blockquote ---
    if (trimmed.startsWith("> ")) {
      closeList(listStack);
      justEmittedMasthead = false;
      out.push(`<blockquote>${inline(escapeHtml(trimmed.slice(2)))}</blockquote>`);
      i++;
      continue;
    }

    // --- image ---
    // Restricted to data: URIs. A figure is embedded once, at save time, as
    // its own base64 payload - never a remote URL - so opening an old note
    // later can never trigger a network request or show a different image
    // than what was actually saved. An optional quoted title after the URI
    // carries a display-size hint (`"size:medium"`) the insertion UI writes;
    // absent (as in every note saved before this existed), it renders at
    // full width exactly as before.
    const image = trimmed.match(
      /^!\[([^\]]*)\]\((data:image\/[a-z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)(?:\s+"([^"]*)")?\)$/,
    );
    if (image) {
      closeList(listStack);
      justEmittedMasthead = false;
      figureCount++;
      const alt = image[1];
      const sizeHint = image[3]?.match(/size:(small|medium|large|full)/)?.[1] as
        | FigureSize
        | undefined;
      const size = sizeHint ?? "full";
      const caption = alt ? `図${figureCount}：${alt}` : `図${figureCount}`;
      out.push(
        `<figure class="note-figure note-figure-${size}">` +
          `<img src="${escapeHtml(image[2])}" alt="${escapeHtml(alt)}" />` +
          `<figcaption>${inline(escapeHtml(caption))}</figcaption>` +
          "</figure>",
      );
      i++;
      continue;
    }

    // --- lists ---
    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      justEmittedMasthead = false;
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
    const pClass = justEmittedMasthead ? ' class="note-meta"' : "";
    justEmittedMasthead = false;
    out.push(`<p${pClass}>${buf.map((l) => inline(escapeHtml(l))).join("<br />")}</p>`);
  }

  closeList(listStack);
  return out.join("\n");
}

/** First embedded data-URI image in a Markdown block, if any. */
export function extractMarkdownImageSrc(markdown: string): string | null {
  const match = markdown.match(
    /!\[[^\]]*\]\((data:image\/[a-z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)(?:\s+"[^"]*")?\)/,
  );
  return match?.[1] ?? null;
}
