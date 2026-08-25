import { NextResponse } from "next/server";
import { findSimilarArticles } from "@/lib/literature/pubmed";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Papers similar to one already-found article, via PubMed's own "similar
 * articles" ranking (see `findSimilarArticles`'s doc comment) - no model call,
 * so this has no AI gate the way /search's query-builder step does. Same
 * open-access shape as /search: PubMed itself is free, and gating a feature
 * that costs this app nothing would only slow a researcher down for no reason.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pmid = String(body?.pmid ?? "").trim();
    if (!/^\d+$/.test(pmid)) {
      return NextResponse.json({ error: "PMIDが不正です。" }, { status: 400 });
    }
    const retmax = Math.min(50, Math.max(1, Number(body?.retmax) || 10));

    const result = await findSimilarArticles(pmid, { retmax });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "類似論文の検索に失敗しました。" },
      { status: 500 },
    );
  }
}
