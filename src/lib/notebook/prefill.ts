/**
 * Notebook prefill: carry forward stable protocol fields, fill lots from the
 * reagent registry, and map voice memos onto template keys.
 *
 * Deliberately skips date, time, results, discussion, and tomorrow's plan so
 * each saved entry reflects that day only — the integrity model the product
 * is built around.
 */

import type { StructuredVoiceNote } from "@/lib/ai/voiceNote";
import type { Reagent } from "@/lib/supabase/types";
import type { NotebookTemplate, TemplateField, TemplateValues } from "./templates";

export const NOTEBOOK_PENDING_PREFILL_KEY = "chondro.notebook.pendingPrefill";

/**
 * Whether an entry created at `createdAtIso` can still be edited.
 *
 * Mirrors `prevent_stale_notebook_entry_edit()` in the migration exactly (JST
 * calendar date, not the browser's or server's own timezone) so the UI never
 * offers an 編集 button the database would then refuse. The database trigger
 * is still the actual authority - this only decides what to show. Lives here
 * rather than in `actions.ts` because that file is `"use server"`, which
 * only allows async function exports - this is a plain synchronous helper
 * the client component calls directly, on every row, on every render.
 */
export function isNotebookEntryEditable(createdAtIso: string): boolean {
  const jst = (iso: string) =>
    new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Tokyo" }))
      .toDateString();
  return jst(createdAtIso) === jst(new Date().toISOString());
}

/** Never copied from a previous entry — each day gets fresh values. */
export const EPHEMERAL_KEYS = new Set([
  "experiment_date",
  "experiment_time",
  "results",
  "discussion",
  "tomorrow_plan",
  "notes",
]);

/** Maps template field keys to reagent-name patterns (registry lookup). */
const LOT_FIELD_PATTERNS: Record<string, RegExp[]> = {
  trypsin_lot: [/trypsin/i, /トリプシン/i],
  tmt_lot: [/tmt/i, /ティーエムティ/i],
  enzyme_lot: [/enzyme|enzyme|抗体|antibody|ポリメラーゼ|polymerase/i],
  extraction_kit: [/extract|抽出/i],
  rt_kit: [/reverse|逆転|rt-/i, /cdna/i],
  master_mix: [/master|マスター|mix/i],
  kit: [/kit|キット/i],
  kit_lot: [/kit|キット/i],
};

function lotPatternsForField(field: TemplateField): RegExp[] | null {
  if (LOT_FIELD_PATTERNS[field.key]) return LOT_FIELD_PATTERNS[field.key];
  if (field.key.endsWith("_lot")) {
    const stem = field.key.replace(/_lot$/, "").replace(/_/g, "[\\s_-]*");
    return [new RegExp(stem, "i"), new RegExp(field.label, "i")];
  }
  if (/lot/i.test(field.label) || /Lot/i.test(field.key)) {
    return [new RegExp(field.label.replace(/\s*Lot\s*/i, ""), "i")];
  }
  return null;
}

function findReagentLot(reagents: Reagent[], patterns: RegExp[]): string | null {
  for (const r of reagents) {
    if (!r.lot?.trim()) continue;
    if (patterns.some((p) => p.test(r.name) || (r.category && p.test(r.category)))) {
      return r.lot.trim();
    }
  }
  return null;
}

/** Copies stable fields from the most recent entry for the same template. */
export function prefillFromPrevious(
  template: NotebookTemplate,
  previousValues: Record<string, unknown> | null | undefined,
): TemplateValues {
  const out: TemplateValues = {};
  if (!previousValues) return out;

  for (const f of template.fields) {
    if (EPHEMERAL_KEYS.has(f.key)) continue;
    const v = previousValues[f.key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[f.key] = v as TemplateValues[string];
  }
  return out;
}

/** Fills empty lot fields and the reagents list from `/reagents` registry rows. */
export function prefillLotsFromReagents(
  template: NotebookTemplate,
  reagents: Reagent[],
  existing: TemplateValues = {},
): TemplateValues {
  const out: TemplateValues = { ...existing };

  for (const f of template.fields) {
    const current = out[f.key];
    if (current !== undefined && current !== null && String(current).trim() !== "") continue;
    const patterns = lotPatternsForField(f);
    if (!patterns) continue;
    const lot = findReagentLot(reagents, patterns);
    if (lot) out[f.key] = lot;
  }

  const listField = template.fields.find((f) => f.key === "reagents" && f.type === "list");
  if (listField) {
    const cur = out.reagents;
    const empty =
      cur === undefined ||
      cur === null ||
      (typeof cur === "string" && cur.trim() === "") ||
      (Array.isArray(cur) && cur.length === 0);
    if (empty) {
      const lines = reagents
        .filter((r) => r.lot?.trim())
        .slice(0, 12)
        .map((r) => `${r.name}, Lot ${r.lot}`);
      if (lines.length) out.reagents = lines.join("\n");
    }
  }

  return out;
}

/** Today's date, clock time, and signed-in operator. */
export function buildTodayDefaults(operator: string): TemplateValues {
  const now = new Date();
  return {
    experiment_date: now.toISOString().slice(0, 10),
    experiment_time: now.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    operator: operator.trim() || "—",
  };
}

/** Maps a structured voice memo onto generic / protocol template keys. */
export function mapVoiceNoteToValues(note: StructuredVoiceNote): TemplateValues {
  const out: TemplateValues = {};

  if (note.experiment_date) out.experiment_date = note.experiment_date;
  if (note.experiment_name) out.experiment_name = note.experiment_name;
  if (note.operator) out.operator = note.operator;
  if (note.purpose) out.purpose = note.purpose;
  if (note.sample_count !== null) out.sample_count = String(note.sample_count);

  if (note.reagents.length) {
    out.reagents = note.reagents
      .map((r) => {
        const parts = [r.name];
        if (r.lot) parts.push(`Lot ${r.lot}`);
        if (r.amount) parts.push(r.amount);
        return parts.join(" — ");
      })
      .join("\n");

    for (const r of note.reagents) {
      const name = r.name.toLowerCase();
      if (r.lot) {
        if (/trypsin|トリプシン/.test(name)) out.trypsin_lot = r.lot;
        if (/tmt|ティーエムティ/.test(name)) out.tmt_lot = r.lot;
      }
    }
  }

  if (note.procedure.length) out.procedure = note.procedure.join("\n");
  if (note.observations.length) out.results = note.observations.join("\n");
  if (note.next_actions.length) {
    out.tomorrow_plan = note.next_actions.map((a) => `- [ ] ${a}`).join("\n");
  }

  return out;
}

/**
 * Maps free-form capture text onto template fields without AI.
 * Used on the free plan where `/api/voice/structure` is unavailable.
 */
export function prefillFromRawCapture(
  template: NotebookTemplate,
  rawText: string,
): TemplateValues {
  const text = rawText.trim();
  if (!text) return {};

  const out: TemplateValues = {};

  const notes = template.fields.find((f) => f.key === "notes" && f.type === "textarea");
  if (notes) {
    out.notes = text;
    return out;
  }

  const procedure = template.fields.find((f) => f.key === "procedure" && f.type === "list");
  if (procedure) {
    out.procedure = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    return out;
  }

  const ephemeralTextarea = template.fields.find(
    (f) => f.type === "textarea" && EPHEMERAL_KEYS.has(f.key),
  );
  if (ephemeralTextarea) {
    out[ephemeralTextarea.key] = text;
    return out;
  }

  const anyTextarea = template.fields.find((f) => f.type === "textarea");
  if (anyTextarea) {
    out[anyTextarea.key] = text;
    return out;
  }

  return out;
}

/** Merge layers: user edits win over everything beneath. */
export function mergePrefillLayers(
  ...layers: TemplateValues[]
): TemplateValues {
  const out: TemplateValues = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      out[k] = v;
    }
  }
  return out;
}
