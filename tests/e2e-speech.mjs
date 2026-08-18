/**
 * End-to-end check of the free browser speech-recognition path.
 *
 * Playwright's Chromium ships without Google's speech API key, so real
 * recognition cannot run here — `start()` produces no events at all. A mock
 * SpeechRecognition is installed before page load instead, emitting the same
 * event shapes Chrome does. That exercises every line this app owns: session
 * lifecycle, transcript accumulation, restart-on-end, the watchdog, and the
 * fallback to the paid engine.
 *
 * What it does NOT prove is Google's transcription accuracy. That needs a real
 * Chrome with a real microphone.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const SHOTS = "tmp/e2e-speech";
mkdirSync(SHOTS, { recursive: true });

const problems = [];
let step = 0;
const check = (cond, msg) => { if (!cond) problems.push(msg); };

/** Installs a controllable fake engine on `window`. */
const MOCK = ({ mode }) => {
  class MockSpeechRecognition extends EventTarget {
    constructor() {
      super();
      this.lang = "";
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
      this.onresult = null;
      this.onaudiostart = null;
      this.onspeechstart = null;
      this._stopped = false;
    }
    start() {
      // "dead" reproduces a Chromium build with no speech backend: the call
      // is accepted and nothing ever happens.
      if (window.__speechMode === "dead") return;
      this._stopped = false;
      setTimeout(() => this.onstart?.(new Event("start")), 10);
      window.__mockRecognition = this;
    }
    stop() {
      this._stopped = true;
      setTimeout(() => this.onend?.(new Event("end")), 10);
    }
    abort() { this._stopped = true; }

    /** Test hook: deliver a results event exactly as Chrome shapes it. */
    __emit(resultIndex, entries) {
      const results = { length: entries.length };
      entries.forEach((e, i) => {
        results[i] = { isFinal: e.final, length: 1, 0: { transcript: e.text, confidence: 0.9 } };
      });
      const ev = new Event("result");
      Object.defineProperty(ev, "resultIndex", { value: resultIndex });
      Object.defineProperty(ev, "results", { value: results });
      this.onresult?.(ev);
    }
    __error(code) {
      const ev = new Event("error");
      Object.defineProperty(ev, "error", { value: code });
      this.onerror?.(ev);
    }
  }
  window.__speechMode = mode;
  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
};

const browser = await chromium.launch();

async function newPage(mode) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error @${page.url()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror @${page.url()}: ${e.message}`));
  await page.addInitScript(MOCK, { mode });
  return page;
}

async function shot(page, name) {
  step++;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png` });
  console.log(`  [${step}] ${name}`);
}

try {
  // ================= working engine =================
  console.log("Browser recognition (working engine)");
  let page = await newPage("ok");
  await page.goto(`${BASE}/voice`, { waitUntil: "networkidle" });

  // The free option must be the default.
  const freeSelected = await page
    .locator('button[aria-pressed="true"]:has-text("ブラウザ音声認識")').count();
  check(freeSelected === 1, "Browser recognition should be selected by default");
  check(
    (await page.locator("text=無料").count()) > 0,
    "The free engine is not labelled as free",
  );
  await shot(page, "engine-choice");

  await page.click('button:has-text("話し始める")');
  await page.waitForTimeout(300);
  check(
    (await page.locator("text=認識中").count()) > 0,
    "Listening indicator did not appear",
  );

  // Interim result, revised, then finalized — as Chrome delivers it.
  await page.evaluate(() => window.__mockRecognition.__emit(0, [{ text: "ほんじつ", final: false }]));
  await page.waitForTimeout(120);
  let shown = await page.locator('[aria-label="認識結果"]').innerText();
  check(shown.includes("ほんじつ"), `Interim text not displayed: ${shown}`);

  await page.evaluate(() =>
    window.__mockRecognition.__emit(0, [{ text: "本日8月18日、TMT標識を実施します。", final: true }]));
  await page.waitForTimeout(120);

  // Second phrase: the results list still holds phrase 0.
  await page.evaluate(() =>
    window.__mockRecognition.__emit(1, [
      { text: "本日8月18日、TMT標識を実施します。", final: true },
      { text: "サンプルは6検体。", final: true },
    ]));
  await page.waitForTimeout(120);

  await page.evaluate(() =>
    window.__mockRecognition.__emit(2, [
      { text: "本日8月18日、TMT標識を実施します。", final: true },
      { text: "サンプルは6検体。", final: true },
      { text: "担当は山田です。", final: true },
    ]));
  await page.waitForTimeout(150);

  shown = await page.locator('[aria-label="認識結果"]').innerText();
  check(shown.includes("TMT標識"), `Missing first phrase: ${shown}`);
  check(shown.includes("6検体"), `Missing second phrase: ${shown}`);
  check(shown.includes("山田"), `Missing third phrase: ${shown}`);
  // The duplication regression: each phrase exactly once.
  check(
    shown.split("TMT標識").length - 1 === 1,
    `First phrase duplicated: ${shown}`,
  );
  check(
    shown.split("サンプルは6検体").length - 1 === 1,
    `Second phrase duplicated: ${shown}`,
  );
  await shot(page, "live-transcript");

  // Stop and confirm the text lands in the editable transcript.
  await page.click('button:has-text("停止して確定")');
  await page.waitForSelector("text=書き起こし", { timeout: 15000 });
  await page.waitForTimeout(400);
  const textareaValue = await page.locator("textarea").first().inputValue();
  check(textareaValue.includes("TMT標識"), `Transcript not committed: ${textareaValue}`);
  check(textareaValue.includes("山田"), "Committed transcript is incomplete");
  check(
    textareaValue.split("TMT標識").length - 1 === 1,
    `Committed transcript duplicated a phrase: ${textareaValue}`,
  );
  await shot(page, "committed");

  // The committed text must feed the existing structuring step.
  await page.click('button:has-text("ノートに整形")');
  await page.waitForSelector("text=抽出された項目", { timeout: 90000 });
  const body = await page.locator("body").innerText();
  check(body.includes("山田"), "Structuring did not pick up the operator");
  check(body.includes("TMT"), "Structuring did not pick up the experiment name");
  await shot(page, "structured-from-speech");
  await page.context().close();

  // ================= permission denied =================
  console.log("Permission denied");
  page = await newPage("ok");
  await page.goto(`${BASE}/voice`, { waitUntil: "networkidle" });
  await page.click('button:has-text("話し始める")');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__mockRecognition.__error("not-allowed"));
  await page.waitForTimeout(300);
  const denied = await page.locator("body").innerText();
  check(denied.includes("マイクの使用が許可されていません"), "Permission error not surfaced");
  await shot(page, "permission-denied");
  await page.context().close();

  // ================= dead engine → fallback =================
  console.log("Dead engine falls back");
  page = await newPage("dead");
  await page.goto(`${BASE}/voice`, { waitUntil: "networkidle" });
  await page.click('button:has-text("話し始める")');
  // The watchdog fires at 4s.
  await page.waitForTimeout(6000);
  const fell = await page.locator("body").innerText();
  check(
    fell.includes("応答しません") || fell.includes("OpenAI"),
    "A non-functional engine did not report itself",
  );
  const openaiSelected = await page
    .locator('button[aria-pressed="true"]:has-text("OpenAI")').count();
  check(openaiSelected === 1, "Did not fall back to the OpenAI engine");
  await shot(page, "dead-engine-fallback");
  await page.context().close();

  // ================= unsupported browser =================
  console.log("Unsupported browser");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bare = await ctx.newPage();
  bare.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await bare.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await bare.goto(`${BASE}/voice`, { waitUntil: "networkidle" });
  // The server renders the optimistic "supported" case; the real answer
  // arrives on the first client read, so wait for it rather than sampling
  // the DOM at whatever moment networkidle happens to fire.
  await bare
    .waitForSelector("text=対応していません", { timeout: 15000 })
    .catch(() => problems.push("An unsupported browser was not told so"));
  const unsupported = await bare.locator("body").innerText();
  check(
    unsupported.includes("OpenAI"),
    "No alternative offered to an unsupported browser",
  );
  await shot(bare, "unsupported-browser");
  await ctx.close();
} catch (e) {
  problems.push(`EXCEPTION: ${e.message}`);
} finally {
  await browser.close();
}

console.log("\n" + "=".repeat(64));
if (problems.length === 0) {
  console.log("SPEECH E2E PASSED — live transcript, commit, errors and fallbacks all correct");
} else {
  console.log(`SPEECH E2E FOUND ${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  - " + p);
  process.exitCode = 1;
}
