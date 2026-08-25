import "server-only";

import { aiConfig, respondStructured } from "./openai";

/**
 * "Does this manuscript look like it matches the target journal's format?" -
 * a separate, optional check requested alongside the three-reviewer AI査読,
 * not a fourth reviewer folded into it. Kept independent on purpose: the
 * three reviewers are a fixed, closed set (`ReviewerRole` in
 * peerReviewReport.ts, the `reviewer_profiles` table's CHECK constraint, the
 * admin editor) that judges the manuscript's content; this instead compares
 * the manuscript against one journal's own stated guidelines, which only
 * runs when a researcher supplies a URL, and folding it into that closed set
 * would mean widening every place that assumes exactly three reviewers for a
 * check that is conditional and structurally different (it has a second
 * input document, the journal's page, that the other three never see).
 */

export type JournalFormatMatch = "yes" | "partial" | "no" | "unknown";

export interface JournalFormatCheckResult {
  matches: JournalFormatMatch;
  /** Concrete, checkable points - "参考文献はAPA形式ですが、投稿要項はVancouver形式を指定しています" etc. */
  notes: string[];
  summary: string;
}

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["matches", "notes", "summary"],
  properties: {
    matches: { type: "string", enum: ["yes", "partial", "no", "unknown"] },
    notes: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

const SYSTEM_PROMPT = `あなたは学術雑誌の投稿要項（Author Guidelines / Instructions for Authors）と、
投稿予定の論文原稿を照合するアシスタントです。以下を厳守してください:

1. 判断材料は、与えられた「論文本文」と「ジャーナルのページから抽出したテキスト」だけです。それ以外の知識で補完しないでください。
2. ジャーナルのページのテキストに、書式・構成・文献引用形式・語数制限などの具体的な投稿要項が含まれていない場合（トップページのみ、ログインが必要、要項ページではない等）、matches は "unknown" とし、その旨を summary に明記してください。
3. 判断できる場合は、実際に確認できた項目（例: セクション構成、参考文献の形式、図表の扱い、語数・ページ数の上限）についてのみ notes に具体的に書いてください。要項に書かれていない項目について指摘しないでください。
4. matches は次の基準で選んでください: "yes" は確認できた項目がすべて一致、"partial" は一部一致・一部不一致、"no" は明確な不一致がある、"unknown" は要項自体が判断材料として不十分。
5. summary は2〜3文で、全体としてどう見えるかを日本語で要約してください。`;

export interface CheckJournalFormatOptions {
  manuscriptText: string;
  journalUrl: string;
  journalPageText: string;
  model?: string;
}

/** Generous excerpt of the manuscript; this check only needs its visible structure, not the full text. */
const MAX_MANUSCRIPT_CHARS = 20_000;

export async function checkJournalFormat(
  opts: CheckJournalFormatOptions,
): Promise<{ data: JournalFormatCheckResult; model: string }> {
  const manuscript = opts.manuscriptText.length > MAX_MANUSCRIPT_CHARS
    ? opts.manuscriptText.slice(0, MAX_MANUSCRIPT_CHARS)
    : opts.manuscriptText;

  const user = [
    `ジャーナルのURL: ${opts.journalUrl}`,
    "",
    "ジャーナルのページから抽出したテキスト:",
    opts.journalPageText,
    "",
    "論文本文:",
    manuscript,
  ].join("\n");

  const result = await respondStructured<JournalFormatCheckResult>({
    model: opts.model ?? aiConfig().text,
    system: SYSTEM_PROMPT,
    user,
    schemaName: "journal_format_check",
    schema: SCHEMA,
  });

  return { data: result.data, model: result.model };
}
