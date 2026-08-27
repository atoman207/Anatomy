"use client";

import { useState } from "react";
import {
  Badge, Button, Card, EmptyState, Field, TextArea, TextInput,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import {
  TemplateFieldRows, draftFieldsToInput, emptyDraftField, templateFieldsToDraft,
  type DraftField,
} from "./TemplateFieldRows";
import type { TemplateField } from "@/lib/notebook/templates";
import {
  deleteCustomTemplate, saveCustomTemplate,
  type LabTemplateRow,
} from "@/lib/notebook/templateActions";

interface FormState {
  templateId?: string;
  name: string;
  description: string;
  category: string;
  body: string;
  fields: DraftField[];
}

function emptyForm(): FormState {
  return { name: "", description: "", category: "", body: "", fields: [emptyDraftField()] };
}

function formFromRow(row: LabTemplateRow): FormState {
  const fields = Array.isArray(row.fields) ? (row.fields as unknown as TemplateField[]) : [];
  return {
    templateId: row.id,
    name: row.name,
    description: row.description ?? "",
    category: row.category ?? "",
    body: row.body,
    fields: templateFieldsToDraft(fields),
  };
}

function formatCreatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface TemplateManagerProps {
  labId: string | null;
  templates: LabTemplateRow[];
  onChanged: () => void;
}

/**
 * Self-service CRUD for a laboratory's custom notebook templates.
 *
 * Any lab member may create and edit these (enforced by RLS, not just this
 * UI) - "allow users to edit templates as they wish". Administrators reach
 * every lab's templates separately, from `/admin/templates`.
 */
export function TemplateManager({ labId, templates, onChanged }: TemplateManagerProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function startCreate() {
    setForm(emptyForm());
    setOpen(true);
  }

  function startEdit(row: LabTemplateRow) {
    setForm(formFromRow(row));
    setOpen(true);
  }

  async function submit() {
    if (!labId) return;
    setSaving(true);
    try {
      const res = await saveCustomTemplate({
        labId,
        templateId: form.templateId,
        name: form.name,
        description: form.description,
        category: form.category,
        body: form.body,
        fields: draftFieldsToInput(form.fields),
      });
      if (!res.ok) throw new Error(res.error ?? "保存に失敗しました。");
      setOpen(false);
      toast("テンプレートを保存しました。", { tone: "good" });
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: LabTemplateRow) {
    if (!confirm(`テンプレート「${row.name}」を削除しますか？この操作は取り消せません。`)) return;
    setDeletingId(row.id);
    try {
      const res = await deleteCustomTemplate(row.id);
      if (res.ok) {
        toast("テンプレートを削除しました。", { tone: "good" });
        onChanged();
      } else {
        toast(res.error ?? "削除に失敗しました。", { tone: "danger" });
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (!labId) return null;

  return (
    <Card
      title="カスタムテンプレート"
      subtitle="このラボ専用のテンプレートを作成・編集できます。組み込みテンプレートとは別に上の一覧に追加されます。"
      actions={
        !open && (
          <Button size="sm" variant="primary" icon="plus" onClick={startCreate}>
            新規作成
          </Button>
        )
      }
    >
      {!open && (
        templates.length === 0 ? (
          <EmptyState title="このラボのカスタムテンプレートはまだありません" />
        ) : (
          <ul className="flex flex-col">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {t.name} {t.category && <Badge tone="neutral">{t.category}</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-3">
                    作成者: {t.creator_name} · {formatCreatedAt(t.created_at)}
                    {t.description ? ` · ${t.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => startEdit(t)}>
                    編集
                  </Button>
                  <Button
                    size="sm" variant="danger" icon="trash"
                    disabled={deletingId === t.id}
                    onClick={() => remove(t)}
                  >
                    削除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {open && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="テンプレート名">
              <TextInput
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder=""
              />
            </Field>
            <Field label="分類">
              <TextInput
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder=""
              />
            </Field>
            <Field label="説明">
              <TextInput
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="任意"
              />
            </Field>
          </div>

          <Field
            label="入力項目"
            hint="本文中で {{キー}} として展開されます。type がリストの場合は {{#each キー}}...{{/each}} を使用してください。"
          >
            <TemplateFieldRows
              fields={form.fields}
              onChange={(fields) => setForm((f) => ({ ...f, fields }))}
            />
          </Field>

          <Field label="本文（Markdown）" hint="{{キー}} で項目値を、{{#each リストキー}}...{{/each}} でリストを展開します。">
            <TextArea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={10}
              className="font-mono text-xs"
              placeholder=""
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button size="sm" variant="primary" icon="save" disabled={saving} onClick={submit}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
