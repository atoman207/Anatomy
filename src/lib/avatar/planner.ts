import {
  GESTURES,
  TIER_BUDGET,
  type AssistantPerformance,
  type AvatarCue,
  type Gesture,
  type GestureTier,
} from "./protocol";

/**
 * Turns the model's per-sentence tags into a timed cue list for one utterance.
 *
 * Human-likeness rules from the design, in order of application:
 *
 * 1. Timing follows the audio: each sentence gets a share of the real audio
 *    duration proportional to its length (Japanese TTS is close to constant
 *    mora rate, so characters are a good proxy).
 * 2. Sentence start → slight lean / head-forward. Question → brow raise near
 *    the end. Thinking sentence → gaze away briefly. Utterance end → neutral.
 * 3. The model's gesture lands just after the sentence starts (on the point
 *    being made), never overlapping another gesture on the same body channel.
 * 4. Budget: context motion ≤ 20 % and strong gestures ≤ 10 % of the time
 *    (a question's brow raise is exempt: it is how a listener hears "?").
 *    One strong gesture is always allowed when the model marks it clearly
 *    (intensity ≥ 0.6), otherwise over-budget gestures are downgraded to a
 *    context equivalent or dropped. Subtle motion (blinks, breathing, micro
 *    head movement) is continuous and owned by the renderer, not cued here.
 */

/** A calmer stand-in when a strong gesture does not fit the budget. */
const DOWNGRADE: Partial<Record<Gesture, Gesture>> = {
  Greeting: "SmallNod",
  Bow: "LargeNod",
  ThankYou: "SmallNod",
  HandOnChest: "SmallNod",
  ExplainLeft: "HeadTilt",
  ExplainRight: "HeadTilt",
  ExplainBoth: "LeanForward",
  OpenPalms: "LeanForward",
  Point: "BrowRaise",
  Count: "SmallNod",
};

const MIN_CLEAR_INTENSITY = 0.6;

export interface PlannedSegment {
  start: number;
  end: number;
}

export interface PerformancePlan {
  cues: AvatarCue[];
  segments: PlannedSegment[];
  /** Seconds used per tier, for tests and debugging overlays. */
  usage: Record<GestureTier, number>;
}

function isQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text) || /(ですか|ますか|でしょうか|か)[。．]?\s*$/.test(text);
}

export function planPerformance(
  performance: AssistantPerformance,
  totalDuration: number,
): PerformancePlan {
  const total = Math.max(0, totalDuration);
  const cues: AvatarCue[] = [];
  const usage: Record<GestureTier, number> = { subtle: 0, context: 0, strong: 0 };
  const channelFreeAt: Record<string, number> = { head: 0, face: 0, hands: 0, body: 0 };
  let strongCount = 0;

  const lengths = performance.segments.map((s) => Math.max(1, [...s.speech].length));
  const sum = lengths.reduce((a, b) => a + b, 0) || 1;
  const segments: PlannedSegment[] = [];
  let cursor = 0;
  for (const len of lengths) {
    const dur = (total * len) / sum;
    segments.push({ start: cursor, end: cursor + dur });
    cursor += dur;
  }

  const budget = (tier: GestureTier) => TIER_BUDGET[tier] * total;

  /** Places a gesture if its channel is free and the tier has room. */
  const place = (
    gesture: Gesture,
    at: number,
    intensity: number,
    segEnd: number,
    /** Short cues the listener relies on (a question's brow raise) bypass the budget. */
    essential = false,
  ): boolean => {
    const spec = GESTURES[gesture];
    if (!spec.clip || spec.duration <= 0) return false;
    const start = Math.max(at, channelFreeAt[spec.channel]);
    // Must start inside the sentence and finish by the end of the utterance.
    if (start >= segEnd || start + spec.duration > total + 0.25) return false;

    const over = usage[spec.tier] + spec.duration > budget(spec.tier);
    if (over && !essential) {
      const clearlyWarranted =
        spec.tier === "strong" && strongCount === 0 && intensity >= MIN_CLEAR_INTENSITY;
      const firstContext = spec.tier === "context" && usage.context === 0;
      if (!clearlyWarranted && !firstContext) return false;
    }

    cues.push({ at: start, duration: spec.duration, kind: "gesture", name: gesture, intensity });
    usage[spec.tier] += spec.duration;
    channelFreeAt[spec.channel] = start + spec.duration;
    if (spec.tier === "strong") strongCount++;
    return true;
  };

  performance.segments.forEach((seg, i) => {
    const { start, end } = segments[i];
    const len = end - start;
    const intensity = seg.intensity;

    cues.push({ at: start, duration: len, kind: "emotion", name: seg.emotion, intensity });

    if (seg.emotion === "thinking") {
      cues.push({ at: start, duration: Math.min(0.6, len * 0.4), kind: "gaze", name: "away", intensity: 0.5 });
      cues.push({ at: start + Math.min(0.6, len * 0.4), duration: 0, kind: "gaze", name: "user", intensity: 1 });
    }

    // The model's chosen gesture, on the point being made.
    const at = start + Math.min(0.35, len * 0.15);
    if (seg.gesture !== "none" && !place(seg.gesture, at, intensity, end)) {
      const calmer = DOWNGRADE[seg.gesture];
      if (calmer) place(calmer, at, Math.min(intensity, 0.5), end);
    }

    // Sentence start: slight forward head movement, only if nothing else leads.
    if (i > 0 && len > 1.2 && channelFreeAt.head <= start) {
      cues.push({ at: start, duration: 0.6, kind: "gesture", name: "HeadForward", intensity: 0.25 });
      channelFreeAt.head = start + 0.6;
    }

    if (isQuestion(seg.speech)) place("BrowRaise", Math.max(start, end - 0.9), 0.5, end, true);
  });

  if (total > 0) {
    cues.push({ at: Math.max(0, total - 0.3), duration: 0.6, kind: "emotion", name: "neutral", intensity: 0.2 });
  }

  cues.sort((a, b) => a.at - b.at);
  return { cues, segments, usage };
}

/** Rough duration estimate for planning before real audio exists (browser TTS). */
export function estimateSpeechSeconds(text: string, rate = 1): number {
  // Standard Japanese reading speed ≈ 7–8 morae/s; kana ≈ mora, kanji ≈ 1.7 morae.
  let morae = 0;
  for (const ch of text) {
    if (/[一-鿿]/.test(ch)) morae += 1.7;
    else if (/[。．！？!?]/.test(ch)) morae += 3;
    else if (/[、，,]/.test(ch)) morae += 1.5;
    else if (/\s/.test(ch)) morae += 0.3;
    else morae += 1;
  }
  return morae / (7.5 * rate);
}
