import "server-only";

import { respondStructured, type StructuredResult } from "./openai";

/**
 * Structured form of a spoken lab memo.
 *
 * Every field is nullable on purpose. A voice memo is a partial record - the
 * researcher says what is on their mind, not a complete form - and a model
 * that fills gaps with plausible guesses would quietly corrupt the notebook.
 * Null means "not said", which is information.
 */
export interface VoiceNoteReagent {
  name: string;
  lot: string | null;
  amount: string | null;
}

export interface VoiceNoteTreatment {
  agent: string;
  concentration: string | null;
  duration: string | null;
}

export interface VoiceNoteSample {
  identifier: string | null;
  description: string | null;
}

export interface StructuredVoiceNote {
  experiment_date: string | null;
  experiment_name: string | null;
  operator: string | null;
  purpose: string | null;
  sample_count: number | null;
  samples: VoiceNoteSample[];
  reagents: VoiceNoteReagent[];
  treatments: VoiceNoteTreatment[];
  procedure: string[];
  observations: string[];
  next_actions: string[];
  /** Terms the transcript rendered ambiguously, for the researcher to confirm. */
  uncertain_terms: string[];
  /** One-line summary in the language the memo was spoken in. */
  summary: string | null;
}

const nullableString = { type: ["string", "null"] } as const;

export const VOICE_NOTE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "experiment_date", "experiment_name", "operator", "purpose", "sample_count",
    "samples", "reagents", "treatments", "procedure", "observations",
    "next_actions", "uncertain_terms", "summary",
  ],
  properties: {
    experiment_date: {
      ...nullableString,
      description: "YYYY-MM-DD. Only if a date was actually spoken.",
    },
    experiment_name: nullableString,
    operator: nullableString,
    purpose: nullableString,
    sample_count: { type: ["integer", "null"] },
    samples: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["identifier", "description"],
        properties: { identifier: nullableString, description: nullableString },
      },
    },
    reagents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "lot", "amount"],
        properties: {
          name: { type: "string" },
          lot: nullableString,
          amount: nullableString,
        },
      },
    },
    treatments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "concentration", "duration"],
        properties: {
          agent: { type: "string" },
          concentration: nullableString,
          duration: nullableString,
        },
      },
    },
    procedure: { type: "array", items: { type: "string" } },
    observations: { type: "array", items: { type: "string" } },
    next_actions: { type: "array", items: { type: "string" } },
    uncertain_terms: { type: "array", items: { type: "string" } },
    summary: nullableString,
  },
};

const SYSTEM_PROMPT = `あなたは研究室の音声メモを構造化するアシスタントです。

厳守事項:
1. 書き起こしに述べられていない情報は絶対に補完しないでください。述べられていない項目は必ず null または空配列にします。数値・濃度・ロット番号を推測することは、ノートの記録を汚染する重大な誤りです。
2. 音声認識がカタカナで書き起こした試薬名・機器名・手法名は、研究分野で一般的な英数字表記に正規化してください。
   例: トリプシン→Trypsin、ロットA123→lot "A123"、ティーエムティー→TMT、アイエルワンベータ→IL-1β、アールティーキューピーシーアール→RT-qPCR
3. 聞き取りが不確実な語、複数の解釈があり得る語は uncertain_terms に列挙してください。研究者が確認できるようにするためです。
4. procedure は話された順序で、1項目1手順に分けてください。
5. summary は音声と同じ言語で1文にまとめてください。
6. 日付は「本日」「今日」のような相対表現の場合、与えられた基準日を使って YYYY-MM-DD に変換してください。基準日が無ければ null にします。`;

export interface StructureVoiceNoteOptions {
  transcript: string;
  /** Today's date, so relative expressions like 本日 can be resolved. */
  referenceDate?: string;
  model?: string;
}

export async function structureVoiceNote(
  opts: StructureVoiceNoteOptions,
): Promise<StructuredResult<StructuredVoiceNote>> {
  const context = opts.referenceDate
    ? `基準日: ${opts.referenceDate}\n\n書き起こし:\n${opts.transcript}`
    : `書き起こし:\n${opts.transcript}`;

  return respondStructured<StructuredVoiceNote>({
    model: opts.model,
    system: SYSTEM_PROMPT,
    user: context,
    schemaName: "voice_note",
    schema: VOICE_NOTE_SCHEMA,
  });
}

/** Renders a structured note as the Markdown that goes into the notebook. */
export function voiceNoteToMarkdown(
  note: StructuredVoiceNote,
  opts: { transcript?: string; includeTranscript?: boolean } = {},
): string {
  const lines: string[] = [];
  const dash = "—";
  const v = (x: string | null | undefined) => (x && x.trim() ? x : dash);

  lines.push(`# ${v(note.experiment_date)} ${v(note.experiment_name)}`, "");
  if (note.summary) lines.push(`> ${note.summary}`, "");

  lines.push(`**担当:** ${v(note.operator)}`);
  lines.push(`**目的:** ${v(note.purpose)}`);
  lines.push(
    `**サンプル数:** ${note.sample_count === null ? dash : String(note.sample_count)}`,
  );
  lines.push("");

  if (note.samples.length) {
    lines.push("## サンプル", "");
    for (const s of note.samples) {
      const id = s.identifier ?? dash;
      lines.push(`- ${id}${s.description ? ` — ${s.description}` : ""}`);
    }
    lines.push("");
  }

  if (note.reagents.length) {
    lines.push("## 使用試薬", "");
    for (const r of note.reagents) {
      const parts = [r.name];
      if (r.lot) parts.push(`Lot: ${r.lot}`);
      if (r.amount) parts.push(r.amount);
      lines.push(`- ${parts.join(" — ")}`);
    }
    lines.push("");
  }

  if (note.treatments.length) {
    lines.push("## 処理条件", "");
    for (const t of note.treatments) {
      const parts = [t.agent];
      if (t.concentration) parts.push(t.concentration);
      if (t.duration) parts.push(t.duration);
      lines.push(`- ${parts.join(" / ")}`);
    }
    lines.push("");
  }

  if (note.procedure.length) {
    lines.push("## 実施内容", "");
    note.procedure.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    lines.push("");
  }

  if (note.observations.length) {
    lines.push("## 観察・結果", "");
    for (const o of note.observations) lines.push(`- ${o}`);
    lines.push("");
  }

  if (note.next_actions.length) {
    lines.push("## 次のアクション", "");
    for (const a of note.next_actions) lines.push(`- [ ] ${a}`);
    lines.push("");
  }

  if (note.uncertain_terms.length) {
    lines.push("## 要確認（音声認識が不確実）", "");
    for (const u of note.uncertain_terms) lines.push(`- ${u}`);
    lines.push("");
  }

  if (opts.includeTranscript && opts.transcript) {
    lines.push("## 元の書き起こし", "");
    lines.push("```");
    lines.push(opts.transcript);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Fields the structured pass left empty.
 *
 * Surfaced in the UI so the gap is visible: a blank field in a lab notebook
 * should look like a blank, not like a value nobody checked.
 */
export function missingFields(note: StructuredVoiceNote): string[] {
  const missing: string[] = [];
  if (!note.experiment_date) missing.push("実験日");
  if (!note.experiment_name) missing.push("実験名");
  if (!note.operator) missing.push("担当者");
  if (note.sample_count === null) missing.push("サンプル数");
  if (note.reagents.length === 0) missing.push("試薬");
  if (note.procedure.length === 0) missing.push("実施内容");
  return missing;
}
