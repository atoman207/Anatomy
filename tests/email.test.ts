import test from "node:test";
import assert from "node:assert/strict";

import { EMAIL_RE, htmlToText, parseAddressList } from "../src/lib/email/compose";
import { renderTemplate, usesPlaceholders } from "../src/lib/email/smtp";
import {
  chunk, isRateLimitError, isTransientError, maxMessagesPerHour,
  maxRecipientsPerMessage, messagesNeeded,
  DEFAULT_MAX_MESSAGES_PER_HOUR, PROVIDER_MAX_RECIPIENTS_PER_MESSAGE,
} from "../src/lib/email/limits";

/**
 * The administrator mailer sends real mail to real people, and the mistakes
 * that matter there are quiet ones: an address list split wrongly, a
 * placeholder left unsubstituted in someone's inbox, or an HTML announcement
 * whose plain-text part is a wall of markup. Those three are pinned here.
 */

/* ------------------------------------------------------------------ */
/* Address lists                                                       */
/* ------------------------------------------------------------------ */

test("an address list splits on every separator an administrator might paste", () => {
  const pasted = "a@example.com, b@example.com;c@example.com\nd@example.com e@example.com";
  assert.deepEqual(parseAddressList(pasted), [
    "a@example.com",
    "b@example.com",
    "c@example.com",
    "d@example.com",
    "e@example.com",
  ]);
});

test("addresses are lowercased and de-duplicated", () => {
  assert.deepEqual(
    parseAddressList("Person@Example.com, person@example.com\n PERSON@EXAMPLE.COM "),
    ["person@example.com"],
  );
});

test("an empty or whitespace-only list yields no addresses", () => {
  for (const raw of ["", "   ", "\n\n", " , ; \n"]) {
    assert.deepEqual(parseAddressList(raw), [], JSON.stringify(raw));
  }
});

test("splitting does not judge validity - that is the caller's job", () => {
  // The UI shows which entries were rejected, so they have to survive the split.
  assert.deepEqual(parseAddressList("good@example.com, not-an-address"), [
    "good@example.com",
    "not-an-address",
  ]);
});

test("the address pattern accepts ordinary addresses and rejects malformed ones", () => {
  for (const ok of ["a@b.co", "first.last+tag@sub.example.co.jp", "user_name@example.com"]) {
    assert.equal(EMAIL_RE.test(ok), true, ok);
  }
  for (const bad of ["plain", "no-at.example.com", "a@b", "a@@b.com", "a b@example.com", "@example.com"]) {
    assert.equal(EMAIL_RE.test(bad), false, bad);
  }
});

/* ------------------------------------------------------------------ */
/* Per-recipient substitution                                          */
/* ------------------------------------------------------------------ */

test("{{name}} and {{email}} are substituted per recipient", () => {
  const out = renderTemplate("{{name}} 様（{{email}}）へ", {
    email: "hanako@example.com",
    name: "山田 花子",
  });
  assert.equal(out, "山田 花子 様（hanako@example.com）へ");
});

test("a recipient with no name falls back to the local part of the address", () => {
  assert.equal(renderTemplate("{{name}}", { email: "hanako@example.com" }), "hanako");
  assert.equal(renderTemplate("{{name}}", { email: "hanako@example.com", name: null }), "hanako");
  assert.equal(renderTemplate("{{name}}", { email: "hanako@example.com", name: "  " }), "hanako");
});

test("placeholders are substituted everywhere they appear, spacing and all", () => {
  const out = renderTemplate("{{name}}/{{ name }}/{{name}}", {
    email: "x@example.com",
    name: "Ada",
  });
  assert.equal(out, "Ada/Ada/Ada");
});

test("a body with no placeholders is left exactly as written", () => {
  const body = "メンテナンスのお知らせ\n\n{ not a placeholder }";
  assert.equal(renderTemplate(body, { email: "x@example.com", name: "Ada" }), body);
});

/* ------------------------------------------------------------------ */
/* HTML to plain text                                                  */
/* ------------------------------------------------------------------ */

test("the plain-text fallback keeps the shape of an HTML announcement", () => {
  const html = "<h2>お知らせ</h2><p>本日<br>メンテナンスを行います。</p><ul><li>1つ目</li><li>2つ目</li></ul>";
  assert.equal(
    htmlToText(html),
    "お知らせ\n本日\nメンテナンスを行います。\n1つ目\n2つ目",
  );
});

test("the plain-text fallback carries no markup through", () => {
  const text = htmlToText('<a href="https://example.com">こちら</a>をご覧ください。');
  assert.equal(text, "こちらをご覧ください。");
  assert.equal(text.includes("<"), false);
  assert.equal(text.includes("href"), false);
});

test("HTML entities are decoded, and a doubly-escaped entity decodes only once", () => {
  assert.equal(htmlToText("<p>A&nbsp;&amp;&nbsp;B</p>"), "A & B");
  assert.equal(htmlToText("<p>&quot;引用&quot; &lt;tag&gt;</p>"), '"引用" <tag>');
  // "&amp;lt;" is a literal "&lt;" the author wanted shown, not a nested tag.
  assert.equal(htmlToText("<p>&amp;lt;</p>"), "&lt;");
});

test("runs of blank lines collapse rather than padding the message out", () => {
  assert.equal(htmlToText("<p>A</p><p></p><p></p><p>B</p>"), "A\n\nB");
});

/* ------------------------------------------------------------------ */
/* Provider limits and batching                                        */
/* ------------------------------------------------------------------ */

test("the recipients-per-message setting never exceeds the provider's hard cap", () => {
  // Namecheap rejects a message addressed to more than 50 across To/Cc/Bcc,
  // so a generous configured value has to be clamped rather than obeyed.
  assert.equal(
    maxRecipientsPerMessage({ SMTP_MAX_RECIPIENTS_PER_MESSAGE: "500" }),
    PROVIDER_MAX_RECIPIENTS_PER_MESSAGE,
  );
  assert.equal(
    maxRecipientsPerMessage({ SMTP_MAX_RECIPIENTS_PER_MESSAGE: "30" }),
    30,
  );
});

test("limits fall back to the trial-plan defaults when unset or nonsense", () => {
  for (const env of [
    {},
    { SMTP_MAX_MESSAGES_PER_HOUR: "" },
    { SMTP_MAX_MESSAGES_PER_HOUR: "0" },
    { SMTP_MAX_MESSAGES_PER_HOUR: "-5" },
    { SMTP_MAX_MESSAGES_PER_HOUR: "abc" },
  ]) {
    assert.equal(
      maxMessagesPerHour(env),
      DEFAULT_MAX_MESSAGES_PER_HOUR,
      JSON.stringify(env),
    );
  }
  // Guessing high is what produced the 369 rejections, so the default has to
  // be the low figure and an upgrade has to be explicit.
  assert.equal(
    maxMessagesPerHour({ SMTP_MAX_MESSAGES_PER_HOUR: "500" }),
    500,
  );
});

test("chunking covers every recipient exactly once, with no empty batch", () => {
  const recipients = Array.from({ length: 389 }, (_, i) => `user${i}@example.com`);
  const batches = chunk(recipients, 45);
  assert.equal(batches.length, 9);
  assert.deepEqual(batches.flat(), recipients);
  assert.equal(batches.every((b) => b.length > 0 && b.length <= 45), true);
});

test("chunking handles the edges rather than dividing by zero", () => {
  assert.deepEqual(chunk([], 45), []);
  assert.deepEqual(chunk(["a"], 45), [["a"]]);
  // A zero or negative size would otherwise loop forever.
  assert.deepEqual(chunk(["a", "b"], 0), [["a"], ["b"]]);
});

test("the message count is what the hourly limit is spent on, not the headcount", () => {
  // The incident in one line: 389 recipients is 389 messages unbatched, which
  // cannot fit in a 20/hour mailbox, but only 9 messages when batched by 45.
  assert.equal(messagesNeeded(389, 1), 389);
  assert.equal(messagesNeeded(389, 45), 9);
  assert.equal(messagesNeeded(0, 45), 0);
  assert.equal(messagesNeeded(45, 45), 1);
  assert.equal(messagesNeeded(46, 45), 2);
});

/* ------------------------------------------------------------------ */
/* Recognising a throttled sender                                      */
/* ------------------------------------------------------------------ */

test("the provider's hourly rejection is recognised as throttling", () => {
  // Verbatim from the failed 389-recipient send.
  const actual =
    "Data command failed: 554 5.7.1 <DATA>: Data command rejected: Reject: too many messages from sender in last 60 minutes";
  assert.equal(isRateLimitError(actual), true);
  // Must also be treated as retryable-later, never as a dead address.
  assert.equal(isTransientError(actual), true);
});

test("other providers' throttling wording is recognised too", () => {
  for (const message of [
    "421 4.7.0 Too many messages from this sender",
    "450 Requested action aborted: rate limit exceeded",
    "550 Sending limit exceeded for this account",
    "452 4.5.3 Too many recipients",
    "Throttled: please retry later",
  ]) {
    assert.equal(isRateLimitError(message), true, message);
  }
});

test("a bad address is not mistaken for throttling", () => {
  // These must fail the recipient and let the rest of the campaign continue,
  // rather than stopping the run as a rate limit does.
  for (const message of [
    "550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown",
    "553 5.1.3 Bad recipient address syntax",
    "5.7.1 Message rejected due to content",
  ]) {
    assert.equal(isRateLimitError(message), false, message);
  }
});

test("connection trouble is retryable but is not throttling", () => {
  for (const message of ["ETIMEDOUT", "ECONNRESET", "socket close", "dns lookup failed"]) {
    assert.equal(isTransientError(message), true, message);
    assert.equal(isRateLimitError(message), false, message);
  }
});

/* ------------------------------------------------------------------ */
/* Batching vs personalisation                                         */
/* ------------------------------------------------------------------ */

test("a draft using placeholders cannot be batched", () => {
  // One Bcc message carries one body, so {{name}} forces individual sends -
  // this is the check that decides delivery mode.
  assert.equal(usesPlaceholders("{{name}} 様", "本文"), true);
  assert.equal(usesPlaceholders("お知らせ", "{{ email }} 宛"), true);
  assert.equal(usesPlaceholders("お知らせ", "本文のみ"), false);
  assert.equal(usesPlaceholders(undefined, undefined), false);
  // A lone brace pair is not a placeholder.
  assert.equal(usesPlaceholders("{name}", "{{other}}"), false);
});
