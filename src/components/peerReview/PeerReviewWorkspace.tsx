"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Badge, Button, Callout, Card, EmptyState, Field, PendingOverlay, Select, StatTile, TextInput, cx,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useDownload, useWorkspace } from "@/components/workspace";
import { ReviewerAvatar } from "./ReviewerAvatar";
import { ScoreTrendCard } from "./ScoreTrendChart";
import {
  ACCEPTANCE_LIKELIHOOD_LABELS, CATEGORY_LABELS, REVIEWER_LABELS, TIER_LABELS,
  peerReviewToMarkdown, scoreTone, severityTone,
  type CategoryScores, type ReviewTier, type ReviewerResult, type ReviewerRole,
} from "@/lib/ai/peerReviewReport";
import type { ReviewerProfile } from "@/lib/ai/reviewerProfiles";
import {
  REVIEWER_PERSONALITIES, personalityById, randomPersonalities, type PersonalityId,
} from "@/lib/ai/reviewerPersonalities";
import type { JournalFormatMatch } from "@/lib/ai/journalFormatCheck";
import type { AnalyzeResponse } from "@/app/api/peer-review/analyze/route";
import {
  getMyPeerReviewCredits, startCreditCheckout,
} from "@/lib/peerReview/creditActions";
import type { PeerReviewCredits } from "@/lib/peerReview/credits";
import {
  FREE_PEER_REVIEW_CREDITS, PEER_REVIEW_CREDIT_PACKS,
} from "@/lib/peerReview/creditPacks";
import {
  getReviewChain, savePeerReview,
  type RecentPeerReviewSummary, type ReviewChainEntry,
} from "@/lib/peerReview/actions";
import { formatJpy } from "@/lib/billing/plans";

const REVIEWER_ROLES: ReviewerRole[] = ["methods", "novelty", "structure"];

const MAX_FILE_MB = 25;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx"];

/**
 * Upload a PDF and run AI peer review without tying the run to an experiment.
 *
 * Entitlement is personal credits: a free allowance, then purchased packs.
 * Completed reviews are persisted so the researcher can reopen the comments
 * later from the history panel (and from the dashboard).
 */
export function PeerReviewWorkspace({
  profiles,
  initialHistory = [],
}: {
  profiles: Record<ReviewerRole, ReviewerProfile>;
  initialHistory?: RecentPeerReviewSummary[];
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [journalUrl, setJournalUrl] = useState("");
  const [targetJournalName, setTargetJournalName] = useState("");
  const [tier, setTier] = useState<ReviewTier>("standard");
  const [personalities, setPersonalities] = useState<Partial<Record<ReviewerRole, PersonalityId>>>({});
  const [previousReviewId, setPreviousReviewId] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [savedReviewId, setSavedReviewId] = useState<string | null>(null);
  const [chain, setChain] = useState<ReviewChainEntry[]>([]);
  const [history, setHistory] = useState<RecentPeerReviewSummary[]>(initialHistory);
  const [showText, setShowText] = useState(false);
  const [credits, setCredits] = useState<PeerReviewCredits | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  const reviewerNames: Partial<Record<ReviewerRole, string>> = {
    methods: profiles.methods.name,
    novelty: profiles.novelty.name,
    structure: profiles.structure.name,
  };

  const refreshCredits = useCallback(async () => {
    const res = await getMyPeerReviewCredits();
    if (res.ok && res.data) setCredits(res.data);
  }, []);

  useEffect(() => {
    // Fetching the account's current balance from the server on mount -
    // exactly what an effect is for (synchronizing with an external
    // system). The setState the compiler traces through happens inside
    // refreshCredits' own async body, after the request resolves, not
    // synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (!checkout) return;
    if (checkout === "success") {
      toast("決済が完了しました。回数を反映しています…", { tone: "good" });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refreshCredits();
    } else if (checkout === "cancel") {
      toast("決済をキャンセルしました。", { tone: "info" });
    }
    router.replace("/peer-review");
  }, [searchParams, refreshCredits, router, toast]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      toast("PDFまたはWord（.docx）ファイルを選択してください。", { tone: "danger" });
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      toast(`ファイルが大きすぎます（上限 ${MAX_FILE_MB} MB）。`, { tone: "danger" });
      return;
    }
    setFile(f);
    setResult(null);
    setSavedReviewId(null);
    setChain([]);
    if (!title) setTitle(f.name.replace(/\.(pdf|docx)$/i, ""));
  }

  function randomizePersonalities() {
    setPersonalities(randomPersonalities(REVIEWER_ROLES));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    pickFile(e.dataTransfer.files?.[0]);
  }

  async function runReview() {
    if (!file) return;
    if (credits && credits.remaining <= 0) {
      toast("残り回数がありません。下のパックから追加してください。", {
        tone: "danger", title: "エラー",
      });
      return;
    }
    setBusy(true);
    setReviewing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("tier", tier);
      if (journalUrl.trim()) form.append("journalUrl", journalUrl.trim());
      if (targetJournalName.trim()) form.append("targetJournalName", targetJournalName.trim());
      if (Object.keys(personalities).length > 0) {
        form.append("personalities", JSON.stringify(personalities));
      }

      const res = await fetch("/api/peer-review/analyze", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `査読に失敗しました (${res.status})`);

      setResult(json as AnalyzeResponse);
      setSavedReviewId(null);
      setChain([]);
      toast("査読が完了しました。", { tone: "good" });
      if (json.truncated) {
        toast("本文が長いため、一部を切り詰めて査読しました。", { tone: "warn" });
      }
      void refreshCredits();

      const saved = await savePeerReview({
        title: title.trim() || file.name.replace(/\.(pdf|docx)$/i, "") || "無題",
        sourceFilename: file.name,
        extractedText: (json as AnalyzeResponse).extractedText,
        report: (json as AnalyzeResponse).report,
        previousReviewId: previousReviewId || null,
      });
      if (saved.ok && saved.data) {
        setSavedReviewId(saved.data.id);
        setHistory((prev) => [
          {
            id: saved.data!.id,
            title: saved.data!.title,
            source_filename: saved.data!.source_filename,
            overall_score: Number(saved.data!.overall_score),
            previous_review_id: saved.data!.previous_review_id,
            created_at: saved.data!.created_at,
            experiment_id: saved.data!.experiment_id,
            experiment_name: null,
            lab_name: null,
          },
          ...prev.filter((r) => r.id !== saved.data!.id),
        ]);
        if (previousReviewId) {
          const chainRes = await getReviewChain(saved.data.id);
          if (chainRes.ok && chainRes.data) setChain(chainRes.data);
        }
      } else {
        toast(saved.error ?? "査読結果の保存に失敗しました。画面上の結果は引き続き確認できます。", {
          tone: "warn",
        });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "査読に失敗しました。", { tone: "danger", title: "エラー" });
      void refreshCredits();
    } finally {
      setBusy(false);
      setReviewing(false);
    }
  }

  async function buyPack(packId: string) {
    setBuying(packId);
    try {
      const res = await startCreditCheckout(packId);
      if (!res.ok || !res.data) {
        toast(res.error ?? "決済を開始できませんでした。", { tone: "danger", title: "エラー" });
        return;
      }
      // A same-tab redirect to Stripe Checkout triggered by this click
      // handler, not a render-time mutation - the rule's "modifying a
      // variable defined outside a component" heuristic is over-broad here.
      // eslint-disable-next-line react-hooks/immutability
      window.location.href = res.data;
    } catch (e) {
      toast(e instanceof Error ? e.message : "決済を開始できませんでした。", {
        tone: "danger", title: "エラー",
      });
    } finally {
      setBuying(null);
    }
  }

  function addToNotebook() {
    if (!result) return;
    ws.addClip(
      `AI査読: ${title || "無題"}`,
      peerReviewToMarkdown(result.report, {
        title: title || "無題",
        sourceFilename: file?.name,
        reviewerNames,
        assessment: result.assessment && "data" in result.assessment ? result.assessment.data : null,
      }),
    );
    toast("実験ノートへ追加しました。", { tone: "good" });
  }

  const outOfCredits = credits !== null && credits.remaining <= 0;

  return (
    <div className="flex flex-col gap-5">
      {reviewing && (
        <PendingOverlay
          title="AI査読を実行しています…"
          hint={
            <>
              {profiles.methods.name}・{profiles.novelty.name}・{profiles.structure.name}{" "}
              が論文を読んでいます。1〜2分ほどお待ちください。
            </>
          }
        />
      )}

      <header>
        <h1 className="text-xl font-semibold text-ink">AI査読</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          論文（PDF・Word）を、3名のAI査読者が独立して評価します。トップジャーナル基準・一般的な国際誌基準から評価の厳しさを選べ、
          査読者ごとに性格（口調）も指定・ランダム設定できます。投稿前の疑似査読として、弱点の深刻度、想定されるIFレンジ、
          投稿予定ジャーナルへの採択可能性、修正前後のスコア推移まで得られます。
        </p>
      </header>

      <ReviewerRoster profiles={profiles} />

      <Card title="利用回数について">
        <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-ink-2">
          <li>
            アカウントあたり、<strong className="text-ink">最初の{FREE_PEER_REVIEW_CREDITS}回は無料</strong>
            でご利用いただけます。
          </li>
          <li>
            無料枠を使い切ったあと、および追加購入分は
            <strong className="text-ink">1回の論文分析あたり {formatJpy(100)}</strong>
            です。
          </li>
          <li>
            まとめて買う場合は、30件セット（{formatJpy(2000)}）・無制限の月額プラン（{formatJpy(5000)} / 月）も選べます。
          </li>
          <li>1回の実行で論文1本を3名のAI査読者が評価し、回数を1つ消費します。</li>
        </ul>

        {credits && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="残り合計" value={`${credits.remaining} 回`} tone={credits.remaining ? "accent" : "danger"} />
            <StatTile label="無料の残り" value={`${credits.freeRemaining} 回`} />
            <StatTile label="購入済みの残り" value={`${credits.purchasedBalance} 回`} />
            <StatTile label="これまでの利用" value={`${credits.usedCount} 回`} />
          </div>
        )}
      </Card>

      <Card title="論文をアップロード">
        <div className="flex flex-col gap-3">
          <div
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragging ? "border-accent bg-accent-soft" : "border-line",
            )}
          >
            <Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()} disabled={busy}>
              ファイルを選択
            </Button>
            <p className="text-[12px] text-ink-3">またはここにドラッグ＆ドロップ（PDF・Word / 上限 {MAX_FILE_MB}MB）</p>
            {file && <span className="text-[13px] font-medium text-ink">{file.name}</span>}
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <Field label="タイトル">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="論文のタイトル" />
          </Field>

          <Field
            label="投稿予定のジャーナルURL（任意）"
            hint="ジャーナルの投稿要項ページを貼り付けると、論文の形式が合っているか確認します。"
          >
            <TextInput
              value={journalUrl}
              onChange={(e) => setJournalUrl(e.target.value)}
              placeholder="https://example.com/journal/author-guidelines"
              type="url"
            />
          </Field>

          <Field
            label="投稿予定のジャーナル名（任意）"
            hint="ジャーナル名がわかっている場合、そのジャーナルへの採択可能性（％）を推定します。"
          >
            <TextInput
              value={targetJournalName}
              onChange={(e) => setTargetJournalName(e.target.value)}
              placeholder="例: Osteoarthritis and Cartilage"
            />
          </Field>

          {history.length > 0 && (
            <Field
              label="再査読（任意）"
              hint="以前の査読の修正版として実行すると、スコアの推移を比較できます。"
            >
              <Select value={previousReviewId} onChange={(e) => setPreviousReviewId(e.target.value)}>
                <option value="">新規の査読</option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title}（{h.overall_score}点・{new Date(h.created_at).toLocaleDateString("ja-JP")}）の修正版
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="査読者の性格（任意）"
            hint="査読者ごとに口調を変えられます。指定しない場合は標準的な口調で評価します。"
          >
            <div className="flex flex-col gap-2">
              <div className="grid gap-2 sm:grid-cols-3">
                {REVIEWER_ROLES.map((role) => (
                  <div key={role} className="flex flex-col gap-1">
                    <span className="text-[11px] text-ink-3">{REVIEWER_LABELS[role].title}</span>
                    <Select
                      value={personalities[role] ?? ""}
                      onChange={(e) =>
                        setPersonalities((prev) => ({
                          ...prev,
                          [role]: (e.target.value || undefined) as PersonalityId | undefined,
                        }))
                      }
                    >
                      <option value="">標準</option>
                      {REVIEWER_PERSONALITIES.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="secondary" onClick={randomizePersonalities} disabled={busy} className="w-fit">
                ランダムに設定
              </Button>
            </div>
          </Field>

          <Field label="評価基準">
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(TIER_LABELS) as ReviewTier[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  disabled={busy}
                  className={cx(
                    "flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    tier === t ? "border-accent bg-accent-soft" : "border-line hover:border-accent/50",
                  )}
                >
                  <span className="text-[13px] font-medium text-ink">{TIER_LABELS[t].title}</span>
                  <span className="text-[11px] text-ink-3">{TIER_LABELS[t].description}</span>
                </button>
              ))}
            </div>
          </Field>

          {outOfCredits && (
            <Callout tone="warn" title="残り回数がありません">
              下の「回数を追加する」からパックを購入すると、引き続き査読できます。
            </Callout>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon="search"
              onClick={runReview}
              disabled={!file || busy || outOfCredits}
            >
              {busy ? "査読中…（1〜2分ほどかかります）" : "AI査読を実行"}
            </Button>
            <span className="text-[12px] text-ink-3">
              {credits
                ? `残り ${credits.remaining} 回（無料 ${credits.freeRemaining} ＋ 購入分 ${credits.purchasedBalance}）`
                : `最初の${FREE_PEER_REVIEW_CREDITS}回は無料 · 以降 ${formatJpy(100)} / 回`}
            </span>
          </div>
        </div>
      </Card>

      {result && (
        <Card
          title="AI査読レポート"
          actions={
            <>
              {savedReviewId && (
                <Link
                  href={`/peer-review/${savedReviewId}`}
                  className="text-[12px] text-accent underline underline-offset-2"
                >
                  保存済みの詳細
                </Link>
              )}
              <Button
                size="sm" icon="file"
                onClick={() => setShowText((v) => !v)}
              >
                {showText ? "本文を隠す" : "抽出した本文を表示"}
              </Button>
              <Button
                size="sm" icon="download"
                onClick={() =>
                  download(
                    `${(title || "peer-review").replace(/[^\w.-]+/g, "_")}.md`,
                    peerReviewToMarkdown(result.report, {
                      title,
                      sourceFilename: file?.name,
                      reviewerNames,
                      assessment: result.assessment && "data" in result.assessment ? result.assessment.data : null,
                    }),
                    "text/markdown",
                  )
                }
              >
                .md
              </Button>
              <Button size="sm" icon="notebook" onClick={addToNotebook}>
                ノートへ
              </Button>
            </>
          }
        >
          {showText && (
            <div className="mb-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-[12px] text-ink-2">
              {result.extractedText}
            </div>
          )}

          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatTile
                label="総合評価"
                value={`${result.report.overallScore} / 100`}
                tone={scoreTone(result.report.overallScore)}
                hint={`3名の査読者スコアの平均（${result.report.reviewers.map((r) => r.overall_score).join(" / ")}）`}
              />
              <Badge tone="accent">{TIER_LABELS[result.report.tier].title}で評価</Badge>
            </div>

            <CategoryScoreGrid scores={result.report.categoryScores} />

            <div className="flex flex-col gap-4">
              {result.report.reviewers.map((r) => (
                <ReviewerCard
                  key={r.reviewer} result={r} profile={profiles[r.reviewer]}
                  personality={personalities[r.reviewer]}
                />
              ))}
            </div>
          </div>
        </Card>
      )}

      {chain.length >= 2 && <ScoreTrendCard chain={chain} />}

      {result?.assessment && <PublicationAssessmentCard assessment={result.assessment} />}

      {result?.journalCheck && <JournalCheckCard journalCheck={result.journalCheck} />}

      <Card
        title="査読履歴"
        subtitle="過去のAI査読コメントをあとから開き直せます。"
      >
        {history.length === 0 ? (
          <EmptyState title="まだ査読履歴がありません">
            論文をアップロードして査読を実行すると、ここに結果が残ります。
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-[13px]">
            {history.map((r) => {
              const meta = [
                r.source_filename,
                new Date(r.created_at).toLocaleString("ja-JP"),
              ].filter(Boolean).join(" ・ ");
              return (
                <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {r.title}
                    {r.previous_review_id && <>{" "}<Badge tone="neutral">再査読</Badge></>}
                  </span>
                  <span className="hidden shrink-0 truncate text-[11px] text-ink-3 sm:block sm:max-w-[280px]">
                    {meta}
                  </span>
                  <Badge tone={scoreTone(r.overall_score)}>{r.overall_score} / 100</Badge>
                  <Link
                    href={`/peer-review/${r.id}`}
                    className="shrink-0 text-[12px] text-accent underline underline-offset-2"
                  >
                    コメントを見る
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="回数を追加する"
        subtitle="無料枠のあと、または回数をまとめて確保したいときに購入します。"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {PEER_REVIEW_CREDIT_PACKS.map((pack) => {
            const popular = Boolean(pack.popular);
            return (
              <div
                key={pack.id}
                className={
                  popular
                    ? "relative flex flex-col gap-2 rounded-lg border-2 border-accent bg-accent-soft/40 p-4"
                    : "flex flex-col gap-2 rounded-lg border border-line p-4"
                }
              >
                {popular && (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent-contrast">
                    人気
                  </span>
                )}
                <p className="text-[13px] font-medium text-ink">{pack.name}</p>
                <p className="font-serif text-2xl font-semibold text-ink">
                  {formatJpy(pack.amountJpy)}
                  {pack.billingInterval === "month" && (
                    <span className="ml-1 text-[14px] font-sans font-medium text-ink-2">/ 月</span>
                  )}
                </p>
                <p className="text-[12px] text-ink-3">
                  {pack.billingInterval === "month" ? (
                    <>無制限アクセス</>
                  ) : (
                    <>
                      {pack.credits} 回分
                      {pack.credits > 1 && (
                        <>（1回あたり約 {formatJpy(Math.round(pack.amountJpy / pack.credits))}）</>
                      )}
                    </>
                  )}
                </p>
                <Button
                  variant={popular ? "primary" : "secondary"}
                  size="sm"
                  disabled={buying !== null}
                  onClick={() => void buyPack(pack.id)}
                >
                  {buying === pack.id ? "決済ページへ…" : "購入する"}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/** Who is about to review the paper, shown before a review even starts. */
function ReviewerRoster({ profiles }: { profiles: Record<ReviewerRole, ReviewerProfile> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {(Object.keys(REVIEWER_LABELS) as ReviewerRole[]).map((role) => {
        const profile = profiles[role];
        const { title, focus } = REVIEWER_LABELS[role];
        return (
          <div
            key={role}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2.5"
          >
            <ReviewerAvatar name={profile.name} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{profile.name}</p>
              <p className="truncate text-[11px] text-ink-3">{title} · {focus}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryScoreGrid({ scores }: { scores: CategoryScores }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {(Object.keys(CATEGORY_LABELS) as (keyof CategoryScores)[]).map((key) => {
        const score = scores[key];
        return (
          <div key={key} className="rounded-md border border-line px-3 py-2">
            <p className="text-[11px] text-ink-3">{CATEGORY_LABELS[key]}</p>
            <p className={cx("mt-0.5 text-lg font-semibold tabular-nums", {
              good: "text-good", warn: "text-warn", danger: "text-danger",
            }[scoreTone(score)])}>
              {score}
              <span className="text-[11px] font-normal text-ink-3"> / 100</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ReviewerCard({
  result, profile, personality,
}: {
  result: ReviewerResult;
  profile: ReviewerProfile;
  personality?: PersonalityId;
}) {
  const { title, focus } = REVIEWER_LABELS[result.reviewer];
  const p = personalityById(personality);
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <ReviewerAvatar name={profile.name} size={32} />
          <h3 className="font-serif text-[15px] font-semibold text-ink">
            {profile.name}
            <span className="font-sans text-[13px] font-normal text-ink-3"> ・ {title}（{focus}）</span>
            {p && <span className="ml-1.5 font-sans"><Badge tone="neutral">{p.label}</Badge></span>}
          </h3>
        </div>
        <Badge tone={scoreTone(result.overall_score)}>{result.overall_score} / 100</Badge>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{result.summary}</p>

      {result.major_concerns.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-danger">重大な指摘（深刻度）</p>
          <ol className="mt-1 flex flex-col gap-1.5 pl-4 text-[13px] leading-relaxed text-ink-2">
            {result.major_concerns
              .slice()
              .sort((a, b) => b.severity - a.severity)
              .map((c, i) => (
                <li key={i} className="list-decimal">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {c.issue}
                    <Badge tone={severityTone(c.severity)}>{c.severity} / 10</Badge>
                  </span>
                </li>
              ))}
          </ol>
        </div>
      )}

      {result.minor_concerns.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-warn">軽微な指摘</p>
          <ul className="mt-1 flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-2">
            {result.minor_concerns.map((c, i) => (
              <li key={i} className="list-disc">{c}</li>
            ))}
          </ul>
        </div>
      )}

      {result.recommendations.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-accent">改善提案</p>
          <ul className="mt-1 flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-2">
            {result.recommendations.map((r, i) => (
              <li key={i} className="list-disc">{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const ACCEPTANCE_TONE: Record<string, "good" | "warn" | "danger" | "neutral"> = {
  high: "good",
  moderate: "warn",
  low: "danger",
  very_low: "danger",
};

/** IF range, recommended journals, acceptance likelihood - see publicationAssessment.ts. */
function PublicationAssessmentCard({ assessment }: { assessment: NonNullable<AnalyzeResponse["assessment"]> }) {
  if ("error" in assessment) {
    return (
      <Card title="掲載可能性の評価">
        <Callout tone="warn" title="評価できませんでした">
          {assessment.error}
        </Callout>
      </Card>
    );
  }

  const { data } = assessment;
  return (
    <Card title="掲載可能性の評価（AIによる目安）">
      <div className="flex flex-col gap-5">
        {data.targetJournal && (
          <div className="rounded-lg border-2 border-accent bg-accent-soft/40 p-4">
            <p className="text-[12px] text-ink-3">「{data.targetJournal.name}」への採択可能性</p>
            <p className="mt-0.5 font-serif text-3xl font-semibold text-ink">
              約{data.targetJournal.acceptancePercent}%
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{data.targetJournal.rationale}</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-3">
            <p className="text-[11px] text-ink-3">想定IFレンジ</p>
            <p className="mt-0.5 font-serif text-2xl font-semibold text-ink">
              {data.impactFactorEstimate.min} 〜 {data.impactFactorEstimate.max}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{data.impactFactorEstimate.rationale}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-[11px] text-ink-3">採択可能性の目安</p>
            <div className="mt-0.5 flex items-center gap-2">
              <Badge tone={ACCEPTANCE_TONE[data.acceptanceLikelihood.rating]}>
                {ACCEPTANCE_LIKELIHOOD_LABELS[data.acceptanceLikelihood.rating]}
              </Badge>
              <span className="text-[13px] font-medium text-ink">{data.acceptanceLikelihood.percentRange}</span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{data.acceptanceLikelihood.rationale}</p>
          </div>
        </div>

        {data.recommendedJournals.length > 0 && (
          <div>
            <p className="text-[12px] font-semibold text-ink-2">推奨ジャーナル</p>
            <div className="mt-2 flex flex-col gap-2">
              {data.recommendedJournals.map((j, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-medium text-ink">{j.name}</p>
                    {j.typicalImpactFactor !== null && (
                      <Badge tone="neutral">IF {j.typicalImpactFactor}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{j.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[13px] leading-relaxed text-ink-2">{data.summary}</p>

        <Callout tone="info">
          この評価はAIによる目安です。実際の査読結果・採否を保証するものではありません。
        </Callout>
      </div>
    </Card>
  );
}

const JOURNAL_MATCH_LABEL: Record<JournalFormatMatch, { label: string; tone: "good" | "warn" | "danger" | "neutral" }> = {
  yes: { label: "形式は一致しています", tone: "good" },
  partial: { label: "一部の項目が一致していません", tone: "warn" },
  no: { label: "形式が一致していません", tone: "danger" },
  unknown: { label: "投稿要項を確認できませんでした", tone: "neutral" },
};

/** Separate from the three reviewers - see journalFormatCheck.ts for why. */
function JournalCheckCard({ journalCheck }: { journalCheck: NonNullable<AnalyzeResponse["journalCheck"]> }) {
  if ("error" in journalCheck) {
    return (
      <Card title="投稿先ジャーナルとの形式チェック">
        <Callout tone="warn" title="チェックできませんでした">
          {journalCheck.error}
        </Callout>
      </Card>
    );
  }

  const { data, journalUrl } = journalCheck;
  const { label, tone } = JOURNAL_MATCH_LABEL[data.matches];

  return (
    <Card title="投稿先ジャーナルとの形式チェック">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          <a
            href={journalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[12px] text-accent underline underline-offset-2"
          >
            {journalUrl}
          </a>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-2">{data.summary}</p>
        {data.notes.length > 0 && (
          <ul className="flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-2">
            {data.notes.map((n, i) => (
              <li key={i} className="list-disc">{n}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
