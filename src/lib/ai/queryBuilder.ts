import "server-only";

import { respondStructured, type StructuredResult } from "./openai";
import type { PubMedArticle } from "../literature/pubmed";

/**
 * The model's entire role in literature search: turning a question into a
 * PubMed query string.
 *
 * It never produces citations. Asked for "ten relevant papers" a model will
 * emit ten plausible-looking references, and some fraction of them will not
 * exist. Here it writes a query, PubMed executes it, and only real records
 * reach the researcher.
 */

export interface BuiltQuery {
  /** PubMed advanced-search syntax. */
  query: string;
  /** Plain-language account of what the query asks for. */
  explanation: string;
  /** The concepts the query was built from, for the UI to show as chips. */
  concepts: { concept: string; terms: string[] }[];
  /** Suggested broader query when the first returns too little. */
  broader_query: string | null;
  /** Suggested narrower query when the first returns too much. */
  narrower_query: string | null;
}

const QUERY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["query", "explanation", "concepts", "broader_query", "narrower_query"],
  properties: {
    query: { type: "string" },
    explanation: { type: "string" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["concept", "terms"],
        properties: {
          concept: { type: "string" },
          terms: { type: "array", items: { type: "string" } },
        },
      },
    },
    broader_query: { type: ["string", "null"] },
    narrower_query: { type: ["string", "null"] },
  },
};

const QUERY_SYSTEM = `あなたは PubMed の検索式を組み立てる専門家です。研究者の質問（日本語または英語）から、PubMed の advanced search 構文で検索式を作成します。

規則:
1. 概念ごとに同義語を OR でまとめ、概念同士は AND で結合します。
   例: ("chondrocyte"[Title/Abstract] OR "articular cartilage"[Title/Abstract]) AND ("MMP13"[Title/Abstract] OR "matrix metalloproteinase 13"[Title/Abstract])
2. 可能な限り MeSH 用語と Title/Abstract の両方を含めて感度を上げてください。
   例: ("Osteoarthritis"[MeSH Terms] OR "osteoarthritis"[Title/Abstract])
3. 日本語の専門用語は必ず英語の標準用語に変換してください。PubMed は日本語を検索できません。
   例: 軟骨細胞→chondrocyte、変形性関節症→osteoarthritis、炎症→inflammation
4. ギリシャ文字や記号は表記ゆれを両方入れてください。
   例: IL-1β → ("IL-1beta"[Title/Abstract] OR "IL-1b"[Title/Abstract] OR "interleukin-1 beta"[Title/Abstract])
5. 日付フィルタは検索式に含めないでください。別途アプリ側で付与します。
6. explanation は質問と同じ言語で、何を検索するのかを1〜2文で説明してください。
7. broader_query は概念を1つ減らすなどして緩めた式、narrower_query は限定を加えた式にします。不要なら null。
8. 論文そのものや著者名を創作してはいけません。検索式のみを出力します。`;

export async function buildPubMedQuery(
  question: string,
  model?: string,
): Promise<StructuredResult<BuiltQuery>> {
  return respondStructured<BuiltQuery>({
    model,
    system: QUERY_SYSTEM,
    user: question,
    schemaName: "pubmed_query",
    schema: QUERY_SCHEMA,
  });
}

/* ------------------------------------------------------------------ */
/* Summarizing retrieved results                                       */
/* ------------------------------------------------------------------ */

export interface LiteratureSummary {
  /** Overall answer to the researcher's question, grounded in the abstracts. */
  overview: string;
  themes: { theme: string; pmids: string[]; detail: string }[];
  /** Papers the model judges most directly relevant, by PMID. */
  most_relevant_pmids: string[];
  /** Gaps or caveats visible from the retrieved set. */
  caveats: string[];
}

const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "themes", "most_relevant_pmids", "caveats"],
  properties: {
    overview: { type: "string" },
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["theme", "pmids", "detail"],
        properties: {
          theme: { type: "string" },
          pmids: { type: "array", items: { type: "string" } },
          detail: { type: "string" },
        },
      },
    },
    most_relevant_pmids: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } },
  },
};

const SUMMARY_SYSTEM = `与えられた論文の書誌情報と抄録のみに基づいて要約します。

厳守事項:
1. 提示された論文以外の知識を持ち込まないでください。抄録に書かれていない主張をしてはいけません。
2. すべての主張に、根拠となる論文の PMID を必ず紐づけてください。PMID は与えられたものだけを使い、決して創作しないでください。
3. 抄録が提供されていない論文については、タイトルから読み取れる範囲に留めてください。
4. 検索結果から答えられない場合は、その旨を caveats に明記してください。無理に結論を出さないでください。
5. 出力は質問と同じ言語で書いてください。`;

export async function summarizeLiterature(
  question: string,
  articles: PubMedArticle[],
  model?: string,
): Promise<StructuredResult<LiteratureSummary>> {
  // Abstracts are trimmed so a large result set stays within a sane request
  // size; the model is told when it is seeing a truncated abstract.
  const corpus = articles
    .map((a) => {
      const abstract = a.abstract
        ? a.abstract.length > 1500
          ? `${a.abstract.slice(0, 1500)}…(以下略)`
          : a.abstract
        : "(抄録なし)";
      return [
        `PMID: ${a.pmid}`,
        `Title: ${a.title}`,
        `Journal: ${a.journal} (${a.pubDate})`,
        `Authors: ${a.authors.slice(0, 5).join(", ")}${a.authors.length > 5 ? " et al." : ""}`,
        `Abstract: ${abstract}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return respondStructured<LiteratureSummary>({
    model,
    system: SUMMARY_SYSTEM,
    user: `質問:\n${question}\n\n検索で得られた論文 (${articles.length} 件):\n\n${corpus}`,
    schemaName: "literature_summary",
    schema: SUMMARY_SCHEMA,
    timeoutMs: 120_000,
  });
}

/**
 * Drops any PMID the model cited that was not in the retrieved set.
 *
 * Structured Outputs guarantees the shape, not the truthfulness of a string.
 * This is the check that keeps an invented identifier out of the notebook.
 */
export function pruneHallucinatedPmids(
  summary: LiteratureSummary,
  articles: PubMedArticle[],
): { summary: LiteratureSummary; removed: string[] } {
  const valid = new Set(articles.map((a) => a.pmid));
  const removed: string[] = [];

  const keep = (pmids: string[]) =>
    pmids.filter((p) => {
      if (valid.has(p)) return true;
      removed.push(p);
      return false;
    });

  return {
    summary: {
      ...summary,
      themes: summary.themes.map((t) => ({ ...t, pmids: keep(t.pmids) })),
      most_relevant_pmids: keep(summary.most_relevant_pmids),
    },
    removed: [...new Set(removed)],
  };
}
