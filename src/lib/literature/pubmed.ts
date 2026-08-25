import "server-only";

/**
 * NCBI E-utilities client.
 *
 * Every record this app shows comes from here, not from a model. A language
 * model asked for "ten relevant papers" will produce ten plausible citations,
 * some of which will not exist; the model's only job in this feature is to
 * turn a question into a query string, which is then executed against the real
 * index.
 */

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export interface PubMedArticle {
  pmid: string;
  title: string;
  journal: string;
  pubDate: string;
  year: number | null;
  authors: string[];
  doi: string | null;
  pmcid: string | null;
  abstract: string | null;
  publicationTypes: string[];
  url: string;
  doiUrl: string | null;
  /** Bibliographic detail needed for a proper reference-list citation. */
  volume: string | null;
  issue: string | null;
  pages: string | null;
}

export interface PubMedSearchResult {
  query: string;
  translatedQuery: string | null;
  total: number;
  articles: PubMedArticle[];
  notes: string[];
}

function identity(): { email?: string; apiKey?: string } {
  return {
    email: process.env.NCBI_EMAIL || undefined,
    apiKey: process.env.NCBI_API_KEY || undefined,
  };
}

/**
 * NCBI asks callers to identify themselves and caps unauthenticated traffic at
 * 3 requests/second (10 with a key). Every call carries tool+email so this
 * app is a good citizen rather than an anonymous scraper.
 */
function withIdentity(url: URL): URL {
  const { email, apiKey } = identity();
  url.searchParams.set("tool", "chondro");
  if (email) url.searchParams.set("email", email);
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url;
}

async function get(url: URL, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(withIdentity(url), {
      signal: controller.signal,
      headers: {
        "User-Agent": `chondro/0.1 (${identity().email ?? "research tool"})`,
      },
      cache: "no-store",
    });
    return res;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("PubMed への要求がタイムアウトしました。");
    }
    throw new Error(
      e instanceof Error ? `PubMed に接続できません: ${e.message}` : "PubMed に接続できません。",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface PubMedSearchOptions {
  term: string;
  retmax?: number;
  sort?: "relevance" | "pub_date" | "Author" | "JournalName";
  /** Restrict to the last N years. */
  yearsBack?: number;
  minYear?: number;
  maxYear?: number;
  includeAbstracts?: boolean;
  /**
   * Limit to papers with at least one author affiliated with a Japanese
   * institution, via PubMed's own `[Affiliation]` field - a real index term,
   * not a post-hoc guess from journal name or language. A hard filter rather
   * than a "boost": re-ranking without it would need a second unfiltered
   * query to compare against, doubling latency for no accuracy PubMed's own
   * index doesn't already give us for free.
   */
  restrictJapan?: boolean;
}

/** Runs esearch, then esummary, then optionally efetch for abstracts. */
export async function searchPubMed(
  opts: PubMedSearchOptions,
): Promise<PubMedSearchResult> {
  const notes: string[] = [];
  const retmax = Math.min(50, Math.max(1, opts.retmax ?? 20));

  let term = opts.term.trim();
  if (!term) {
    return { query: "", translatedQuery: null, total: 0, articles: [], notes: ["検索式が空です。"] };
  }

  // Date filtering is expressed in the query itself, which is what PubMed's
  // own advanced search does.
  const now = new Date().getFullYear();
  const min = opts.minYear ?? (opts.yearsBack ? now - opts.yearsBack + 1 : undefined);
  const max = opts.maxYear ?? (min ? now : undefined);
  if (min && max) {
    term = `(${term}) AND ("${min}"[Date - Publication] : "${max}"[Date - Publication])`;
  }
  if (opts.restrictJapan) {
    term = `(${term}) AND Japan[Affiliation]`;
  }

  const searchUrl = new URL(`${BASE}/esearch.fcgi`);
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("term", term);
  searchUrl.searchParams.set("retmax", String(retmax));
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("sort", opts.sort ?? "relevance");

  const searchRes = await get(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`PubMed 検索に失敗しました (HTTP ${searchRes.status})`);
  }
  const searchBody = await searchRes.json();
  const result = searchBody.esearchresult;

  if (result?.ERROR) {
    return {
      query: term, translatedQuery: null, total: 0, articles: [],
      notes: [`PubMed からのエラー: ${result.ERROR}`],
    };
  }

  const ids: string[] = result?.idlist ?? [];
  const total = Number(result?.count ?? 0);
  const translated: string | null = result?.querytranslation ?? null;

  if (Array.isArray(result?.warninglist?.phrasesnotfound) &&
      result.warninglist.phrasesnotfound.length) {
    notes.push(
      `一致しなかった語: ${result.warninglist.phrasesnotfound.join(", ")}`,
    );
  }
  if (ids.length === 0) {
    return { query: term, translatedQuery: translated, total, articles: [], notes };
  }
  if (total > ids.length) {
    notes.push(`全 ${total.toLocaleString()} 件中 ${ids.length} 件を表示しています。`);
  }

  const { articles, notes: hydrateNotes } = await hydrateArticles(ids, opts.includeAbstracts !== false);
  notes.push(...hydrateNotes);

  return { query: term, translatedQuery: translated, total, articles, notes };
}

/**
 * Turns a bare list of PMIDs into full records: esummary for bibliographic
 * detail, efetch for abstracts. The two calls depend only on the id list, not
 * on each other, so they run concurrently rather than one after the other -
 * this is the main latency win over the old sequential version, since efetch
 * (25s timeout) was previously paid in full on top of esummary's own round
 * trip even though nothing here needs the summary before fetching abstracts.
 */
async function hydrateArticles(
  ids: string[],
  includeAbstracts: boolean,
): Promise<{ articles: PubMedArticle[]; notes: string[] }> {
  const notes: string[] = [];

  const summaryUrl = new URL(`${BASE}/esummary.fcgi`);
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("id", ids.join(","));
  summaryUrl.searchParams.set("retmode", "json");

  const [summaryRes, abstracts] = await Promise.all([
    get(summaryUrl),
    includeAbstracts
      ? fetchAbstracts(ids).catch(() => {
          // Abstracts are an enhancement; a failure here should not lose the hits.
          notes.push("抄録の取得に失敗しました。書誌情報のみ表示しています。");
          return new Map<string, string>();
        })
      : Promise.resolve(new Map<string, string>()),
  ]);

  if (!summaryRes.ok) {
    throw new Error(`PubMed の書誌取得に失敗しました (HTTP ${summaryRes.status})`);
  }
  const summaryBody = await summaryRes.json();

  const articles: PubMedArticle[] = [];
  for (const pmid of ids) {
    const a = summaryBody.result?.[pmid];
    if (!a) continue;
    const articleIds: { idtype: string; value: string }[] = a.articleids ?? [];
    const doi = articleIds.find((x) => x.idtype === "doi")?.value ?? null;
    const pmcid = articleIds.find((x) => x.idtype === "pmcid")?.value ?? null;
    const pubDate: string = a.pubdate ?? a.sortpubdate ?? "";
    const yearMatch = pubDate.match(/\d{4}/);

    articles.push({
      pmid,
      title: stripTags(a.title ?? "(no title)"),
      journal: a.fulljournalname || a.source || "",
      pubDate,
      year: yearMatch ? Number(yearMatch[0]) : null,
      authors: (a.authors ?? [])
        .filter((x: { authtype?: string }) => x.authtype === "Author")
        .map((x: { name: string }) => x.name),
      doi,
      pmcid,
      abstract: abstracts.get(pmid) ?? null,
      publicationTypes: a.pubtype ?? [],
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      doiUrl: doi ? `https://doi.org/${doi}` : null,
      volume: a.volume || null,
      issue: a.issue || null,
      pages: a.pages || a.elocationid || null,
    });
  }

  return { articles, notes };
}

export interface SimilarArticlesResult {
  sourcePmid: string;
  total: number;
  articles: PubMedArticle[];
  notes: string[];
}

/**
 * Papers PubMed itself considers related to one already-known article, via
 * ELink's `neighbor_score` - the same "similar articles" ranking PubMed's own
 * site shows, computed from term-weighted content similarity across the whole
 * index rather than a keyword re-search. No model call: turning "find similar
 * papers" into a fresh free-text query is exactly the kind of plausible-but-
 * unverified step `searchPubMed`'s own module doc warns against, and it would
 * also cost the query-builder's ~60s round trip for no accuracy gain over an
 * algorithm NCBI already runs and ranks by score. This is why the feature is
 * both faster and more accurate than re-querying: one extra HTTP call, using
 * NCBI's own relevance judgment instead of an LLM's guess at good search terms.
 */
export async function findSimilarArticles(
  pmid: string,
  opts: { retmax?: number } = {},
): Promise<SimilarArticlesResult> {
  const retmax = Math.min(50, Math.max(1, opts.retmax ?? 10));

  const linkUrl = new URL(`${BASE}/elink.fcgi`);
  linkUrl.searchParams.set("dbfrom", "pubmed");
  linkUrl.searchParams.set("db", "pubmed");
  linkUrl.searchParams.set("id", pmid);
  linkUrl.searchParams.set("cmd", "neighbor_score");
  linkUrl.searchParams.set("retmode", "json");

  const linkRes = await get(linkUrl);
  if (!linkRes.ok) {
    throw new Error(`類似論文の取得に失敗しました (HTTP ${linkRes.status})`);
  }
  const linkBody = await linkRes.json();

  const linksets = linkBody.linksets?.[0]?.linksetdbs as
    | { linkname: string; links: { id: string; score?: string }[] }[]
    | undefined;
  const scored = linksets?.find((l) => l.linkname === "pubmed_pubmed")?.links ?? [];

  // ELink returns the source article itself as the top "neighbor"; drop it,
  // then take the next `retmax` by descending score (already ranked, but
  // sorted explicitly since the API does not document that as a guarantee).
  const ids = scored
    .filter((l) => l.id !== pmid)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, retmax)
    .map((l) => l.id);

  if (ids.length === 0) {
    return { sourcePmid: pmid, total: 0, articles: [], notes: ["類似論文が見つかりませんでした。"] };
  }

  const { articles, notes } = await hydrateArticles(ids, true);
  return { sourcePmid: pmid, total: articles.length, articles, notes };
}

/** efetch returns XML; only the abstract text is needed. */
async function fetchAbstracts(pmids: string[]): Promise<Map<string, string>> {
  const url = new URL(`${BASE}/efetch.fcgi`);
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmids.join(","));
  url.searchParams.set("rettype", "abstract");
  url.searchParams.set("retmode", "xml");

  const res = await get(url, 25_000);
  if (!res.ok) throw new Error(`efetch HTTP ${res.status}`);
  return parseAbstractsXml(await res.text());
}

/**
 * Extracts abstracts from an efetch response, keyed by PMID.
 *
 * Exported so the attribution can be tested directly: one response holds many
 * records, and pairing an abstract with the wrong PMID would put the wrong
 * summary against a citation.
 */
export function parseAbstractsXml(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  // Split per article so an abstract is never attributed to the wrong PMID.
  const articles = xml.split(/<PubmedArticle[\s>]/).slice(1);
  for (const chunk of articles) {
    // The article's own PMID comes first, inside MedlineCitation; any later
    // PMIDs in the chunk belong to its reference list.
    const pmid = chunk.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;
    const parts = [...chunk.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)];
    if (!parts.length) continue;
    const text = parts
      .map((m) => {
        const label = m[1].match(/Label="([^"]+)"/)?.[1];
        const body = stripTags(m[2]);
        return label ? `${label}: ${body}` : body;
      })
      .join("\n\n")
      .trim();
    if (text) out.set(pmid, text);
  }
  return out;
}

/** Inline formatting PubMed escapes inside abstract text. */
const INLINE_TAGS = /<\/?(i|b|u|em|strong|sup|sub|br|p)\s*\/?>/gi;

function stripTags(s: string): string {
  return (
    s
      // Real markup first.
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // PubMed writes italics and subscripts as escaped tags, so a second
      // pass is needed after decoding. Restricted to known inline tags so a
      // genuine comparison like "p < 0.05" is never eaten.
      .replace(INLINE_TAGS, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// A properly formatted, exportable citation (Vancouver / BibTeX / RIS) lives
// in ./citation.ts, which - unlike this module - has no "server-only" import
// and so can be used from the client component that renders the results.
