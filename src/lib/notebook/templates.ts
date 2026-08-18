/**
 * Experiment notebook templates.
 *
 * A template is a typed field list plus a Markdown body. Rendering is pure
 * string substitution with no model call, so a saved template produces the
 * same notebook every time and works offline.
 */

export type FieldType = "text" | "textarea" | "number" | "date" | "select" | "list";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** For `select`. */
  options?: string[];
  /** Default value, applied when the field is left blank. */
  defaultValue?: string;
  help?: string;
}

export interface NotebookTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: TemplateField[];
  /** Markdown with {{key}} placeholders and {{#each list}} blocks. */
  body: string;
}

/** Values captured for one notebook entry. */
export type TemplateValues = Record<string, string | string[] | number | null | undefined>;

const COMMON_FIELDS: TemplateField[] = [
  { key: "experiment_date", label: "実験日 / Date", type: "date", required: true },
  { key: "operator", label: "担当者 / Operator", type: "text", required: true },
  { key: "experiment_name", label: "実験名 / Experiment", type: "text", required: true },
  { key: "purpose", label: "目的 / Purpose", type: "textarea" },
];

export const BUILT_IN_TEMPLATES: NotebookTemplate[] = [
  {
    id: "generic",
    name: "汎用実験ノート / General experiment",
    description: "Any experiment: purpose, materials, procedure, results.",
    category: "General",
    fields: [
      ...COMMON_FIELDS,
      { key: "sample_count", label: "サンプル数 / Sample count", type: "number" },
      { key: "reagents", label: "試薬 (1行に1つ: 名前, Lot) / Reagents", type: "list",
        placeholder: "Trypsin, Lot A123" },
      { key: "procedure", label: "手順 / Procedure", type: "list" },
      { key: "notes", label: "備考 / Notes", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**担当 / Operator:** {{operator}}
**目的 / Purpose:** {{purpose}}
**サンプル数 / Samples:** {{sample_count}}

## 使用試薬 / Reagents
{{#each reagents}}
- {{.}}
{{/each}}

## 実施内容 / Procedure
{{#each procedure}}
1. {{.}}
{{/each}}

## 結果 / Results

## 考察 / Discussion

## 備考 / Notes
{{notes}}

## 添付ファイル / Attachments
`,
  },
  {
    id: "tmt-labeling",
    name: "TMT標識 / TMT labeling",
    description: "Isobaric labeling run with lot tracking per channel.",
    category: "Proteomics",
    fields: [
      ...COMMON_FIELDS,
      { key: "sample_count", label: "サンプル数 / Sample count", type: "number", defaultValue: "6" },
      { key: "trypsin_lot", label: "Trypsin Lot", type: "text" },
      { key: "tmt_lot", label: "TMT reagent Lot", type: "text" },
      { key: "tmt_plex", label: "TMT plex", type: "select", options: ["6plex", "10plex", "11plex", "16plex", "18plex"], defaultValue: "10plex" },
      { key: "digestion_time", label: "消化時間 / Digestion (h)", type: "number", defaultValue: "16" },
      { key: "channels", label: "チャネル割当 / Channel assignment", type: "list",
        placeholder: "126: Control_1" },
      { key: "notes", label: "備考 / Notes", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**担当 / Operator:** {{operator}}
**目的 / Purpose:** {{purpose}}
**サンプル数 / Samples:** {{sample_count}}
**TMT plex:** {{tmt_plex}}

## 使用試薬 / Reagents
- Trypsin — Lot: {{trypsin_lot}}
- TMT reagent — Lot: {{tmt_lot}}

## チャネル割当 / Channel assignment
{{#each channels}}
- {{.}}
{{/each}}

## 実施内容 / Procedure
1. タンパク質定量 / Protein quantification
2. 還元・アルキル化 / Reduction and alkylation
3. トリプシン消化 ({{digestion_time}} h) / Trypsin digestion
4. TMT標識 / TMT labeling
5. クエンチ・混合 / Quench and pool
6. 脱塩 / Desalting

## 結果 / Results

## 考察 / Discussion

## 備考 / Notes
{{notes}}
`,
  },
  {
    id: "cell-treatment",
    name: "細胞刺激実験 / Cell treatment",
    description: "Stimulation time course with dose and readout.",
    category: "Cell biology",
    fields: [
      ...COMMON_FIELDS,
      { key: "cell_type", label: "細胞 / Cell type", type: "text", placeholder: "Chondrocytes" },
      { key: "passage", label: "継代数 / Passage", type: "text" },
      { key: "stimulus", label: "刺激 / Stimulus", type: "text", placeholder: "IL-1b" },
      { key: "concentration", label: "濃度 / Concentration", type: "text", placeholder: "10 ng/mL" },
      { key: "duration", label: "処理時間 / Duration", type: "text", placeholder: "24 h" },
      { key: "readout", label: "解析 / Readout", type: "text", placeholder: "RT-qPCR" },
      { key: "conditions", label: "条件 / Conditions", type: "list" },
      { key: "notes", label: "備考 / Notes", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**担当 / Operator:** {{operator}}
**目的 / Purpose:** {{purpose}}

## 細胞 / Cells
- 種類 / Type: {{cell_type}}
- 継代 / Passage: {{passage}}

## 処理 / Treatment
- 刺激 / Stimulus: {{stimulus}}
- 濃度 / Concentration: {{concentration}}
- 時間 / Duration: {{duration}}
- 解析 / Readout: {{readout}}

## 条件 / Conditions
{{#each conditions}}
- {{.}}
{{/each}}

## 実施内容 / Procedure

## 結果 / Results

## 考察 / Discussion

## 備考 / Notes
{{notes}}
`,
  },
  {
    id: "lcms-run",
    name: "LC-MS測定 / LC-MS acquisition",
    description: "Instrument run with gradient and column details.",
    category: "Proteomics",
    fields: [
      ...COMMON_FIELDS,
      { key: "instrument", label: "装置 / Instrument", type: "text" },
      { key: "column", label: "カラム / Column", type: "text" },
      { key: "gradient", label: "グラジエント / Gradient", type: "text", placeholder: "5-35% B in 90 min" },
      { key: "injection_volume", label: "注入量 / Injection (uL)", type: "text" },
      { key: "sample_count", label: "サンプル数 / Sample count", type: "number" },
      { key: "run_order", label: "測定順 / Run order", type: "list" },
      { key: "notes", label: "備考 / Notes", type: "textarea" },
    ],
    body: `# {{experiment_date}} {{experiment_name}}

**担当 / Operator:** {{operator}}
**目的 / Purpose:** {{purpose}}

## 測定条件 / Acquisition
- 装置 / Instrument: {{instrument}}
- カラム / Column: {{column}}
- グラジエント / Gradient: {{gradient}}
- 注入量 / Injection volume: {{injection_volume}}
- サンプル数 / Samples: {{sample_count}}

## 測定順 / Run order
{{#each run_order}}
1. {{.}}
{{/each}}

## 結果 / Results

## 考察 / Discussion

## 備考 / Notes
{{notes}}
`,
  },
];

/**
 * Renders a template body.
 *
 * Supports {{key}} substitution and {{#each key}} ... {{/each}} blocks where
 * {{.}} is the current item. Missing values render as an em dash so the gap is
 * visible in the notebook rather than silently blank.
 */
export function renderTemplate(
  template: NotebookTemplate,
  values: TemplateValues,
): string {
  const resolved: TemplateValues = {};
  for (const f of template.fields) {
    const v = values[f.key];
    const empty =
      v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    resolved[f.key] = empty ? (f.defaultValue ?? "") : v;
  }
  for (const [k, v] of Object.entries(values)) {
    if (!(k in resolved)) resolved[k] = v;
  }

  let out = template.body;

  // Each-blocks first, so item placeholders are not eaten by scalar
  // substitution.
  out = out.replace(
    /\{\{#each\s+(\w+)\}\}\r?\n?([\s\S]*?)\{\{\/each\}\}\r?\n?/g,
    (_whole, key: string, inner: string) => {
      const raw = resolved[key];
      const items = Array.isArray(raw)
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          : [];
      if (items.length === 0) return "_(未記入 / not recorded)_\n";
      return items
        .map((item) => inner.replace(/\{\{\.\}\}/g, String(item)))
        .join("");
    },
  );

  out = out.replace(/\{\{(\w+)\}\}/g, (_whole, key: string) => {
    const v = resolved[key];
    if (v === undefined || v === null || v === "") return "—";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  });

  return out.trimEnd() + "\n";
}

/** Checks required fields before a notebook entry is saved. */
export function validateTemplateValues(
  template: NotebookTemplate,
  values: TemplateValues,
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const f of template.fields) {
    if (!f.required) continue;
    const v = values[f.key];
    const empty =
      v === undefined || v === null || String(v).trim() === "" ||
      (Array.isArray(v) && v.length === 0);
    if (empty && !f.defaultValue) missing.push(f.label);
  }
  return { valid: missing.length === 0, missing };
}

export function getTemplate(id: string): NotebookTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
