import test from "node:test";
import assert from "node:assert/strict";

import { extractMarkdownImageSrc } from "../src/lib/notebook/markdown";
import { BUILT_IN_TEMPLATES } from "../src/lib/notebook/templates";
import { prefillFromRawCapture } from "../src/lib/notebook/prefill";

test("extractMarkdownImageSrc finds embedded data-URI images", () => {
  const md = "### Chart\n\n![volcano](data:image/png;base64,abc123)\n";
  assert.equal(extractMarkdownImageSrc(md), "data:image/png;base64,abc123");
});

test("extractMarkdownImageSrc returns null when no image is present", () => {
  assert.equal(extractMarkdownImageSrc("### Stats\n\n| A | B |\n"), null);
});


test("prefillFromRawCapture puts free-form text in notes for the generic template", () => {
  const generic = BUILT_IN_TEMPLATES.find((t) => t.id === "generic")!;
  const out = prefillFromRawCapture(generic, "培養した\n観察メモ");
  assert.equal(out.notes, "培養した\n観察メモ");
});

test("prefillFromRawCapture splits lines into procedure when notes is absent", () => {
  const template = {
    id: "custom-procedure-only",
    name: "手順のみ",
    description: "",
    category: "test",
    fields: [
      { key: "procedure", label: "手順", type: "list" as const },
      { key: "results", label: "結果", type: "textarea" as const },
    ],
    body: "",
  };
  const out = prefillFromRawCapture(template, "step one\n\nstep two");
  assert.equal(out.procedure, "step one\nstep two");
});
