import "server-only";

import { ASSISTANT_VOICE_INSTRUCTIONS, type KnowledgeDocument } from "./assistantKnowledge";

/**
 * Instructions for the live (speech-to-speech) assistant, split for token
 * economy:
 *
 * - `realtimeSessionInstructions` - the persona and speaking rules only. It is
 *   sent once per session and is what the model sees for turns that need no
 *   product knowledge.
 * - `responseInstructions` - persona + only the 2-3 knowledge snippets
 *   relevant to the current question, attached to that one response, instead
 *   of the whole knowledge base (~5k tokens) on every turn.
 *
 * The same persona text drives server-side answer generation for the cache,
 * so cached and live answers sound alike.
 */
export const SPOKEN_PERSONA = `あなたは LABNOTE（ラボノート）の研究アシスタントです。白衣を着た日本人女性研究者として、画面越しに相手と向き合って、声だけで会話しています。

## 話し方
- 標準語の、丁寧で自然な です・ます調。落ち着いた声で、すぐに答えます。
- 耳で聞いて分かる短い文で話します。1回の返答は1〜3文、120字程度まで。長い説明が必要なら要点だけ話し、「詳しくお話ししましょうか？」と確認します。
- 箇条書き・記号・URL・絵文字は使いません。手順は「まず」「次に」でつなぎます。
- 前置きや相づちを繰り返さず、質問にまっすぐ答えます。

## 守ること
- LABNOTE の使い方・料金・機能は「参考情報」だけを根拠に答えます。書かれていないことは断定せず、ヘルプページかお問い合わせを案内します。
- 研究一般の質問にも答えてよいですが、推測は推測だと伝えます。
- 危険な実験手順や医療・診断の判断には踏み込まず、専門家への確認を勧めます。
- 相手の研究データやカメラ映像は見えていません。`;

export type Audience = "guest" | "member";

export function audienceNote(audience: Audience): string {
  return audience === "guest"
    ? "相手はまだログインしていない訪問者です。始め方を聞かれたら、無料登録やログインを自然に案内してください。"
    : "相手はログイン済みの利用者です。";
}

/** Knowledge snippets trimmed to what a short spoken answer can use. */
const SNIPPET_CHARS = 450;

function snippets(docs: KnowledgeDocument[]): string {
  return docs
    .map((d) => {
      const body = d.body.length > SNIPPET_CHARS ? `${d.body.slice(0, SNIPPET_CHARS)}…` : d.body;
      return `### ${d.title}\n${body}`;
    })
    .join("\n\n");
}

export function realtimeSessionInstructions(audience: Audience): string {
  return `${SPOKEN_PERSONA}\n\n## 声\n${ASSISTANT_VOICE_INSTRUCTIONS}\n\n## 相手について\n${audienceNote(audience)}`;
}

export function responseInstructions(audience: Audience, docs: KnowledgeDocument[]): string {
  const reference = docs.length ? `\n\n## 参考情報（この質問に関係する部分）\n${snippets(docs)}` : "";
  return `${realtimeSessionInstructions(audience)}${reference}`;
}
