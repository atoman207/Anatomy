/**
 * The contract between the conversation AI, the avatar controller and the
 * two renderers (Unreal Engine / MetaHuman over Pixel Streaming, and the
 * browser-native three.js avatar).
 *
 * The model never animates anything directly. It tags each sentence with an
 * emotion, a gesture from a fixed library and an intensity; the planner turns
 * those tags into a timed cue list, and each renderer maps cue names onto its
 * own animation assets. Keeping the vocabulary here, in one pure module, is
 * what lets Unreal and the browser stay in step.
 *
 * `unreal/LabnoteAvatar/PROTOCOL.md` documents the wire format for the Unreal
 * side; update it together with this file.
 */

export const AVATAR_PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------------ */
/* Conversation state                                                        */
/* ------------------------------------------------------------------------ */

export const AVATAR_STATES = ["IDLE", "LISTENING", "THINKING", "SPEAKING", "INTERRUPTED"] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

/* ------------------------------------------------------------------------ */
/* Emotion                                                                   */
/* ------------------------------------------------------------------------ */

export const EMOTIONS = [
  "neutral",
  "friendly",
  "happy",
  "grateful",
  "thinking",
  "curious",
  "concerned",
  "apologetic",
  "surprised",
  "confident",
] as const;
export type Emotion = (typeof EMOTIONS)[number];

/* ------------------------------------------------------------------------ */
/* Gesture library                                                           */
/* ------------------------------------------------------------------------ */

/**
 * How much of the screen time a gesture's tier may take.
 *
 * - `subtle`  : blink / breathing / micro head motion class. Always allowed.
 * - `context` : nods, brow raises, head tilts that follow the sentence.
 * - `strong`  : hand and arm gestures. Only when the speech warrants it.
 *
 * The 70 / 20 / 10 split from the design is enforced by the planner via
 * `TIER_BUDGET` (share of the utterance duration).
 */
export type GestureTier = "subtle" | "context" | "strong";

export const TIER_BUDGET: Record<GestureTier, number> = {
  subtle: 0.7,
  context: 0.2,
  strong: 0.1,
};

export interface GestureSpec {
  tier: GestureTier;
  /** Nominal clip length in seconds; renderers may time-stretch slightly. */
  duration: number;
  /** Unreal Anim Montage / glTF clip name the renderer looks up. */
  clip: string;
  /** Body part the gesture occupies, so two cues never fight over it. */
  channel: "head" | "face" | "hands" | "body";
}

/**
 * The animation library. Names are the clip names: a MetaHuman project maps
 * each to an Anim Montage (DataTable `DT_LabnoteGestures`), and a glTF model
 * may ship clips with the same names. Missing clips degrade to procedural
 * head/face motion in the browser renderer.
 */
export const GESTURES = {
  none: { tier: "subtle", duration: 0, clip: "", channel: "body" },
  Idle01: { tier: "subtle", duration: 6, clip: "Idle01", channel: "body" },
  Idle02: { tier: "subtle", duration: 6, clip: "Idle02", channel: "body" },
  Listening: { tier: "subtle", duration: 4, clip: "Listening", channel: "head" },
  Thinking: { tier: "context", duration: 2.2, clip: "Thinking", channel: "head" },
  /** Planner-owned: slight forward head movement at a sentence start. */
  HeadForward: { tier: "subtle", duration: 0.6, clip: "HeadForward", channel: "head" },
  SmallNod: { tier: "context", duration: 0.7, clip: "SmallNod", channel: "head" },
  LargeNod: { tier: "context", duration: 1.1, clip: "LargeNod", channel: "head" },
  Agree: { tier: "context", duration: 1.2, clip: "Agree", channel: "head" },
  HeadTilt: { tier: "context", duration: 1.4, clip: "HeadTilt", channel: "head" },
  LeanForward: { tier: "context", duration: 1.2, clip: "LeanForward", channel: "body" },
  BrowRaise: { tier: "context", duration: 0.8, clip: "BrowRaise", channel: "face" },
  Smile: { tier: "context", duration: 1.6, clip: "Smile", channel: "face" },
  Confused: { tier: "context", duration: 1.5, clip: "Confused", channel: "face" },
  Bow: { tier: "strong", duration: 1.6, clip: "Bow", channel: "body" },
  Greeting: { tier: "strong", duration: 1.8, clip: "Greeting", channel: "hands" },
  ThankYou: { tier: "strong", duration: 1.6, clip: "ThankYou", channel: "body" },
  ExplainLeft: { tier: "strong", duration: 1.8, clip: "ExplainLeft", channel: "hands" },
  ExplainRight: { tier: "strong", duration: 1.8, clip: "ExplainRight", channel: "hands" },
  ExplainBoth: { tier: "strong", duration: 2, clip: "ExplainBoth", channel: "hands" },
  Point: { tier: "strong", duration: 1.4, clip: "Point", channel: "hands" },
  Count: { tier: "strong", duration: 1.8, clip: "Count", channel: "hands" },
  OpenPalms: { tier: "strong", duration: 1.6, clip: "OpenPalms", channel: "hands" },
  HandOnChest: { tier: "strong", duration: 1.6, clip: "HandOnChest", channel: "hands" },
} as const satisfies Record<string, GestureSpec>;

export type Gesture = keyof typeof GESTURES;
export const GESTURE_NAMES = Object.keys(GESTURES) as Gesture[];

/** Gestures the model may choose; idle/listening loops are controller-owned. */
export const AI_GESTURES = GESTURE_NAMES.filter(
  (g) => !["Idle01", "Idle02", "Listening", "Thinking", "HeadForward"].includes(g),
);

/* ------------------------------------------------------------------------ */
/* AI output                                                                 */
/* ------------------------------------------------------------------------ */

/** One spoken sentence (or short clause group) with its performance tags. */
export interface SpeechSegment {
  speech: string;
  emotion: Emotion;
  gesture: Gesture;
  /** 0..1. Scales expression strength; high values may be downgraded by the budget. */
  intensity: number;
}

export interface AssistantPerformance {
  segments: SpeechSegment[];
}

/** Strict JSON schema for the Responses API structured output. */
export const PERFORMANCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["segments"],
  properties: {
    segments: {
      type: "array",
      description: "返答を1〜2文ずつに区切ったもの。順番に読み上げられる。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speech", "emotion", "gesture", "intensity"],
        properties: {
          speech: { type: "string", description: "読み上げる日本語の文。" },
          emotion: { type: "string", enum: [...EMOTIONS] },
          gesture: { type: "string", enum: AI_GESTURES },
          intensity: { type: "number", description: "0〜1。普段は0.2〜0.5。" },
        },
      },
    },
  },
} as const;

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.3;
}

/** Validates model output defensively; strict mode should already guarantee it. */
export function normalizePerformance(raw: unknown): AssistantPerformance {
  const segments: SpeechSegment[] = [];
  const list = (raw as { segments?: unknown })?.segments;
  if (Array.isArray(list)) {
    for (const item of list) {
      const s = item as Partial<Record<keyof SpeechSegment, unknown>>;
      const speech = String(s.speech ?? "").trim();
      if (!speech) continue;
      const emotion = (EMOTIONS as readonly string[]).includes(String(s.emotion))
        ? (s.emotion as Emotion)
        : "friendly";
      const gesture = (AI_GESTURES as string[]).includes(String(s.gesture))
        ? (s.gesture as Gesture)
        : "none";
      segments.push({ speech, emotion, gesture, intensity: clamp01(Number(s.intensity)) });
    }
  }
  return { segments };
}

export function performanceText(p: AssistantPerformance): string {
  return p.segments.map((s) => s.speech).join("");
}

/* ------------------------------------------------------------------------ */
/* Timed cues                                                                */
/* ------------------------------------------------------------------------ */

export type CueKind = "gesture" | "emotion" | "gaze" | "pause";

export interface AvatarCue {
  /** Seconds from the start of the utterance audio. */
  at: number;
  duration: number;
  kind: CueKind;
  /** Gesture name, emotion name, or gaze target ("user" | "away"). */
  name: string;
  intensity: number;
}

/* ------------------------------------------------------------------------ */
/* Messages browser -> Unreal (Pixel Streaming `emitUIInteraction`)          */
/* ------------------------------------------------------------------------ */

export type ToUnrealMessage =
  | { type: "hello"; version: number }
  | { type: "state"; state: AvatarState }
  | {
      type: "speak.begin";
      id: string;
      /** RIFF WAV, 24 kHz mono 16-bit, split into base64 chunks. */
      audioFormat: "wav";
      chunks: number;
      durationSec: number;
      text: string;
      emotion: Emotion;
      cues: AvatarCue[];
      /** Fallback lip sync when Audio2Face is not wired: 30 fps, VISEMES order, 0..255. */
      visemeFps: number;
      visemes: string;
    }
  | { type: "speak.chunk"; id: string; index: number; data: string }
  | { type: "speak.end"; id: string }
  | { type: "stop"; reason: "interrupted" | "closed" }
  | { type: "listen.activity"; level: number };

/* Messages Unreal -> browser (`addResponseEventListener`). */
export type FromUnrealMessage =
  | { type: "ready"; version: number }
  | { type: "speech.started"; id: string }
  | { type: "speech.finished"; id: string }
  | { type: "error"; message: string };

/** Pixel Streaming data-channel payloads should stay well under 64 KB. */
export const UNREAL_CHUNK_CHARS = 16_000;
