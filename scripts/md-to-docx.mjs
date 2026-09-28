import fs from "fs";
import { marked } from "marked";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

const input = process.argv[2] || "DOCS.md";
const output = process.argv[3] || "DOCS.docx";
const md = fs.readFileSync(input, "utf8");
const tokens = marked.lexer(md);

const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const font = "Yu Gothic";

function inlineRuns(tokenList = []) {
  const runs = [];
  for (const t of tokenList) {
    if (t.type === "text") {
      runs.push(new TextRun({ text: t.text, size: 20, font }));
    } else if (t.type === "strong") {
      runs.push(new TextRun({ text: t.text, bold: true, size: 20, font }));
    } else if (t.type === "em") {
      runs.push(new TextRun({ text: t.text, italics: true, size: 20, font }));
    } else if (t.type === "codespan") {
      runs.push(new TextRun({ text: t.text, font: "Consolas", size: 18 }));
    } else if (t.type === "link") {
      runs.push(
        new TextRun({
          text: t.text,
          size: 20,
          font,
          color: "2563EB",
          underline: {},
        }),
      );
    } else if (t.type === "escape") {
      runs.push(new TextRun({ text: t.text, size: 20, font }));
    } else if (t.tokens) {
      runs.push(...inlineRuns(t.tokens));
    } else if (t.text) {
      runs.push(new TextRun({ text: t.text, size: 20, font }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: "", size: 20, font })];
}

function cell(text, opts = {}) {
  return new TableCell({
    borders,
    width: { size: opts.width || 2400, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text ?? ""),
            bold: !!opts.bold,
            size: 18,
            font,
          }),
        ],
      }),
    ],
  });
}

function listItemRuns(item) {
  const nested = [];
  for (const t of item.tokens || []) {
    if (t.type === "paragraph") nested.push(...(t.tokens || [{ text: t.text }]));
    else if (t.text) nested.push({ text: t.text });
  }
  return nested.length ? nested : [{ text: item.text || "" }];
}

const children = [];

for (const token of tokens) {
  if (token.type === "heading") {
    const size = token.depth === 1 ? 36 : token.depth === 2 ? 28 : 24;
    const heading =
      token.depth === 1
        ? HeadingLevel.TITLE
        : token.depth === 2
          ? HeadingLevel.HEADING_1
          : token.depth === 3
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
    children.push(
      new Paragraph({
        heading,
        spacing: { before: 240, after: 120 },
        children: [
          new TextRun({ text: token.text, bold: true, size, font }),
        ],
      }),
    );
  } else if (token.type === "paragraph") {
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: inlineRuns(token.tokens),
      }),
    );
  } else if (token.type === "list") {
    token.items.forEach((item, i) => {
      const marker = token.ordered ? `${i + 1}. ` : "• ";
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: marker, size: 20, font }),
            ...inlineRuns(listItemRuns(item)),
          ],
        }),
      );
    });
  } else if (token.type === "table") {
    const colCount = Math.max(
      token.header.length,
      ...token.rows.map((r) => r.length),
    );
    const width = Math.floor(9000 / colCount);
    const rows = [
      new TableRow({
        children: token.header.map((h) =>
          cell(h.text, { bold: true, width }),
        ),
      }),
      ...token.rows.map(
        (row) =>
          new TableRow({
            children: row.map((c) => cell(c.text, { width })),
          }),
      ),
    ];
    children.push(
      new Table({ width: { size: 9000, type: WidthType.DXA }, rows }),
    );
    children.push(new Paragraph({ children: [] }));
  } else if (token.type === "blockquote") {
    const paras = (token.tokens || []).filter((t) => t.type === "paragraph");
    for (const p of paras) {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          indent: { left: 360 },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 24,
              color: "2563EB",
              space: 8,
            },
          },
          children: inlineRuns(p.tokens),
        }),
      );
    }
  } else if (token.type === "hr") {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 120 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: "DDDDDD",
            space: 1,
          },
        },
        children: [],
      }),
    );
  } else if (token.type === "space") {
    children.push(new Paragraph({ children: [] }));
  }
}

const doc = new Document({
  sections: [
    {
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(output, buffer);
console.log(`Wrote ${output} (${buffer.length} bytes)`);
