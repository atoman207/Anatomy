import type { AvatarCue, AvatarState, Emotion } from "./protocol";

/**
 * Per-frame expression and head/body offsets for the browser avatar, derived
 * from the conversation state and the active cues.
 *
 * Pure (no three.js) so the behaviour can be tested. Values are *targets*;
 * the renderer smooths them. Continuous subtle motion (blinks, breathing,
 * saccades, micro head drift) stays in the renderer; this adds the context
 * layer on top.
 */

export interface ExpressionPose {
  smile: number;
  browUp: number;
  browDown: number;
  eyeWide: number;
  cheekSquint: number;
  mouthFrown: number;
  /** Radians, added on top of idle motion. Pitch + = look down. */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  neckPitch: number;
  chestPitch: number;
  /** Gaze offset (radians-ish), null = let saccades run freely. */
  gaze: { x: number; y: number } | null;
}

export function neutralPose(): ExpressionPose {
  return {
    smile: 0.12,
    browUp: 0,
    browDown: 0,
    eyeWide: 0,
    cheekSquint: 0,
    mouthFrown: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    neckPitch: 0,
    chestPitch: 0,
    gaze: null,
  };
}

type FacePreset = Pick<ExpressionPose, "smile" | "browUp" | "browDown" | "eyeWide" | "cheekSquint" | "mouthFrown">;

const EMOTION_FACE: Record<Emotion, FacePreset> = {
  neutral: { smile: 0.1, browUp: 0, browDown: 0, eyeWide: 0, cheekSquint: 0, mouthFrown: 0 },
  friendly: { smile: 0.3, browUp: 0.08, browDown: 0, eyeWide: 0, cheekSquint: 0.12, mouthFrown: 0 },
  happy: { smile: 0.55, browUp: 0.15, browDown: 0, eyeWide: 0, cheekSquint: 0.35, mouthFrown: 0 },
  grateful: { smile: 0.45, browUp: 0.2, browDown: 0, eyeWide: 0, cheekSquint: 0.25, mouthFrown: 0 },
  thinking: { smile: 0.05, browUp: 0.1, browDown: 0.15, eyeWide: 0, cheekSquint: 0, mouthFrown: 0.05 },
  curious: { smile: 0.18, browUp: 0.35, browDown: 0, eyeWide: 0.15, cheekSquint: 0, mouthFrown: 0 },
  concerned: { smile: 0, browUp: 0.3, browDown: 0.2, eyeWide: 0, cheekSquint: 0, mouthFrown: 0.2 },
  apologetic: { smile: 0.08, browUp: 0.4, browDown: 0.1, eyeWide: 0, cheekSquint: 0, mouthFrown: 0.12 },
  surprised: { smile: 0.1, browUp: 0.6, browDown: 0, eyeWide: 0.45, cheekSquint: 0, mouthFrown: 0 },
  confident: { smile: 0.28, browUp: 0.05, browDown: 0.05, eyeWide: 0, cheekSquint: 0.1, mouthFrown: 0 },
};

/** 0 → 1 → 0 over the gesture, with soft ends. */
function envelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return Math.sin(Math.PI * p);
}

function addFace(pose: ExpressionPose, face: FacePreset, weight: number) {
  pose.smile += (face.smile - 0.1) * weight;
  pose.browUp += face.browUp * weight;
  pose.browDown += face.browDown * weight;
  pose.eyeWide += face.eyeWide * weight;
  pose.cheekSquint += face.cheekSquint * weight;
  pose.mouthFrown += face.mouthFrown * weight;
}

/** Procedural version of a library gesture (head / face / torso only). */
function applyGesture(pose: ExpressionPose, name: string, p: number, intensity: number) {
  const k = 0.6 + intensity * 0.8;
  const env = envelope(p);
  switch (name) {
    case "SmallNod":
      pose.headPitch += Math.sin(Math.PI * p) ** 2 * 0.09 * k;
      break;
    case "LargeNod":
      pose.headPitch += Math.sin(Math.PI * p) ** 2 * 0.17 * k;
      pose.neckPitch += env * 0.04 * k;
      break;
    case "Agree":
      // Two small nods.
      pose.headPitch += Math.max(0, Math.sin(2 * Math.PI * p * 2)) * 0.08 * k;
      pose.smile += env * 0.15;
      break;
    case "HeadTilt":
      pose.headRoll += env * 0.1 * k;
      pose.headYaw += env * 0.04 * k;
      break;
    case "HeadForward":
      pose.headPitch += env * 0.04 * k;
      pose.neckPitch += env * 0.03 * k;
      break;
    case "LeanForward":
      pose.chestPitch += env * 0.05 * k;
      pose.headPitch += env * 0.03 * k;
      break;
    case "BrowRaise":
      pose.browUp += env * 0.45 * k;
      break;
    case "Smile":
      pose.smile += env * 0.35 * k;
      pose.cheekSquint += env * 0.25 * k;
      break;
    case "Confused":
      pose.browDown += env * 0.35 * k;
      pose.headRoll -= env * 0.07 * k;
      break;
    case "Thinking":
      pose.browDown += env * 0.2;
      pose.gaze = { x: -0.12, y: 0.08 };
      break;
    case "Bow":
    case "ThankYou":
      // Japanese eshaku (15°) split over chest, neck and head.
      pose.chestPitch += env * 0.14 * k;
      pose.neckPitch += env * 0.06 * k;
      pose.headPitch += env * 0.06 * k;
      pose.smile += env * 0.2;
      break;
    case "Greeting":
      pose.headPitch += env * 0.06 * k;
      pose.smile += env * 0.25;
      break;
    case "HandOnChest":
      pose.headPitch += env * 0.04 * k;
      break;
    case "ExplainLeft":
      pose.headYaw += env * 0.05 * k;
      break;
    case "ExplainRight":
      pose.headYaw -= env * 0.05 * k;
      break;
    case "ExplainBoth":
    case "OpenPalms":
    case "Count":
    case "Point":
      pose.browUp += env * 0.15 * k;
      pose.headPitch -= env * 0.02 * k;
      break;
  }
}

export interface ExpressionInput {
  state: AvatarState;
  /** Seconds since the state was entered. */
  stateAge: number;
  /** Seconds into the current utterance, or < 0 when not speaking. */
  utteranceTime: number;
  cues: readonly AvatarCue[] | null;
  /** Seconds since the user last produced speech. */
  userActivityAge: number;
  /** Wall-clock seconds, for slow periodic motion. */
  now: number;
}

/** Emotion in force at `t`: the latest emotion cue that has started. */
export function activeEmotion(cues: readonly AvatarCue[], t: number): AvatarCue | null {
  let best: AvatarCue | null = null;
  for (const c of cues) {
    if (c.kind !== "emotion" || c.at > t) continue;
    if (!best || c.at >= best.at) best = c;
  }
  return best;
}

export function computeExpression(input: ExpressionInput): ExpressionPose {
  const pose = neutralPose();
  const { state, stateAge, now } = input;
  const ramp = Math.min(1, stateAge / 0.35);

  switch (state) {
    case "IDLE":
      break;

    case "LISTENING": {
      // Attentive: eyes on the user, slight tilt, soft brows, a gentle smile.
      pose.gaze = { x: 0, y: 0 };
      pose.headRoll += 0.035 * ramp;
      pose.browUp += 0.08 * ramp;
      pose.smile += 0.06 * ramp;
      // Back-channel nod shortly after the user says something (not on every word).
      const a = input.userActivityAge;
      if (a >= 0.15 && a < 0.85) pose.headPitch += Math.sin(Math.PI * ((a - 0.15) / 0.7)) ** 2 * 0.06;
      break;
    }

    case "THINKING": {
      // Look up and aside, brows gather slightly, lips press.
      const drift = Math.sin(now * 0.9) * 0.02;
      pose.gaze = { x: -0.13 + drift, y: 0.09 };
      pose.headRoll -= 0.05 * ramp;
      pose.headYaw += 0.04 * ramp;
      pose.browDown += 0.15 * ramp;
      pose.browUp += 0.1 * ramp;
      pose.smile -= 0.06 * ramp;
      break;
    }

    case "INTERRUPTED": {
      // Caught mid-sentence: brief brow flash, small pull back, then yield.
      const flash = envelope(Math.min(1, stateAge / 0.6));
      pose.browUp += 0.4 * flash;
      pose.eyeWide += 0.2 * flash;
      pose.headPitch -= 0.04 * flash;
      pose.gaze = { x: 0, y: 0 };
      break;
    }

    case "SPEAKING": {
      pose.gaze = { x: 0, y: 0 }; // mostly eye contact; renderer adds saccades
      const cues = input.cues;
      const t = input.utteranceTime;
      if (!cues || t < 0) break;

      const emotion = activeEmotion(cues, t);
      if (emotion) {
        const fadeIn = Math.min(1, (t - emotion.at) / 0.4);
        addFace(pose, EMOTION_FACE[emotion.name as Emotion] ?? EMOTION_FACE.friendly, (0.5 + emotion.intensity) * fadeIn);
      }
      for (const c of cues) {
        if (c.kind === "gesture" && c.duration > 0 && t >= c.at && t < c.at + c.duration) {
          applyGesture(pose, c.name, (t - c.at) / c.duration, c.intensity);
        } else if (c.kind === "gaze" && c.name === "away" && t >= c.at && t < c.at + c.duration) {
          pose.gaze = { x: -0.12, y: 0.07 };
        }
      }
      break;
    }
  }

  pose.smile = Math.max(0, Math.min(1, pose.smile));
  for (const key of ["browUp", "browDown", "eyeWide", "cheekSquint", "mouthFrown"] as const) {
    pose[key] = Math.max(0, Math.min(1, pose[key]));
  }
  return pose;
}

/** Gesture cues active at `t` whose names may exist as animation clips. */
export function activeClipCues(cues: readonly AvatarCue[] | null, t: number): AvatarCue[] {
  if (!cues || t < 0) return [];
  return cues.filter((c) => c.kind === "gesture" && c.duration > 0 && t >= c.at && t < c.at + c.duration);
}
