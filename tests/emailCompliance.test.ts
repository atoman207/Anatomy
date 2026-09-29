import assert from "node:assert/strict";
import test from "node:test";

import {
  extractUrls, footerHtml, footerText, lintMessage, registrableDomain, unsubscribeHeaders,
  type SenderIdentity, type UnsubscribeLinks,
} from "../src/lib/email/compliance";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../src/lib/email/token";
import { warmupState, emailProvider, maxMessagesPerHour } from "../src/lib/email/limits";

/**
 * What has to hold for a broadcast to reach an inbox: a signed opt-out link
 * that survives a round trip, a footer that names the sender, a warm-up ramp
 * that actually binds, and a linter that recognises what filters penalise.
 */

const SECRET = { EMAIL_UNSUBSCRIBE_SECRET: "test-secret-value" };

const SENDER: SenderIdentity = {
  name: "LABNOTE",
  operator: "テスト運営",
  postalAddress: "〒100-0001 東京都千代田区1-1-1",
  siteUrl: "https://labnote.site",
  contact: "contact@labnote.site",
};

/* ---- Unsubscribe tokens ---- */

test("a signed token round-trips to the address it was issued for", () => {
  const token = signUnsubscribeToken("Reader@Example.com", SECRET);
  assert.ok(token);
  assert.equal(verifyUnsubscribeToken(token, SECRET), "reader@example.com");
});

test("a token signed with another secret is rejected", () => {
  const token = signUnsubscribeToken("reader@example.com", SECRET);
  assert.equal(verifyUnsubscribeToken(token, { EMAIL_UNSUBSCRIBE_SECRET: "other" }), null);
});

test("a tampered address does not verify", () => {
  const token = signUnsubscribeToken("reader@example.com", SECRET)!;
  const [, mac] = token.split(".");
  const forged = `${Buffer.from("victim@example.com").toString("base64url")}.${mac}`;
  assert.equal(verifyUnsubscribeToken(forged, SECRET), null);
});

test("malformed tokens are refused rather than throwing", () => {
  for (const bad of ["", "nodot", "a.b", null, 42, "x".repeat(600)]) {
    assert.equal(verifyUnsubscribeToken(bad, SECRET), null);
  }
});

test("no secret means no link, rather than an unsigned one", () => {
  assert.equal(signUnsubscribeToken("reader@example.com", {}), null);
});

/* ---- Headers ---- */

test("a per-recipient link earns the one-click header; both routes are offered", () => {
  const headers = unsubscribeHeaders({
    url: "https://labnote.site/api/email/unsubscribe?t=abc",
    mailto: "contact@labnote.site",
    oneClick: true,
  })!;
  assert.equal(
    headers["List-Unsubscribe"],
    "<https://labnote.site/api/email/unsubscribe?t=abc>, <mailto:contact@labnote.site?subject=unsubscribe>",
  );
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("a Bcc batch keeps the button but never promises one-click", () => {
  // Nothing in the URL says who to remove, so a provider POSTing it could
  // only guess - the header would be a broken promise.
  const headers = unsubscribeHeaders({
    url: "https://labnote.site/unsubscribe",
    mailto: "contact@labnote.site",
    oneClick: false,
  })!;
  assert.match(headers["List-Unsubscribe"], /^<https:\/\/labnote\.site\/unsubscribe>, <mailto:/);
  assert.equal("List-Unsubscribe-Post" in headers, false);
});

test("with no way out configured, no header is invented", () => {
  assert.equal(unsubscribeHeaders({ oneClick: false }), undefined);
  // oneClick without a URL cannot be honoured either.
  assert.equal(unsubscribeHeaders({ oneClick: true }), undefined);
});

/* ---- Footer ---- */

test("the footer names the sender and both ways out", () => {
  const links: UnsubscribeLinks = {
    url: "https://labnote.site/api/email/unsubscribe?t=abc",
    mailto: "contact@labnote.site",
    oneClick: true,
  };
  const text = footerText(SENDER, links);
  assert.match(text, /LABNOTE（運営: テスト運営）/);
  assert.match(text, /東京都千代田区/);
  assert.match(text, /配信を停止する/);
  assert.ok(text.includes(links.url!));
  assert.ok(text.includes(links.mailto!));
});

test("the HTML footer escapes what it interpolates", () => {
  const html = footerHtml(
    { name: 'Lab "X" <script>', siteUrl: "https://labnote.site" },
    { oneClick: false },
  );
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("a batch with no per-recipient link still offers the mailto route", () => {
  const text = footerText(SENDER, { mailto: "contact@labnote.site", oneClick: false });
  assert.match(text, /contact@labnote\.site/);
});

/* ---- Warm-up ---- */

test("the warm-up ramp raises the daily ceiling as the domain ages", () => {
  const start = "2026-09-01";
  const capOn = (day: number) =>
    warmupState({ EMAIL_WARMUP_START: start }, new Date(Date.UTC(2026, 8, day))).dailyCap;

  assert.equal(capOn(1), 50);
  assert.equal(capOn(3), 100);
  assert.equal(capOn(6), 200);
  assert.equal(capOn(12), 500);
  // Day 29 is past the last step: the ramp stops binding entirely.
  assert.equal(
    warmupState({ EMAIL_WARMUP_START: start }, new Date(Date.UTC(2026, 8, 30))).dailyCap,
    null,
  );
});

test("no warm-up date configured means no daily ceiling", () => {
  const state = warmupState({});
  assert.equal(state.active, false);
  assert.equal(state.dailyCap, null);
});

test("a future or unparseable start date cannot lift the ceiling", () => {
  const future = warmupState({ EMAIL_WARMUP_START: "2099-01-01" }, new Date(Date.UTC(2026, 8, 1)));
  assert.equal(future.day, 1);
  assert.equal(future.dailyCap, 50);
  assert.equal(warmupState({ EMAIL_WARMUP_START: "not-a-date" }).dailyCap, null);
});

/* ---- Provider selection ---- */

test("an API key switches broadcasts to the API sender, and EMAIL_PROVIDER overrides", () => {
  assert.equal(emailProvider({}), "smtp");
  assert.equal(emailProvider({ RESEND_API_KEY: "re_x" }), "resend");
  assert.equal(emailProvider({ RESEND_API_KEY: "re_x", EMAIL_PROVIDER: "smtp" }), "smtp");
});

test("the hourly default follows the provider rather than the mailbox's trial limit", () => {
  assert.equal(maxMessagesPerHour({}), 20);
  assert.equal(maxMessagesPerHour({ RESEND_API_KEY: "re_x" }), 100);
  // An explicit setting still wins over both.
  assert.equal(maxMessagesPerHour({ RESEND_API_KEY: "re_x", SMTP_MAX_MESSAGES_PER_HOUR: "7" }), 7);
});

/* ---- Draft inspection ---- */

test("links pointing off the sending domain are reported", () => {
  const warnings = lintMessage({
    subject: "お知らせ",
    body: "詳しくは https://anatomy-two-azure.vercel.app/notebook をご覧ください。",
    format: "text",
    senderAddress: "contact@labnote.site",
  });
  assert.ok(warnings.some((w) => w.code === "link-domain-mismatch"));
});

test("a subdomain of the sending domain is not a mismatch", () => {
  const warnings = lintMessage({
    subject: "お知らせ",
    body: "https://mail.labnote.site/news をご覧ください。",
    format: "text",
    senderAddress: "news@labnote.site",
  });
  assert.equal(warnings.filter((w) => w.code === "link-domain-mismatch").length, 0);
});

test("shorteners and plain-http links are each called out", () => {
  const warnings = lintMessage({
    subject: "お知らせ",
    body: "https://bit.ly/abc と http://labnote.site/x",
    format: "text",
    senderAddress: "contact@labnote.site",
  });
  const codes = warnings.map((w) => w.code);
  assert.ok(codes.includes("shortened-link"));
  assert.ok(codes.includes("insecure-link"));
});

test("an image-only HTML body is flagged, a written one is not", () => {
  const imageOnly = lintMessage({
    subject: "お知らせ",
    body: '<p><img src="https://labnote.site/a.png"></p>',
    format: "html",
    senderAddress: "contact@labnote.site",
  });
  assert.ok(imageOnly.some((w) => w.code === "image-heavy"));

  const written = lintMessage({
    subject: "お知らせ",
    body: `<p><img src="https://labnote.site/a.png"></p><p>${"実験記録の更新についてお知らせします。".repeat(12)}</p>`,
    format: "html",
    senderAddress: "contact@labnote.site",
  });
  assert.equal(written.filter((w) => w.code === "image-heavy").length, 0);
});

test("one advertising word is tolerated, a pile of them is not", () => {
  const ordinary = lintMessage({
    subject: "新機能のお知らせ",
    body: "無料プランでもお使いいただけます。",
    format: "text",
    senderAddress: "contact@labnote.site",
  });
  assert.equal(ordinary.filter((w) => w.code === "spam-vocabulary").length, 0);

  const loud = lintMessage({
    subject: "今すぐ無料で登録！！",
    body: "限定キャンペーン。必ず稼げる副業です。クリックしてください。",
    format: "text",
    senderAddress: "contact@labnote.site",
  });
  const codes = loud.map((w) => w.code);
  assert.ok(codes.includes("spam-vocabulary"));
  assert.ok(codes.includes("subject-punctuation"));
});

test("a plain announcement from the sending domain passes clean", () => {
  const warnings = lintMessage({
    subject: "9月のアップデートについて",
    body: "実験ノートの記録画面を更新しました。詳細は https://labnote.site/help をご覧ください。",
    format: "text",
    senderAddress: "contact@labnote.site",
  });
  assert.deepEqual(warnings, []);
});

/* ---- Helpers the rules are built on ---- */

test("URLs are extracted without trailing punctuation or markup", () => {
  assert.deepEqual(extractUrls('見る: <a href="https://labnote.site/a">こちら</a>'), [
    "https://labnote.site/a",
  ]);
});

test("registrable domains cope with the Japanese second-level ones", () => {
  assert.equal(registrableDomain("mail.labnote.site"), "labnote.site");
  assert.equal(registrableDomain("news.example.co.jp"), "example.co.jp");
  assert.equal(registrableDomain("example.com"), "example.com");
});
