import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { ASSISTANT_VOICE_INSTRUCTIONS } from "../assistantKnowledge";
import { allKnowledgeDocuments, knowledgeForConversation } from "../assistantKnowledgeStore";
import { aiConfig, respondText, synthesizeSpeech } from "../openai";
import { responseInstructions, type Audience } from "../realtimeAssistant";
import { QuestionIndex, normalizeQuestion } from "./matcher";

/**
 * Persistence and generation for the assistant answer cache.
 *
 * Token policy:
 * - A cache hit costs nothing: no model, no speech synthesis, just bytes.
 * - A question is only worth an answer of its own once it has been asked
 *   `MIN_ASKS` times; one-off questions are answered live and forgotten.
 * - The stored answer is produced here, server-side, with the cheap text model
 *   and only the relevant knowledge snippets, then voiced once. Answers are
 *   never accepted from the browser, so nobody can plant one for others.
 *
 * Everything degrades to "miss" when the table or service key is absent, so
 * the assistant keeps working (just without savings) before the migration.
 */

const MIN_ASKS = Math.max(1, Number(process.env.ASSISTANT_CACHE_MIN_ASKS) || 2);
/** Ready answers older than this are regenerated on demand rather than served. */
const MAX_AGE_DAYS = 90;
const INDEX_TTL_MS = 60_000;
const KNOWLEDGE_TTL_MS = 5 * 60_000;

type Row = {
  id: string;
  question: string;
  normalized: string;
  answer: string | null;
  status: string;
};

/** Set when the table is missing/unreachable, so each question does not retry it. */
let unavailableUntil = 0;

function db(): SupabaseClient | null {
  if (Date.now() < unavailableUntil) return null;
  try {
    // The table is not in the generated types until the migration is applied.
    return createAdminSupabase() as unknown as SupabaseClient;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Knowledge version + background corpus                                     */
/* ------------------------------------------------------------------------ */

let knowledgeCache: { at: number; version: string; background: string[] } | null = null;

async function knowledgeState() {
  if (knowledgeCache && Date.now() - knowledgeCache.at < KNOWLEDGE_TTL_MS) return knowledgeCache;
  const docs = await allKnowledgeDocuments();
  const hash = createHash("sha256");
  for (const d of [...docs].sort((a, b) => a.id.localeCompare(b.id))) hash.update(`${d.id}\n${d.title}\n${d.body}\n`);
  const background = docs
    .flatMap((d) => `${d.title}。${d.body}`.split(/[。！？\n]/))
    .map((t) => t.trim())
    .filter((t) => t.length > 4);
  knowledgeCache = { at: Date.now(), version: hash.digest("hex").slice(0, 16), background };
  return knowledgeCache;
}

/* ------------------------------------------------------------------------ */
/* In-memory indexes (rebuilt at most once a minute per audience)            */
/* ------------------------------------------------------------------------ */

type Indexes = { at: number; ready: QuestionIndex<Row>; pending: QuestionIndex<Row> };
const indexCache = new Map<string, Indexes>();

function invalidate(audience: Audience, version: string) {
  indexCache.delete(`${audience}:${version}`);
}

async function indexes(client: SupabaseClient, audience: Audience): Promise<Indexes & { version: string }> {
  const { version, background } = await knowledgeState();
  const key = `${audience}:${version}`;
  const cached = indexCache.get(key);
  if (cached && Date.now() - cached.at < INDEX_TTL_MS) return { ...cached, version };

  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data, error } = await client
    .from("assistant_answer_cache")
    .select("id, question, normalized, answer, status, updated_at")
    .eq("audience", audience)
    .eq("knowledge_version", version)
    .in("status", ["ready", "pending", "generating"])
    .gte("updated_at", since)
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const built: Indexes = {
    at: Date.now(),
    ready: new QuestionIndex(rows.filter((r) => r.status === "ready" && r.answer), background),
    pending: new QuestionIndex(rows.filter((r) => r.status !== "ready"), background),
  };
  indexCache.set(key, built);
  return { ...built, version };
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

export type CacheLookup =
  | { hit: true; id: string; answer: string }
  | { hit: false };

export async function lookupAnswer(question: string, audience: Audience): Promise<CacheLookup> {
  const client = db();
  if (!client) return { hit: false };
  try {
    const { ready } = await indexes(client, audience);
    const match = ready.match(normalizeQuestion(question));
    if (match?.entry.answer) return { hit: true, id: match.entry.id, answer: match.entry.answer };
  } catch {
    // Table missing or unreachable: behave as an empty cache for a minute.
    unavailableUntil = Date.now() + 60_000;
  }
  return { hit: false };
}

export async function recordHit(id: string): Promise<void> {
  const client = db();
  if (!client) return;
  await client.rpc("assistant_answer_cache_bump", { p_id: id, p_hit: true });
}

/**
 * Notes that a question went to the model. Once the same question (by the
 * matcher's judgement) has been asked `MIN_ASKS` times, generates and stores
 * its answer. Meant to run after the response (Next.js `after`).
 */
export async function recordMissAndMaybeGenerate(question: string, audience: Audience): Promise<void> {
  const client = db();
  if (!client) return;
  try {
    const { pending, version } = await indexes(client, audience);
    const normalized = normalizeQuestion(question);
    const existing = pending.match(normalized);

    let id: string;
    let asked: number;
    if (existing) {
      id = existing.entry.id;
      const { data, error } = await client.rpc("assistant_answer_cache_bump", { p_id: id, p_hit: false });
      if (error) return;
      asked = Number(data ?? 0);
    } else {
      const { data, error } = await client
        .from("assistant_answer_cache")
        .upsert(
          { audience, question: question.slice(0, 300), normalized, knowledge_version: version },
          { onConflict: "audience,knowledge_version,normalized", ignoreDuplicates: true },
        )
        .select("id, asked_count")
        .maybeSingle();
      if (error || !data) return;
      id = String((data as { id: string }).id);
      asked = Number((data as { asked_count: number }).asked_count);
      invalidate(audience, version);
    }

    if (asked >= MIN_ASKS && existing?.entry.status !== "generating") {
      await generateAnswer(client, id, question, audience, version);
    }
  } catch {
    // Best effort: the user already got a live answer.
  }
}

async function generateAnswer(
  client: SupabaseClient,
  id: string,
  question: string,
  audience: Audience,
  version: string,
): Promise<void> {
  // Claim the row so concurrent askers do not generate twice.
  const { data: claimed } = await client
    .from("assistant_answer_cache")
    .update({ status: "generating" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  try {
    const docs = await knowledgeForConversation([question], 3);
    const result = await respondText({
      model: aiConfig().cheap,
      system:
        `${responseInstructions(audience, docs)}\n\n## 出力\n` +
        "この質問への答えだけを、そのまま音声で読み上げる1〜3文（120字程度まで）で書いてください。",
      messages: [{ role: "user", content: question }],
      timeoutMs: 30_000,
    });
    const answer = result.text.trim();
    if (!answer) throw new Error("empty answer");

    const speech = await synthesizeSpeech(answer, { instructions: ASSISTANT_VOICE_INSTRUCTIONS, format: "mp3" });
    const { error } = await client
      .from("assistant_answer_cache")
      .update({
        status: "ready",
        answer,
        audio: `\\x${Buffer.from(speech.audio).toString("hex")}`,
        audio_mime: speech.contentType,
        model: result.model,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } catch {
    await client.from("assistant_answer_cache").update({ status: "failed" }).eq("id", id);
  } finally {
    invalidate(audience, version);
  }
}

export async function answerAudio(id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const client = db();
  if (!client) return null;
  const { data, error } = await client
    .from("assistant_answer_cache")
    .select("audio, audio_mime")
    .eq("id", id)
    .eq("status", "ready")
    .maybeSingle();
  if (error || !data) return null;
  const raw = (data as { audio: string | null; audio_mime: string | null }).audio;
  if (!raw) return null;
  // PostgREST returns bytea as a "\x…" hex string.
  const bytes = raw.startsWith("\\x") ? Buffer.from(raw.slice(2), "hex") : Buffer.from(raw, "base64");
  return { bytes, mime: (data as { audio_mime: string | null }).audio_mime ?? "audio/mpeg" };
}
