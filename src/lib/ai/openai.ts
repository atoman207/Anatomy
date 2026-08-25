import "server-only";

/**
 * Minimal OpenAI client for the two places this app uses a model:
 * transcribing a voice memo, and turning free text into a validated JSON
 * object.
 *
 * Deliberately not the official SDK - the surface used here is two endpoints,
 * and a thin wrapper keeps the timeout, error shape and usage accounting
 * explicit rather than buried.
 */

const API = "https://api.openai.com/v1";

export interface AiConfig {
  enabled: boolean;
  /**
   * The accurate tier, reserved for tasks whose output is hard to verify and
   * expensive to get wrong: AI Peer Review's critical reading of a manuscript,
   * and literature summarization's multi-abstract synthesis. Both involve
   * judgment a cheaper model is more likely to get subtly wrong in a way
   * nothing downstream catches.
   */
  text: string;
  /**
   * The cost tier, for well-specified, mechanical tasks a researcher already
   * reviews before anything is saved: building a PubMed query (shown and
   * editable before it runs) and structuring a voice memo (checked against
   * the original transcript before it is saved). Both are closer to
   * extraction/formatting than to open-ended reasoning, which is exactly
   * where a cheaper model holds up.
   */
  cheap: string;
  /** File-upload transcription. */
  transcribe: string;
  /** Streaming transcription over WebRTC/WebSocket - not valid for uploads. */
  realtime: string;
  image: string;
}

export function aiConfig(): AiConfig {
  return {
    enabled: Boolean(process.env.OPENAI_API_KEY),
    text: process.env.OPENAI_MODEL_TEXT || "gpt-5.6-terra",
    cheap: process.env.OPENAI_MODEL_CHEAP || "gpt-5.6-luna",
    transcribe: process.env.OPENAI_MODEL_TRANSCRIBE || "gpt-4o-transcribe",
    realtime: process.env.OPENAI_MODEL_REALTIME || "gpt-live-transcribe",
    image: process.env.OPENAI_MODEL_IMAGE || "gpt-image-2",
  };
}

export function isAiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Thrown for any non-2xx response, carrying the status so routes can map it. */
export class AiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AiError";
    this.status = status;
    // 429 and 5xx are worth retrying; a 400 means the request itself is wrong.
    this.retryable = status === 429 || status >= 500;
  }
}

function requireKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new AiError(
      "OPENAI_API_KEY が設定されていません。AI機能は無効です。",
      503,
    );
  }
  return key;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function readUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, number>;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

async function post(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API}${path}`, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new AiError(`AIへの要求が ${timeoutMs / 1000} 秒でタイムアウトしました。`, 504);
    }
    throw new AiError(
      e instanceof Error ? e.message : "AIへの接続に失敗しました。",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function failure(res: Response): Promise<AiError> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    detail = body?.error?.message ?? detail;
  } catch {
    // Non-JSON error body; the status alone will have to do.
  }
  if (res.status === 401) {
    return new AiError(`AIキーが拒否されました: ${detail}`, 401);
  }
  if (res.status === 429) {
    return new AiError(`レート制限に達しました: ${detail}`, 429);
  }
  return new AiError(detail, res.status);
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage: Usage;
  /** Raw JSON text, kept so the exact model output can be recorded. */
  raw: string;
}

export interface StructuredOptions {
  model?: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Calls the Responses API with a strict JSON schema.
 *
 * Structured Outputs guarantees the shape, which is what makes it safe to feed
 * a model's output straight into the notebook: a missing field comes back as
 * null rather than as prose the UI would have to guess at.
 */
export async function respondStructured<T>(
  opts: StructuredOptions,
): Promise<StructuredResult<T>> {
  const key = requireKey();
  const cfg = aiConfig();
  const model = opts.model ?? cfg.text;

  const res = await post(
    "/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: opts.schemaName,
            strict: true,
            schema: opts.schema,
          },
        },
      }),
    },
    opts.timeoutMs ?? 60_000,
  );

  if (!res.ok) throw await failure(res);

  const body = await res.json();
  const text: string = (body.output ?? [])
    .flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
    .filter((c: { type: string }) => c.type === "output_text")
    .map((c: { text?: string }) => c.text ?? "")
    .join("");

  if (!text) {
    throw new AiError("モデルが空の応答を返しました。", 502);
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    // Strict mode should make this impossible; surface it rather than crash.
    throw new AiError("モデルの応答をJSONとして解析できませんでした。", 502);
  }

  return { data, model, usage: readUsage(body.usage), raw: text };
}

export interface TranscriptionResult {
  text: string;
  model: string;
  durationSeconds: number | null;
  language: string | null;
}

export interface TranscriptionOptions {
  model?: string;
  /** ISO-639-1 hint. Supplying it measurably improves Japanese accuracy. */
  language?: string;
  /** Vocabulary hint. Has limited effect on gpt-4o-transcribe. */
  prompt?: string;
  timeoutMs?: number;
}

/**
 * Transcribes an audio file.
 *
 * Note that the realtime model (`gpt-live-transcribe`) is not valid here - it
 * serves the streaming WebRTC/WebSocket path and returns 404 on this endpoint.
 * A recorded memo is uploaded whole, so the file-based model is the right one.
 */
export async function transcribeAudio(
  file: Blob,
  filename: string,
  opts: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const key = requireKey();
  const cfg = aiConfig();
  const model = opts.model ?? cfg.transcribe;

  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", model);
  if (opts.language) form.append("language", opts.language);
  if (opts.prompt) form.append("prompt", opts.prompt);

  const res = await post(
    "/audio/transcriptions",
    { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form },
    opts.timeoutMs ?? 180_000,
  );

  if (!res.ok) throw await failure(res);

  const body = await res.json();
  return {
    text: (body.text ?? "").trim(),
    model,
    durationSeconds: typeof body.duration === "number" ? body.duration : null,
    language: body.language ?? opts.language ?? null,
  };
}

export interface GeneratedImage {
  /** Base64-encoded PNG, undecorated (no `data:` prefix). */
  base64: string;
  model: string;
}

/**
 * Fixed framing applied to every notebook image request, never something a
 * caller's prompt can override.
 *
 * This is a lab notebook, not a general image generator: the feature exists
 * to illustrate a protocol or a concept from the researcher's own record, so
 * every request - whatever it names - is rendered as a labeled scientific
 * diagram in a clean, flat, professional illustration style (the kind common
 * to biology/biochemistry figure tools, e.g. BioRender-style panels: vector
 * shapes, a white background, a muted palette, clear callout labels) rather
 * than a photorealistic or decorative image.
 */
const SCIENTIFIC_FIGURE_STYLE = [
  "Create a clean, professional scientific/biology or biochemistry diagram",
  "illustrating the following concept for a laboratory notebook, in the flat,",
  "labeled, vector-illustration style common to biology figure tools (e.g.",
  "BioRender-style panels): schematic shapes, a white background, a muted",
  "professional color palette, clear callout labels where useful, no",
  "photorealism, no decorative or unrelated imagery, no watermarks or logos.",
  "Concept to illustrate:",
].join(" ");

/**
 * Generates one illustrative image (a schematic, a diagram, a plate layout)
 * from a free-text prompt, for the notebook step's "AIで生成" insert action.
 *
 * Separate from `respondStructured`: the images endpoint returns base64
 * pixel data rather than JSON text, so it needs its own response handling,
 * but shares the same key/timeout/error plumbing as every other call here.
 */
export async function generateImage(
  prompt: string,
  opts: { size?: "1024x1024" | "1024x1536" | "1536x1024"; timeoutMs?: number } = {},
): Promise<GeneratedImage> {
  const key = requireKey();
  const cfg = aiConfig();

  const res = await post(
    "/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.image,
        prompt: `${SCIENTIFIC_FIGURE_STYLE} ${prompt}`,
        size: opts.size ?? "1024x1024",
        n: 1,
      }),
    },
    opts.timeoutMs ?? 90_000,
  );

  if (!res.ok) throw await failure(res);

  const body = await res.json();
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new AiError("モデルが画像を返しませんでした。", 502);

  return { base64: b64, model: cfg.image };
}

/** Quick reachability probe used by the health endpoint. */
export async function checkAi(): Promise<{
  ok: boolean;
  detail: string;
  models: string[];
}> {
  if (!isAiEnabled()) {
    return { ok: false, detail: "AI APIキーが未設定です", models: [] };
  }
  try {
    const key = requireKey();
    const res = await post(
      "/models",
      { method: "GET", headers: { Authorization: `Bearer ${key}` } },
      15_000,
    );
    if (!res.ok) {
      const err = await failure(res);
      return { ok: false, detail: err.message, models: [] };
    }
    const body = await res.json();
    const available = new Set<string>(
      (body.data ?? []).map((m: { id: string }) => m.id),
    );
    const cfg = aiConfig();
    const wanted = [cfg.text, cfg.cheap, cfg.transcribe];
    const missing = wanted.filter((m) => !available.has(m));
    if (missing.length) {
      return {
        ok: false,
        detail: `設定されたモデルが利用できません: ${missing.join(", ")}`,
        models: wanted,
      };
    }
    return { ok: true, detail: "接続済み", models: wanted };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "接続に失敗しました",
      models: [],
    };
  }
}
