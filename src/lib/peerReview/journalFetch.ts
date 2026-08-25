import "server-only";

/**
 * Fetches a researcher-supplied "submit to this journal" URL and reduces it
 * to readable text, so the format-match check (see
 * src/lib/ai/journalFormatCheck.ts) has something to compare the manuscript
 * against besides the URL string itself.
 *
 * This is the one place in the app that fetches a URL typed by a user rather
 * than one this app constructed itself (PubMed/Crossref calls always target
 * a fixed, known host). That makes it the one place that needs an SSRF
 * guard: block the request before it leaves the server if the URL points at
 * a loopback/private/link-local address. This blocks the common case (an
 * obviously internal target) by inspecting the literal hostname; it does not
 * defend against DNS rebinding (a public hostname whose A record resolves to
 * a private address at fetch time), which would need pinning the connection
 * to a pre-resolved IP - out of scope for what is, in the end, a best-effort
 * "does this look like it matches the journal's format" convenience check.
 */

export class JournalFetchError extends Error {}

const MAX_BYTES = 400_000;
const MAX_TEXT_CHARS = 8_000;
const FETCH_TIMEOUT_MS = 8_000;

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

function isBlockedIpLiteral(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/** Throws JournalFetchError if the URL is malformed or points somewhere disallowed. */
export function assertFetchableJournalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JournalFetchError("ジャーナルのURLの形式が正しくありません。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new JournalFetchError("ジャーナルのURLは http または https で始めてください。");
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || isBlockedIpLiteral(hostname)) {
    throw new JournalFetchError("このURLは取得できません。");
  }
  return url;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface JournalPageText {
  url: string;
  text: string;
  truncated: boolean;
}

/** Fetches the page and returns a plain-text excerpt suitable for a prompt. */
export async function fetchJournalPageText(rawUrl: string): Promise<JournalPageText> {
  const url = assertFetchableJournalUrl(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; chondro-journal-check/1.0)" },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new JournalFetchError("ジャーナルのページの取得がタイムアウトしました。");
    }
    throw new JournalFetchError(
      `ジャーナルのページを取得できませんでした: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new JournalFetchError(`ジャーナルのページを取得できませんでした（HTTP ${res.status}）。`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new JournalFetchError("このURLはHTMLページではないため、内容を確認できません。");
  }

  const buf = await res.arrayBuffer();
  const bytes = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const text = stripHtml(raw);

  if (!text) {
    throw new JournalFetchError("ジャーナルのページから本文を抽出できませんでした。");
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  return { url: url.toString(), text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
}
