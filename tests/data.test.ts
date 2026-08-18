import test from "node:test";
import assert from "node:assert/strict";

import {
  parseDelimited, toDelimited, detectDelimiter, parseNumber, inferColumnType,
  isMissingToken,
} from "../src/lib/data/csv";
import {
  buildRawFileInventory, splitExtension, tokenize, humanSize,
} from "../src/lib/data/rawfiles";
import {
  sampleSheetFromInventory, sampleSheetFromTable, validateSampleSheet,
  sampleSheetToTable, type SampleRow,
} from "../src/lib/data/samplesheet";
import {
  previewRename, previewToMapping, invertMapping, RENAME_PRESETS,
} from "../src/lib/data/rename";
import { profileTable, buildMatrix, sampleQc } from "../src/lib/data/table";
import { buildDemoData } from "../src/lib/data/demo";
import { renderMarkdown } from "../src/lib/notebook/markdown";
import {
  BUILT_IN_TEMPLATES, renderTemplate, validateTemplateValues, getTemplate,
} from "../src/lib/notebook/templates";
import { differentialAnalysis } from "../src/lib/stats/differential";

/* ------------------------------------------------------------------ */
/* Delimited parsing                                                   */
/* ------------------------------------------------------------------ */

test("CSV parsing handles quotes, embedded delimiters and newlines", () => {
  const csv = 'name,value,note\n"Smith, John",12,"line1\nline2"\nplain,3,ok';
  const t = parseDelimited(csv);
  assert.deepEqual(t.headers, ["name", "value", "note"]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][0], "Smith, John");
  assert.equal(t.rows[0][2], "line1\nline2");
  assert.equal(t.rows[1][0], "plain");
});

test("escaped double quotes survive a round trip", () => {
  const original = [['He said ""hi""'.replace(/""/g, '"'), "x"]];
  const text = toDelimited(["a", "b"], original);
  const back = parseDelimited(text);
  assert.equal(back.rows[0][0], original[0][0]);
});

test("delimiter detection prefers the consistent separator", () => {
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
});

test("BOM and CRLF endings are tolerated", () => {
  const t = parseDelimited("﻿a,b\r\n1,2\r\n");
  assert.deepEqual(t.headers, ["a", "b"]);
  assert.deepEqual(t.rows, [["1", "2"]]);
});

test("ragged rows are padded and reported", () => {
  const t = parseDelimited("a,b,c\n1,2\n3,4,5");
  assert.equal(t.raggedRows.length, 1);
  assert.deepEqual(t.rows[0], ["1", "2", ""]);
});

test("numeric parsing copes with instrument formats", () => {
  assert.equal(parseNumber("1,234.5"), 1234.5);
  assert.equal(parseNumber("1.2e3"), 1200);
  assert.equal(parseNumber("50%"), 0.5);
  assert.equal(parseNumber("NA"), null);
  assert.equal(parseNumber("n/a"), null);
  assert.equal(parseNumber("#N/A"), null);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("-"), null);
  assert.equal(parseNumber("0"), 0);
  assert.equal(parseNumber("-3.5"), -3.5);
});

test("missing-value placeholders do not make a numeric column look like text", () => {
  // A real export writes NA/Filtered into measurement columns; treating those
  // as text drops the whole column from the analysis matrix.
  assert.ok(isMissingToken("NA"));
  assert.ok(isMissingToken("Filtered"));
  assert.ok(isMissingToken("#N/A"));
  assert.ok(!isMissingToken("MMP13"));
  assert.equal(inferColumnType(["1.5", "", "NA"]), "numeric");
  assert.equal(inferColumnType(["12.1", "NA", "Filtered", "13.4"]), "numeric");
  assert.equal(inferColumnType(["MMP13", "NA", "ACAN"]), "text");
});

test("column type inference separates numbers, dates and text", () => {
  assert.equal(inferColumnType(["1", "2", "3.5"]), "numeric");
  assert.equal(inferColumnType(["2026-08-18", "2026-01-02"]), "date");
  assert.equal(inferColumnType(["P1", "Q2", "R3"]), "text");
  assert.equal(inferColumnType(["", "", ""]), "empty");
});

/* ------------------------------------------------------------------ */
/* Raw file inventory                                                  */
/* ------------------------------------------------------------------ */

test("extension splitting handles double extensions", () => {
  assert.deepEqual(splitExtension("a.raw"), { stem: "a", extension: "raw" });
  assert.deepEqual(splitExtension("s1.fastq.gz"), { stem: "s1", extension: "fastq.gz" });
  assert.deepEqual(splitExtension("noext"), { stem: "noext", extension: "" });
  assert.deepEqual(splitExtension(".hidden"), { stem: ".hidden", extension: "" });
});

test("tokenizer splits on the usual separators", () => {
  assert.deepEqual(tokenize("Control_1"), ["Control", "1"]);
  assert.deepEqual(tokenize("IL1b-rep2"), ["IL1b", "rep2"]);
  assert.deepEqual(tokenize("a b.c_d"), ["a", "b", "c", "d"]);
});

test("inventory infers groups and replicates from filenames", () => {
  const inv = buildRawFileInventory([
    { name: "Control_1.raw", size: 1000 },
    { name: "Control_2.raw", size: 1010 },
    { name: "IL1b_1.raw", size: 990 },
    { name: "IL1b_2.raw", size: 1005 },
  ]);
  assert.equal(inv.entries.length, 4);
  assert.equal(inv.entries[0].inferredGroup, "Control");
  assert.equal(inv.entries[0].inferredReplicate, 1);
  assert.equal(inv.entries[2].inferredGroup, "IL1b");
  assert.equal(inv.entries[0].platform, "Thermo / Waters RAW");
  const groups = inv.groupSummary.map((g) => g.group).sort();
  assert.deepEqual(groups, ["Control", "IL1b"]);
});

test("inventory flags duplicates and zero-byte files", () => {
  const inv = buildRawFileInventory([
    { name: "a.raw", size: 100 },
    { name: "a.raw", size: 100 },
    { name: "b.raw", size: 0 },
  ]);
  assert.equal(inv.duplicateNames.length, 1);
  assert.ok(inv.issues.some((i) => i.includes("duplicate")));
  assert.ok(inv.issues.some((i) => i.includes("zero bytes")));
  assert.ok(inv.entries[2].issues.some((i) => i.includes("Zero bytes")));
});

test("humanSize formats readable units", () => {
  assert.equal(humanSize(0), "0 B");
  assert.equal(humanSize(1024), "1.0 KB");
  assert.equal(humanSize(1024 * 1024 * 5), "5.0 MB");
  assert.equal(humanSize(null), "");
});

/* ------------------------------------------------------------------ */
/* Sample sheet                                                        */
/* ------------------------------------------------------------------ */

test("sample sheet derives from the inventory and validates clean", () => {
  const inv = buildRawFileInventory(
    ["Control_1", "Control_2", "Control_3", "IL1b_1", "IL1b_2", "IL1b_3"].map((n) => ({
      name: `${n}.raw`, size: 1000,
    })),
  );
  const sheet = sampleSheetFromInventory(inv);
  assert.equal(sheet.rows.length, 6);
  assert.equal(sheet.groups.length, 2);
  assert.ok(sheet.valid, JSON.stringify(sheet.issues));
});

test("duplicate sample ids are an error", () => {
  const rows: SampleRow[] = [
    { sample_id: "S1", file_name: "a.raw", group: "A", replicate: 1, batch: null, run_order: 1, extra: {} },
    { sample_id: "S1", file_name: "b.raw", group: "A", replicate: 2, batch: null, run_order: 2, extra: {} },
    { sample_id: "S3", file_name: "c.raw", group: "B", replicate: 1, batch: null, run_order: 3, extra: {} },
    { sample_id: "S4", file_name: "d.raw", group: "B", replicate: 2, batch: null, run_order: 4, extra: {} },
  ];
  const sheet = validateSampleSheet(rows, []);
  assert.ok(!sheet.valid);
  assert.ok(sheet.issues.some((i) => i.level === "error" && i.message.includes("Duplicate sample_id")));
});

test("a one-replicate group is an error, two is a warning", () => {
  const mk = (id: string, group: string): SampleRow => ({
    sample_id: id, file_name: `${id}.raw`, group, replicate: 1, batch: null, run_order: 1, extra: {},
  });
  const single = validateSampleSheet([mk("a", "A"), mk("b", "B"), mk("c", "B")], []);
  assert.ok(single.issues.some((i) => i.level === "error" && i.message.includes('"A" has 1 sample')));

  const two = validateSampleSheet(
    [mk("a", "A"), mk("b", "A"), mk("c", "B"), mk("d", "B")], [],
  );
  assert.ok(two.valid);
  assert.ok(two.issues.some((i) => i.level === "warning" && i.message.includes("only 2 replicates")));
});

test("batch confounding is warned about", () => {
  const mk = (id: string, group: string, batch: string): SampleRow => ({
    sample_id: id, file_name: `${id}.raw`, group, replicate: 1, batch, run_order: 1, extra: {},
  });
  const sheet = validateSampleSheet(
    [
      mk("a", "A", "B1"), mk("b", "A", "B1"), mk("c", "A", "B1"),
      mk("d", "B", "B2"), mk("e", "B", "B2"), mk("f", "B", "B2"),
    ],
    [],
  );
  assert.ok(sheet.issues.some((i) => i.message.includes("confounded")));
});

test("sample sheet maps columns from a table by alias", () => {
  const headers = ["Sample", "Raw File", "Condition", "Rep", "Concentration"];
  const rows = [
    ["S1", "a.raw", "Control", "1", "10"],
    ["S2", "b.raw", "Control", "2", "10"],
    ["S3", "c.raw", "Treated", "1", "20"],
    ["S4", "d.raw", "Treated", "2", "20"],
  ];
  const sheet = sampleSheetFromTable(headers, rows);
  assert.equal(sheet.rows[0].sample_id, "S1");
  assert.equal(sheet.rows[0].file_name, "a.raw");
  assert.equal(sheet.rows[0].group, "Control");
  assert.equal(sheet.rows[0].replicate, 1);
  // Unclaimed columns become extras rather than being dropped.
  assert.deepEqual(sheet.extraColumns, ["Concentration"]);
  assert.equal(sheet.rows[2].extra["Concentration"], "20");
  const table = sampleSheetToTable(sheet);
  assert.ok(table.headers.includes("Concentration"));
  assert.equal(table.rows.length, 4);
});

/* ------------------------------------------------------------------ */
/* Rename                                                              */
/* ------------------------------------------------------------------ */

test("rename preserves extensions and reports collisions", () => {
  const files = [{ name: "A B.raw" }, { name: "A_B.raw" }];
  const preview = previewRename(files, [{ type: "sanitize", replacement: "_" }]);
  assert.equal(preview.rows[0].proposed, "A_B.raw");
  assert.equal(preview.collisions.length, 1);
  assert.ok(!preview.safe);
  assert.ok(preview.rows[0].errors.some((e) => e.includes("Collides")));
});

test("sanitize preset makes pipeline-safe names", () => {
  const preview = previewRename(
    [{ name: "My Sample #1 (final).raw" }],
    RENAME_PRESETS[0].rules,
  );
  assert.equal(preview.rows[0].proposed, "My_Sample_#1_(final).raw");
  assert.ok(preview.safe);
});

test("numbering prefixes a zero-padded sequence", () => {
  const preview = previewRename(
    [{ name: "a.raw" }, { name: "b.raw" }, { name: "c.raw" }],
    [{ type: "numbering", start: 1, padding: 3, position: "prefix", separator: "_" }],
  );
  assert.deepEqual(
    preview.rows.map((r) => r.proposed),
    ["001_a.raw", "002_b.raw", "003_c.raw"],
  );
  assert.ok(preview.safe);
});

test("template rule pulls values from sample sheet fields", () => {
  const preview = previewRename(
    [
      { name: "junk1.raw", fields: { group: "Control", replicate: "1" } },
      { name: "junk2.raw", fields: { group: "IL1b", replicate: "2" } },
    ],
    [{ type: "template", template: "{group}_{replicate}" }],
  );
  assert.deepEqual(
    preview.rows.map((r) => r.proposed),
    ["Control_1.raw", "IL1b_2.raw"],
  );
});

test("an invalid regex is reported rather than thrown", () => {
  const preview = previewRename(
    [{ name: "a.raw" }],
    [{ type: "regex", pattern: "([unclosed", replaceWith: "x", flags: "g" }],
  );
  assert.ok(preview.issues.some((i) => i.includes("Invalid regular expression")));
  assert.equal(preview.rows[0].proposed, "a.raw");
});

test("a rename that empties the name is an error", () => {
  const preview = previewRename(
    [{ name: "abc.raw" }],
    [{ type: "regex", pattern: "abc", replaceWith: "", flags: "g" }],
  );
  assert.ok(!preview.safe);
  assert.ok(preview.rows[0].errors.some((e) => e.includes("empty")));
});

test("Windows reserved device names are rejected", () => {
  const preview = previewRename(
    [{ name: "data.raw" }],
    [{ type: "regex", pattern: "^data$", replaceWith: "CON", flags: "" }],
  );
  assert.ok(preview.rows[0].errors.some((e) => e.includes("reserved device name")));
});

test("mapping inverts for rollback", () => {
  const preview = previewRename(
    [{ name: "old.raw" }],
    [{ type: "replace", find: "old", replaceWith: "new", all: true, caseSensitive: false }],
  );
  const map = previewToMapping(preview);
  assert.deepEqual(map, [{ from: "old.raw", to: "new.raw" }]);
  assert.deepEqual(invertMapping(map), [{ from: "new.raw", to: "old.raw" }]);
});

/* ------------------------------------------------------------------ */
/* Table profiling and matrix building                                 */
/* ------------------------------------------------------------------ */

test("table profiling identifies id, label and value columns", () => {
  const headers = ["Protein", "Gene", "Control_1", "Control_2", "Treated_1", "Treated_2", "Peptides"];
  const rows = [
    ["P001", "MMP13", "10.1", "10.3", "14.2", "14.4", "7"],
    ["P002", "COL2A1", "12.0", "12.2", "9.1", "9.0", "12"],
    ["P003", "ACAN", "8.4", "8.6", "7.9", "8.1", "4"],
  ];
  const profile = profileTable(headers, rows);
  assert.equal(profile.featureIdColumn, 0);
  assert.equal(profile.featureLabelColumn, 1);
  assert.deepEqual(profile.valueColumns, [2, 3, 4, 5]);
  // "Peptides" is an annotation column, not a measurement.
  assert.equal(profile.columns[6].role, "annotation");
});

test("matrix building keeps labels, parses numbers and skips empty rows", () => {
  const headers = ["Protein", "Gene", "A1", "A2"];
  const rows = [
    ["P001", "MMP13", "1.5", "2.5"],
    ["", "", "", ""],
    ["P002", "ACAN", "NA", "3.0"],
  ];
  const profile = profileTable(headers, rows);
  const built = buildMatrix(headers, rows, profile);
  assert.deepEqual(built.matrix.features, ["P001", "P002"]);
  assert.deepEqual(built.matrix.featureLabels, ["MMP13", "ACAN"]);
  assert.deepEqual(built.matrix.samples, ["A1", "A2"]);
  assert.deepEqual(built.matrix.values[0], [1.5, 2.5]);
  assert.deepEqual(built.matrix.values[1], [null, 3.0]);
  assert.equal(built.skippedRows, 1);
});

test("duplicate feature ids are suffixed, never dropped", () => {
  const headers = ["Protein", "A1", "A2"];
  const rows = [["P1", "1", "2"], ["P1", "3", "4"]];
  const profile = profileTable(headers, rows);
  const built = buildMatrix(headers, rows, profile);
  assert.equal(built.matrix.features.length, 2);
  assert.deepEqual(built.matrix.features, ["P1", "P1__2"]);
  assert.deepEqual(built.duplicateFeatures, ["P1"]);
});

test("sample QC summarises each column", () => {
  const qc = sampleQc({
    features: ["a", "b", "c"],
    samples: ["s1", "s2"],
    values: [[1, 10], [2, null], [3, 30]],
  });
  assert.equal(qc[0].observed, 3);
  assert.equal(qc[0].median, 2);
  assert.equal(qc[1].observed, 2);
  assert.equal(qc[1].missing, 1);
});

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

test("demo data is deterministic and shaped as documented", () => {
  const a = buildDemoData();
  const b = buildDemoData();
  assert.deepEqual(a.matrix.samples, b.matrix.samples);
  assert.deepEqual(a.matrix.values[0], b.matrix.values[0]);
  assert.equal(a.matrix.samples.length, 12);
  assert.equal(a.matrix.features.length, 600);
  assert.equal(new Set(a.groups).size, 4);
  assert.ok(a.matrix.featureLabels?.includes("MMP13"));
});

test("demo data yields significant hits after FDR control", () => {
  // A demo whose volcano comes out empty looks broken; this guards the power.
  const demo = buildDemoData();
  const idx = (g: string) => demo.groups.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0);
  const r = differentialAnalysis(
    demo.matrix, idx("IL-1b"), idx("Control"), "IL-1b", "Control",
    { test: "welch", correction: "bh", dataIsLog: true, pThreshold: 0.05, fcThreshold: 1 },
  );
  assert.ok(r.counts.up >= 5, `expected >=5 up, got ${r.counts.up}`);
  assert.ok(r.counts.down >= 5, `expected >=5 down, got ${r.counts.down}`);
  const mmp13 = r.rows.find((x) => x.label === "MMP13")!;
  assert.equal(mmp13.direction, "up");
});

/* ------------------------------------------------------------------ */
/* Markdown rendering                                                  */
/* ------------------------------------------------------------------ */

test("markdown escapes HTML before formatting", () => {
  const html = renderMarkdown('<script>alert("x")</script>');
  assert.ok(!html.includes("<script>"), "script tag must not survive");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("underscores inside identifiers are not emphasis", () => {
  const html = renderMarkdown("Figure exported as pca_plot.svg and sample_id kept.");
  assert.ok(!html.includes("<em>"), `unexpected emphasis: ${html}`);
  assert.ok(html.includes("pca_plot.svg"));
  assert.ok(html.includes("sample_id"));
});

test("genuine underscore and asterisk emphasis still works", () => {
  assert.ok(renderMarkdown("_emphasised_").includes("<em>emphasised</em>"));
  assert.ok(renderMarkdown("**bold**").includes("<strong>bold</strong>"));
  assert.ok(renderMarkdown("*starred*").includes("<em>starred</em>"));
});

test("consecutive lines keep their line breaks", () => {
  const html = renderMarkdown("**Operator:** Yamada\n**Purpose:** testing\n**Samples:** 6");
  assert.ok(html.includes("<br />"), "single newlines should become hard breaks");
  assert.equal((html.match(/<p>/g) ?? []).length, 1);
});

test("headings, lists, tables and rules render", () => {
  const html = renderMarkdown(
    "# Title\n\n- one\n- two\n\n1. first\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---\n",
  );
  assert.ok(html.includes("<h1>Title</h1>"));
  assert.ok(html.includes("<ul>") && html.includes("<li>one</li>"));
  assert.ok(html.includes("<ol>") && html.includes("<li>first</li>"));
  assert.ok(html.includes("<table>") && html.includes("<th>A</th>") && html.includes("<td>2</td>"));
  assert.ok(html.includes("<hr/>"));
});

test("table cells containing HTML are escaped", () => {
  const html = renderMarkdown("| A |\n| --- |\n| <b>x</b> |");
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(!html.includes("<b>x</b>"));
});

/* ------------------------------------------------------------------ */
/* Notebook templates                                                  */
/* ------------------------------------------------------------------ */

test("every built-in template renders without leftover placeholders", () => {
  for (const t of BUILT_IN_TEMPLATES) {
    const out = renderTemplate(t, {});
    assert.ok(!/\{\{/.test(out), `${t.id} left a placeholder: ${out.slice(0, 120)}`);
    assert.ok(!/\{\{#each/.test(out), `${t.id} left an each-block`);
    assert.ok(out.length > 40, `${t.id} rendered suspiciously short`);
  }
});

test("template substitution fills scalars and list blocks", () => {
  const t = getTemplate("tmt-labeling")!;
  const out = renderTemplate(t, {
    experiment_date: "2026-08-18",
    experiment_name: "TMT labeling",
    operator: "山田",
    sample_count: "6",
    trypsin_lot: "A123",
    tmt_lot: "B456",
    channels: ["126: Control_1", "127N: Control_2"],
  });
  assert.ok(out.includes("2026-08-18 TMT labeling"));
  assert.ok(out.includes("山田"));
  assert.ok(out.includes("Lot: A123"));
  assert.ok(out.includes("Lot: B456"));
  assert.ok(out.includes("- 126: Control_1"));
  assert.ok(out.includes("- 127N: Control_2"));
});

test("a list given as newline text is split into items", () => {
  const t = getTemplate("generic")!;
  const out = renderTemplate(t, { reagents: "Trypsin, Lot A123\nTMT, Lot B456" });
  assert.ok(out.includes("- Trypsin, Lot A123"));
  assert.ok(out.includes("- TMT, Lot B456"));
});

test("empty lists render a visible placeholder, not silence", () => {
  const t = getTemplate("generic")!;
  const out = renderTemplate(t, {});
  assert.ok(out.includes("not recorded"));
});

test("required-field validation reports what is missing", () => {
  const t = getTemplate("generic")!;
  const missing = validateTemplateValues(t, {});
  assert.ok(!missing.valid);
  assert.ok(missing.missing.length >= 3);

  const ok = validateTemplateValues(t, {
    experiment_date: "2026-08-18",
    operator: "山田",
    experiment_name: "Test",
  });
  assert.ok(ok.valid, JSON.stringify(ok.missing));
});

test("template values cannot inject markup through the renderer", () => {
  const t = getTemplate("generic")!;
  const md = renderTemplate(t, {
    experiment_name: "<img src=x onerror=alert(1)>",
    operator: "y",
    experiment_date: "2026-08-18",
  });
  const html = renderMarkdown(md);
  assert.ok(!html.includes("<img"), "raw img tag must not survive");
  assert.ok(html.includes("&lt;img"));
});
