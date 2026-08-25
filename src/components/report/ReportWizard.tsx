"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Callout, Card, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useWorkspace } from "@/components/workspace";
import type { LabOption } from "@/components/reagents/ReagentManager";
import { StepFooter, StepHeader, type WizardStep } from "./StepHeader";
import { ExperimentStep } from "./steps/ExperimentStep";
import { ReagentsStep } from "./steps/ReagentsStep";
import { TemplateStep } from "./steps/TemplateStep";
import { NotebookStep, type NotebookStepHandle } from "./steps/NotebookStep";
import { LiteratureStep } from "./steps/LiteratureStep";
import { renderElementToPdf, blobToBase64 } from "@/lib/reports/pdf";
import { uploadReportFile } from "@/lib/reports/actions";

const STEPS: WizardStep[] = [
  { id: 1, label: "実験選択" },
  { id: 2, label: "試薬・Lot" },
  { id: 3, label: "テンプレート" },
  { id: 4, label: "実験ノート" },
  { id: 5, label: "論文検索" },
];

function safeFilename(s: string): string {
  return (s || "report").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

export function ReportWizard({ labs }: { labs: LabOption[] }) {
  const ws = useWorkspace();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = ws.wizardStep >= 1 && ws.wizardStep <= 5 ? ws.wizardStep : 1;

  // A redirect from one of the old /notebook, /voice, /reagents, /experiments,
  // /literature routes carries ?step=N so a stale bookmark still lands on the
  // right part of the flow, not always back at step 1.
  useEffect(() => {
    const requested = Number(searchParams.get("step"));
    if (requested >= 1 && requested <= 5) ws.setWizardStep(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const notebookRef = useRef<NotebookStepHandle>(null);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [finished, setFinished] = useState<{ signedUrl: string } | null>(null);

  function goTo(next: number) {
    const target = Math.min(5, Math.max(1, next));
    ws.setWizardStep(target);
    router.replace(`/record?step=${target}`, { scroll: false });
  }

  function next() {
    if (step === 1 && !ws.experimentId) {
      toast("実験を選択するか、新しく作成してください。", { tone: "warn" });
      return;
    }
    if (step === 5) {
      void finish();
      return;
    }
    goTo(step + 1);
  }

  async function generatePdf(kind: "report_preview" | "report_final"): Promise<{
    signedUrl: string | null;
    blobUrl: string;
  } | null> {
    if (!ws.labId || !ws.experimentId) {
      toast("実験が選択されていません。ステップ1に戻ってください。", { tone: "danger" });
      return null;
    }
    const el = notebookRef.current?.getPreviewElement();
    if (!el) {
      toast("実験ノートのプレビューを読み込めませんでした。ステップ4を開いてから試してください。", { tone: "danger" });
      return null;
    }
    const blob = await renderElementToPdf(el);
    const blobUrl = URL.createObjectURL(blob);
    const base64 = await blobToBase64(blob);
    const title = notebookRef.current?.getTitle() || "report";
    const filename = `${safeFilename(title)}${kind === "report_final" ? "" : "_preview"}.pdf`;
    const res = await uploadReportFile({
      labId: ws.labId,
      experimentId: ws.experimentId,
      kind,
      filename,
      mimeType: "application/pdf",
      base64,
    });
    if (!res.ok || !res.data) {
      // Still return the local blob so the researcher can open the PDF even when
      // storage upload fails (quota, missing bucket, etc.).
      toast(res.error ?? "PDFの保存に失敗しました。ローカルコピーを開きます。", { tone: "warn" });
      return { signedUrl: null, blobUrl };
    }
    return { signedUrl: res.data.signedUrl, blobUrl };
  }

  async function finish() {
    if (!ws.experimentId || !ws.labId) {
      toast("実験を選択してください。", { tone: "warn" });
      goTo(1);
      return;
    }
    setPdfBusy(true);
    try {
      const saveRes = await notebookRef.current?.save();
      if (!saveRes?.ok) {
        toast(saveRes?.error ?? "実験ノートの保存に失敗しました。", { tone: "danger" });
        goTo(4);
        return;
      }
      const result = await generatePdf("report_final");
      if (result) {
        setFinished({ signedUrl: result.signedUrl ?? result.blobUrl });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "PDFの作成に失敗しました。", { tone: "danger" });
    } finally {
      setPdfBusy(false);
    }
  }

  function startAnother() {
    ws.reset();
    // A full reload, not router.push: every step component holds its own
    // local state (template, transcript, search results), and a client-side
    // navigation would leave all of that stale even though the workspace
    // store itself was just reset.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/record");
  }

  if (finished) {
    return (
      <Card title="記録を完了しました">
        <div className="flex flex-col gap-4">
          <Callout tone="good">
            実験ノートを保存し、最終版のPDFを実験に記録しました。
          </Callout>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="file" onClick={() => window.open(finished.signedUrl, "_blank", "noopener,noreferrer")}>
              PDFを開く
            </Button>
            <Button icon="refresh" onClick={startAnother}>もう一件記録する</Button>
            <Link href="/dashboard">
              <Button variant="ghost">ダッシュボードに戻る</Button>
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Also listed in the left sidebar (記録 group); this in-page copy is
          what lets a researcher jump straight back to an earlier step to fix
          something without leaving the flow to find the sidebar link. */}
      <StepHeader steps={STEPS} current={step} onJump={goTo} />

      <div className={cx(step === 1 ? "flex flex-col gap-5" : "hidden")}>
        <ExperimentStep />
      </div>
      <div className={cx(step === 2 ? "flex flex-col gap-5" : "hidden")}>
        <ReagentsStep labs={labs} />
      </div>
      <div className={cx(step === 3 ? "flex flex-col gap-5" : "hidden")}>
        <TemplateStep />
      </div>
      {/* Kept mounted even off-screen: the finish action needs its preview
          element and imperative save() regardless of which step is showing. */}
      <div className={cx(step === 4 ? "flex flex-col gap-5" : "hidden")}>
        <NotebookStep ref={notebookRef} />
      </div>
      <div className={cx(step === 5 ? "flex flex-col gap-5" : "hidden")}>
        <LiteratureStep />
      </div>

      <StepFooter
        current={step}
        total={5}
        canGoNext
        busy={pdfBusy}
        nextLabel={step === 5 ? (pdfBusy ? "保存中…" : "完了してPDFを保存") : "次へ"}
        onBack={() => goTo(step - 1)}
        onNext={next}
      />

      {step === 4 && ws.clips.length > 0 && (
        <p className="text-center text-xs text-ink-3">
          <Badge tone="accent">{ws.clips.length}</Badge> 件のグラフ・画像がノートに追加されています。
        </p>
      )}
    </div>
  );
}
