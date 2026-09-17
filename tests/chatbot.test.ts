import { test } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowLimiter, clientAddress } from "../src/lib/ai/chatbotRateLimit";
import { assistantSystemPrompt, builtinKnowledge } from "../src/lib/ai/assistantKnowledge";
import { PLAN_LIST } from "../src/lib/billing/plans";
import { SpeechSession } from "../src/lib/voice/webSpeech";

test("limiter allows up to the limit, then refuses with a retry time", () => {
  const limiter = new SlidingWindowLimiter([{ limit: 2, windowMs: 60_000 }]);
  assert.equal(limiter.take("a", 0).ok, true);
  assert.equal(limiter.take("a", 1_000).ok, true);
  const refused = limiter.take("a", 2_000);
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 58);
  // Other callers are unaffected, and the window slides.
  assert.equal(limiter.take("b", 2_000).ok, true);
  assert.equal(limiter.take("a", 60_001).ok, true);
});

test("limiter enforces every window", () => {
  const limiter = new SlidingWindowLimiter([
    { limit: 5, windowMs: 1_000 },
    { limit: 3, windowMs: 10_000 },
  ]);
  for (let i = 0; i < 3; i++) assert.equal(limiter.take("k", i * 2_000).ok, true);
  assert.equal(limiter.take("k", 6_000).ok, false);
});

test("clientAddress takes the first forwarded hop", () => {
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  assert.equal(clientAddress(new Headers({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
  assert.equal(clientAddress(new Headers()), "unknown");
});

test("assistant knowledge lists every plan and core routes", () => {
  const knowledge = builtinKnowledge().map((d) => d.body).join(" ");
  for (const plan of PLAN_LIST) assert.ok(knowledge.includes(plan.name), plan.name);
  for (const route of ["/record", "/analyze", "/peer-review", "/register"]) {
    assert.ok(knowledge.includes(route), route);
  }
  assert.match(assistantSystemPrompt("voice", { signedIn: false, aiPlan: false }), /ログインしていない訪問者/);
  assert.match(assistantSystemPrompt("video", { signedIn: true, aiPlan: true }), /ビデオ通話/);
});

/** Minimal Web Speech stand-in: results are pushed by the test. */
class FakeRecognition extends EventTarget {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: ((e: Event) => void) | null = null;
  onend: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onaudiostart: ((e: Event) => void) | null = null;
  onspeechstart: ((e: Event) => void) | null = null;
  constructor() {
    super();
    FakeRecognition.last = this;
  }
  start() {
    this.onstart?.(new Event("start"));
  }
  /** Like Chrome: the pending phrase is finalized shortly after stop(). */
  stop() {
    setTimeout(() => {
      this.emit([{ text: "こんにちは", isFinal: true }]);
      this.onend?.(new Event("end"));
    }, 20);
  }
  abort() {}
  emit(results: { text: string; isFinal: boolean }[]) {
    const list = results.map((r) => Object.assign([{ transcript: r.text, confidence: 1 }], { isFinal: r.isFinal }));
    this.onresult?.({ resultIndex: 0, results: list });
  }
}

test("finish() waits for the phrase still being recognized", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in g;
  g.window = { SpeechRecognition: FakeRecognition };
  try {
    const states: boolean[] = [];
    const session = new SpeechSession({
      onTranscript: () => {},
      onError: () => {},
      onStateChange: (s) => states.push(s),
      onDead: () => {},
    });
    session.start();
    // Nothing final yet at click time - the old code sent an empty message.
    FakeRecognition.last!.emit([{ text: "こんに", isFinal: false }]);
    const text = await session.finish(1_000);
    assert.equal(text, "こんにちは");
    assert.equal(states.at(-1), false);
  } finally {
    if (hadWindow) g.window = undefined;
    else delete g.window;
  }
});
