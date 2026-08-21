"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge, Button, Callout, Card, EmptyState, Field, PendingOverlay, StatTile, TextInput, cx,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useDownload, useWorkspace } from "@/components/workspace";
import { ExperimentPicker } from "@/components/ExperimentPicker";
import { ReviewerAvatar } from "./ReviewerAvatar";
import {
  CATEGORY_LABELS, REVIEWER_LABELS, peerReviewToMarkdown,
  type CategoryScores, type ReviewerResult, type ReviewerRole,
} from "@/lib/ai/peerReviewReport";
import type { ReviewerProfile } from "@/lib/ai/reviewerProfiles";
import {
  getPeerReview, listPeerReviews, savePeerReview, type PeerReviewSummary,
} from "@/lib/peerReview/actions";
import type { AnalyzeResponse } from "@/app/api/peer-review/analyze/route";

const MAX_PDF_MB = 25;

/** score >= 70 solid, 50-69 needs major revision, below that reject-level — matches the reviewer prompts' own rubric. */
function scoreTone(score: number): "good" | "warn" | "danger" {
  if (score >= 70) return "good";
  if (score >= 50) return "warn";
  return "danger";
}

export function PeerReviewWorkspace({
  profiles,
}: {
  profiles: Record<ReviewerRole, ReviewerProfile>;
}) {
  const ws = useWorkspace();
  const download = useDownload();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  /** Distinct from `busy`: only true for the AI call itself, so the overlay does not appear for the quick re-review-history fetch. */
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [showText, setShowText] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const [history, setHistory] = useState<PeerReviewSummary[]>([]);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  const [reReviewOf, setReReviewOf] = useState<PeerReviewSummary | null>(null);

  const reviewerNames: Partial<Record<ReviewerRole, string>> = {
    methods: profiles.methods.name,
    novelty: profiles.novelty.name,
    structure: profiles.structure.name,
  };

  useEffect(() => {
    const experimentId = ws.experimentId;
    if (!experimentId) return;
    let cancelled = false;
    listPeerReviews(experimentId).then((res) => {
      if (!cancelled && res.ok && res.data) setHistory(res.data);
      if (!cancelled) setHistoryLoadedFor(experimentId);
    });
    return () => {
      cancelled = true;
    };
  }, [ws.experimentId]);

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
    setSavedId(null);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ""));
  }

  async function runReview() {
    if (!file) return;
    setBusy(true);
    setReviewing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (ws.labId) form.append("labId", ws.labId);

      const res = await fetch("/api/peer-review/analyze", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `査読に失敗しました (${res.status})`);

      setResult(json as AnalyzeResponse);
      setSavedId(null);
      toast("査読が完了しました。", { tone: "good" });
      if (json.truncated) {
        toast("本文が長いため、一部を切り詰めて査読しました。", { tone: "warn" });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "査読に失敗しました。", { tone: "danger" });
    } finally {
      setBusy(false);
      setReviewing(false);
    }
  }

  async function save() {
    if (!result || !ws.experimentId || !ws.labId) return;
    setSaving(true);
    try {
      const res = await savePeerReview({
        labId: ws.labId,
        experimentId: ws.experimentId,
        title: title.trim() || "無題の査読",
        sourceFilename: file?.name ?? null,
        extractedText: result.extractedText,
        report: result.report,
        previousReviewId: reReviewOf?.id ?? null,
      });
      if (!res.ok || !res.data) throw new Error(res.error ?? "保存に失敗しました。");
      setSavedId(res.data.id);
      toast("査読結果を保存しました。", { tone: "good" });
      setReReviewOf(null);
      if (ws.experimentId) {
        const refreshed = await listPeerReviews(ws.experimentId);
        if (refreshed.ok && refreshed.data) setHistory(refreshed.data);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  function addToNotebook() {
    if (!result) return;
    ws.addClip(
      `AI査読: ${title || "無題"}`,
      peerReviewToMarkdown(result.report, { title: title || "無題", sourceFilename: file?.name, reviewerNames }),
    );
    toast("実験ノートへ追加しました。", { tone: "good" });
  }

  async function loadForReReview(summary: PeerReviewSummary) {
    setBusy(true);
    try {
      const res = await getPeerReview(summary.id);
      if (!res.ok || !res.data) throw new Error(res.error ?? "読み込みに失敗しました。");
      setReReviewOf(summary);
      setTitle(summary.title);
      setResult(null);
      setFile(null);
      toast(
        `「${summary.title}」の再査読を開始します。修正版のPDFを選択してください。`,
        { tone: "info" },
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "読み込みに失敗しました。", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

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

      <ExperimentPicker helpText="ここで選んだ実験に、査読結果を保存できます。" />

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

          {reReviewOf && (
            <Callout tone="info" title="再査読">
              「{reReviewOf.title}」（前回スコア {reReviewOf.overall_score} / 100）の修正版として保存されます。
            </Callout>
          )}

          <Field label="タイトル">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="論文のタイトル" />
          </Field>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              icon="search"
              onClick={runReview}
              disabled={!file || busy}
            >
              {busy ? "査読中…（1〜2分ほどかかります）" : "AI査読を実行"}
            </Button>
            <span className="text-[12px] text-ink-3">プロプラン以上が必要です。</span>
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
                    peerReviewToMarkdown(result.report, { title, sourceFilename: file?.name, reviewerNames }),
                    "text/markdown",
                  )
                }
              >
                .md
              </Button>
              <Button size="sm" icon="notebook" onClick={addToNotebook}>
                ノートへ
              </Button>
              <Button
                size="sm" variant="primary" icon="save"
                disabled={!ws.experimentId || !ws.labId || saving || savedId !== null}
                title={ws.experimentId ? undefined : "上で実験を選択してください"}
                onClick={save}
              >
                {saving ? "保存中…" : savedId ? "保存済み" : "実験に保存"}
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

      <Card title={`この実験の査読履歴${history.length ? `（${history.length}）` : ""}`}>
        {!ws.experimentId ? (
          <EmptyState title="実験を選択すると履歴が表示されます" />
        ) : historyLoadedFor !== ws.experimentId ? (
          <p className="text-[13px] text-ink-3">読み込み中…</p>
        ) : history.length === 0 ? (
          <EmptyState title="この実験の査読はまだありません" />
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {h.title}
                    {h.previous_review_id && <Badge tone="neutral"> 再査読</Badge>}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    {new Date(h.created_at).toLocaleString()}
                    {h.source_filename && <> · {h.source_filename}</>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={scoreTone(h.overall_score)}>{h.overall_score} / 100</Badge>
                  <Button size="sm" variant="ghost" onClick={() => loadForReReview(h)} disabled={busy}>
                    再査読
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
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
