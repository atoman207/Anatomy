"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import type { Json } from "@/lib/supabase/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface StartVoiceNoteInput {
  labId: string;
  experimentId: string;
  engine: "browser" | "openai" | "manual";
  model: string | null;
  audioSeconds: number | null;
  rawTranscript: string;
}

/**
 * Opens one voice-note record with the raw transcript, timestamped as it
 * happens. Nothing here is ever rewritten later - editing and structuring
 * add new columns of their own - so "what was actually said" always
 * survives independently of what a researcher cleaned up afterwards.
 */
export async function startVoiceNote(
  input: StartVoiceNoteInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("voice_notes")
    .insert({
      lab_id: input.labId,
      experiment_id: input.experimentId,
      engine: input.engine,
      model: input.model,
      audio_seconds: input.audioSeconds,
      raw_transcript: input.rawTranscript,
      transcribed_at: new Date().toISOString(),
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "voice_note.started",
    entity: "voice_note", entityId: data.id,
    detail: { experiment_id: input.experimentId, engine: input.engine },
  });

  return { ok: true, data: { id: data.id } };
}

/** Records the researcher's edit to the transcript, distinct from the raw text. */
export async function updateVoiceNoteEdit(
  id: string,
  editedTranscript: string,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("voice_notes")
    .update({ edited_transcript: editedTranscript, edited_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Records what the AI extracted from the transcript, as its own stage. */
export async function updateVoiceNoteStructured(
  id: string,
  aiNote: unknown,
  model: string | null,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("voice_notes")
    .update({
      ai_note: aiNote as Json,
      ai_structured_at: new Date().toISOString(),
      model,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface ConfirmVoiceNoteInput {
  id: string;
  labId: string;
  finalMarkdown: string;
}

/**
 * Locks the voice note. After this, the database itself rejects any further
 * change to this row (see the `lock_confirmed_voice_note` trigger) - this is
 * the actual tamper-resistance mechanism, not merely a UI convention.
 */
export async function confirmVoiceNote(
  input: ConfirmVoiceNoteInput,
): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("voice_notes")
    .update({
      final_markdown: input.finalMarkdown,
      confirmed_at: new Date().toISOString(),
      confirmed_by: ctx.user.id,
    })
    .eq("id", input.id);

  if (error) return { ok: false, error: error.message };

  await logAudit({
    labId: input.labId, userId: ctx.user.id, action: "voice_note.confirmed",
    entity: "voice_note", entityId: input.id,
    detail: {},
  });

  return { ok: true };
}

export interface VoiceNoteSummary {
  id: string;
  engine: string | null;
  raw_transcript: string | null;
  edited_transcript: string | null;
  final_markdown: string | null;
  confirmed_at: string | null;
  created_at: string;
}

/** Every voice note for one experiment, confirmed or not, newest first. */
export async function listVoiceNotes(
  experimentId: string,
): Promise<ActionResult<VoiceNoteSummary[]>> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "ログインしていません。" };
  if (!experimentId) return { ok: true, data: [] };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("voice_notes")
    .select("id, engine, raw_transcript, edited_transcript, final_markdown, confirmed_at, created_at")
    .eq("experiment_id", experimentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}
