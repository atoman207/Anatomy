"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";

interface SampleReport {
  file: string;
  templateName: string;
  title: string;
  description: string;
}

/**
 * Three completed lab reports, one per built-in template (see
 * BUILT_IN_TEMPLATES in src/lib/notebook/templates.ts), rendered exactly the
 * way the record wizard's own PDF export does (see .prose-note.report-paper
 * in src/app/globals.css) - so "what does a finished report actually look
 * like" has a real answer instead of only a description.
 */
const SAMPLE_REPORTS: SampleReport[] = [
  {
    file: "/sample-reports/sample-report-generic.pdf",
    templateName: "汎用実験ノート",
    title: "タンパク質サンプルの前処理",
    description: "目的・使用試薬・手順・結果・考察を順番に記録する、最も基本的なテンプレートの例です。",
  },
  {
    file: "/sample-reports/sample-report-western-blot.pdf",
    templateName: "ウェスタンブロット",
    title: "p53発現量の確認",
    description: "抗体の希釈率や転写条件、レーン割当まで含めて記録する、生化学向けテンプレートの例です。",
  },
  {
    file: "/sample-reports/sample-report-rt-qpcr.pdf",
    templateName: "RT-qPCR",
    title: "IL-6 mRNA発現量の定量",
    description: "測定条件・標的遺伝子・解析法まで含めて記録する、分子生物学向けテンプレートの例です。",
  },
];

export function SampleReportsSection() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6">
      <Button variant="primary" onClick={() => setOpen((v) => !v)}>
        {open ? "テンプレート例を閉じる" : "テンプレートを見る"}
      </Button>

      {open && (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {SAMPLE_REPORTS.map((r) => (
            <Card
              key={r.file}
              title={r.templateName}
              subtitle={r.title}
              className="flex flex-col"
            >
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-ink-2">{r.description}</p>
                <div className="overflow-hidden rounded-md border border-line">
                  <iframe
                    src={`${r.file}#toolbar=0&navpanes=0`}
                    title={`${r.templateName} レポートPDFのプレビュー`}
                    className="h-64 w-full bg-white"
                  />
                </div>
                <a
                  href={r.file}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium text-accent underline underline-offset-2"
                >
                  PDFを新しいタブで開く
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
