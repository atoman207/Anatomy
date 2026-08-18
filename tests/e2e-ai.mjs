/**
 * End-to-end check of the voice memo and literature search pages.
 *
 * The recorder needs a microphone, so Chromium is launched with a synthetic
 * audio device: the browser plays a generated tone into getUserMedia, which
 * exercises the whole record -> upload -> transcribe path without hardware.
 * Transcription of a tone is meaningless, so the transcript itself is entered
 * through the manual-entry path and the structuring step is asserted on that.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const SHOTS = "tmp/e2e-ai";
mkdirSync(SHOTS, { recursive: true });

const problems = [];
let step = 0;
const check = (cond, msg) => { if (!cond) problems.push(msg); };

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["microphone"],
});
const page = await context.newPage();

page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console.error @${page.url()}: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror @${page.url()}: ${e.message}`));
page.on("requestfailed", (r) => {
  const url = r.url();
  const aborted = (r.failure()?.errorText ?? "").includes("ERR_ABORTED");
  if (!url.includes("favicon") && !url.includes("_rsc=") && !aborted) {
    problems.push(`requestfailed ${url}: ${r.failure()?.errorText}`);
  }
});

async function shot(name) {
  step++;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png` });
  console.log(`  [${step}] ${name}`);
}

const TRANSCRIPT =
  "本日8月18日、TMT標識を実施します。サンプルは6検体、トリプシンはロットA123、" +
  "TMTリエージェントはロットB456、担当は山田です。IL-1βで24時間刺激した軟骨細胞を使用します。";

try {
  // ---------- voice memo ----------
  console.log("Voice memo");
  await page.goto(`${BASE}/voice`, { waitUntil: "networkidle" });
  check(await page.locator("h1").innerText() === "音声メモ", "Voice page heading missing");
  await shot("voice-empty");

  // The recorder must offer to record, not report the browser as unsupported.
  check(
    (await page.locator("text=録音開始").count()) > 0,
    "Recorder did not render a record button",
  );

  // Manual transcript entry, so the structuring step is tested deterministically.
  await page.fill("textarea", TRANSCRIPT);
  await page.click('button:has-text("ノートに整形")');
  await page.waitForSelector("text=抽出された項目", { timeout: 90000 });
  await shot("voice-structured");

  const body = await page.locator("body").innerText();
  check(body.includes("Trypsin"), "Katakana トリプシン was not normalized to Trypsin");
  check(body.includes("A123"), "Reagent lot A123 was not extracted");
  check(body.includes("B456"), "Reagent lot B456 was not extracted");
  check(body.includes("山田"), "Operator was not extracted");
  check(body.includes("IL-1β"), "Treatment agent was not extracted");
  // Concentration was never spoken; it must not appear invented.
  check(
    !/濃度\s*[:：]\s*\d/.test(body),
    "A concentration appeared that was never in the transcript",
  );

  // Send to the notebook and confirm it lands there.
  await page.click('button:has-text("ノートへ")');
  await page.waitForTimeout(600);
  await page.goto(`${BASE}/notebook`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=解析ブロック", { timeout: 30000 });
  const notebookText = await page.locator("body").innerText();
  check(notebookText.includes("音声メモ"), "Voice note did not reach the notebook queue");
  await shot("voice-in-notebook");

  // ---------- literature search ----------
  console.log("Literature search");
  await page.goto(`${BASE}/literature`, { waitUntil: "networkidle" });
  check(await page.locator("h1").innerText() === "論文検索", "Literature page heading missing");
  await shot("literature-empty");

  await page.fill("textarea", "軟骨細胞におけるIL-1βとMMP13の関係についての論文");
  await page.click('button:has-text("検索")');
  await page.waitForSelector("text=生成された検索式", { timeout: 120000 });
  await page.waitForSelector("text=検索結果", { timeout: 120000 });
  await shot("literature-results");

  const litText = await page.locator("body").innerText();
  check(litText.includes("PMID"), "No PMIDs rendered in results");
  check(/MMP|MMP13|MMP-13/i.test(litText), "Query does not mention MMP13");

  const resultCount = await page.locator("li:has-text('PMID')").count();
  check(resultCount > 0, `Expected search results, got ${resultCount}`);

  // Every rendered PubMed link must point at a real numeric PMID.
  const links = await page.locator('a[href^="https://pubmed.ncbi.nlm.nih.gov/"]').evaluateAll(
    (as) => as.map((a) => a.getAttribute("href")),
  );
  check(links.length > 0, "No PubMed links rendered");
  const badLinks = links.filter((h) => !/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/?$/.test(h));
  check(badLinks.length === 0, `Malformed PubMed links: ${badLinks.slice(0, 3).join(", ")}`);

  // DOI verification against Crossref.
  await page.click('button:has-text("DOIを照合")');
  await page.waitForSelector("text=DOI 照合済み", { timeout: 90000 });
  await shot("literature-doi-verified");

  console.log("Literature summary");
  await page.click('button:has-text("選択分をAI要約")');
  await page.waitForSelector("text=AI要約", { timeout: 180000 });
  await page.waitForTimeout(500);
  await shot("literature-summary");

  const summaryText = await page.locator("body").innerText();
  check(summaryText.includes("AI要約"), "Summary card did not render");

  // Cited PMIDs in the summary must all exist among the retrieved results.
  const shownPmids = new Set(
    (litText.match(/PMID (\d+)/g) ?? []).map((s) => s.replace("PMID ", "")),
  );
  const summaryLinks = await page
    .locator('a[href^="https://pubmed.ncbi.nlm.nih.gov/"]')
    .evaluateAll((as) => as.map((a) => a.textContent?.trim() ?? ""));
  const citedInSummary = summaryLinks.filter((t) => /^\d+$/.test(t));
  const invented = citedInSummary.filter((p) => !shownPmids.has(p));
  check(
    invented.length === 0,
    `Summary cited PMIDs not present in the results: ${invented.join(", ")}`,
  );
  console.log(`     summary cited ${citedInSummary.length} PMIDs, ${invented.length} outside the result set`);

  await page.click('button:has-text("ノートへ")');
  await page.waitForTimeout(600);
  await page.goto(`${BASE}/notebook`, { waitUntil: "networkidle" });
  const nb = await page.locator("body").innerText();
  check(nb.includes("論文検索"), "Literature block did not reach the notebook");
  await shot("literature-in-notebook");
} catch (e) {
  problems.push(`EXCEPTION: ${e.message}`);
} finally {
  await browser.close();
}

console.log("\n" + "=".repeat(64));
if (problems.length === 0) {
  console.log("AI E2E PASSED — voice structuring and literature search both correct");
} else {
  console.log(`AI E2E FOUND ${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  - " + p);
  process.exitCode = 1;
}
