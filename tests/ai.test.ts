import test from "node:test";
import assert from "node:assert/strict";

import { parseAbstractsXml, type PubMedArticle } from "../src/lib/literature/pubmed";
import { formatCitation } from "../src/lib/literature/citation";
import { pruneHallucinatedPmids, type LiteratureSummary } from "../src/lib/ai/queryBuilder";
import {
  voiceNoteToMarkdown, missingFields, VOICE_NOTE_SCHEMA,
  type StructuredVoiceNote,
} from "../src/lib/ai/voiceNote";
import { renderMarkdown } from "../src/lib/notebook/markdown";

/* ------------------------------------------------------------------ */
/* PubMed XML parsing                                                  */
/* ------------------------------------------------------------------ */

const TWO_ARTICLES = `<?xml version="1.0"?>
<PubmedArticleSet>
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">11111111</PMID>
    <Article>
      <Abstract>
        <AbstractText Label="BACKGROUND">First background text.</AbstractText>
        <AbstractText Label="RESULTS">First results text.</AbstractText>
      </Abstract>
    </Article>
  </MedlineCitation>
  <ReferenceList>
    <Reference><ArticleIdList><ArticleId IdType="pubmed">99999999</ArticleId></ArticleIdList></Reference>
  </ReferenceList>
</PubmedArticle>
<PubmedArticle>
  <MedlineCitation>
    <PMID Version="1">22222222</PMID>
    <Article>
      <Abstract>
        <AbstractText>Second article abstract with &lt;i&gt;markup&lt;/i&gt; and &amp;amp; entity.</AbstractText>
      </Abstract>
    </Article>
  </MedlineCitation>
</PubmedArticle>
</PubmedArticleSet>`;

test("abstracts are attributed to the correct article", () => {
  const map = parseAbstractsXml(TWO_ARTICLES);
  assert.equal(map.size, 2);
  assert.ok(map.get("11111111")?.includes("First background text"));
  assert.ok(map.get("11111111")?.includes("First results text"));
  // A reference-list PMID must not become a key of its own.
  assert.equal(map.has("99999999"), false);
  assert.ok(map.get("22222222")?.includes("Second article abstract"));
  // The second article's text must not leak into the first.
  assert.ok(!map.get("11111111")?.includes("Second article"));
});

test("structured abstract labels are preserved", () => {
  const map = parseAbstractsXml(TWO_ARTICLES);
  assert.ok(map.get("11111111")?.startsWith("BACKGROUND:"));
  assert.ok(map.get("11111111")?.includes("RESULTS:"));
});

test("inline markup and entities are unwrapped", () => {
  const map = parseAbstractsXml(TWO_ARTICLES);
  const text = map.get("22222222")!;
  assert.ok(!text.includes("<i>"), `markup survived: ${text}`);
  assert.ok(text.includes("markup"));
});

test("a comparison operator in an abstract is not mistaken for markup", () => {
  const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation>
    <PMID Version="1">44444444</PMID><Article><Abstract>
    <AbstractText>Expression fell (p &lt; 0.05) after &lt;i&gt;IL-1&lt;/i&gt; treatment.</AbstractText>
    </Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
  const text = parseAbstractsXml(xml).get("44444444")!;
  assert.ok(text.includes("p < 0.05"), `comparison lost: ${text}`);
  assert.ok(!text.includes("<i>"), `italic markup survived: ${text}`);
  assert.ok(text.includes("IL-1"));
});

test("an article with no abstract is simply absent", () => {
  const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation>
    <PMID Version="1">33333333</PMID></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
  const map = parseAbstractsXml(xml);
  assert.equal(map.has("33333333"), false);
  assert.equal(map.size, 0);
});

test("empty or malformed XML yields an empty map rather than throwing", () => {
  assert.equal(parseAbstractsXml("").size, 0);
  assert.equal(parseAbstractsXml("<html>not pubmed</html>").size, 0);
});

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

function article(over: Partial<PubMedArticle> = {}): PubMedArticle {
  return {
    pmid: "12345678",
    title: "A study of chondrocytes",
    journal: "J Test",
    pubDate: "2024 Mar",
    year: 2024,
    authors: ["Yamada T", "Suzuki K"],
    doi: "10.1000/test",
    pmcid: null,
    abstract: null,
    publicationTypes: [],
    url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
    doiUrl: "https://doi.org/10.1000/test",
    volume: null,
    issue: null,
    pages: null,
    ...over,
  };
}

test("citations use et al. past six authors (Vancouver style) and fall back to PMID without a DOI", () => {
  assert.ok(formatCitation(article()).includes("Yamada T, Suzuki K"));
  assert.ok(formatCitation(article()).includes("doi:10.1000/test"));

  const many = formatCitation(
    article({ authors: ["A B", "C D", "E F", "G H", "I J", "K L", "M N"] }),
  );
  assert.ok(many.includes("et al."), many);

  const noDoi = formatCitation(article({ doi: null }));
  assert.ok(noDoi.includes("PMID: 12345678"));
  assert.ok(!noDoi.includes("doi:"));
});

test("citations include volume, issue and pages when known", () => {
  const full = formatCitation(article({ volume: "41", issue: "3", pages: "512-520" }));
  assert.ok(full.includes("2024;41(3):512-520"), full);
});

/* ------------------------------------------------------------------ */
/* Hallucinated PMID removal                                           */
/* ------------------------------------------------------------------ */

/**
 * Structured Outputs guarantees the shape of a response, not the truth of the
 * strings inside it. This filter is the check that keeps an invented
 * identifier from reaching a manuscript.
 */
test("PMIDs outside the retrieved set are stripped from a summary", () => {
  const articles = [article({ pmid: "111" }), article({ pmid: "222" })];
  const summary: LiteratureSummary = {
    overview: "overview",
    themes: [
      { theme: "A", pmids: ["111", "999"], detail: "d" },
      { theme: "B", pmids: ["888"], detail: "d" },
    ],
    most_relevant_pmids: ["222", "777"],
    caveats: [],
  };

  const { summary: cleaned, removed } = pruneHallucinatedPmids(summary, articles);
  assert.deepEqual(cleaned.themes[0].pmids, ["111"]);
  assert.deepEqual(cleaned.themes[1].pmids, []);
  assert.deepEqual(cleaned.most_relevant_pmids, ["222"]);
  assert.deepEqual(removed.sort(), ["777", "888", "999"]);
});

test("a summary citing only real PMIDs passes through untouched", () => {
  const articles = [article({ pmid: "111" }), article({ pmid: "222" })];
  const summary: LiteratureSummary = {
    overview: "o",
    themes: [{ theme: "A", pmids: ["111", "222"], detail: "d" }],
    most_relevant_pmids: ["111"],
    caveats: ["c"],
  };
  const { summary: cleaned, removed } = pruneHallucinatedPmids(summary, articles);
  assert.equal(removed.length, 0);
  assert.deepEqual(cleaned.themes[0].pmids, ["111", "222"]);
  assert.deepEqual(cleaned.caveats, ["c"]);
});

/* ------------------------------------------------------------------ */
/* Voice note rendering                                                */
/* ------------------------------------------------------------------ */

function note(over: Partial<StructuredVoiceNote> = {}): StructuredVoiceNote {
  return {
    experiment_date: "2026-08-18",
    experiment_name: "TMT標識",
    operator: "山田",
    purpose: null,
    sample_count: 6,
    samples: [],
    reagents: [{ name: "Trypsin", lot: "A123", amount: null }],
    treatments: [{ agent: "IL-1β", concentration: null, duration: "24時間" }],
    procedure: ["TMT標識を実施"],
    observations: [],
    next_actions: [],
    uncertain_terms: [],
    summary: null,
    ...over,
  };
}

test("a field the memo never mentioned renders as a visible gap", () => {
  const md = voiceNoteToMarkdown(note({ purpose: null }));
  // An em dash, not an empty line: a blank in a lab notebook has to look
  // like a blank rather than like a value nobody checked.
  assert.ok(md.includes("**目的:** —"), md);
});

test("reagent lots and treatment durations survive rendering", () => {
  const md = voiceNoteToMarkdown(note());
  assert.ok(md.includes("Trypsin — Lot: A123"));
  assert.ok(md.includes("IL-1β / 24時間"));
  assert.ok(md.includes("1. TMT標識を実施"));
});

test("empty sections are omitted rather than left as bare headings", () => {
  const md = voiceNoteToMarkdown(note({ observations: [], next_actions: [] }));
  assert.ok(!md.includes("## 観察"));
  assert.ok(!md.includes("## 次のアクション"));
});

test("uncertain terms get their own section so they are confirmed", () => {
  const md = voiceNoteToMarkdown(note({ uncertain_terms: ["リエージェント"] }));
  assert.ok(md.includes("要確認"));
  assert.ok(md.includes("リエージェント"));
});

test("the raw transcript can be embedded for provenance", () => {
  const md = voiceNoteToMarkdown(note(), {
    transcript: "本日TMT標識を実施します",
    includeTranscript: true,
  });
  assert.ok(md.includes("元の書き起こし"));
  assert.ok(md.includes("本日TMT標識を実施します"));
});

test("missingFields reports exactly what was not said", () => {
  assert.deepEqual(missingFields(note()), ["目的"].filter(() => false).concat([]));

  const bare = note({
    experiment_date: null, experiment_name: null, operator: null,
    sample_count: null, reagents: [], procedure: [],
  });
  const missing = missingFields(bare);
  assert.ok(missing.includes("実験日"));
  assert.ok(missing.includes("実験名"));
  assert.ok(missing.includes("担当者"));
  assert.ok(missing.includes("サンプル数"));
  assert.ok(missing.includes("試薬"));
  assert.ok(missing.includes("実施内容"));
});

test("rendered voice notes survive the notebook markdown renderer", () => {
  const html = renderMarkdown(voiceNoteToMarkdown(note()));
  assert.ok(html.includes("<h1>"));
  assert.ok(html.includes("Trypsin"));
  assert.ok(!html.includes("<script"));
});

test("a hostile transcript cannot inject markup through the note", () => {
  const md = voiceNoteToMarkdown(
    note({ experiment_name: "<img src=x onerror=alert(1)>" }),
  );
  const html = renderMarkdown(md);
  assert.ok(!html.includes("<img"), html.slice(0, 200));
  assert.ok(html.includes("&lt;img"));
});

/* ------------------------------------------------------------------ */
/* Schema shape                                                        */
/* ------------------------------------------------------------------ */

/**
 * Structured Outputs in strict mode requires every property to appear in
 * `required` and `additionalProperties: false` on every object. A drifting
 * schema fails at request time with an opaque 400, so it is checked here.
 */
function assertStrict(schema: Record<string, unknown>, path = "root"): void {
  if (schema.type === "object") {
    assert.equal(
      schema.additionalProperties, false,
      `${path}: additionalProperties must be false`,
    );
    const props = Object.keys((schema.properties ?? {}) as object);
    const required = (schema.required ?? []) as string[];
    assert.deepEqual(
      [...required].sort(), [...props].sort(),
      `${path}: every property must be listed in required`,
    );
    for (const [k, v] of Object.entries((schema.properties ?? {}) as Record<string, unknown>)) {
      assertStrict(v as Record<string, unknown>, `${path}.${k}`);
    }
  }
  if (schema.type === "array" && schema.items) {
    assertStrict(schema.items as Record<string, unknown>, `${path}[]`);
  }
}

test("the voice note schema satisfies strict Structured Outputs rules", () => {
  assertStrict(VOICE_NOTE_SCHEMA);
});

test("every voice note field is nullable or an array, so nothing is invented", () => {
  const props = VOICE_NOTE_SCHEMA.properties as Record<string, { type?: unknown }>;
  for (const [key, def] of Object.entries(props)) {
    const type = def.type;
    const nullable = Array.isArray(type) && type.includes("null");
    const isArray = type === "array";
    assert.ok(
      nullable || isArray,
      `${key} must be nullable or an array so "not said" is representable`,
    );
  }
});
