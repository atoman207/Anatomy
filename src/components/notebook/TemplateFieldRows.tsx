"use client";

import { Button, Select, TextInput } from "@/components/ui";
import type { FieldType, TemplateField } from "@/lib/notebook/templates";

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "テキスト", textarea: "長文", number: "数値", date: "日付",
  select: "選択肢", list: "リスト（複数行）",
};

export interface DraftField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string;
  placeholder: string;
}

export function emptyDraftField(): DraftField {
  return { key: "", label: "", type: "text", required: false, options: "", placeholder: "" };
}

export function templateFieldsToDraft(fields: TemplateField[]): DraftField[] {
  const draft = fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: Boolean(f.required),
    options: (f.options ?? []).join(", "),
    placeholder: f.placeholder ?? "",
  }));
  return draft.length ? draft : [emptyDraftField()];
}

/** Drops blank rows and shapes the rest for `sanitizeFields` on the server. */
export function draftFieldsToInput(fields: DraftField[]) {
  return fields
    .filter((f) => f.key.trim() && f.label.trim())
    .map((f) => ({
      key: f.key.trim(),
      label: f.label.trim(),
      type: f.type,
      required: f.required || undefined,
      placeholder: f.placeholder.trim() || undefined,
      options: f.type === "select"
        ? f.options.split(",").map((o) => o.trim()).filter(Boolean)
        : undefined,
    }));
}

/** The repeatable key/label/type/options rows shared by the self-service and admin template editors. */
export function TemplateFieldRows({
  fields, onChange,
}: {
  fields: DraftField[];
  onChange: (fields: DraftField[]) => void;
}) {
  function update(index: number, patch: Partial<DraftField>) {
    onChange(fields.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function add() {
    onChange([...fields, emptyDraftField()]);
  }
  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {fields.map((f, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_1fr_120px_1fr_auto]">
          <TextInput
            value={f.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder="キー"
          />
          <TextInput
            value={f.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="ラベル"
          />
          <Select value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldType })}>
            {Object.entries(FIELD_TYPE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
          {f.type === "select" ? (
            <TextInput
              value={f.options}
              onChange={(e) => update(i, { options: e.target.value })}
              placeholder="選択肢をカンマ区切りで"
            />
          ) : (
            <TextInput
              value={f.placeholder}
              onChange={(e) => update(i, { placeholder: e.target.value })}
              placeholder="入力例（任意）"
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={f.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              必須
            </label>
            <Button size="sm" variant="ghost" icon="x" onClick={() => remove(i)}>
              削除
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon="plus" onClick={add}>
        項目を追加
      </Button>
    </div>
  );
}
