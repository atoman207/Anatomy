"use client";

import { useState } from "react";
import {
  Badge, Button, Card, EmptyState, Field, TextArea, TextInput,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { Select } from "@/components/ui";
import {
  TemplateFieldRows, draftFieldsToInput, emptyDraftField, templateFieldsToDraft,
  type DraftField,
} from "@/components/notebook/TemplateFieldRows";
import type { TemplateField } from "@/lib/notebook/templates";
import {
  adminCreateTemplate, adminDeleteTemplate, adminUpdateTemplate,
} from "@/app/admin/templateActions";
import type { NotebookTemplateRow } from "@/lib/supabase/types";

export type AdminTemplateRow = NotebookTemplateRow & { lab_name: string };

export interface AdminTemplateLab {
  id: string;
  name: string;
}

interface FormState {
  name: string;
  description: string;
  category: string;
  body: string;
  fields: DraftField[];
}

/** A starting point, so a new template is never an empty text box. */
const STARTER_BODY = `# {{experiment_date}} {{experiment_name}}

**担当:** {{operator}}
**目的:** {{purpose}}

## 実施内容

## 結果

## 考察
`;

function emptyForm(): FormState {
  return {
    name: "",
    description: "",
    category: "",
    body: STARTER_BODY,
    fields: [emptyDraftField()],
  };
}

function formFromRow(row: AdminTemplateRow): FormState {
  const fields = Array.isArray(row.fields) ? (row.fields as unknown as TemplateField[]) : [];
  return {
    name: row.name,
    description: row.description ?? "",
    category: row.category ?? "",
    body: row.body,
    fields: templateFieldsToDraft(fields),
  };
}

/**
 * Administrator view over every laboratory's custom templates.
 *
 * Editing and deleting re-check `assertCanManageLab` on the server for the
 * template's own lab, so a lab admin here is still confined to their labs
 * even though the query that lists rows already scoped to the same set.
 */
export function AdminTemplateManager({
  templates, labs,
}: {
  templates: AdminTemplateRow[];
  labs: AdminTemplateLab[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rows, setRows] = useState(templates);

  const [creating, setCreating] = useState(false);
  const [createLabId, setCreateLabId] = useState(labs[0]?.id ?? "");
  const [createForm, setCreateForm] = useState<FormState>(emptyForm);
  const [createSaving, setCreateSaving] = useState(false);

  function startEdit(row: AdminTemplateRow) {
    setEditingId(row.id);
    setForm(formFromRow(row));
  }

  async function create() {
    setCreateSaving(true);
    try {
      const res = await adminCreateTemplate({
        labId: createLabId,
        name: createForm.name,
        description: createForm.description,
        category: createForm.category,
        body: createForm.body,
        fields: draftFieldsToInput(createForm.fields),
      });
      if (!res.ok || !res.data) throw new Error(res.error ?? "作成に失敗しました。");
      const labName = labs.find((l) => l.id === createLabId)?.name ?? "（不明）";
      setRows((prev) => [{ ...res.data!, lab_name: labName }, ...prev]);
      setCreateForm(emptyForm());
      setCreating(false);
      toast("テンプレートを作成しました。", { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "作成に失敗しました。", { tone: "danger" });
    } finally {
      setCreateSaving(false);
    }
  }

  async function submit() {
    if (!editingId || !form) return;
    setSaving(true);
    try {
      const res = await adminUpdateTemplate({
        templateId: editingId,
        name: form.name,
        description: form.description,
        category: form.category,
        body: form.body,
        fields: draftFieldsToInput(form.fields),
      });
      if (!res.ok || !res.data) throw new Error(res.error ?? "保存に失敗しました。");
      const updated = res.data;
      setRows((prev) => prev.map((r) => (r.id === editingId ? { ...r, ...updated } : r)));
      setEditingId(null);
      setForm(null);
      toast("テンプレートを更新しました。", { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: AdminTemplateRow) {
    if (!confirm(`「${row.lab_name}」のテンプレート「${row.name}」を削除しますか？この操作は取り消せません。`)) {
      return;
    }
    setDeletingId(row.id);
    try {
      const res = await adminDeleteTemplate(row.id);
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        toast("テンプレートを削除しました。", { tone: "good" });
      } else {
        toast(res.error ?? "削除に失敗しました。", { tone: "danger" });
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Card
        title="テンプレートを作成"
        subtitle="研究室を選んで、その研究室のテンプレートとして追加します。"
        actions={
          <Button
            size="sm"
            variant={creating ? "ghost" : "primary"}
            icon={creating ? "x" : "plus"}
            disabled={labs.length === 0}
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "閉じる" : "新規作成"}
          </Button>
        }
      >
        {labs.length === 0 ? (
          <EmptyState title="管理できる研究室がありません">
            先に「研究室」から研究室を作成してください。
          </EmptyState>
        ) : !creating ? (
          <p className="text-xs text-ink-3">
            研究者は実験ノートから自分でテンプレートを作成・編集できます。ここでは、
            研究室共通の雛形を管理者が用意する場合に使用します。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="研究室">
                <Select
                  value={createLabId}
                  onChange={(e) => setCreateLabId(e.target.value)}
                >
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="テンプレート名">
                <TextInput
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder=""
                />
              </Field>
              <Field label="分類">
                <TextInput
                  value={createForm.category}
                  onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                  placeholder=""
                />
              </Field>
              <Field label="説明">
                <TextInput
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="任意"
                />
              </Field>
            </div>

            <Field label="入力項目">
              <TemplateFieldRows
                fields={createForm.fields}
                onChange={(fields) => setCreateForm((f) => ({ ...f, fields }))}
              />
            </Field>

            <Field
              label="本文（Markdown）"
              hint="{{項目キー}} が入力値に置き換わります。{{#each キー}} … {{/each}} で繰り返せます。"
            >
              <TextArea
                value={createForm.body}
                onChange={(e) => setCreateForm({ ...createForm, body: e.target.value })}
                rows={10}
                className="font-mono text-xs"
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                キャンセル
              </Button>
              <Button
                size="sm" variant="primary" icon="save"
                disabled={createSaving} onClick={create}
              >
                {createSaving ? "作成中…" : "作成"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <Card title="カスタムテンプレート">
          <EmptyState title="カスタムテンプレートはまだありません">
            研究者が実験ノートで作成すると、ここに表示されます。
          </EmptyState>
        </Card>
      ) : (
    <Card title="カスタムテンプレート" subtitle={`${rows.length} 件 — すべての研究室`}>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {row.name} {row.category && <Badge tone="neutral">{row.category}</Badge>}
                </p>
                <p className="truncate text-xs text-ink-3">
                  {row.lab_name} · {new Date(row.created_at).toLocaleDateString("ja-JP")}
                  {row.description ? ` · ${row.description}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm" variant="ghost" icon="edit"
                  onClick={() => (editingId === row.id ? setEditingId(null) : startEdit(row))}
                >
                  {editingId === row.id ? "閉じる" : "編集"}
                </Button>
                <Button
                  size="sm" variant="danger" icon="trash"
                  disabled={deletingId === row.id}
                  onClick={() => remove(row)}
                >
                  削除
                </Button>
              </div>
            </div>

            {editingId === row.id && form && (
              <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="テンプレート名">
                    <TextInput
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label="分類">
                    <TextInput
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    />
                  </Field>
                  <Field label="説明">
                    <TextInput
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </Field>
                </div>

                <Field label="入力項目">
                  <TemplateFieldRows
                    fields={form.fields}
                    onChange={(fields) => setForm((f) => (f ? { ...f, fields } : f))}
                  />
                </Field>

                <Field label="本文（Markdown）">
                  <TextArea
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    rows={10}
                    className="font-mono text-xs"
                  />
                </Field>

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    キャンセル
                  </Button>
                  <Button size="sm" variant="primary" icon="save" disabled={saving} onClick={submit}>
                    {saving ? "保存中…" : "保存"}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
      )}
    </>
  );
}
