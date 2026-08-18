/**
 * End-to-end smoke test: drives the real UI and fails on any console error,
 * page error, or failed request. Run against a started server:
 *   npx next start -p 3210 &  node tests/e2e.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const SHOTS = "tmp/e2e";
mkdirSync(SHOTS, { recursive: true });

const problems = [];
let step = 0;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console.error @${page.url()}: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror @${page.url()}: ${e.message}`));
page.on("requestfailed", (r) => {
  const url = r.url();
  // Next cancels in-flight RSC prefetches when you navigate away; that shows
  // up as ERR_ABORTED and is not a failure. Favicon noise is not either.
  const benign = url.includes("favicon") || url.includes("_rsc=");
  if (!benign) problems.push(`requestfailed ${url}: ${r.failure()?.errorText}`);
});

async function shot(name) {
  step++;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png`, fullPage: false });
  console.log(`  [${step}] ${name}`);
}

async function go(path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (!res || res.status() >= 400) problems.push(`${path} -> HTTP ${res?.status()}`);
}

try {
  // ---------- dashboard ----------
  console.log("Dashboard");
  await go("/");
  await page.waitForSelector("text=chondro");
  await shot("dashboard");

  // ---------- organize: paste filenames ----------
  console.log("Organize");
  await go("/organize");
  const names = [
    "Control_1.raw", "Control_2.raw", "Control_3.raw",
    "IL1b_1.raw", "IL1b_2.raw", "IL1b_3.raw",
    "TNFa_1.raw", "TNFa_2.raw", "TNFa_3.raw",
  ].join("\n");
  await page.fill("textarea", names);
  await page.click("text=追加 / Add pasted names");
  await page.waitForSelector("text=File inventory");
  await shot("organize-inventory");

  // Scope to the inventory card; the page also renders a group-summary table.
  const inventoryCard = page.locator("section").filter({ hasText: "File inventory" }).last();
  const fileCount = await inventoryCard.locator("tbody tr").count();
  if (fileCount !== 9) problems.push(`Expected 9 inventory rows, got ${fileCount}`);

  // sample sheet tab
  await page.click('button[role="tab"]:has-text("サンプルシート")');
  await page.waitForSelector("text=Sample sheet");
  await shot("organize-samplesheet");
  const groupsText = await page.locator("text=Group composition").count();
  if (groupsText === 0) problems.push("Group composition card missing");

  // rename tab
  await page.click('button[role="tab"]:has-text("ファイル名変更")');
  await page.waitForSelector("text=Rename rules");
  await shot("organize-rename");

  // ---------- analyze: demo data ----------
  console.log("Analyze");
  await go("/analyze");
  await page.click("text=デモデータ / Load demo data");
  await page.waitForSelector("text=Preprocessing", { timeout: 30000 });
  await shot("analyze-import");

  const featureTile = await page.locator("text=Features").first().isVisible();
  if (!featureTile) problems.push("Feature count tile missing after demo load");

  // statistics
  await page.click('button[role="tab"]:has-text("統計解析")');
  await page.waitForSelector("text=解析手法 / Method", { timeout: 30000 });
  await page.waitForSelector("text=Differential", { timeout: 30000 });
  await shot("analyze-differential");

  const upTile = await page.locator("text=Up").first().isVisible();
  if (!upTile) problems.push("Differential result tiles missing");

  // ANOVA
  await page.click('button:has-text("ANOVA")');
  await page.waitForSelector("text=ANOVA table", { timeout: 60000 });
  await shot("analyze-anova");

  // PCA
  await page.click('button:has-text("PCA")');
  await page.waitForSelector("text=Explained variance", { timeout: 60000 });
  await shot("analyze-pca");

  // clustering
  await page.click('button:has-text("クラスタリング")');
  await page.waitForSelector("text=k-means", { timeout: 60000 });
  await shot("analyze-cluster");

  // t-test
  await page.click('button:has-text("t検定")');
  await page.waitForSelector("text=All features", { timeout: 60000 });
  await shot("analyze-ttest");

  // ---------- figures ----------
  console.log("Figures");
  await page.click('button[role="tab"]:has-text("図作成")');
  await page.waitForSelector("svg", { timeout: 60000 });
  await page.waitForTimeout(600);
  await shot("figure-volcano");
  const volcanoPts = await page.locator("svg circle").count();
  if (volcanoPts < 50) problems.push(`Volcano rendered only ${volcanoPts} points`);

  await page.click('button:has-text("Heatmap")');
  await page.waitForTimeout(1200);
  await shot("figure-heatmap");
  const cells = await page.locator("svg rect").count();
  if (cells < 100) problems.push(`Heatmap rendered only ${cells} rects`);

  await page.click('button:has-text("PCA plot")');
  await page.waitForTimeout(900);
  await shot("figure-pca");

  // send a figure to the notebook
  await page.click("text=ノートへ / To notebook");

  // ---------- notebook ----------
  console.log("Notebook");
  await go("/notebook");
  await page.waitForSelector("text=プレビュー / Preview");
  await page.fill("#f-experiment_name", "TMT labeling");
  await page.fill("#f-operator", "山田");
  await page.waitForTimeout(400);
  await shot("notebook");

  const previewText = await page.locator(".prose-note").innerText();
  if (!previewText.includes("TMT labeling")) problems.push("Notebook preview did not pick up the experiment name");
  if (!previewText.includes("山田")) problems.push("Notebook preview did not pick up the operator");

  // template switch
  await page.selectOption("select", { index: 1 });
  await page.waitForTimeout(400);
  await shot("notebook-template2");

  // ---------- experiments / login ----------
  console.log("Auth pages");
  await go("/experiments");
  await shot("experiments");
  await go("/login");
  await shot("login");
} catch (e) {
  problems.push(`EXCEPTION: ${e.message}`);
} finally {
  await browser.close();
}

console.log("\n" + "=".repeat(60));
if (problems.length === 0) {
  console.log("E2E PASSED — no console errors, no failed requests, all assertions ok");
} else {
  console.log(`E2E FOUND ${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  - " + p);
  process.exitCode = 1;
}
