/**
 * Shared helpers for validating and slugifying custom notebook templates.
 *
 * Plain module (no "use server") so it can be imported by more than one
 * server-action file - a "use server" file may only export async functions.
 */

import type { FieldType, TemplateField } from "./templates";

export const FIELD_TYPES: FieldType[] = ["text", "textarea", "number", "date", "select", "list"];

export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "template";
}

export function sanitizeFields(raw: unknown): { fields: TemplateField[]; error?: string } {
  if (!Array.isArray(raw)) return { fields: [], error: "項目の形式が正しくありません。" };
  const fields: TemplateField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const key = String(f.key ?? "").trim();
    const label = String(f.label ?? "").trim();
    const type = FIELD_TYPES.includes(f.type as FieldType) ? (f.type as FieldType) : "text";
    if (!key || !label) continue;
    const field: TemplateField = { key, label, type };
    if (f.required) field.required = true;
    if (f.placeholder) field.placeholder = String(f.placeholder);
    if (f.help) field.help = String(f.help);
    if (type === "select") {
      const opts = f.options;
      field.options = Array.isArray(opts)
        ? opts.map((o) => String(o)).filter(Boolean)
        : String(opts ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    }
    fields.push(field);
  }
  if (fields.length === 0) return { fields: [], error: "少なくとも1つの項目を入力してください。" };
  const keys = new Set<string>();
  for (const f of fields) {
    if (keys.has(f.key)) return { fields: [], error: `項目キー「${f.key}」が重複しています。` };
    keys.add(f.key);
  }
  return { fields };
}
