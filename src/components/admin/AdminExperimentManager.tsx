"use client";

import { useState } from "react";
import {
  Badge, Button, Card, EmptyState, Field, Select, TextArea, TextInput,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { adminDeleteExperiment, adminSaveExperiment } from "@/app/admin/experimentActions";
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
 * Administrator CRUD over experiments across every laboratory they manage.
 *
 * A regular researcher still creates and browses experiments from
 * `/experiments`, scoped to their own labs by RLS; this view adds
 * cross-lab oversight and the ability to edit or delete any of them.
 */
export function AdminExperimentManager({ labs, experiments }: Props) {
  const [rows, setRows] = useState(experiments);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(labs[0]?.id ?? ""));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const labById = new Map(labs.map((l) => [l.id, l.name]));

  function startCreate() {
    setForm(emptyForm(labs[0]?.id ?? ""));
    setEditingId(null);
    setCreating(true);
  }

  function startEdit(row: AdminExperimentRow) {
    setForm(formFromRow(row));
    setEditingId(row.id);
    setCreating(false);
  }

  function close() {
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
      close();
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
        toast("実験を削除しました。", { tone: "good" });
      } else {
        toast(res.error ?? "削除に失敗しました。", { tone: "danger" });
      }
    } finally {
      setDeletingId(null);
    }
  }

  const formPanel = (creating || editingId) && (
    <Card title={creating ? "実験を作成" : "実験を編集"}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="研究室">
          <Select value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value })}>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="実験名" className="lg:col-span-2">
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
        <Field label="タグ（カンマ区切り）" className="lg:col-span-3">
          <TextInput value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </Field>
        <Field label="目的" className="lg:col-span-3">
          <TextArea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={close}>キャンセル</Button>
        <Button size="sm" variant="primary" icon="save" disabled={saving} onClick={submit}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="実験"
        subtitle={`${rows.length} 件 — 管理できるすべての研究室`}
        actions={
          !creating && !editingId && (
            <Button size="sm" variant="primary" icon="plus" onClick={startCreate}>
              作成
            </Button>
          )
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="実験がありません" />
        ) : (
          <div className="scroll-x rounded-lg border border-line">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-surface-2">
                <tr>
                  {["研究室", "実験名", "日付", "担当者", "状態", "操作"].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-line px-2.5 py-2 text-left font-semibold text-ink-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="even:bg-surface-2/40 align-top">
                    <td className="border-b border-line px-2.5 py-2 text-ink-2">{r.lab_name}</td>
                    <td className="border-b border-line px-2.5 py-2 font-medium text-ink">{r.name}</td>
                    <td className="border-b border-line px-2.5 py-2 text-ink-3">{r.experiment_date}</td>
                    <td className="border-b border-line px-2.5 py-2 text-ink-2">{r.operator ?? "—"}</td>
                    <td className="border-b border-line px-2.5 py-2">
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                    </td>
                    <td className="border-b border-line px-2.5 py-2">
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" icon="edit" onClick={() => startEdit(r)}>
                          編集
                        </Button>
                        <Button
                          size="sm" variant="danger" icon="trash"
                          disabled={deletingId === r.id}
                          onClick={() => remove(r)}
                        >
                          削除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {formPanel}
    </div>
  );
}
