"use client";

import { useEffect, useMemo, useState } from "react";
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
  created_by: string | null;
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

function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg = (e as { message: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

export function ReagentManager({
  labs, initialLabId, initialExperimentId, onExperimentChange,
  selectable, selectedIds, onToggleSelected,
}: {
  labs: LabOption[];
  initialLabId?: string | null;
  initialExperimentId?: string | null;
  onExperimentChange?: (next: ExperimentOption | null) => void;
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
  const [userId, setUserId] = useState<string | null>(null);
  const [isLabCreator, setIsLabCreator] = useState(false);
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loadedForLabId, setLoadedForLabId] = useState<string | null>(null);
  const loading = !!labId && labId !== loadedForLabId;
  const { toast } = useToast();
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReagentInput>(EMPTY_INPUT);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const selectedExperiment = useMemo(
    () => experiments.find((e) => e.id === experimentId) ?? null,
    [experiments, experimentId],
  );
  const ownsSelectedExperiment = Boolean(
    userId && selectedExperiment && selectedExperiment.created_by === userId,
  );
  /** Lab creator may browse others' experiments read-only; only own experiments are editable. */
  const canRecord = ownsSelectedExperiment;

  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    // Clearing any stale error from a previous lab before this fetch starts -
    // legitimate effect use, not state derivable from props during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    const supabase = createClient();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      if (cancelled) return;
      setUserId(uid);

      const { data: labRow } = await supabase
        .from("laboratories")
        .select("owner_id")
        .eq("id", labId)
        .maybeSingle();
      const creator = Boolean(uid && labRow?.owner_id === uid);
      if (cancelled) return;
      setIsLabCreator(creator);

      let query = supabase
        .from("experiments")
        .select("id, name, experiment_date, lab_id, created_by")
        .eq("lab_id", labId)
        .order("experiment_date", { ascending: false });

      // Participants only see experiments they created. Lab creators see all
      // for review, but write paths stay gated on ownsSelectedExperiment.
      if (uid && !creator) {
        query = query.eq("created_by", uid);
      }

      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        setExperiments([]);
        setExperimentId("");
        setLoadedExperimentsForLabId(labId);
        setLoadError(error.message);
        return;
      }
      const nextExperiments = (data ?? []) as ExperimentOption[];
      setExperiments(nextExperiments);
      setLoadedExperimentsForLabId(labId);

      setExperimentId((current) => {
        if (current && nextExperiments.some((exp) => exp.id === current)) return current;
        if (initialExperimentId && nextExperiments.some((exp) => exp.id === initialExperimentId)) {
          return initialExperimentId;
        }
        return "";
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [initialExperimentId, labId]);

  // Clearing to empty when the lab selection is cleared is fully determined
  // by `labId`, so it is adjusted during render (see ChatSidebar's
  // seededForLab for the same pattern) rather than in the effect below,
  // which only needs to run the actual fetch.
  const [prevReagentsLabId, setPrevReagentsLabId] = useState(labId);
  if (labId !== prevReagentsLabId) {
    setPrevReagentsLabId(labId);
    if (!labId) {
      setReagents([]);
      setLoadedForLabId(null);
      setLoadError(null);
    }
  }

  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    // Clearing any stale error before this fetch starts - legitimate effect
    // use, not state derivable from props during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    listReagents(labId).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) setReagents(res.data);
      else setLoadError(res.error ?? "読み込みに失敗しました。");
      setLoadedForLabId(labId);
    });
    return () => {
      cancelled = true;
    };
  }, [labId]);

  function startCreate() {
    if (!canRecord) return;
    setEditingId("new");
    setForm(EMPTY_INPUT);
  }

  function startEdit(r: Reagent) {
    if (!userId || r.created_by !== userId) return;
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
    if (!labId || !editingId) return;
    if (editingId === "new" && (!experimentId || !canRecord)) return;
    setSaving(true);
    try {
      const res = editingId === "new"
        ? await createReagent(labId, experimentId, form)
        : await updateReagent(labId, editingId, form);
      if (!res.ok) throw new Error(res.error ?? "保存に失敗しました。");
      const refreshed = await listReagents(labId);
      if (refreshed.ok && refreshed.data) setReagents(refreshed.data);
      if (editingId === "new" && selectable && canRecord && res.data) {
        onToggleSelected?.(res.data.id);
      }
      cancelEdit();
      toast(editingId === "new" ? "試薬を登録しました。" : "試薬を更新しました。", { tone: "good" });
    } catch (e) {
      toast(errorMessage(e, "保存に失敗しました。"), { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!labId) return;
    if (!window.confirm("この試薬・Lotの登録を削除します。よろしいですか？")) return;
    const res = await deleteReagent(labId, id);
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
                  {isLabCreator && userId && exp.created_by && exp.created_by !== userId
                    ? "（閲覧）"
                    : ""}
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
            disabled={editingId !== null || !canRecord}
            title={
              !experimentId
                ? "先に自分の実験を選択してください"
                : !canRecord
                  ? "他メンバーの実験は閲覧のみです"
                  : undefined
            }
          >
            新規登録
          </Button>
        </div>

        {isLabCreator && experimentId && !canRecord && (
          <div className="mt-3">
            <Callout tone="info" title="閲覧モード">
              研究室の作成者として他メンバーの実験を確認しています。試薬の選択・登録・ノートの編集はできません。問題があればチャットで伝えてください。
            </Callout>
          </div>
        )}

        {!experimentId ? (
          <div className="mt-3">
            <Callout tone="info" title="実験を選択してください">
              登録済みの試薬は研究室で共有されます。今日の記録では、一覧から選ぶか新規登録してください。
            </Callout>
          </div>
        ) : experiments.length === 0 && loadedExperimentsForLabId === labId ? (
          <div className="mt-3">
            <Callout tone="info" title="表示できる実験がありません">
              ステップ1で自分の実験を作成してから、試薬・Lotを登録してください。
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
        {filtered.length === 0 ? (
          <EmptyState title="試薬・Lotが登録されていません">
            自分の実験を選んだうえで「新規登録」から追加してください。次の実験では一覧から選べます。
          </EmptyState>
        ) : (
          <DataTable
            headers={[
              ...(selectable ? ["使用"] : []),
              "名称", "分類", "メーカー", "Lot", "受領日", "有効期限", "操作",
            ]}
            rows={filtered.map((r) => {
              const status = isExpiringSoon(r.expires_at);
              const mine = Boolean(userId && r.created_by === userId);
              return [
                ...(selectable
                  ? [
                      <input
                        key="sel"
                        type="checkbox"
                        checked={selectedIds?.has(r.id) ?? false}
                        onChange={() => onToggleSelected?.(r.id)}
                        disabled={!canRecord}
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
                  {mine ? (
                    <>
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => startEdit(r)}>編集</Button>
                      <Button size="sm" variant="danger" icon="trash" onClick={() => remove(r.id)}>削除</Button>
                    </>
                  ) : (
                    <span className="text-[11px] text-ink-3">共有</span>
                  )}
                </span>,
              ];
            })}
          />
        )}
      </Card>
    </div>
  );
}
