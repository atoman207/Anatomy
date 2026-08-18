import "server-only";

/**
 * Crossref client, used to verify and enrich DOI metadata.
 *
 * PubMed is the source of record for which papers exist; Crossref answers
 * "does this DOI resolve, and does its metadata agree?". That check is what
 * catches a mistyped or fabricated DOI before it reaches a manuscript.
 */

const BASE = "https://api.crossref.org";

export interface CrossrefWork {
  doi: string;
  title: string;
  containerTitle: string | null;
  authors: string[];
  published: string | null;
  year: number | null;
  volume: string | null;
  issue: string | null;
  page: string | null;
  publisher: string | null;
  type: string | null;
  referenceCount: number | null;
  citedByCount: number | null;
  url: string;
}

function mailto(): string | undefined {
  return process.env.CROSSREF_MAILTO || process.env.NCBI_EMAIL || undefined;
}

async function get(url: URL, timeoutMs = 20_000): Promise<Response> {
  // Supplying mailto puts the request in Crossref's "polite pool", which is
  // faster and less likely to be throttled.
  const address = mailto();
  if (address) url.searchParams.set("mailto", address);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": `chondro/0.1 (mailto:${address ?? "unknown"})`,
      },
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Crossref への要求がタイムアウトしました。");
    }
    throw new Error("Crossref に接続できません。");
  } finally {
    clearTimeout(timer);
  }
}

function toWork(item: Record<string, unknown>): CrossrefWork {
  const parts = (item["published-print"] ?? item["published-online"] ?? item.published) as
    | { "date-parts"?: number[][] }
    | undefined;
  const dateParts = parts?.["date-parts"]?.[0] ?? [];
  const year = typeof dateParts[0] === "number" ? dateParts[0] : null;
  const published = dateParts.length
    ? dateParts.map((n) => String(n).padStart(2, "0")).join("-").replace(/^(\d{2})(\d{2})/, "$1$2")
    : null;

  const authors = ((item.author ?? []) as { given?: string; family?: string }[])
    .map((a) => [a.family, a.given].filter(Boolean).join(" "))
    .filter(Boolean);

  return {
    doi: String(item.DOI ?? ""),
    title: Array.isArray(item.title) ? String(item.title[0] ?? "") : "",
    containerTitle: Array.isArray(item["container-title"])
      ? String((item["container-title"] as string[])[0] ?? "") || null
      : null,
    authors,
    published: year ? (published ?? String(year)) : null,
    year,
    volume: (item.volume as string) ?? null,
    issue: (item.issue as string) ?? null,
    page: (item.page as string) ?? null,
    publisher: (item.publisher as string) ?? null,
    type: (item.type as string) ?? null,
    referenceCount: typeof item["reference-count"] === "number" ? item["reference-count"] : null,
    citedByCount:
      typeof item["is-referenced-by-count"] === "number" ? item["is-referenced-by-count"] : null,
    url: `https://doi.org/${String(item.DOI ?? "")}`,
  };
}

/** Looks up one DOI. Returns null when it does not resolve. */
export async function lookupDoi(doi: string): Promise<CrossrefWork | null> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (!clean) return null;

  const url = new URL(`${BASE}/works/${encodeURIComponent(clean)}`);
  const res = await get(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crossref lookup failed (HTTP ${res.status})`);

  const body = await res.json();
  return body?.message ? toWork(body.message) : null;
}

export interface DoiVerification {
  doi: string;
  resolves: boolean;
  work: CrossrefWork | null;
  /** True when the Crossref title broadly agrees with the expected one. */
  titleMatches: boolean | null;
  note: string;
}

/**
 * Confirms a DOI resolves and that its title agrees with what PubMed said.
 *
 * Comparison is deliberately loose - punctuation, case and markup differ
 * between the two indexes for the same paper - so it flags genuine
 * disagreement rather than formatting noise.
 */
export async function verifyDoi(
  doi: string,
  expectedTitle?: string,
): Promise<DoiVerification> {
  try {
    const work = await lookupDoi(doi);
    if (!work) {
      return {
        doi, resolves: false, work: null, titleMatches: null,
        note: "この DOI は Crossref で解決できませんでした。",
      };
    }
    if (!expectedTitle) {
      return { doi, resolves: true, work, titleMatches: null, note: "解決しました。" };
    }
    const a = normalizeTitle(work.title);
    const b = normalizeTitle(expectedTitle);
    const matches = a.length > 0 && b.length > 0 && (a === b || a.includes(b) || b.includes(a));
    return {
      doi, resolves: true, work, titleMatches: matches,
      note: matches
        ? "解決し、タイトルも一致しました。"
        : "解決しましたが、タイトルが一致しません。確認してください。",
    };
  } catch (e) {
    return {
      doi, resolves: false, work: null, titleMatches: null,
      note: e instanceof Error ? e.message : "確認に失敗しました。",
    };
  }
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, " ")
    .trim();
}

/** Free-text bibliographic search. Noisier than PubMed; use as a supplement. */
export async function searchCrossref(
  query: string,
  rows = 10,
): Promise<CrossrefWork[]> {
  const url = new URL(`${BASE}/works`);
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(Math.min(50, Math.max(1, rows))));
  url.searchParams.set("select", [
    "DOI", "title", "container-title", "author", "published-print",
    "published-online", "volume", "issue", "page", "publisher", "type",
    "reference-count", "is-referenced-by-count",
  ].join(","));

  const res = await get(url);
  if (!res.ok) throw new Error(`Crossref search failed (HTTP ${res.status})`);
  const body = await res.json();
  return (body?.message?.items ?? []).map(toWork);
}
