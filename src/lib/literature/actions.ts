"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { Json } from "@/lib/supabase/types";
import type { PubMedArticle } from "./pubmed";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Saves the chosen articles to an experiment's literature record. */
export async function saveLiteraturePapers(
  labId: string,
  experimentId: string,
  articles: PubMedArticle[],
): Promise<ActionResult<{ count: number }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!articles.length) return { ok: false, error: "論文が選択されていません。" };

  const supabase = await createServerSupabase();
  const rows = articles.map((a) => ({
    lab_id: labId,
    experiment_id: experimentId,
    pmid: a.pmid || null,
    doi: a.doi || null,
    title: a.title,
    journal: a.journal || null,
    pub_year: a.year ?? null,
    authors: a.authors as unknown as Json,
    volume: a.volume || null,
    issue: a.issue || null,
    pages: a.pages || null,
    url: a.url || null,
    note: null,
    created_by: ctx.user.id,
  }));

  const { error } = await supabase.from("saved_papers").insert(rows);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId, userId: ctx.user.id, action: "literature.saved",
    entity: "experiment", entityId: experimentId,
    detail: { count: rows.length },
  });

  return { ok: true, data: { count: rows.length } };
}

export interface SavedPaperSummary {
  id: string;
  title: string;
  journal: string | null;
  pub_year: number | null;
  pmid: string | null;
  doi: string | null;
  authors: string[];
  volume: string | null;
  issue: string | null;
  pages: string | null;
  url: string | null;
  created_at: string;
}

/** Every paper saved to one experiment, newest first. */
export async function listSavedPapers(
  experimentId: string,
): Promise<ActionResult<SavedPaperSummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!experimentId) return { ok: true, data: [] };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("saved_papers")
    .select("id, title, journal, pub_year, pmid, doi, authors, volume, issue, pages, url, created_at")
    .eq("experiment_id", experimentId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return { ok: false, error: error.message };
  const rows: SavedPaperSummary[] = (data ?? []).map((r) => ({
    ...r,
    authors: Array.isArray(r.authors) ? (r.authors as unknown[]).map(String) : [],
  }));
  return { ok: true, data: rows };
}
