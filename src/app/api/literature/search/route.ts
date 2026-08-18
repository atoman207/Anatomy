import { NextResponse } from "next/server";
import { AiError, isAiEnabled } from "@/lib/ai/openai";
import { buildPubMedQuery } from "@/lib/ai/queryBuilder";
import { searchPubMed } from "@/lib/literature/pubmed";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Literature search.
 *
 * Two clearly separated stages: a model turns the question into a PubMed
 * query, then PubMed returns the records. Every article in the response came
 * out of the index — none is generated. When AI is unavailable the question is
 * passed through as a literal query, so the feature degrades to plain PubMed
 * search rather than failing.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const question = String(body?.question ?? "").trim();
    const useAi = body?.useAi !== false && isAiEnabled();
    const retmax = Math.min(50, Math.max(1, Number(body?.retmax) || 20));
    const yearsBack = Number(body?.yearsBack) || undefined;
    const sort = body?.sort === "pub_date" ? "pub_date" : "relevance";
    const explicitQuery =
      typeof body?.query === "string" && body.query.trim() ? body.query.trim() : null;

    if (!question && !explicitQuery) {
      return NextResponse.json({ error: "検索したい内容を入力してください。" }, { status: 400 });
    }

    const notes: string[] = [];
    let query = explicitQuery;
    let built = null;

    // An explicit query means the researcher edited it by hand; respect it.
    if (!query) {
      if (useAi) {
        try {
          const result = await buildPubMedQuery(question);
          built = result.data;
          query = result.data.query;
        } catch (e) {
          if (e instanceof AiError) {
            notes.push(`検索式の自動生成に失敗しました (${e.message})。入力をそのまま検索します。`);
          }
          query = question;
        }
      } else {
        query = question;
        if (!isAiEnabled()) {
          notes.push("AIが無効のため、入力をそのまま PubMed の検索式として使用しました。");
        }
      }
    }

    const search = await searchPubMed({
      term: query!,
      retmax,
      sort,
      yearsBack,
      includeAbstracts: true,
    });

    return NextResponse.json({
      question,
      builtQuery: built,
      executedQuery: search.query,
      translatedQuery: search.translatedQuery,
      total: search.total,
      articles: search.articles,
      notes: [...notes, ...search.notes],
      aiEnabled: isAiEnabled(),
    });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "検索に失敗しました。" },
      { status: 500 },
    );
  }
}
