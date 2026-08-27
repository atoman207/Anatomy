"use server";

/**
 * Site news: short announcements shown on the public landing page and
 * managed from /admin/news.
 *
 * Platform-admin only to write, the same authority level as
 * /admin/peer-review: this is deployment-wide content, not something a lab
 * manages for itself. `site_news` has row-level security enabled with no
 * client-facing policy at all (see supabase/migrations/all.sql), so every
 * read and write here goes through the service-role client - the public
 * landing page has no session to check a policy against anyway, and the
 * authority check below is what actually protects writes.
 */

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { SiteNewsRow } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function platformAdmin() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("ログインしていません。");
  if (!ctx.isPlatformAdmin) throw new Error("システム管理者のみ利用できます。");
  return ctx;
}

function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Date.now().toString(36).slice(-6);
  return base ? `${base.slice(0, 60)}-${suffix}` : suffix;
}

/** Every article, published or not, newest first - for the admin editor. */
export async function adminListNews(): Promise<ActionResult<SiteNewsRow[]>> {
  try {
    await platformAdmin();
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("site_news")
      .select("*")
      .order("published_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "取得できませんでした。" };
  }
}

/** Published articles only, newest first - what the landing page shows. */
export async function listPublishedNews(limit = 5): Promise<SiteNewsRow[]> {
  try {
    const admin = createAdminSupabase();
    const { data } = await admin
      .from("site_news")
      .select("*")
      .eq("is_published", true)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch {
    // A missing table (migration not pasted in yet) or an unreachable
    // database degrades to an empty list rather than breaking the public
    // landing page over an optional section.
    return [];
  }
}

export interface NewsArticleInput {
  title: string;
  summary: string;
  bodyMd: string;
  isPublished: boolean;
  publishedAt: string;
}

function validate(input: NewsArticleInput): string | null {
  if (!input.title.trim()) return "タイトルを入力してください。";
  if (!input.publishedAt || Number.isNaN(Date.parse(input.publishedAt))) {
    return "公開日を正しく入力してください。";
  }
  return null;
}

export async function createNewsArticle(input: NewsArticleInput): Promise<ActionResult<SiteNewsRow>> {
  try {
    const ctx = await platformAdmin();
    const error = validate(input);
    if (error) return { ok: false, error };

    const admin = createAdminSupabase();
    const { data, error: dbError } = await admin
      .from("site_news")
      .insert({
        slug: slugify(input.title),
        title: input.title.trim(),
        summary: input.summary.trim(),
        body_md: input.bodyMd,
        is_published: input.isPublished,
        published_at: new Date(input.publishedAt).toISOString(),
        created_by: ctx.user.id,
      })
      .select("*")
      .single();
    if (dbError) return { ok: false, error: dbError.message };

    await logAudit({
      labId: null, userId: ctx.user.id, action: "news.created",
      entity: "site_news", entityId: data.id, detail: { title: input.title.trim() },
    });

    revalidatePath("/admin/news");
    revalidatePath("/");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "作成できませんでした。" };
  }
}

export async function updateNewsArticle(
  id: string,
  input: NewsArticleInput,
): Promise<ActionResult<SiteNewsRow>> {
  try {
    const ctx = await platformAdmin();
    const error = validate(input);
    if (error) return { ok: false, error };
    if (!id) return { ok: false, error: "対象が指定されていません。" };

    const admin = createAdminSupabase();
    const { data, error: dbError } = await admin
      .from("site_news")
      .update({
        title: input.title.trim(),
        summary: input.summary.trim(),
        body_md: input.bodyMd,
        is_published: input.isPublished,
        published_at: new Date(input.publishedAt).toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (dbError) return { ok: false, error: dbError.message };

    await logAudit({
      labId: null, userId: ctx.user.id, action: "news.updated",
      entity: "site_news", entityId: id, detail: { title: input.title.trim() },
    });

    revalidatePath("/admin/news");
    revalidatePath("/");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新できませんでした。" };
  }
}

export async function deleteNewsArticle(id: string): Promise<ActionResult> {
  try {
    const ctx = await platformAdmin();
    if (!id) return { ok: false, error: "対象が指定されていません。" };

    const admin = createAdminSupabase();
    const { error } = await admin.from("site_news").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    await logAudit({
      labId: null, userId: ctx.user.id, action: "news.deleted",
      entity: "site_news", entityId: id, detail: {},
    });

    revalidatePath("/admin/news");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "削除できませんでした。" };
  }
}
