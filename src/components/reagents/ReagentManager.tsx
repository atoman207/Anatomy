"use client";

import { useEffect, useState } from "react";
import {
  Badge, Button, Callout, Card, DataTable, EmptyState, Field, Select, TextInput,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import type { Reagent } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import {
  createReagent, deleteReagent, listReagents, updateReagent, type ReagentInput,
} from "@/lib/reagents/actions";

export interface LabOption {
  id: string;
  name: string;
}

interface ExperimentOption {
  id: string;
  name: string;
  experiment_date: string;
  lab_id: string;
}

const EMPTY_INPUT: ReagentInput = {
  name: "", category: null, vendor: null, lot: null, received_at: null, expires_at: null, notes: null,
};

function isExpiringSoon(expiresAt: string | null): "expired" | "soon" | null {
  if (!expiresAt) return null;
  const days = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return "expired";
  if (days <= 30) return "soon";
  return null;
}

export function ReagentManager({
  labs, initialLabId, initialExperimentId, onExperimentChange,
  selectable, selectedIds, onToggleSelected,
}: {
  labs: LabOption[];
  /** Preselected when it names one of `labs` (e.g. the wizard's current lab); falls back to the first lab. */
  initialLabId?: string | null;
  initialExperimentId?: string | null;
  onExperimentChange?: (next: ExperimentOption | null) => void;
  /**
   * Adds a checkbox column so the caller can track "which of these are used
   * today" separately from the full registry - the report wizard's step 2
   * uses this; the standalone /reagents tool (pure CRUD, no such concept)
   * does not pass these props at all.
   */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
}) {
  const [labId, setLabId] = useState(
    (initialLabId && labs.some((l) => l.id === initialLabId) ? initialLabId : labs[0]?.id) ?? "",
  );
  const [experiments, setExperiments] = useState<ExperimentOption[]>([]);
  const [experimentId, setExperimentId] = useState(initialExperimentId ?? "");
  const [loadedExperimentsForLabId, setLoadedExperimentsForLabId] = useState<string | null>(null);
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loadedForKey, setLoadedForKey] = useState<string | null>(null);
  const loading = !!labId && !!experimentId && `${labId}:${experimentId}` !== loadedForKey;
  const { toast } = useToast();
  /** Kept inline rather than as a toast: without this, a failed load leaves the whole panel empty with no explanation. */
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReagentInput>(EMPTY_INPUT);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    setLoadError(null);
    const supabase = createClient();
    supabase
      .from("experiments")
      .select("id, name, experiment_date, lab_id")
      .eq("lab_id", labId)
      .order("experiment_date", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setExperiments([]);
          setExperimentId("");
          setLoadedExperimentsForLabId(labId);
          setLoadError(error.message);
          return;
        }
        const nextExperiments = data ?? [];
        setExperiments(nextExperiments);
        setLoadedExperimentsForLabId(labId);

        // Resolve the preferred id outside any setState updater: React may
        // re-run updaters during render, and calling onExperimentChange there
        // would update Sidebar (via the workspace store) mid-render.
        setExperimentId((current) => {
          if (current && nextExperiments.some((exp) => exp.id === current)) return current;
          if (initialExperimentId && nextExperiments.some((exp) => exp.id === initialExperimentId)) {
            return initialExperimentId;
          }
          return "";
        });
      });
    return () => {
      cancelled = true;
    };
    // Intentionally omit onExperimentChange: parent selection sync happens
    // only on explicit user change in the experiment <Select>, not on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExperimentId, labId]);

  useEffect(() => {
    if (!labId || !experimentId) {
      setReagents([]);
      setLoadedForKey(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    listReagents(labId, experimentId).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) setReagents(res.data);
      else setLoadError(res.error ?? "読み込みに失敗しました。");
      setLoadedForKey(`${labId}:${experimentId}`);
    });
    return () => {
      cancelled = true;
    };
  }, [experimentId, labId]);

  function startCreate() {
    setEditingId("new");
    setForm(EMPTY_INPUT);
  }

  function startEdit(r: Reagent) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      category: r.category,
      vendor: r.vendor,
      lot: r.lot,
      received_at: r.received_at,
      expires_at: r.expires_at,
      notes: r.notes,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_INPUT);
  }

  async function save() {
    if (!labId || !experimentId || !editingId) return;
    setSaving(true);
    try {
      const res = editingId === "new"
        ? await createReagent(labId, experimentId, form)
        : await updateReagent(labId, experimentId, editingId, form);
      if (!res.ok) throw new Error(res.error ?? "保存に失敗しました。");
      const refreshed = await listReagents(labId, experimentId);
      if (refreshed.ok && refreshed.data) setReagents(refreshed.data);
      // A reagent just created for today's report is, by definition, one
      // being used today - select it automatically rather than making the
      // researcher find and re-check the row they just typed in.
      if (editingId === "new" && selectable && res.data) onToggleSelected?.(res.data.id);
      cancelEdit();
      toast(editingId === "new" ? "試薬を登録しました。" : "試薬を更新しました。", { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!labId || !experimentId) return;
    if (!window.confirm("この試薬・Lotの登録を削除します。よろしいですか？")) return;
    const res = await deleteReagent(labId, experimentId, id);
    if (!res.ok) {
      toast(res.error ?? "削除に失敗しました。", { tone: "danger" });
      return;
    }
    setReagents((prev) => prev.filter((r) => r.id !== id));
    toast("試薬を削除しました。", { tone: "good" });
  }

  const filtered = reagents.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      (r.lot ?? "").toLowerCase().includes(q) ||
      (r.vendor ?? "").toLowerCase().includes(q) ||
      (r.category ?? "").toLowerCase().includes(q)
    );
  });

  const expiringCount = reagents.filter((r) => isExpiringSoon(r.expires_at) !== null).length;

  if (labs.length === 0) {
    return (
      <EmptyState title="研究室がまだありません">
        まず「実験一覧」で研究室を作成してください。
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError && <Callout tone="danger" title="読み込みに失敗しました">{loadError}</Callout>}

      <Card title="試薬・Lot registry">
        <div className="flex flex-wrap items-end gap-3">
          {labs.length > 1 && (
            <Field label="研究室" className="min-w-[200px]">
              <Select
                value={labId}
                onChange={(e) => {
                  setLabId(e.target.value);
                  setExperimentId("");
                  cancelEdit();
                }}
              >
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="実験" className="min-w-[240px]">
            <Select
              value={experimentId}
              onChange={(e) => {
                const nextId = e.target.value;
                setExperimentId(nextId);
                cancelEdit();
                onExperimentChange?.(experiments.find((exp) => exp.id === nextId) ?? null);
              }}
              disabled={loadedExperimentsForLabId !== labId}
            >
              <option value="">未選択</option>
              {experiments.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.experiment_date} · {exp.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="検索" className="min-w-[220px] flex-1">
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名称・Lot・メーカー・分類で検索"
            />
          </Field>
          <Button
            variant="primary"
            icon="plus"
            onClick={startCreate}
            disabled={editingId !== null || !experimentId}
            title={experimentId ? undefined : "先に実験を選択してください"}
          >
            新規登録
          </Button>
        </div>

        {!experimentId ? (
          <div className="mt-3">
            <Callout tone="info" title="実験を選択してください">
              試薬・Lotは研究室全体ではなく、選択した実験ごとに管理されます。
            </Callout>
          </div>
        ) : experiments.length === 0 && loadedExperimentsForLabId === labId ? (
          <div className="mt-3">
            <Callout tone="info" title="この研究室には実験がまだありません">
              ステップ1で実験を作成してから、試薬・Lotを登録してください。
            </Callout>
          </div>
        ) : null}

        {expiringCount > 0 && (
          <div className="mt-3">
            <Callout tone="warn" title={`期限切れ・期限間近が ${expiringCount} 件あります`}>
              使用前に有効期限を確認してください。
            </Callout>
          </div>
        )}
      </Card>

      {editingId && (
        <Card title={editingId === "new" ? "新規登録" : "編集"}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="名称" className="lg:col-span-2">
              <TextInput
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例: TMTsixplex Label Reagent"
                required
              />
            </Field>
            <Field label="分類">
              <TextInput
                value={form.category ?? ""}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder=""
              />
            </Field>
            <Field label="メーカー">
              <TextInput
                value={form.vendor ?? ""}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              />
            </Field>
            <Field label="Lot番号">
              <TextInput
                value={form.lot ?? ""}
                onChange={(e) => setForm({ ...form, lot: e.target.value })}
              />
            </Field>
            <Field label="受領日">
              <TextInput
                type="date"
                value={form.received_at ?? ""}
                onChange={(e) => setForm({ ...form, received_at: e.target.value })}
              />
            </Field>
            <Field label="有効期限">
              <TextInput
                type="date"
                value={form.expires_at ?? ""}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
              />
            </Field>
            <Field label="メモ" className="sm:col-span-2 lg:col-span-3">
              <TextInput
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="保管条件、使用上の注意など"
              />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button variant="ghost" onClick={cancelEdit} disabled={saving}>取消</Button>
          </div>
        </Card>
      )}

      <Card title={`登録済み (${filtered.length} 件)`} subtitle={loading ? "読み込み中…" : undefined}>
        {!experimentId ? (
          <EmptyState title="実験を選択すると試薬・Lotが表示されます" />
        ) : filtered.length === 0 ? (
          <EmptyState title="試薬・Lotが登録されていません">
            「新規登録」から追加してください。
          </EmptyState>
        ) : (
          <DataTable
            headers={[
              ...(selectable ? ["使用"] : []),
              "名称", "分類", "メーカー", "Lot", "受領日", "有効期限", "操作",
            ]}
            rows={filtered.map((r) => {
              const status = isExpiringSoon(r.expires_at);
              return [
                ...(selectable
                  ? [
                      <input
                        key="sel"
                        type="checkbox"
                        checked={selectedIds?.has(r.id) ?? false}
                        onChange={() => onToggleSelected?.(r.id)}
                        aria-label={`${r.name} を今日の記録で使用する`}
                      />,
                    ]
                  : []),
                r.name,
                r.category ?? "—",
                r.vendor ?? "—",
                r.lot ?? "—",
                r.received_at ?? "—",
                <span key="exp" className="inline-flex items-center gap-1.5">
                  {r.expires_at ?? "—"}
                  {status === "expired" && <Badge tone="danger">期限切れ</Badge>}
                  {status === "soon" && <Badge tone="warn">期限間近</Badge>}
                </span>,
                <span key="actions" className="inline-flex gap-1.5">
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => startEdit(r)}>編集</Button>
                  <Button size="sm" variant="danger" icon="trash" onClick={() => remove(r.id)}>削除</Button>
                </span>,
              ];
            })}
          />
        )}
      </Card>
    </div>
  );
}
