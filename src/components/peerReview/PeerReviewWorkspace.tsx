"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Badge, Button, Callout, Card, Field, PendingOverlay, StatTile, TextInput, cx,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useDownload, useWorkspace } from "@/components/workspace";
import { ReviewerAvatar } from "./ReviewerAvatar";
import {
  CATEGORY_LABELS, REVIEWER_LABELS, peerReviewToMarkdown, scoreTone,
  type CategoryScores, type ReviewerResult, type ReviewerRole,
} from "@/lib/ai/peerReviewReport";
import type { ReviewerProfile } from "@/lib/ai/reviewerProfiles";
import type { AnalyzeResponse } from "@/app/api/peer-review/analyze/route";
import {
  getMyPeerReviewCredits, startCreditCheckout,
} from "@/lib/peerReview/creditActions";
import type { PeerReviewCredits } from "@/lib/peerReview/credits";
import {
  FREE_PEER_REVIEW_CREDITS, PEER_REVIEW_CREDIT_PACKS,
} from "@/lib/peerReview/creditPacks";
import { formatJpy } from "@/lib/billing/plans";

const MAX_PDF_MB = 25;

/**
 * Upload a PDF and run AI peer review without tying the run to an experiment.
 *
 * Entitlement is personal credits: a free allowance, then purchased packs.
 */
export function PeerReviewWorkspace({
  profiles,
}: {
  profiles: Record<ReviewerRole, ReviewerProfile>;
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
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
    void refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (!checkout) return;
    if (checkout === "success") {
      toast("決済が完了しました。回数を反映しています…", { tone: "good" });
      void refreshCredits();
    } else if (checkout === "cancel") {
      toast("決済をキャンセルしました。", { tone: "info" });
    }
    router.replace("/peer-review");
  }, [searchParams, refreshCredits, router, toast]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      toast("PDFファイルを選択してください。", { tone: "danger" });
      return;
    }
    if (f.size > MAX_PDF_MB * 1024 * 1024) {
      toast(`ファイルが大きすぎます（上限 ${MAX_PDF_MB} MB）。`, { tone: "danger" });
      return;
    }
    setFile(f);
    setResult(null);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ""));
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

      const res = await fetch("/api/peer-review/analyze", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `査読に失敗しました (${res.status})`);

      setResult(json as AnalyzeResponse);
      toast("査読が完了しました。", { tone: "good" });
      if (json.truncated) {
        toast("本文が長いため、一部を切り詰めて査読しました。", { tone: "warn" });
      }
      void refreshCredits();
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
          論文PDFを、3名のAI査読者が独立して評価します。
          投稿前の疑似査読として、弱点の特定と具体的な改善提案を得られます。
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
            まとめて買う場合は、10件セット（{formatJpy(800)}）・100件セット（{formatJpy(5000)}）も選べます。
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()} disabled={busy}>
              PDFを選択
            </Button>
            {file && <span className="text-[13px] text-ink-2">{file.name}</span>}
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
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
            <div className="flex items-center gap-4">
              <StatTile
                label="総合評価"
                value={`${result.report.overallScore} / 100`}
                tone={scoreTone(result.report.overallScore)}
                hint={`3名の査読者スコアの平均（${result.report.reviewers.map((r) => r.overall_score).join(" / ")}）`}
              />
            </div>

            <CategoryScoreGrid scores={result.report.categoryScores} />

            <div className="flex flex-col gap-4">
              {result.report.reviewers.map((r) => (
                <ReviewerCard key={r.reviewer} result={r} profile={profiles[r.reviewer]} />
              ))}
            </div>
          </div>
        </Card>
      )}

      <Card
        title="回数を追加する"
        subtitle="無料枠のあと、または回数をまとめて確保したいときに購入します。"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {PEER_REVIEW_CREDIT_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="flex flex-col gap-2 rounded-lg border border-line p-4"
            >
              <p className="text-[13px] font-medium text-ink">{pack.name}</p>
              <p className="font-serif text-2xl font-semibold text-ink">
                {formatJpy(pack.amountJpy)}
              </p>
              <p className="text-[12px] text-ink-3">
                {pack.credits} 回分
                {pack.credits > 1 && (
                  <>（1回あたり約 {formatJpy(Math.round(pack.amountJpy / pack.credits))}）</>
                )}
              </p>
              <Button
                variant={pack.id === "ten" ? "primary" : "secondary"}
                size="sm"
                disabled={buying !== null}
                onClick={() => void buyPack(pack.id)}
              >
                {buying === pack.id ? "決済ページへ…" : "購入する"}
              </Button>
            </div>
          ))}
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

function ReviewerCard({ result, profile }: { result: ReviewerResult; profile: ReviewerProfile }) {
  const { title, focus } = REVIEWER_LABELS[result.reviewer];
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <ReviewerAvatar name={profile.name} size={32} />
          <h3 className="font-serif text-[15px] font-semibold text-ink">
            {profile.name}
            <span className="font-sans text-[13px] font-normal text-ink-3"> ・ {title}（{focus}）</span>
          </h3>
        </div>
        <Badge tone={scoreTone(result.overall_score)}>{result.overall_score} / 100</Badge>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{result.summary}</p>

      {result.major_concerns.length > 0 && (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-danger">重大な指摘</p>
          <ol className="mt-1 flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-2">
            {result.major_concerns.map((c, i) => (
              <li key={i} className="list-decimal">{c}</li>
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
