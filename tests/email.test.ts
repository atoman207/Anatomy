import test from "node:test";
import assert from "node:assert/strict";

import { EMAIL_RE, htmlToText, parseAddressList } from "../src/lib/email/compose";
import { renderTemplate } from "../src/lib/email/smtp";

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
