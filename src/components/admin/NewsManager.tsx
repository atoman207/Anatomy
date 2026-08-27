"use client";

import { useState } from "react";
import {
  Badge, Button, Card, EmptyState, Field, TextArea, TextInput,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  createNewsArticle, deleteNewsArticle, updateNewsArticle, type NewsArticleInput,
} from "@/lib/news/actions";
import type { SiteNewsRow } from "@/lib/supabase/types";

/** `2026-08-27T09:00` from an ISO timestamp, for a `datetime-local` input. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_DRAFT: NewsArticleInput = {
  title: "",
  summary: "",
  bodyMd: "",
  isPublished: true,
  publishedAt: toLocalInputValue(new Date().toISOString()),
};

/**
 * Create, edit, and remove the announcements shown on the public landing
 * page (see NewsSection). Platform-admin only - the page that renders this
 * already enforces `requirePlatformAdmin`.
 */
export function NewsManager({ articles }: { articles: SiteNewsRow[] }) {
  const { toast } = useToast();
  const [items, setItems] = useState(articles);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<NewsArticleInput>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function startCreate() {
    setDraft(EMPTY_DRAFT);
    setEditingId("new");
  }

  function startEdit(row: SiteNewsRow) {
    setDraft({
      title: row.title,
      summary: row.summary,
      bodyMd: row.body_md,
      isPublished: row.is_published,
      publishedAt: toLocalInputValue(row.published_at),
    });
    setEditingId(row.id);
  }

  function cancel() {
    setEditingId(null);
  }

  async function save() {
    if (!draft.title.trim()) {
      toast("タイトルを入力してください。", { tone: "warn" });
      return;
    }
    setSaving(true);
    try {
      const res =
        editingId === "new"
          ? await createNewsArticle(draft)
          : await updateNewsArticle(editingId!, draft);
      if (!res.ok || !res.data) throw new Error(res.error ?? "保存に失敗しました。");

      setItems((prev) => {
        const next = editingId === "new"
          ? [res.data!, ...prev]
          : prev.map((it) => (it.id === res.data!.id ? res.data! : it));
        return [...next].sort((a, b) => b.published_at.localeCompare(a.published_at));
      });
      toast(editingId === "new" ? "お知らせを作成しました。" : "お知らせを更新しました。", { tone: "good" });
      setEditingId(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("このお知らせを削除しますか？この操作は取り消せません。")) return;
    setDeletingId(id);
    try {
      const res = await deleteNewsArticle(id);
      if (!res.ok) throw new Error(res.error ?? "削除に失敗しました。");
      setItems((prev) => prev.filter((it) => it.id !== id));
      toast("削除しました。", { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "削除に失敗しました。", { tone: "danger" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {editingId ? (
        <Card title={editingId === "new" ? "お知らせを作成" : "お知らせを編集"}>
          <div className="flex flex-col gap-3">
            <Field label="タイトル">
              <TextInput
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="例: 研究室チャットを追加しました"
              />
            </Field>
            <Field label="概要（一覧・カードに表示）">
              <TextArea
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                rows={2}
                placeholder="1〜2文で要点を"
              />
            </Field>
            <Field label="本文" hint="詳細ページはまだないため、現在はトップページのカード展開にのみ使われます。">
              <TextArea
                value={draft.bodyMd}
                onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })}
                rows={5}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="公開日時" className="w-auto">
                <TextInput
                  type="datetime-local"
                  value={draft.publishedAt}
                  onChange={(e) => setDraft({ ...draft, publishedAt: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={draft.isPublished}
                  onChange={(e) => setDraft({ ...draft, isPublished: e.target.checked })}
                />
                公開する
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="ghost" onClick={cancel} disabled={saving}>キャンセル</Button>
              <Button variant="primary" icon="save" onClick={() => void save()} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button variant="primary" icon="plus" onClick={startCreate}>お知らせを作成</Button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="お知らせはまだありません">
          「お知らせを作成」からトップページに表示する内容を追加してください。
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((row) => (
            <Card key={row.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[14px] font-semibold text-ink">{row.title}</p>
                    {row.is_published ? (
                      <Badge tone="good">公開中</Badge>
                    ) : (
                      <Badge tone="neutral">下書き</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {new Date(row.published_at).toLocaleString("ja-JP")}
                  </p>
                  {row.summary && <p className="mt-1 text-[13px] text-ink-2">{row.summary}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => startEdit(row)}>
                    編集
                  </Button>
                  <Button
                    size="sm" variant="danger" icon="trash"
                    disabled={deletingId === row.id}
                    onClick={() => void remove(row.id)}
                  >
                    削除
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
