"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge, Button, Callout, Card, EmptyState, Field, Select, StatTile, TextArea, cx,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useDownload, useWorkspace } from "@/components/workspace";
import type { PubMedArticle } from "@/lib/literature/pubmed";
import type { BuiltQuery, LiteratureSummary } from "@/lib/ai/queryBuilder";
import type { DoiVerification } from "@/lib/literature/crossref";
import { listSavedPapers, saveLiteraturePapers, type SavedPaperSummary } from "@/lib/literature/actions";
import { formatCitation, toBibTeXFile, toRisFile, type CitationSource } from "@/lib/literature/citation";
import { SelectionSummary } from "../SelectionSummary";

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

interface SimilarResponse {
  sourcePmid: string;
  total: number;
  articles: PubMedArticle[];
  notes: string[];
  error?: string;
}

/** Step 5: optionally attach supporting literature to the experiment. */
export function LiteratureStep() {
  const ws = useWorkspace();
  const download = useDownload();
  const router = useRouter();
  const { toast } = useToast();

  const [question, setQuestion] = useState("");
  const [editedQuery, setEditedQuery] = useState<string | null>(null);
  const [yearsBack, setYearsBack] = useState(5);
  const [retmax, setRetmax] = useState(20);
  const [sort, setSort] = useState<"relevance" | "pub_date">("relevance");
  const [restrictJapan, setRestrictJapan] = useState(false);

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [similarFor, setSimilarFor] = useState<PubMedArticle | null>(null);
  const [similarResult, setSimilarResult] = useState<SimilarResponse | null>(null);
  const [similarBusy, setSimilarBusy] = useState(false);
  const [summary, setSummary] = useState<LiteratureSummary | null>(null);
  const [summaryNotes, setSummaryNotes] = useState<string[]>([]);
  const [verifications, setVerifications] = useState<DoiVerification[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState<null | "search" | "summary" | "verify">(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedPaperSummary[]>([]);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  const historyLoading = ws.experimentId !== null && ws.experimentId !== historyLoadedFor;

  useEffect(() => {
    const experimentId = ws.experimentId;
    if (!experimentId) return;
    let cancelled = false;
    listSavedPapers(experimentId).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) setHistory(res.data);
      setHistoryLoadedFor(experimentId);
    });
    return () => {
      cancelled = true;
    };
  }, [ws.experimentId]);

  const chosen = result?.articles.filter((a) => selected.has(a.pmid)) ?? [];

  async function saveToExperiment() {
    if (!ws.experimentId || !ws.labId || chosen.length === 0) return;
    setSaveState("saving");
    try {
      const res = await saveLiteraturePapers(ws.labId, ws.experimentId, chosen);
      if (!res.ok) throw new Error(res.error ?? "保存に失敗しました。");
      setSaveState("saved");
      toast(`${chosen.length}件の論文を保存しました。`, { tone: "good" });
      const refreshed = await listSavedPapers(ws.experimentId);
      if (refreshed.ok && refreshed.data) setHistory(refreshed.data);
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
      setSaveState("idle");
    }
  }

  async function search(overrideQuery?: string, overrideQuestion?: string) {
    setBusy("search");
    setSummary(null);
    setVerifications(null);
    setSummaryNotes([]);
    try {
      const res = await fetch("/api/literature/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labId: ws.labId, question: overrideQuestion ?? question, query: overrideQuery ?? undefined,
          yearsBack: yearsBack || undefined, retmax, sort, restrictJapan,
        }),
      });
      const json = (await res.json()) as SearchResponse;
      if (!res.ok) throw new Error(json.error ?? `検索に失敗しました (${res.status})`);
      setResult(json);
      setEditedQuery(json.executedQuery);
      setSelected(new Set(json.articles.map((a) => a.pmid)));
      setSimilarFor(null);
      setSimilarResult(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "検索に失敗しました。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  /**
   * PubMed's own "similar articles" ranking for one result - no AI call, so
   * this stays fast even when the AI query builder is unavailable or slow.
   */
  async function findSimilar(article: PubMedArticle) {
    setSimilarFor(article);
    setSimilarResult(null);
    setSimilarBusy(true);
    try {
      const res = await fetch("/api/literature/similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pmid: article.pmid, retmax: 10 }),
      });
      const json = (await res.json()) as SimilarResponse;
      if (!res.ok) throw new Error(json.error ?? `類似論文の検索に失敗しました (${res.status})`);
      setSimilarResult(json);
    } catch (e) {
      toast(e instanceof Error ? e.message : "類似論文の検索に失敗しました。", { tone: "danger" });
      setSimilarFor(null);
    } finally {
      setSimilarBusy(false);
    }
  }

  async function summarize() {
    if (!result) return;
    setBusy("summary");
    try {
      const picked = result.articles.filter((a) => selected.has(a.pmid));
      const res = await fetch("/api/literature/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labId: ws.labId, question: question || result.executedQuery, articles: picked }),
      });
      const json = await res.json();
      if (!res.ok) {
        const message = json.error ?? `要約に失敗しました (${res.status})`;
        if (res.status === 402) {
          toast(message, { tone: "danger", title: "エラー" });
          router.push("/billing");
          return;
        }
        throw new Error(message);
      }
      setSummary(json.summary);
      setSummaryNotes(json.notes ?? []);
    } catch (e) {
      toast(e instanceof Error ? e.message : "要約に失敗しました。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    if (!result) return;
    setBusy("verify");
    try {
      const items = result.articles
        .filter((a) => selected.has(a.pmid) && a.doi)
        .map((a) => ({ doi: a.doi!, title: a.title }));
      if (items.length === 0) {
        toast("選択された論文に DOI がありません。", { tone: "danger" });
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
      toast(e instanceof Error ? e.message : "確認に失敗しました。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  /** Folds one similar-article result into the main list, so it can be selected, saved, and summarized like any search hit. */
  function addSimilarToResults(article: PubMedArticle) {
    setResult((prev) => {
      if (!prev) return prev;
      if (prev.articles.some((a) => a.pmid === article.pmid)) return prev;
      return { ...prev, articles: [...prev.articles, article], total: prev.total + 1 };
    });
    setSelected((prev) => new Set(prev).add(article.pmid));
    toast("検索結果に追加しました。", { tone: "good" });
  }

  /**
   * Searches using what was actually captured in step 4 (the raw text before
   * AI structuring, stashed in the workspace) rather than requiring the
   * researcher to re-describe their own experiment in the search box.
   */
  function searchFromReportContext() {
    if (!ws.reportContext.trim()) return;
    const derived = ws.reportContext.trim().slice(0, 400);
    setQuestion(derived);
    void search(undefined, derived);
  }

  /** Adds the current selection as a plain reference list, independent of the AI summary flow above. */
  function addReferencesToReport() {
    if (chosen.length === 0) return;
    const lines = [
      "### 参考文献",
      "",
      ...chosen.map((a, i) => `${i + 1}. ${formatCitation(a)}`),
    ];
    ws.addClip(`参考文献 (${chosen.length}件)`, lines.join("\n"));
    toast("参考文献をレポートに追加しました。", { tone: "good" });
  }

  const verificationByDoi = new Map((verifications ?? []).map((v) => [v.doi, v]));

  async function copyCitation(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
    } catch {
      toast("引用のコピーに失敗しました。ブラウザの権限を確認してください。", { tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="info">
        今日の記録に関連する論文があれば検索して保存してください。このステップは任意です。
      </Callout>

      <SelectionSummary upTo={5} />

      <Card title="検索">
        <div className="flex flex-col gap-3">
          {ws.reportContext.trim() && (
            <Callout tone="info" title="ここまでの記録から検索できます">
              <p>ステップ4で書いた内容をそのまま検索語として使います。</p>
              <div className="mt-2">
                <Button size="sm" icon="search" onClick={searchFromReportContext} disabled={busy !== null}>
                  記録の内容から検索
                </Button>
              </div>
            </Callout>
          )}
          <Field label="調べたいこと">
            <TextArea value={question} onChange={(e) => setQuestion(e.target.value)} className="min-h-20" />
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
          <label className="flex w-fit items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox" checked={restrictJapan}
              onChange={(e) => setRestrictJapan(e.target.checked)}
            />
            日本の研究機関に所属する著者の論文に限定する
          </label>
          <div>
            <Button variant="primary" icon="search" onClick={() => search()} disabled={busy !== null || !question.trim()}>
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
                <Button size="sm" icon="plus" onClick={() => search(result.builtQuery!.broader_query!)}>条件を広げる</Button>
              )}
              {result.builtQuery.narrower_query && (
                <Button size="sm" icon="search" onClick={() => search(result.builtQuery!.narrower_query!)}>条件を絞る</Button>
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
                value={editedQuery ?? ""} onChange={(e) => setEditedQuery(e.target.value)}
                className="min-h-20 font-mono text-[11px] leading-relaxed"
              />
            </Field>
            <div>
              <Button size="sm" icon="search" onClick={() => editedQuery && search(editedQuery)} disabled={busy !== null || !editedQuery?.trim()}>
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
            <StatTile label="DOIあり" value={result.articles.filter((a) => a.doi).length} />
          </div>

          {result.notes.map((n, i) => <Callout key={i} tone="info">{n}</Callout>)}

          {result.articles.length === 0 ? (
            <EmptyState title="該当する論文がありません">検索式を広げるか、期間を長くしてみてください。</EmptyState>
          ) : (
            <Card
              title={`検索結果 (${result.articles.length} 件)`}
              actions={
                <>
                  <Button
                    size="sm" icon="check"
                    onClick={() => setSelected(selected.size === result.articles.length ? new Set() : new Set(result.articles.map((a) => a.pmid)))}
                  >
                    {selected.size === result.articles.length ? "全解除" : "全選択"}
                  </Button>
                  <Button size="sm" icon="check" onClick={verify} disabled={busy !== null || chosen.length === 0}>
                    {busy === "verify" ? "確認中…" : "DOIを照合"}
                  </Button>
                  <Button
                    size="sm" variant="primary" icon="file" onClick={summarize}
                    disabled={busy !== null || chosen.length === 0 || !result.aiEnabled}
                  >
                    {busy === "summary" ? "要約中…" : "選択分をAI要約"}
                  </Button>
                  <Button
                    size="sm" icon="notebook" onClick={saveToExperiment}
                    disabled={!ws.experimentId || chosen.length === 0 || saveState === "saving"}
                  >
                    {saveState === "saving" ? "保存中…" : saveState === "saved" ? "保存しました ✓" : "選択分を実験に保存"}
                  </Button>
                  <Button
                    size="sm" variant="primary" icon="notebook" onClick={addReferencesToReport}
                    disabled={chosen.length === 0}
                    title="AI要約なしで、選択した文献の参考文献リストだけをレポートに追加します"
                  >
                    参考文献をレポートへ追加
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
                          type="checkbox" checked={selected.has(a.pmid)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(a.pmid);
                            else next.delete(a.pmid);
                            setSelected(next);
                          }}
                          className="mt-1" aria-label={`${a.title} を選択`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink">{a.title}</p>
                          <p className="mt-0.5 text-xs text-ink-2">
                            {a.authors.slice(0, 4).join(", ")}{a.authors.length > 4 && " et al."}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-3"><em>{a.journal}</em> · {a.pubDate} · PMID {a.pmid}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <a href={a.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent underline">PubMed</a>
                            {a.doiUrl && (
                              <a href={a.doiUrl} target="_blank" rel="noreferrer" className="text-[11px] text-accent underline">doi:{a.doi}</a>
                            )}
                            {a.pmcid && <Badge tone="good">全文あり (PMC)</Badge>}
                            {v && (
                              <Badge tone={v.resolves ? (v.titleMatches === false ? "warn" : "good") : "danger"}>
                                {v.resolves ? (v.titleMatches === false ? "DOI: タイトル不一致" : "DOI 照合済み") : "DOI 未解決"}
                              </Badge>
                            )}
                            {a.publicationTypes.includes("Review") && <Badge>Review</Badge>}
                            <button
                              type="button"
                              className="text-[11px] text-accent underline"
                              onClick={() => void findSimilar(a)}
                            >
                              類似論文を探す
                            </button>
                          </div>
                          {a.abstract && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[11px] text-ink-2">抄録</summary>
                              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">{a.abstract}</p>
                            </details>
                          )}
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[11px] text-ink-2">引用（Vancouver形式）</summary>
                            <div className="mt-1 flex items-start gap-2">
                              <p className="min-w-0 flex-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">{formatCitation(a)}</p>
                              <Button size="sm" icon={copiedId === a.pmid ? "check" : "copy"} onClick={() => copyCitation(a.pmid, formatCitation(a))}>
                                {copiedId === a.pmid ? "コピー済み" : "コピー"}
                              </Button>
                            </div>
                          </details>
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

      {similarFor && (
        <Card
          title="類似論文"
          subtitle={`「${similarFor.title}」の類似論文（PubMed による判定）`}
          actions={
            <Button size="sm" icon="x" onClick={() => { setSimilarFor(null); setSimilarResult(null); }}>
              閉じる
            </Button>
          }
        >
          {similarBusy ? (
            <p className="text-xs text-ink-3">検索中…</p>
          ) : !similarResult || similarResult.articles.length === 0 ? (
            <EmptyState title="類似論文が見つかりませんでした" />
          ) : (
            <>
              {similarResult.notes.map((n, i) => <Callout key={i} tone="info">{n}</Callout>)}
              <ul className="mt-2 flex flex-col gap-2">
                {similarResult.articles.map((a) => (
                  <li key={a.pmid} className="rounded-lg border border-line p-2.5">
                    <p className="text-sm font-medium text-ink">{a.title}</p>
                    <p className="mt-0.5 text-xs text-ink-2">
                      {a.authors.slice(0, 4).join(", ")}{a.authors.length > 4 && " et al."}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-3"><em>{a.journal}</em> · {a.pubDate} · PMID {a.pmid}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent underline">PubMed</a>
                      <button
                        type="button"
                        className="text-[11px] text-accent underline"
                        onClick={() => addSimilarToResults(a)}
                        disabled={result?.articles.some((x) => x.pmid === a.pmid)}
                      >
                        {result?.articles.some((x) => x.pmid === a.pmid) ? "追加済み" : "検索結果に追加"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {summary && (
        <Card
          title="AI要約"
          subtitle="選択した論文の抄録に基づく要約です。"
          actions={
            <Button
              size="sm" variant="primary" icon="notebook"
              onClick={() => ws.addClip(`論文検索: ${question.slice(0, 40)}`, literatureToMarkdown(question, result!, chosen, summary))}
            >
              ノートへ
            </Button>
          }
        >
          {summaryNotes.map((n, i) => <div key={i} className="mb-2"><Callout tone="warn">{n}</Callout></div>)}
          <p className="text-sm leading-relaxed text-ink">{summary.overview}</p>
          {summary.themes.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {summary.themes.map((t, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <p className="text-xs font-semibold text-ink">{t.theme}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-2">{t.detail}</p>
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {t.pmids.map((p) => (
                      <a key={p} href={`https://pubmed.ncbi.nlm.nih.gov/${p}/`} target="_blank" rel="noreferrer"
                        className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-accent underline">
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
                <ul className="mt-1 list-disc pl-4">{summary.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </Callout>
            </div>
          )}
        </Card>
      )}

      {ws.experimentId && (
        <Card
          title="この実験に保存済みの論文"
          subtitle={historyLoading ? "読み込み中…" : `${history.length} 件`}
          actions={history.length > 0 && (
            <>
              <Button
                size="sm" icon="download"
                onClick={() => download("citations.bib", toBibTeXFile(history.map(toCitationSource)), "application/x-bibtex")}
              >
                BibTeX
              </Button>
              <Button
                size="sm" icon="download"
                onClick={() => download("citations.ris", toRisFile(history.map(toCitationSource)), "application/x-research-info-systems")}
              >
                RIS
              </Button>
            </>
          )}
        >
          {history.length === 0 ? (
            <p className="text-xs text-ink-3">まだ保存された論文はありません。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((p) => (
                <li key={p.id} className="rounded-lg border border-line p-2.5">
                  <p className="text-xs font-medium text-ink">{p.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {p.journal ?? "—"} · {p.pub_year ?? "—"}
                    {p.pmid && <> · PMID {p.pmid}</>}
                    {p.doi && <> · doi:{p.doi}</>}
                    {" · "}{new Date(p.created_at).toLocaleString("ja-JP")}
                  </p>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" className="mt-0.5 text-[11px] text-accent underline">PubMed</a>
                  )}
                  <div className="mt-1.5 flex items-start gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">
                      {formatCitation(toCitationSource(p))}
                    </p>
                    <Button size="sm" icon={copiedId === p.id ? "check" : "copy"} onClick={() => copyCitation(p.id, formatCitation(toCitationSource(p)))}>
                      {copiedId === p.id ? "コピー済み" : "コピー"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function toCitationSource(p: SavedPaperSummary): CitationSource {
  return {
    title: p.title, journal: p.journal, year: p.pub_year, authors: p.authors,
    volume: p.volume, issue: p.issue, pages: p.pages, doi: p.doi, pmid: p.pmid,
  };
}

function literatureToMarkdown(
  question: string, result: SearchResponse, articles: PubMedArticle[], summary: LiteratureSummary,
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
  lines.push("**参考文献**", "");
  articles.forEach((a, i) => lines.push(`${i + 1}. ${formatCitation(a)}`));
  lines.push("");
  if (summary.caveats.length) {
    lines.push("**留意点**", "");
    for (const c of summary.caveats) lines.push(`- ${c}`);
    lines.push("");
  }
  lines.push(`_検索日: ${new Date().toISOString().slice(0, 10)} · 出典: PubMed (NCBI E-utilities)_`);
  return lines.join("\n");
}
