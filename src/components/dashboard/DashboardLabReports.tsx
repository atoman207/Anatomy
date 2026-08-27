"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { MediaPreviewModal } from "@/components/MediaPreviewModal";
import { useToast } from "@/components/shell/Toast";
import { renderMarkdown } from "@/lib/notebook/markdown";
import {
  getMyNotebookEntry,
  type MyNotebookEntriesByExperiment,
  type MyNotebookEntryDetail,
  type MyNotebookEntrySummary,
} from "@/lib/notebook/actions";
import { renderElementToPdf } from "@/lib/reports/pdf";

function safeFilename(s: string): string {
  return (s || "report").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

/**
 * Dashboard list of the caller's lab reports, grouped by experiment.
 * Click a report to preview; download as PDF from the preview modal.
 */
export function DashboardLabReports({
  today,
  groups,
}: {
  today: MyNotebookEntrySummary[];
  groups: MyNotebookEntriesByExperiment[];
}) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<MyNotebookEntryDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfSourceRef = useRef<HTMLDivElement>(null);

  async function openPreview(entryId: string) {
    setLoadingId(entryId);
    try {
      const res = await getMyNotebookEntry(entryId);
      if (!res.ok || !res.data) {
        toast(res.error ?? "レポートを開けませんでした。", { tone: "danger" });
        return;
      }
      setPreview(res.data);
    } catch (e) {
      toast(e instanceof Error ? e.message : "レポートを開けませんでした。", { tone: "danger" });
    } finally {
      setLoadingId(null);
    }
  }

  async function downloadPdf() {
    if (!preview || !pdfSourceRef.current) return;
    setPdfBusy(true);
    try {
      const blob = await renderElementToPdf(pdfSourceRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFilename(preview.title)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("PDFをダウンロードしました。", { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "PDFの作成に失敗しました。", { tone: "danger" });
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-2">今日のラボレポート</h2>
          <Link href="/record?step=4" className="text-xs text-accent underline">
            実験記録を開く
          </Link>
        </div>
        <Card>
          {today.length === 0 ? (
            <EmptyState title="今日作成されたラボレポートはまだありません">
              <Link href="/record?step=4" className="text-accent underline">実験記録</Link>
              でレポートを作成すると、ここに表示されます。
            </EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-[13px]">
              {today.map((r) => (
                <ReportRow
                  key={r.id}
                  entry={r}
                  busy={loadingId === r.id}
                  onOpen={() => void openPreview(r.id)}
                  showLab
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-2">実験とラボレポート</h2>
          <Link href="/experiments" className="text-xs text-accent underline">
            実験一覧を見る
          </Link>
        </div>
        <Card subtitle="あなたが実施した実験ごとに、作成したラボレポートを確認・プレビュー・PDF保存できます。">
          {groups.length === 0 ? (
            <EmptyState title="まだラボレポートがありません">
              <Link href="/record?step=4" className="text-accent underline">実験記録</Link>
              でレポートを作成すると、実験ごとにここへまとまります。
            </EmptyState>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {groups.map((g, i) => (
                <details key={g.experimentId} className="py-2 first:pt-0 last:pb-0" open={i === 0}>
                  <summary className="cursor-pointer text-[13px] font-medium text-ink">
                    {g.experimentName}
                    <span className="ml-1.5 font-normal text-ink-3">
                      ・ {g.labName} ・ {g.entries.length} 件
                    </span>
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1.5 pl-3">
                    {g.entries.map((r) => (
                      <ReportRow
                        key={r.id}
                        entry={r}
                        busy={loadingId === r.id}
                        onOpen={() => void openPreview(r.id)}
                        showTemplate
                      />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </Card>
      </section>

      {preview && (
        <MediaPreviewModal
          title={preview.title}
          onClose={() => setPreview(null)}
          actions={
            <Button
              size="sm"
              variant="primary"
              icon="download"
              disabled={pdfBusy}
              onClick={() => void downloadPdf()}
            >
              {pdfBusy ? "作成中…" : "PDFをダウンロード"}
            </Button>
          }
        >
          <div className="mb-3 flex flex-wrap gap-2 text-[12px] text-ink-3">
            <span>{preview.experiment_name}</span>
            <span>・</span>
            <span>{preview.lab_name}</span>
            <span>・</span>
            <span>{new Date(preview.created_at).toLocaleString("ja-JP")}</span>
            {preview.template_slug && <Badge>{preview.template_slug}</Badge>}
          </div>
          <div
            ref={pdfSourceRef}
            className="prose-note rounded-lg border border-line bg-white px-4 py-3 text-black"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.body_md) }}
          />
        </MediaPreviewModal>
      )}
    </>
  );
}

function ReportRow({
  entry,
  busy,
  onOpen,
  showLab,
  showTemplate,
}: {
  entry: MyNotebookEntrySummary;
  busy: boolean;
  onOpen: () => void;
  showLab?: boolean;
  showTemplate?: boolean;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-[12px] first:pt-0 last:pb-0 sm:text-[13px]">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="min-w-0 flex-1 truncate text-left font-medium text-ink underline-offset-2 hover:text-accent hover:underline disabled:opacity-60"
      >
        {busy ? "読み込み中…" : entry.title}
      </button>
      {showLab && (
        <span className="hidden shrink-0 truncate text-[11px] text-ink-3 sm:block sm:max-w-[240px]">
          {entry.experiment_name} ・ {entry.lab_name}
        </span>
      )}
      {showTemplate && entry.template_slug && <Badge>{entry.template_slug}</Badge>}
      <span className="shrink-0 text-[11px] text-ink-3">
        {showLab
          ? new Date(entry.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
          : new Date(entry.created_at).toLocaleDateString("ja-JP")}
      </span>
      <Button size="sm" variant="ghost" icon="eye" disabled={busy} onClick={onOpen}>
        プレビュー
      </Button>
    </li>
  );
}
