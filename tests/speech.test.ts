import test from "node:test";
import assert from "node:assert/strict";

import {
  applyResult, joinJapanese, fullTranscript, classifyError,
  EMPTY_TRANSCRIPT, type TranscriptState,
} from "../src/lib/voice/webSpeech";

/**
 * Builds a recognition event the way the browser delivers it: the results list
 * holds every phrase of the session so far, and `resultIndex` marks where the
 * new material begins.
 */
function event(
  resultIndex: number,
  entries: { text: string; final: boolean }[],
): { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string; confidence: number } } } } {
  const results: Record<string, unknown> = { length: entries.length };
  entries.forEach((e, i) => {
    results[String(i)] = {
      isFinal: e.final,
      length: 1,
      0: { transcript: e.text, confidence: 0.9 },
    };
  });
  return { resultIndex, results: results as never };
}

/* ------------------------------------------------------------------ */
/* Joining                                                             */
/* ------------------------------------------------------------------ */

test("Japanese fragments join without inserted spaces", () => {
  // Spaces between Japanese segments would put gaps inside sentences.
  assert.equal(joinJapanese("本日は", "TMT標識を実施します"), "本日はTMT標識を実施します");
  assert.equal(joinJapanese("サンプルは", "6検体です"), "サンプルは6検体です");
});

test("Latin words on both sides keep a separating space", () => {
  assert.equal(joinJapanese("Trypsin", "Lot A123"), "Trypsin Lot A123");
  assert.equal(joinJapanese("the sample", "was measured"), "the sample was measured");
});

test("a Japanese/Latin boundary needs no space", () => {
  assert.equal(joinJapanese("担当は", "Yamada"), "担当はYamada");
  assert.equal(joinJapanese("IL-1β", "で刺激した"), "IL-1βで刺激した");
});

test("joining tolerates empty sides and trims the seam", () => {
  assert.equal(joinJapanese("", "本日"), "本日");
  assert.equal(joinJapanese("本日", ""), "本日");
  assert.equal(joinJapanese("", ""), "");
  assert.equal(joinJapanese("本日  ", "  実施"), "本日実施");
});

/* ------------------------------------------------------------------ */
/* Accumulation                                                        */
/* ------------------------------------------------------------------ */

test("interim text is replaced, not appended, as a phrase is revised", () => {
  let state: TranscriptState = EMPTY_TRANSCRIPT;
  state = applyResult(state, event(0, [{ text: "ほん", final: false }]));
  assert.equal(state.interim, "ほん");
  state = applyResult(state, event(0, [{ text: "本日", final: false }]));
  assert.equal(state.interim, "本日");
  state = applyResult(state, event(0, [{ text: "本日8月", final: false }]));
  assert.equal(state.interim, "本日8月");
  // Nothing has been committed yet.
  assert.equal(state.final, "");
});

test("a finalized phrase moves into final and clears interim", () => {
  let state: TranscriptState = EMPTY_TRANSCRIPT;
  state = applyResult(state, event(0, [{ text: "本日TMT標識を実施します", final: false }]));
  state = applyResult(state, event(0, [{ text: "本日TMT標識を実施します。", final: true }]));
  assert.equal(state.final, "本日TMT標識を実施します。");
  assert.equal(state.interim, "");
});

/**
 * The regression this guards: the event carries the whole result list, so
 * appending all of it on each event repeats every phrase already committed.
 */
test("earlier phrases are not re-appended on later events", () => {
  let state: TranscriptState = EMPTY_TRANSCRIPT;

  state = applyResult(state, event(0, [{ text: "第一文。", final: true }]));
  assert.equal(state.final, "第一文。");

  // Second event: results still contains phrase 0, but resultIndex is 1.
  state = applyResult(
    state,
    event(1, [{ text: "第一文。", final: true }, { text: "第二文。", final: true }]),
  );
  assert.equal(state.final, "第一文。第二文。");

  state = applyResult(
    state,
    event(2, [
      { text: "第一文。", final: true },
      { text: "第二文。", final: true },
      { text: "第三文。", final: true },
    ]),
  );
  assert.equal(state.final, "第一文。第二文。第三文。");
  // Each sentence appears exactly once.
  assert.equal(state.final.split("第一文。").length - 1, 1);
  assert.equal(state.final.split("第二文。").length - 1, 1);
});

test("a single event carrying both final and interim parts is split correctly", () => {
  const state = applyResult(
    EMPTY_TRANSCRIPT,
    event(0, [
      { text: "確定した文。", final: true },
      { text: "まだ途中", final: false },
    ]),
  );
  assert.equal(state.final, "確定した文。");
  assert.equal(state.interim, "まだ途中");
});

test("fullTranscript shows committed and in-progress text together", () => {
  const state: TranscriptState = { final: "本日は", interim: "TMT標識" };
  assert.equal(fullTranscript(state), "本日はTMT標識");
  assert.equal(fullTranscript({ final: "本日は", interim: "" }), "本日は");
  assert.equal(fullTranscript(EMPTY_TRANSCRIPT), "");
});

test("a realistic dictation accumulates exactly once per phrase", () => {
  const phrases = [
    "本日8月18日、TMT標識を実施します。",
    "サンプルは6検体。",
    "TrypsinはLot A123。",
    "担当は山田です。",
  ];
  let state: TranscriptState = EMPTY_TRANSCRIPT;
  const committed: { text: string; final: boolean }[] = [];

  phrases.forEach((phrase, index) => {
    // Interim updates while speaking, then a final result.
    state = applyResult(state, event(index, [...committed, { text: phrase.slice(0, 3), final: false }]));
    state = applyResult(state, event(index, [...committed, { text: phrase, final: true }]));
    committed.push({ text: phrase, final: true });
  });

  assert.equal(state.interim, "");
  assert.equal(state.final, phrases.join(""));
  for (const p of phrases) {
    assert.equal(state.final.split(p).length - 1, 1, `"${p}" appeared more than once`);
  }
});

test("an event with no alternatives is ignored rather than crashing", () => {
  const broken = { resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 0 } } };
  const state = applyResult(EMPTY_TRANSCRIPT, broken as never);
  assert.equal(state.final, "");
  assert.equal(state.interim, "");
});

/* ------------------------------------------------------------------ */
/* Error classification                                                */
/* ------------------------------------------------------------------ */

test("routine pauses are recoverable so dictation continues", () => {
  // Chrome ends recognition after a silence; that must not look like a fault.
  assert.equal(classifyError("no-speech").recoverable, true);
  assert.equal(classifyError("aborted").recoverable, true);
});

test("permission and hardware failures are not silently retried", () => {
  const denied = classifyError("not-allowed");
  assert.equal(denied.kind, "not-allowed");
  assert.equal(denied.recoverable, false);
  assert.ok(denied.message.includes("マイク"));

  const noMic = classifyError("audio-capture");
  assert.equal(noMic.kind, "no-microphone");
  assert.equal(noMic.recoverable, false);
});

test("a network failure points at the paid fallback", () => {
  // This is what a Chromium build without Google's speech key reports.
  const net = classifyError("network");
  assert.equal(net.kind, "network");
  assert.equal(net.recoverable, false);
  assert.ok(net.message.includes("OpenAI"), net.message);
});

test("service-not-allowed is treated as a permission problem", () => {
  assert.equal(classifyError("service-not-allowed").kind, "not-allowed");
});

test("an unknown code still yields an actionable message", () => {
  const unknown = classifyError("some-future-code");
  assert.equal(unknown.kind, "unknown");
  assert.ok(unknown.message.includes("some-future-code"));
});
