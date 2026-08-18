/**
 * End-to-end check of login and the administration area.
 *
 * Drives the real UI against a running server, and asserts both that
 * permitted actions work and that forbidden ones are refused.
 *
 *   node tmp/seed-e2e.mjs          # create the disposable accounts
 *   npx next start -p 3210 &
 *   node tests/e2e-auth.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const SHOTS = "tmp/e2e-auth";
mkdirSync(SHOTS, { recursive: true });

const ADMIN = { email: "e2e-admin@example.com", password: "e2e-Passw0rd!" };
const MEMBER = { email: "e2e-member@example.com", password: "e2e-Passw0rd!" };
const LAB_NAME = `E2E Lab ${Date.now()}`;

const problems = [];
let step = 0;

function check(condition, message) {
  if (!condition) problems.push(message);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

let expectAuthFailure = false;
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // The deliberate wrong-password step makes Supabase return 400, which the
  // browser logs. That is the API behaving correctly, not a defect.
  if (expectAuthFailure && m.text().includes("400")) return;
  problems.push(`console.error @${page.url()}: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror @${page.url()}: ${e.message}`));
page.on("requestfailed", (r) => {
  const url = r.url();
  // ERR_ABORTED means a navigation or prefetch was superseded - normal during
  // form submits and redirects, not a failed request.
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

async function signIn({ email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

async function signOut() {
  await page.goto(`${BASE}/admin/account`, { waitUntil: "networkidle" });
  await page.click("text=ログアウト");
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 20000 });
}

try {
  // ---------- signed out: admin is not reachable ----------
  console.log("Signed-out access control");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check(
    page.url().includes("/login"),
    `Signed-out /admin should redirect to /login, landed on ${page.url()}`,
  );
  check(page.url().includes("next="), "Redirect should preserve the intended destination");
  await shot("signed-out-redirect");

  // ---------- bad credentials are refused ----------
  console.log("Rejecting bad credentials");
  await page.fill("#email", ADMIN.email);
  expectAuthFailure = true;
  await page.fill("#password", "definitely-the-wrong-password");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  check(page.url().includes("/login"), "A wrong password must not sign anyone in");
  const errorVisible = await page.locator("text=続行できません").count();
  check(errorVisible > 0, "A failed sign-in should show an error");
  await shot("bad-password");
  expectAuthFailure = false;

  // ---------- sign in as the platform admin ----------
  console.log("Signing in as platform admin");
  await signIn(ADMIN);
  await shot("signed-in");

  const meAdmin = await page.evaluate(async () => {
    const r = await fetch("/api/me", { cache: "no-store" });
    return r.json();
  });
  check(meAdmin.signedIn === true, "/api/me should report a signed-in session");
  check(meAdmin.isPlatformAdmin === true, "Test admin should be a platform admin");
  check(meAdmin.canAccessAdmin === true, "Platform admin should reach the admin area");

  // ---------- admin area ----------
  console.log("Admin area");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check(page.url().endsWith("/admin"), `Admin overview should load, got ${page.url()}`);
  check((await page.locator("text=システム管理者").count()) > 0, "Platform admin badge missing");
  await shot("admin-overview");

  // ---------- create a laboratory ----------
  console.log("Creating a laboratory");
  await page.goto(`${BASE}/admin/labs`, { waitUntil: "networkidle" });
  await page.fill('input[name="name"]', LAB_NAME);
  await page.click('button:has-text("作成")');
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "networkidle" });
  check(
    (await page.locator(`text=${LAB_NAME}`).count()) > 0,
    "The new laboratory should appear in the list",
  );
  await shot("lab-created");

  // ---------- add a member ----------
  console.log("Adding a member");
  await page.goto(`${BASE}/admin/members`, { waitUntil: "networkidle" });
  await page.fill("#member-email", MEMBER.email);
  await page.selectOption('select[name="role"]', "member");
  await page.click('button:has-text("追加")');
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "networkidle" });
  check(
    (await page.locator(`text=${MEMBER.email}`).count()) > 0,
    "The added member should appear in the roster",
  );
  await shot("member-added");

  // ---------- audit log recorded it ----------
  console.log("Audit log");
  await page.goto(`${BASE}/admin/audit`, { waitUntil: "networkidle" });
  const auditText = await page.locator("body").innerText();
  check(auditText.includes("lab.created"), "Audit log should record lab.created");
  check(auditText.includes("member.added"), "Audit log should record member.added");
  await shot("audit-log");

  // ---------- platform user list ----------
  console.log("User management");
  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  const usersText = await page.locator("body").innerText();
  check(usersText.includes(ADMIN.email), "User list should include the admin");
  check(usersText.includes(MEMBER.email), "User list should include the member");
  await shot("users");

  // ---------- account page ----------
  await page.goto(`${BASE}/admin/account`, { waitUntil: "networkidle" });
  check(
    (await page.locator(`text=${ADMIN.email}`).count()) > 0,
    "Account page should show the signed-in address",
  );
  await shot("account");

  // ---------- sign out ----------
  console.log("Signing out");
  await signOut();
  const meOut = await page.evaluate(async () => {
    const r = await fetch("/api/me", { cache: "no-store" });
    return r.json();
  });
  check(meOut.signedIn === false, "/api/me should report signed out after sign-out");
  await shot("signed-out");

  // ---------- a plain member is denied the platform pages ----------
  console.log("Member permissions");
  await signIn(MEMBER);
  const meMember = await page.evaluate(async () => {
    const r = await fetch("/api/me", { cache: "no-store" });
    return r.json();
  });
  check(meMember.signedIn === true, "Member should be signed in");
  check(
    meMember.isPlatformAdmin === false,
    "A plain member must NOT be a platform admin",
  );
  check(
    meMember.canAccessAdmin === false,
    "A plain member (role: member) must not reach the admin area",
  );

  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  check(
    !page.url().includes("/admin/users"),
    `A member must be redirected away from /admin/users, landed on ${page.url()}`,
  );
  await shot("member-denied");

  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check(
    !page.url().startsWith(`${BASE}/admin`) || page.url().includes("denied"),
    `A member must not reach /admin, landed on ${page.url()}`,
  );
  await shot("member-denied-admin");
} catch (e) {
  problems.push(`EXCEPTION: ${e.message}`);
} finally {
  await browser.close();
}

console.log("\n" + "=".repeat(64));
if (problems.length === 0) {
  console.log("AUTH E2E PASSED — sign-in, admin actions and permission denials all correct");
} else {
  console.log(`AUTH E2E FOUND ${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  - " + p);
  process.exitCode = 1;
}
