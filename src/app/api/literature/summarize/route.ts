import { NextResponse } from "next/server";
import { AiError, isAiEnabled } from "@/lib/ai/openai";
import { summarizeLiterature, pruneHallucinatedPmids } from "@/lib/ai/queryBuilder";
import type { PubMedArticle } from "@/lib/literature/pubmed";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_ARTICLES = 30;

/**
 * Summarizes an already-retrieved result set.
 *
 * The article list is posted back from the client rather than re-fetched, so
 * the model can only see records PubMed actually returned. Any PMID it cites
 * that was not in that set is stripped before the response is sent.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY が設定されていないため、要約は利用できません。" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const question = String(body?.question ?? "").trim();
    const articles = (body?.articles ?? []) as PubMedArticle[];

    if (!question) {
      return NextResponse.json({ error: "質問が空です。" }, { status: 400 });
    }
    if (!Array.isArray(articles) || articles.length === 0) {
      return NextResponse.json({ error: "要約する論文がありません。" }, { status: 400 });
    }

    const subset = articles.slice(0, MAX_ARTICLES);
    const notes: string[] = [];
    if (articles.length > MAX_ARTICLES) {
      notes.push(`上位 ${MAX_ARTICLES} 件のみを要約しました（全 ${articles.length} 件）。`);
    }

    const started = Date.now();
    const result = await summarizeLiterature(question, subset);
    const { summary, removed } = pruneHallucinatedPmids(result.data, subset);

    if (removed.length) {
      // Worth surfacing: it means the model referenced something outside the
      // retrieved set, and the researcher should treat the summary carefully.
      notes.push(
        `検索結果に存在しない PMID を ${removed.length} 件除去しました: ${removed.join(", ")}`,
      );
    }

    return NextResponse.json({
      summary,
      notes,
      model: result.model,
      usage: result.usage,
      elapsedMs: Date.now() - started,
      articleCount: subset.length,
    });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "要約に失敗しました。" },
      { status: 500 },
    );
  }
}
