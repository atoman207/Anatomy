import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISEMES,
  analyzeSpeechAudio,
  emptyFrame,
  sampleTrack,
  textVisemeTrack,
  type PcmSource,
} from "../src/lib/voice/lipSync";

const RATE = 24_000;
const idx = (v: (typeof VISEMES)[number]) => VISEMES.indexOf(v);

/** Glottal-pulse-like harmonics shaped by two formant resonances. */
function vowel(seconds: number, f1: number, f2: number, amp = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const f0 = 210;
  for (let h = 1; h * f0 < 5000; h++) {
    const f = h * f0;
    const g = Math.exp(-(((f - f1) / 110) ** 2)) + 0.7 * Math.exp(-(((f - f2) / 160) ** 2)) + 0.01;
    for (let i = 0; i < out.length; i++) out[i] += g * Math.sin((2 * Math.PI * f * i) / RATE);
  }
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < out.length; i++) out[i] *= amp / peak;
  return out;
}

function pcm(...parts: Float32Array[]): PcmSource {
  const length = parts.reduce((s, p) => s + p.length, 0);
  const data = new Float32Array(length);
  let o = 0;
  for (const p of parts) {
    data.set(p, o);
    o += p.length;
  }
  return { sampleRate: RATE, numberOfChannels: 1, length, getChannelData: () => data };
}

const silence = (s: number) => new Float32Array(Math.round(s * RATE));

function dominant(track: ReturnType<typeof analyzeSpeechAudio>, time: number) {
  const f = sampleTrack(track, time, emptyFrame());
  let best = 0;
  for (let v = 1; v < VISEMES.length; v++) if (f.weights[v] > f.weights[best]) best = v;
  return { viseme: VISEMES[best], frame: f };
}

test("silence keeps the mouth closed", () => {
  const track = analyzeSpeechAudio(pcm(silence(1)));
  const f = sampleTrack(track, 0.5, emptyFrame());
  assert.ok(f.weights[idx("sil")] > 0.95);
});

test("speech opens the mouth and distinguishes open from rounded vowels", () => {
  const track = analyzeSpeechAudio(
    pcm(silence(0.3), vowel(0.5, 850, 1450), silence(0.4), vowel(0.5, 500, 950), silence(0.3)),
  );
  const a = dominant(track, 0.55);
  const o = dominant(track, 1.45);
  assert.equal(a.viseme, "aa");
  assert.equal(o.viseme, "O");
  assert.ok(a.frame.weights[idx("sil")] < 0.5, "mouth should be open during /a/");
  assert.ok(sampleTrack(track, 1.0, emptyFrame()).weights[idx("sil")] > 0.7, "closed between vowels");
});

test("short gaps inside speech become lip closures", () => {
  const track = analyzeSpeechAudio(pcm(vowel(0.4, 850, 1450), silence(0.07), vowel(0.4, 850, 1450)));
  const f = sampleTrack(track, 0.435, emptyFrame());
  assert.ok(f.weights[idx("PP")] > 0.4, `PP=${f.weights[idx("PP")]}`);
});

test("text track follows kana vowels and pauses at punctuation", () => {
  const track = textVisemeTrack("あいう。お");
  assert.ok(track.duration > 0.8 && track.duration < 1.5);
  // Each char's start time is monotonic for boundary re-anchoring.
  for (let i = 1; i < track.charTimes.length; i++) {
    assert.ok(track.charTimes[i] >= track.charTimes[i - 1]);
  }
  const mid = (i: number) => (track.charTimes[i] + track.charTimes[i + 1]) / 2 + 0.03;
  assert.equal(dominant(track, mid(0)).viseme, "aa");
  assert.equal(dominant(track, mid(1)).viseme, "I");
  assert.equal(dominant(track, mid(2)).viseme, "U");
});

test("katakana and the long-vowel mark map like hiragana", () => {
  const track = textVisemeTrack("ケー");
  const t = (track.charTimes[1] + track.charTimes[2]) / 2;
  assert.equal(dominant(track, t).viseme, "E");
});
