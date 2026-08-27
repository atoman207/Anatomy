"use client";

import { useMemo, useState } from "react";
import {
  Badge, Button, Card, EmptyState, Field, Select, TextArea, TextInput, cx,
} from "@/components/ui";
import { MediaPreviewModal } from "@/components/MediaPreviewModal";
import { useToast } from "@/components/shell/Toast";
import { renderMarkdown } from "@/lib/notebook/markdown";
import {
  adminDeleteExperiment,
  adminListNotebookEntries,
  adminSaveExperiment,
  type AdminNotebookEntry,
} from "@/app/admin/experimentActions";
import type { Experiment, ExperimentStatus } from "@/lib/supabase/types";

export type AdminExperimentRow = Experiment & { lab_name: string };

const STATUS_LABELS: Record<ExperimentStatus, string> = {
  planned: "計画", in_progress: "進行中", complete: "完了", archived: "アーカイブ",
};

const STATUS_TONE: Record<ExperimentStatus, "good" | "warn" | "accent" | "neutral"> = {
  complete: "good", in_progress: "warn", planned: "accent", archived: "neutral",
};

interface FormState {
  labId: string;
  name: string;
  experimentDate: string;
  operator: string;
  purpose: string;
  status: ExperimentStatus;
  tags: string;
}

function emptyForm(labId: string): FormState {
  return {
    labId, name: "", experimentDate: new Date().toISOString().slice(0, 10),
    operator: "", purpose: "", status: "planned", tags: "",
  };
}

function formFromRow(row: AdminExperimentRow): FormState {
  return {
    labId: row.lab_id,
    name: row.name,
    experimentDate: row.experiment_date,
    operator: row.operator ?? "",
    purpose: row.purpose ?? "",
    status: row.status,
    tags: (row.tags ?? []).join(", "),
  };
}

interface Props {
  labs: { id: string; name: string }[];
  experiments: AdminExperimentRow[];
}

/**
 * Two-pane admin view: laboratories on the left, that lab's experiments on
 * the right. Clicking an experiment opens its lab notes.
 */
export function AdminExperimentManager({ labs, experiments }: Props) {
  const [rows, setRows] = useState(experiments);
  const [selectedLabId, setSelectedLabId] = useState(labs[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(labs[0]?.id ?? ""));
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<AdminExperimentRow | null>(null);
  const [notes, setNotes] = useState<AdminNotebookEntry[]>([]);
  const [notesBusy, setNotesBusy] = useState(false);
  const [previewNote, setPreviewNote] = useState<AdminNotebookEntry | null>(null);
  const { toast } = useToast();

  const labById = useMemo(() => new Map(labs.map((l) => [l.id, l.name])), [labs]);

  const countsByLab = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.lab_id, (map.get(r.lab_id) ?? 0) + 1);
    return map;
  }, [rows]);

  const labExperiments = useMemo(
    () => rows.filter((r) => r.lab_id === selectedLabId),
    [rows, selectedLabId],
  );

  const selectedLabName = labById.get(selectedLabId) ?? "研究室";

  function startCreate() {
    setForm(emptyForm(selectedLabId || labs[0]?.id || ""));
    setEditingId(null);
    setCreating(true);
  }

  function startEdit(row: AdminExperimentRow) {
    setForm(formFromRow(row));
    setEditingId(row.id);
    setCreating(false);
  }

  function closeForm() {
    setCreating(false);
    setEditingId(null);
  }

  async function submit() {
    setSaving(true);
    try {
      const res = await adminSaveExperiment({
        experimentId: editingId ?? undefined,
        labId: form.labId,
        name: form.name,
        experimentDate: form.experimentDate,
        operator: form.operator,
        purpose: form.purpose,
        status: form.status,
        tags: form.tags,
      });
      if (!res.ok || !res.data) throw new Error(res.error ?? "保存に失敗しました。");
      const saved = res.data;
      const withLab: AdminExperimentRow = { ...saved, lab_name: labById.get(saved.lab_id) ?? "?" };
      setRows((prev) => {
        const exists = prev.some((r) => r.id === saved.id);
        return exists
          ? prev.map((r) => (r.id === saved.id ? withLab : r))
          : [withLab, ...prev];
      });
      setSelectedLabId(saved.lab_id);
      closeForm();
      toast(creating ? "実験を作成しました。" : "実験を更新しました。", { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: AdminExperimentRow) {
    if (!confirm(`「${row.lab_name}」の実験「${row.name}」を削除しますか？関連するデータもすべて削除されます。`)) {
      return;
    }
    setDeletingId(row.id);
    try {
      const res = await adminDeleteExperiment(row.id);
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        if (notesFor?.id === row.id) {
          setNotesFor(null);
          setNotes([]);
        }
        toast("実験を削除しました。", { tone: "good" });
      } else {
        toast(res.error ?? "削除に失敗しました。", { tone: "danger" });
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function openNotes(row: AdminExperimentRow) {
    setNotesFor(row);
    setNotesBusy(true);
    setNotes([]);
    try {
      const res = await adminListNotebookEntries(row.id);
      if (!res.ok || !res.data) {
        toast(res.error ?? "ラボノートを読み込めませんでした。", { tone: "danger" });
        return;
      }
      setNotes(res.data);
    } catch (e) {
      toast(e instanceof Error ? e.message : "ラボノートを読み込めませんでした。", { tone: "danger" });
    } finally {
      setNotesBusy(false);
    }
  }

  const formPanel = (creating || editingId) && (
    <Card title={creating ? "実験を作成" : "実験を編集"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="研究室">
          <Select value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value })}>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="実験名">
          <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="実験日">
          <TextInput
            type="date"
            value={form.experimentDate}
            onChange={(e) => setForm({ ...form, experimentDate: e.target.value })}
          />
        </Field>
        <Field label="担当者">
          <TextInput value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })} />
        </Field>
        <Field label="状態">
          <Select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ExperimentStatus })}
          >
            {Object.entries(STATUS_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="タグ（カンマ区切り）">
          <TextInput value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </Field>
        <Field label="目的" className="sm:col-span-2">
          <TextArea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={closeForm}>キャンセル</Button>
        <Button size="sm" variant="primary" icon="save" disabled={saving} onClick={submit}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-[28rem] overflow-hidden rounded-lg border border-line bg-surface-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-2 sm:w-64">
          <div className="border-b border-line px-3 py-2">
            <p className="text-[12px] font-semibold text-ink-2">研究室</p>
            <p className="text-[11px] text-ink-3">{labs.length} 件</p>
          </div>
          <ul className="flex-1 overflow-y-auto p-1.5">
            {labs.map((lab) => {
              const active = lab.id === selectedLabId;
              const count = countsByLab.get(lab.id) ?? 0;
              return (
                <li key={lab.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLabId(lab.id);
                      setNotesFor(null);
                      setNotes([]);
                      closeForm();
                    }}
                    className={cx(
                      "mb-0.5 flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px] leading-5 transition-colors",
                      active
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-transparent text-ink-2 hover:border-line hover:bg-surface-1",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{lab.name}</span>
                    <span className={cx("shrink-0 tabular-nums", active ? "text-accent" : "text-ink-3")}>
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{selectedLabName}</p>
              <p className="text-[11px] text-ink-3">実験 {labExperiments.length} 件</p>
            </div>
            {!creating && !editingId && (
              <Button size="sm" variant="primary" icon="plus" onClick={startCreate}>
                作成
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {labExperiments.length === 0 ? (
              <EmptyState title="この研究室には実験がありません">
                「作成」から実験を追加できます。
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {labExperiments.map((r) => {
                  const notesOpen = notesFor?.id === r.id;
                  return (
                    <li
                      key={r.id}
                      className={cx(
                        "rounded-lg border px-3 py-2",
                        notesOpen ? "border-accent bg-accent-soft/40" : "border-line bg-surface-1",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void openNotes(r)}
                          className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
                        >
                          {r.name}
                        </button>
                        <span className="shrink-0 text-[11px] text-ink-3">{r.experiment_date}</span>
                        <span className="hidden shrink-0 text-[11px] text-ink-3 sm:inline">
                          {r.operator ?? "—"}
                        </span>
                        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                        <div className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" icon="eye" onClick={() => void openNotes(r)}>
                            ノート
                          </Button>
                          <Button size="sm" variant="ghost" icon="edit" onClick={() => startEdit(r)}>
                            編集
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            icon="trash"
                            disabled={deletingId === r.id}
                            onClick={() => void remove(r)}
                          >
                            削除
                          </Button>
                        </div>
                      </div>

                      {notesOpen && (
                        <div className="mt-2 border-t border-line pt-2">
                          <p className="mb-1.5 text-[11px] font-semibold text-ink-2">
                            ラボノート（{notesBusy ? "…" : notes.length} 件）
                          </p>
                          {notesBusy ? (
                            <p className="text-[12px] text-ink-3">読み込み中…</p>
                          ) : notes.length === 0 ? (
                            <p className="text-[12px] text-ink-3">この実験にはラボノートがありません。</p>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {notes.map((n) => (
                                <li
                                  key={n.id}
                                  className="flex items-center gap-2 rounded-md border border-line bg-surface-1 px-2 py-1.5"
                                >
                                  <button
                                    type="button"
                                    onClick={() => setPreviewNote(n)}
                                    className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-ink hover:text-accent hover:underline"
                                  >
                                    {n.title}
                                  </button>
                                  {n.template_slug && <Badge>{n.template_slug}</Badge>}
                                  <span className="shrink-0 text-[10px] text-ink-3">
                                    {new Date(n.created_at).toLocaleString("ja-JP")}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    icon="eye"
                                    onClick={() => setPreviewNote(n)}
                                  >
                                    表示
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {formPanel}

      {previewNote && (
        <MediaPreviewModal title={previewNote.title} onClose={() => setPreviewNote(null)}>
          <div className="mb-2 flex flex-wrap gap-2 text-[12px] text-ink-3">
            {previewNote.template_slug && <Badge>{previewNote.template_slug}</Badge>}
            <span>{new Date(previewNote.created_at).toLocaleString("ja-JP")}</span>
          </div>
          <div
            className="prose-note rounded-lg border border-line bg-white px-4 py-3 text-black"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(previewNote.body_md) }}
          />
        </MediaPreviewModal>
      )}
    </div>
  );
}
