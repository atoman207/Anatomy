"use client";

import { useState } from "react";
import {
  Badge, Button, Callout, Card, EmptyState, Field, Select, StatTile, TextArea, cx,
} from "@/components/ui";
import { useDownload, useWorkspace } from "@/components/workspace";
import type { PubMedArticle } from "@/lib/literature/pubmed";
import type { BuiltQuery, LiteratureSummary } from "@/lib/ai/queryBuilder";
import type { DoiVerification } from "@/lib/literature/crossref";
import { toDelimited } from "@/lib/data/csv";

interface SearchResponse {
  question: string;
  builtQuery: BuiltQuery | null;
  executedQuery: string;
  translatedQuery: string | null;
  total: number;
  articles: PubMedArticle[];
  notes: string[];
  aiEnabled: boolean;
  error?: string;
}

export default function LiteraturePage() {
  const ws = useWorkspace();
  const download = useDownload();

  const [question, setQuestion] = useState("");
  const [editedQuery, setEditedQuery] = useState<string | null>(null);
  const [yearsBack, setYearsBack] = useState(5);
  const [retmax, setRetmax] = useState(20);
  const [sort, setSort] = useState<"relevance" | "pub_date">("relevance");

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [summary, setSummary] = useState<LiteratureSummary | null>(null);
  const [summaryNotes, setSummaryNotes] = useState<string[]>([]);
  const [verifications, setVerifications] = useState<DoiVerification[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState<null | "search" | "summary" | "verify">(null);
  const [error, setError] = useState<string | null>(null);

  async function search(overrideQuery?: string) {
    setBusy("search");
    setError(null);
    setSummary(null);
    setVerifications(null);
    setSummaryNotes([]);
    try {
      const res = await fetch("/api/literature/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          query: overrideQuery ?? undefined,
          yearsBack: yearsBack || undefined,
          retmax,
          sort,
        }),
      });
      const json = (await res.json()) as SearchResponse;
      if (!res.ok) throw new Error(json.error ?? `検索に失敗しました (${res.status})`);
      setResult(json);
      setEditedQuery(json.executedQuery);
      setSelected(new Set(json.articles.map((a) => a.pmid)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "検索に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  async function summarize() {
    if (!result) return;
    setBusy("summary");
    setError(null);
    try {
      const chosen = result.articles.filter((a) => selected.has(a.pmid));
      const res = await fetch("/api/literature/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question || result.executedQuery, articles: chosen }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `要約に失敗しました (${res.status})`);
      setSummary(json.summary);
      setSummaryNotes(json.notes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "要約に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    if (!result) return;
    setBusy("verify");
    setError(null);
    try {
      const items = result.articles
        .filter((a) => selected.has(a.pmid) && a.doi)
        .map((a) => ({ doi: a.doi!, title: a.title }));
      if (items.length === 0) {
        setError("選択された論文に DOI がありません。");
        return;
      }
      const res = await fetch("/api/literature/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `確認に失敗しました (${res.status})`);
      setVerifications(json.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  const chosen = result?.articles.filter((a) => selected.has(a.pmid)) ?? [];
  const verificationByDoi = new Map((verifications ?? []).map((v) => [v.doi, v]));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">論文検索</h1>
      </header>

      {error && <Callout tone="danger" title="エラー">{error}</Callout>}

      <Card title="検索">
        <div className="flex flex-col gap-3">
          <Field label="調べたいこと">
            <TextArea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-20"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`対象期間: 過去 ${yearsBack || "全"} 年`}>
              <input
                type="range" min={0} max={20} value={yearsBack}
                onChange={(e) => setYearsBack(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
            <Field label={`取得件数: ${retmax}`}>
              <input
                type="range" min={5} max={50} step={5} value={retmax}
                onChange={(e) => setRetmax(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
            <Field label="並び順">
              <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="relevance">関連度順</option>
                <option value="pub_date">新しい順</option>
              </Select>
            </Field>
          </div>

          <div>
            <Button
              variant="primary"
              icon="search"
              onClick={() => search()}
              disabled={busy !== null || !question.trim()}
            >
              {busy === "search" ? "検索中…" : "検索"}
            </Button>
          </div>
        </div>
      </Card>

      {result?.builtQuery && (
        <Card
          title="生成された検索式"
          subtitle={result.builtQuery.explanation}
          actions={
            <>
              {result.builtQuery.broader_query && (
                <Button size="sm" icon="plus" onClick={() => search(result.builtQuery!.broader_query!)}>
                  条件を広げる
                </Button>
              )}
              {result.builtQuery.narrower_query && (
                <Button size="sm" icon="search" onClick={() => search(result.builtQuery!.narrower_query!)}>
                  条件を絞る
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {result.builtQuery.concepts.map((c) => (
                <div key={c.concept} className="rounded-lg border border-line px-2.5 py-1.5">
                  <p className="text-[11px] font-medium text-ink">{c.concept}</p>
                  <p className="text-[10px] text-ink-3">{c.terms.join(" / ")}</p>
                </div>
              ))}
            </div>
            <Field label="検索式（編集して再検索できます）">
              <TextArea
                value={editedQuery ?? ""}
                onChange={(e) => setEditedQuery(e.target.value)}
                className="min-h-20 font-mono text-[11px] leading-relaxed"
              />
            </Field>
            <div>
              <Button
                size="sm"
                icon="search"
                onClick={() => editedQuery && search(editedQuery)}
                disabled={busy !== null || !editedQuery?.trim()}
              >
                この式で再検索
              </Button>
            </div>
          </div>
        </Card>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="ヒット総数" value={result.total.toLocaleString()} tone="accent" />
            <StatTile label="取得" value={result.articles.length} />
            <StatTile label="選択中" value={chosen.length} />
            <StatTile
              label="DOIあり"
              value={result.articles.filter((a) => a.doi).length}
            />
          </div>

          {result.notes.map((n, i) => (
            <Callout key={i} tone="info">{n}</Callout>
          ))}

          {result.articles.length === 0 ? (
            <EmptyState title="該当する論文がありません">
              検索式を広げるか、期間を長くしてみてください。
            </EmptyState>
          ) : (
            <Card
              title={`検索結果 (${result.articles.length} 件)`}
              actions={
                <>
                  <Button
                    size="sm"
                    icon="check"
                    onClick={() =>
                      setSelected(
                        selected.size === result.articles.length
                          ? new Set()
                          : new Set(result.articles.map((a) => a.pmid)),
                      )
                    }
                  >
                    {selected.size === result.articles.length ? "全解除" : "全選択"}
                  </Button>
                  <Button size="sm" icon="check" onClick={verify} disabled={busy !== null || chosen.length === 0}>
                    {busy === "verify" ? "確認中…" : "DOIを照合"}
                  </Button>
                  <Button
                    size="sm"
                    icon="download"
                    onClick={() =>
                      download(
                        "pubmed_results.csv",
                        toDelimited(
                          ["pmid", "title", "journal", "pubdate", "authors", "doi", "url"],
                          chosen.map((a) => [
                            a.pmid, a.title, a.journal, a.pubDate,
                            a.authors.join("; "), a.doi ?? "", a.url,
                          ]),
                        ),
                        "text/csv",
                      )
                    }
                    disabled={chosen.length === 0}
                  >
                    CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon="file"
                    onClick={summarize}
                    disabled={busy !== null || chosen.length === 0 || !result.aiEnabled}
                  >
                    {busy === "summary" ? "要約中…" : "選択分をAI要約"}
                  </Button>
                </>
              }
            >
              <ul className="flex flex-col gap-3">
                {result.articles.map((a) => {
                  const v = a.doi ? verificationByDoi.get(a.doi) : undefined;
                  return (
                    <li
                      key={a.pmid}
                      className={cx(
                        "rounded-lg border p-3 transition-colors",
                        selected.has(a.pmid) ? "border-accent/40 bg-accent-soft/30" : "border-line",
                      )}
                    >
                      <div className="flex gap-3">
                        <input
                          type="checkbox"
                          checked={selected.has(a.pmid)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(a.pmid);
                            else next.delete(a.pmid);
                            setSelected(next);
                          }}
                          className="mt-1"
                          aria-label={`${a.title} を選択`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink">{a.title}</p>
                          <p className="mt-0.5 text-xs text-ink-2">
                            {a.authors.slice(0, 4).join(", ")}
                            {a.authors.length > 4 && " et al."}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-3">
                            <em>{a.journal}</em> · {a.pubDate} · PMID {a.pmid}
                          </p>

                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <a
                              href={a.url} target="_blank" rel="noreferrer"
                              className="text-[11px] text-accent underline"
                            >
                              PubMed
                            </a>
                            {a.doiUrl && (
                              <a
                                href={a.doiUrl} target="_blank" rel="noreferrer"
                                className="text-[11px] text-accent underline"
                              >
                                doi:{a.doi}
                              </a>
                            )}
                            {a.pmcid && <Badge tone="good">全文あり (PMC)</Badge>}
                            {v && (
                              <Badge tone={v.resolves ? (v.titleMatches === false ? "warn" : "good") : "danger"}>
                                {v.resolves
                                  ? v.titleMatches === false
                                    ? "DOI: タイトル不一致"
                                    : "DOI 照合済み"
                                  : "DOI 未解決"}
                              </Badge>
                            )}
                            {a.publicationTypes.includes("Review") && <Badge>Review</Badge>}
                          </div>

                          {a.abstract && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[11px] text-ink-2">抄録</summary>
                              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">
                                {a.abstract}
                              </p>
                            </details>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}

      {summary && (
        <Card
          title="AI要約"
          subtitle="選択した論文の抄録に基づく要約です。"
          actions={
            <Button
              size="sm"
              variant="primary"
              icon="notebook"
              onClick={() =>
                ws.addClip(
                  `論文検索: ${question.slice(0, 40)}`,
                  literatureToMarkdown(question, result!, chosen, summary),
                )
              }
            >
              ノートへ
            </Button>
          }
        >
          {summaryNotes.map((n, i) => (
            <div key={i} className="mb-2"><Callout tone="warn">{n}</Callout></div>
          ))}

          <p className="text-sm leading-relaxed text-ink">{summary.overview}</p>

          {summary.themes.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {summary.themes.map((t, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <p className="text-xs font-semibold text-ink">{t.theme}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.detail}</p>
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {t.pmids.map((p) => (
                      <a
                        key={p}
                        href={`https://pubmed.ncbi.nlm.nih.gov/${p}/`}
                        target="_blank" rel="noreferrer"
                        className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-accent underline"
                      >
                        {p}
                      </a>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          )}

          {summary.caveats.length > 0 && (
            <div className="mt-3">
              <Callout tone="warn" title="留意点">
                <ul className="mt-1 list-disc pl-4">
                  {summary.caveats.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </Callout>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Assembles the notebook block: real citations plus the AI reading of them. */
function literatureToMarkdown(
  question: string,
  result: SearchResponse,
  articles: PubMedArticle[],
  summary: LiteratureSummary,
): string {
  const lines: string[] = [];
  lines.push(`### 論文検索: ${question}`, "");
  lines.push(`**検索式:** \`${result.executedQuery}\``);
  lines.push(`**ヒット総数:** ${result.total.toLocaleString()} 件（${articles.length} 件を検討）`, "");
  lines.push("**要約**", "", summary.overview, "");

  if (summary.themes.length) {
    lines.push("**主なテーマ**", "");
    for (const t of summary.themes) {
      lines.push(`- **${t.theme}** — ${t.detail} (PMID: ${t.pmids.join(", ") || "—"})`);
    }
    lines.push("");
  }

  lines.push("**文献一覧**", "");
  lines.push("| # | 著者 | タイトル | 掲載誌 | 年 | PMID | DOI |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  articles.forEach((a, i) => {
    const author = a.authors.length ? `${a.authors[0]}${a.authors.length > 1 ? " et al." : ""}` : "—";
    lines.push(
      `| ${i + 1} | ${author} | ${a.title.replace(/\|/g, "/")} | ${a.journal} | ${a.year ?? "—"} | ${a.pmid} | ${a.doi ?? "—"} |`,
    );
  });
  lines.push("");

  if (summary.caveats.length) {
    lines.push("**留意点**", "");
    for (const c of summary.caveats) lines.push(`- ${c}`);
    lines.push("");
  }

  lines.push(`_検索日: ${new Date().toISOString().slice(0, 10)} · 出典: PubMed (NCBI E-utilities)_`);
  return lines.join("\n");
}
