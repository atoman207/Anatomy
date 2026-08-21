"use client";

import { useEffect, useState } from "react";
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Select,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  adminDeleteContent, adminListContent, type ContentRow, type LabContentUsage,
} from "@/app/admin/content/contentActions";
import {
  CONTENT_CONFIG, CONTENT_KINDS, detailOf, isLockedRow, titleOf, type ContentKind,
} from "@/app/admin/content/contentTypes";

export interface LabOption {
  id: string;
  name: string;
}

export function AdminContentManager({
  labs, usage,
}: {
  labs: LabOption[];
  usage: LabContentUsage[];
}) {
  const { toast } = useToast();
  const labById = new Map(labs.map((l) => [l.id, l.name]));

  const [kind, setKind] = useState<ContentKind>(CONTENT_KINDS[0]);
  const [labFilter, setLabFilter] = useState("");
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Nested so the immediate setLoading(true) below is not a direct
    // synchronous call in the effect body itself.
    void (async () => {
      setLoading(true);
      const res = await adminListContent(kind, labFilter || null);
      if (cancelled) return;
      if (res.ok && res.data) setRows(res.data);
      else {
        setRows([]);
        toast(res.error ?? "取得できませんでした。", { tone: "danger" });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, labFilter, toast]);

  async function remove(row: ContentRow) {
    const locked = isLockedRow(kind, row);
    const label = titleOf(kind, row);
    const confirmed = window.confirm(
      locked
        ? `「${label}」は本来編集・削除できない保護されたレコードです。管理者権限で削除を上書きします。` +
          "この操作は取り消せません。よろしいですか？"
        : `「${label}」を削除します。この操作は取り消せません。よろしいですか？`,
    );
    if (!confirmed) return;

    setDeletingId(row.id);
    try {
      const res = await adminDeleteContent(kind, row.id);
      if (!res.ok) throw new Error(res.error ?? "削除に失敗しました。");
      setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
      toast(`「${label}」を削除しました。`, { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "削除に失敗しました。", { tone: "danger" });
    } finally {
      setDeletingId(null);
    }
  }

  const config = CONTENT_CONFIG[kind];

  return (
    <div className="flex flex-col gap-4">
      <UsageSummary usage={usage} />

      <Card title="コンテンツを検索">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="種類">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ContentKind)}>
              {CONTENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONTENT_CONFIG[k].label}
                  {CONTENT_CONFIG[k].protectedByDesign ? "（保護レコード）" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="研究室で絞り込み">
            <Select value={labFilter} onChange={(e) => setLabFilter(e.target.value)}>
              <option value="">すべての研究室</option>
              {labs.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card
        title={config.label}
        subtitle={
          config.protectedByDesign
            ? "通常は編集・削除できない保護されたレコードです。ここでの削除は管理者による例外的な上書きとして監査ログに記録されます。"
            : "最新 200 件まで表示します。"
        }
      >
        {loading ? (
          <p className="text-[13px] text-ink-3">読み込み中…</p>
        ) : !rows || rows.length === 0 ? (
          <EmptyState title="該当するレコードがありません" />
        ) : (
          <DataTable
            headers={["タイトル", "研究室", "詳細", "作成日時", "操作"]}
            align={["left", "left", "left", "left", "left"]}
            rows={rows.map((row) => {
              const locked = isLockedRow(kind, row);
              const createdAt = typeof row.created_at === "string" ? row.created_at : null;
              return [
                <span key="t" className="flex items-center gap-1.5 font-medium text-ink">
                  {titleOf(kind, row)}
                  {locked && <Badge tone="warn">保護</Badge>}
                </span>,
                <span key="l" className="text-ink-2">{labById.get(row.lab_id) ?? "—"}</span>,
                <span key="d" className="text-ink-3">{detailOf(kind, row) || "—"}</span>,
                <span key="c" className="text-ink-3">
                  {createdAt ? new Date(createdAt).toLocaleString() : "—"}
                </span>,
                <Button
                  key="a" size="sm" variant="danger" icon="trash"
                  disabled={deletingId === row.id}
                  onClick={() => remove(row)}
                >
                  削除
                </Button>,
              ];
            })}
          />
        )}
      </Card>
    </div>
  );
}

function UsageSummary({ usage }: { usage: LabContentUsage[] }) {
  if (usage.length === 0) {
    return (
      <Card title="研究室別の件数">
        <EmptyState title="研究室がまだありません" />
      </Card>
    );
  }

  return (
    <Card title="研究室別の件数" subtitle="各研究室が保有するコンテンツの件数です。">
      <DataTable
        headers={["研究室", ...CONTENT_KINDS.map((k) => CONTENT_CONFIG[k].label), "合計"]}
        align={["left", ...CONTENT_KINDS.map(() => "right" as const), "right"]}
        rows={usage.map((u) => [
          <span key="l" className="font-medium text-ink">{u.labName}</span>,
          ...CONTENT_KINDS.map((k) => u.counts[k]),
          <span key="t" className="font-semibold text-ink">{u.total}</span>,
        ])}
      />
    </Card>
  );
}
