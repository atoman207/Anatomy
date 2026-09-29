/**
 * What a bulk message must carry to reach an inbox rather than a spam folder,
 * expressed as pure functions over text.
 *
 * Three separate requirements land here because they are all "things the body
 * and headers must say":
 *
 *   - Gmail and Yahoo's bulk-sender rules (in force since February 2024) want
 *     a working `List-Unsubscribe`, and one-click (RFC 8058) where the sender
 *     can tell recipients apart.
 *   - The Japanese 特定電子メール法 requires advertising mail to name the
 *     sender, give a postal address and a contact, and state how to opt out -
 *     in the body, not only in a header.
 *   - Filters weigh the body itself: links pointing somewhere other than the
 *     sender's own domain, shorteners, image-only messages and the usual
 *     advertising vocabulary all cost reputation.
 *
 * The first two are satisfied by appending a footer; the third is advisory,
 * so `lintMessage` reports rather than refuses - an administrator writing
 * "無料" in a legitimate announcement should be warned, not blocked.
 *
 * Pure and env-free by design: every value is passed in, so the rules are
 * testable without a mailbox (tests/emailCompliance.test.ts).
 */

/** The unsubscribe routes offered for one message. */
export interface UnsubscribeLinks {
  /** HTTPS endpoint - required for one-click. */
  url?: string;
  /** Address that accepts an unsubscribe request by mail. */
  mailto?: string;
  /**
   * True only when `url` identifies a single recipient, which is what
   * `List-Unsubscribe-Post` promises: the provider POSTs it with no human
   * involved, so it cannot be a page that asks "which address?".
   */
  oneClick: boolean;
}

/** Who the mail is from, as the law requires it to be stated. */
export interface SenderIdentity {
  /** Service or organisation name, e.g. "LABNOTE". */
  name: string;
  /** Operating entity, when it differs from the service name. */
  operator?: string;
  /** Postal address - 特定電子メール法 requires one for advertising mail. */
  postalAddress?: string;
  /** Public site, shown so the recipient can place the sender. */
  siteUrl?: string;
  /** Where a human reply goes. */
  contact?: string;
}

const RULE = "──────────────────────────────";

/**
 * `List-Unsubscribe`, and its one-click companion.
 *
 * Both headers, not one: mail clients show the "unsubscribe" button from
 * `List-Unsubscribe`, while `List-Unsubscribe-Post` is the promise that the
 * HTTPS entry can be POSTed with nobody watching (RFC 8058) - which is what
 * Gmail and Yahoo's bulk-sender rules ask for. It is only ever sent when the
 * URL identifies one recipient: promising one-click for a page that has to
 * ask "which address?" would break the button rather than satisfy the rule.
 */
export function unsubscribeHeaders(
  links: UnsubscribeLinks,
): Record<string, string> | undefined {
  const entries: string[] = [];
  if (links.url) entries.push(`<${links.url}>`);
  if (links.mailto) entries.push(`<mailto:${links.mailto}?subject=unsubscribe>`);
  if (entries.length === 0) return undefined;

  const headers: Record<string, string> = { "List-Unsubscribe": entries.join(", ") };
  if (links.oneClick && links.url) {
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return headers;
}

/**
 * The plain-text footer.
 *
 * Kept short and unadorned: this is the part a filter reads for the sender's
 * identity and the way out, and a recipient reads when they have had enough.
 */
export function footerText(sender: SenderIdentity, links: UnsubscribeLinks): string {
  const lines: string[] = [RULE];
  lines.push(sender.operator ? `${sender.name}（運営: ${sender.operator}）` : sender.name);
  if (sender.postalAddress) lines.push(sender.postalAddress);
  if (sender.siteUrl) lines.push(sender.siteUrl);
  if (sender.contact) lines.push(`お問い合わせ: ${sender.contact}`);
  if (links.url || links.mailto) {
    lines.push("");
    lines.push("このメールの配信を停止する:");
    if (links.url) lines.push(links.url);
    if (links.mailto) {
      lines.push(
        links.url
          ? `（メールで停止する場合は ${links.mailto} 宛に空メールをお送りください）`
          : `${links.mailto} 宛に空メールをお送りください`,
      );
    }
  }
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The same footer for an HTML body. Inline styles only - mail clients strip <style>. */
export function footerHtml(sender: SenderIdentity, links: UnsubscribeLinks): string {
  const line = (html: string) => `<div>${html}</div>`;
  const parts: string[] = [];
  parts.push(
    line(
      `<strong>${escapeHtml(
        sender.operator ? `${sender.name}（運営: ${sender.operator}）` : sender.name,
      )}</strong>`,
    ),
  );
  if (sender.postalAddress) parts.push(line(escapeHtml(sender.postalAddress)));
  if (sender.siteUrl) {
    parts.push(line(`<a href="${escapeHtml(sender.siteUrl)}">${escapeHtml(sender.siteUrl)}</a>`));
  }
  if (sender.contact) {
    parts.push(
      line(
        `お問い合わせ: <a href="mailto:${escapeHtml(sender.contact)}">${escapeHtml(sender.contact)}</a>`,
      ),
    );
  }
  if (links.url) {
    parts.push(
      line(
        `<a href="${escapeHtml(links.url)}" style="color:#475569">このメールの配信を停止する</a>`,
      ),
    );
  } else if (links.mailto) {
    parts.push(
      line(
        `配信停止: <a href="mailto:${escapeHtml(links.mailto)}?subject=unsubscribe">${escapeHtml(links.mailto)}</a>`,
      ),
    );
  }
  return (
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;` +
    `color:#64748b;font-size:12px;line-height:1.7">${parts.join("")}</div>`
  );
}

/* ------------------------------------------------------------------ */
/* Pre-send inspection                                                 */
/* ------------------------------------------------------------------ */

export interface EmailWarning {
  code: string;
  message: string;
}

/** URL shorteners: filters treat a hidden destination as one. */
const SHORTENERS = [
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "is.gd", "ow.ly", "buff.ly",
  "cutt.ly", "rebrand.ly", "lnkd.in", "t.ly", "x.gd", "shorturl.at", "urx.nu",
];

/**
 * Advertising vocabulary that raises a message's spam score in Japanese mail.
 * Not forbidden words - an announcement may legitimately say 無料 - which is
 * why every hit is a warning and none of them stops a send.
 */
const SPAM_PHRASES = [
  "無料", "今すぐ", "限定", "当選", "儲か", "稼げ", "副業", "必ず", "保証",
  "クリックしてください", "urgent", "act now", "free!!", "click here",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Every http(s) URL in the body, markup or not. */
export function extractUrls(body: string): string[] {
  return body.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];
}

/**
 * Registrable domain, roughly: the last two labels, or three for the common
 * Japanese second-level domains (co.jp, or.jp, …). Enough to tell
 * "mail.labnote.site" and "labnote.site" apart from "example.com", which is
 * all this is asked to do.
 */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split(".");
  if (parts.length <= 2) return parts.join(".");
  const secondLevel = ["co", "or", "ne", "ac", "go", "com", "net", "org", "gov", "edu"];
  const tail = parts.slice(-3);
  if (parts.length >= 3 && secondLevel.includes(tail[1])) return tail.join(".");
  return parts.slice(-2).join(".");
}

export interface LintInput {
  subject: string;
  body: string;
  format: "text" | "html";
  /** The From address, so links can be compared against the sending domain. */
  senderAddress?: string | null;
}

/**
 * Everything about a draft that a receiving filter is likely to hold against
 * it. Advisory: the administrator decides, and the send proceeds either way.
 */
export function lintMessage(input: LintInput): EmailWarning[] {
  const warnings: EmailWarning[] = [];
  const urls = extractUrls(input.body);
  const senderDomain = input.senderAddress?.split("@")[1]?.toLowerCase() ?? null;

  if (senderDomain) {
    const senderSite = registrableDomain(senderDomain);
    const foreign = new Set<string>();
    for (const url of urls) {
      const host = hostOf(url);
      if (!host) continue;
      if (registrableDomain(host) !== senderSite) foreign.add(host);
    }
    if (foreign.size > 0) {
      warnings.push({
        code: "link-domain-mismatch",
        message:
          `本文のリンク先（${[...foreign].slice(0, 3).join("、")}）が差出人ドメイン ${senderSite} と異なります。` +
          "差出人と同じドメインのURLにすると迷惑メール判定されにくくなります。",
      });
    }
  }

  const shortened = urls.filter((u) => {
    const host = hostOf(u);
    return !!host && SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`));
  });
  if (shortened.length > 0) {
    warnings.push({
      code: "shortened-link",
      message: "短縮URLが含まれています。リンク先が隠れるため、迷惑メール判定の強い要因になります。",
    });
  }

  const insecure = urls.filter((u) => u.toLowerCase().startsWith("http://"));
  if (insecure.length > 0) {
    warnings.push({
      code: "insecure-link",
      message: `http:// のリンクが ${insecure.length} 件あります。https:// にしてください。`,
    });
  }

  if (input.format === "html") {
    const images = (input.body.match(/<img\b/gi) ?? []).length;
    const textLength = input.body.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (images > 0 && textLength < 200) {
      warnings.push({
        code: "image-heavy",
        message:
          "画像が中心で本文テキストが少ない構成です。画像だけのメールは開封前に迷惑メールへ振り分けられやすいため、" +
          "本文の文章量を増やしてください。",
      });
    }
  }

  const haystack = `${input.subject}\n${input.body}`.toLowerCase();
  const hits = SPAM_PHRASES.filter((p) => haystack.includes(p.toLowerCase()));
  if (hits.length >= 2) {
    warnings.push({
      code: "spam-vocabulary",
      message: `広告メールでよく使われる語（${hits.slice(0, 4).join("、")}）が含まれています。表現を控えめにすると安全です。`,
    });
  }

  if (/[!！]{2,}|[?？]{2,}/.test(input.subject)) {
    warnings.push({
      code: "subject-punctuation",
      message: "件名に「!」「?」の連続があります。1つに減らしてください。",
    });
  }
  if ([...input.subject].length > 60) {
    warnings.push({
      code: "subject-length",
      message: `件名が ${[...input.subject].length} 文字あります。60文字以内だと途中で切れず、開封率も上がります。`,
    });
  }

  return warnings;
}
