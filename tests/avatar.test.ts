import { test } from "node:test";
import assert from "node:assert/strict";
import { planPerformance, estimateSpeechSeconds } from "../src/lib/avatar/planner";
import { nextAvatarState } from "../src/lib/avatar/stateMachine";
import { computeExpression, activeEmotion } from "../src/lib/avatar/expression";
import {
  AI_GESTURES,
  GESTURES,
  PERFORMANCE_SCHEMA,
  normalizePerformance,
  performanceText,
  type AssistantPerformance,
} from "../src/lib/avatar/protocol";
import { builtinKnowledge, retrieveKnowledge } from "../src/lib/ai/assistantKnowledge";
import { encodeVisemeTrack, chunkString } from "../src/lib/avatar/encode";
import { VISEME_COUNT } from "../src/lib/voice/lipSync";

const seg = (speech: string, gesture: string, intensity = 0.4, emotion = "friendly") =>
  ({ speech, gesture, intensity, emotion }) as AssistantPerformance["segments"][number];

test("normalizePerformance drops junk and clamps values", () => {
  const p = normalizePerformance({
    segments: [
      { speech: " こんにちは。 ", emotion: "happy", gesture: "Greeting", intensity: 3 },
      { speech: "", emotion: "happy", gesture: "Bow", intensity: 0.5 },
      { speech: "説明します。", emotion: "angry", gesture: "Dance", intensity: Number.NaN },
    ],
  });
  assert.equal(p.segments.length, 2);
  assert.deepEqual(p.segments[0], { speech: "こんにちは。", emotion: "happy", gesture: "Greeting", intensity: 1 });
  assert.equal(p.segments[1].emotion, "friendly");
  assert.equal(p.segments[1].gesture, "none");
  assert.equal(performanceText(p), "こんにちは。説明します。");
  assert.deepEqual(normalizePerformance(null), { segments: [] });
});

test("schema only offers AI-selectable gestures", () => {
  const items = PERFORMANCE_SCHEMA.properties.segments.items.properties;
  assert.deepEqual(items.gesture.enum, AI_GESTURES);
  assert.ok(!AI_GESTURES.includes("Idle01"));
  assert.ok(!AI_GESTURES.includes("HeadForward"));
});

test("planner keeps strong gestures within the 10% budget", () => {
  const performance: AssistantPerformance = {
    segments: Array.from({ length: 6 }, (_, i) => seg(`ポイント${i}について詳しく説明します。`, "ExplainBoth", 0.4)),
  };
  const total = 30;
  const plan = planPerformance(performance, total);
  assert.ok(plan.usage.strong <= total * 0.1 + 1e-9, `strong ${plan.usage.strong}`);
  assert.ok(plan.usage.context <= total * 0.2 + 1e-9, `context ${plan.usage.context}`);
  // Over-budget gestures are downgraded, not silently lost.
  assert.ok(plan.cues.some((c) => c.name === "LeanForward"));
});

test("planner allows one clearly warranted strong gesture in a short reply", () => {
  const plan = planPerformance({ segments: [seg("ありがとうございます。", "ThankYou", 0.8, "grateful")] }, 2);
  assert.ok(plan.cues.some((c) => c.kind === "gesture" && c.name === "ThankYou"));
  const weak = planPerformance({ segments: [seg("ありがとうございます。", "ThankYou", 0.3, "grateful")] }, 2);
  assert.ok(!weak.cues.some((c) => c.name === "ThankYou"));
});

test("planner never overlaps gestures on the same channel and orders cues", () => {
  const plan = planPerformance(
    {
      segments: [
        seg("まず、記録ウィザードです。", "SmallNod"),
        seg("次に、統計解析です。", "HeadTilt"),
        seg("AI査読も使えますか？", "none", 0.4, "curious"),
      ],
    },
    6,
  );
  for (let i = 1; i < plan.cues.length; i++) assert.ok(plan.cues[i].at >= plan.cues[i - 1].at);
  const head = plan.cues
    .filter((c) => c.kind === "gesture" && GESTURES[c.name as keyof typeof GESTURES]?.channel === "head")
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < head.length; i++) {
    assert.ok(head[i].at >= head[i - 1].at + head[i - 1].duration - 1e-9, "head gestures overlap");
  }
  // Question → brow raise; end of utterance → neutral.
  assert.ok(plan.cues.some((c) => c.name === "BrowRaise"));
  assert.equal(plan.cues.at(-1)?.name, "neutral");
  // Segment times cover the whole duration.
  assert.equal(plan.segments[0].start, 0);
  assert.ok(Math.abs(plan.segments.at(-1)!.end - 6) < 1e-9);
});

test("estimateSpeechSeconds is in a natural Japanese range", () => {
  const s = estimateSpeechSeconds("LABNOTEでは実験記録からAI査読まで利用できます。");
  assert.ok(s > 2 && s < 8, String(s));
});

test("state machine follows listen → think → speak and handles interruption", () => {
  let s = nextAvatarState("IDLE", { type: "USER_STARTED" });
  assert.equal(s, "LISTENING");
  s = nextAvatarState(s, { type: "REQUEST_SENT" });
  assert.equal(s, "THINKING");
  s = nextAvatarState(s, { type: "SPEECH_STARTED" });
  assert.equal(s, "SPEAKING");
  s = nextAvatarState(s, { type: "USER_STARTED" });
  assert.equal(s, "INTERRUPTED");
  // The cut-off speech finishing does not steal the turn back.
  assert.equal(nextAvatarState(s, { type: "SPEECH_FINISHED" }), "INTERRUPTED");
  assert.equal(nextAvatarState(s, { type: "INTERRUPT_SETTLED" }), "LISTENING");
  assert.equal(nextAvatarState("LISTENING", { type: "SPEECH_STARTED" }), "LISTENING");
  assert.equal(nextAvatarState("SPEAKING", { type: "SPEECH_FINISHED" }), "IDLE");
  assert.equal(nextAvatarState("THINKING", { type: "REPLY_FAILED" }), "IDLE");
});

test("expression reacts to state, emotion and gesture cues", () => {
  const base = { stateAge: 1, utteranceTime: -1, cues: null, userActivityAge: 99, now: 10 };
  const thinking = computeExpression({ ...base, state: "THINKING" });
  assert.ok(thinking.gaze && thinking.gaze.y > 0, "thinking looks up");
  const listening = computeExpression({ ...base, state: "LISTENING", userActivityAge: 0.5 });
  assert.ok(listening.headPitch > 0, "listener nods after the user speaks");

  const plan = planPerformance({ segments: [seg("うれしいです！", "Smile", 0.7, "happy")] }, 3);
  const speaking = computeExpression({ ...base, state: "SPEAKING", utteranceTime: 1, cues: plan.cues });
  const idle = computeExpression({ ...base, state: "IDLE" });
  assert.ok(speaking.smile > idle.smile + 0.2, `smile ${speaking.smile}`);
  assert.equal(activeEmotion(plan.cues, 1)?.name, "happy");
});

test("retrieval finds the right knowledge for Japanese questions", () => {
  const docs = builtinKnowledge();
  assert.equal(retrieveKnowledge("AI査読はどういう仕組みですか？", docs)[0]?.doc.id, "peer-review");
  assert.equal(retrieveKnowledge("料金はいくらですか", docs)[0]?.doc.id, "pricing");
  assert.equal(retrieveKnowledge("音声で実験ノートに入力できますか", docs)[0]?.doc.id, "voice-input");
  assert.equal(retrieveKnowledge("データは外部に送信されますか？セキュリティは？", docs)[0]?.doc.id, "security");
  assert.equal(retrieveKnowledge("アカウントの登録方法", docs)[0]?.doc.id, "registration");
  assert.deepEqual(retrieveKnowledge("", docs), []);
});

test("viseme track encodes to fixed-rate byte rows", () => {
  const frames = 60;
  const weights = new Float32Array(frames * VISEME_COUNT);
  for (let f = 0; f < frames; f++) weights[f * VISEME_COUNT + 4] = 1; // "aa"
  const encoded = encodeVisemeTrack({ fps: 60, duration: 1, weights, energy: new Float32Array(frames) }, 30);
  const bytes = Buffer.from(encoded, "base64");
  assert.equal(bytes.length, 30 * VISEME_COUNT);
  assert.equal(bytes[4], 255);
  assert.deepEqual(chunkString("abcdefg", 3), ["abc", "def", "g"]);
});
