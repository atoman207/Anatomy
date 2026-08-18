import { NextResponse } from "next/server";
import { verifyDoi } from "@/lib/literature/crossref";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ITEMS = 30;

/**
 * Confirms DOIs resolve in Crossref and that their titles agree with PubMed.
 *
 * PubMed says which papers exist; Crossref independently confirms the
 * identifier a manuscript will actually cite.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items = (body?.items ?? []) as { doi: string; title?: string }[];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "確認する DOI がありません。" }, { status: 400 });
    }

    const subset = items.filter((i) => i?.doi).slice(0, MAX_ITEMS);
    // Sequential rather than parallel: Crossref's polite pool expects a
    // considerate request rate, and a burst risks being throttled.
    const results = [];
    for (const item of subset) {
      results.push(await verifyDoi(item.doi, item.title));
    }

    return NextResponse.json({
      results,
      checked: results.length,
      resolved: results.filter((r) => r.resolves).length,
      mismatched: results.filter((r) => r.titleMatches === false).length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "DOI の確認に失敗しました。" },
      { status: 500 },
    );
  }
}
