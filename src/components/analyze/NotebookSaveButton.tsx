"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { saveAnalysis } from "@/lib/analyze/actions";
import type { AnalysisKind } from "@/lib/supabase/types";

/**
 * The one button every analysis section uses to leave the page.
 *
 * It always queues the Markdown clip for the current notebook draft. When
 * an experiment is selected it additionally writes an immutable `analyses`
 * row - the method, its exact parameters, and its result - so the number
 * that ends up in a paper can always be traced back to how it was produced.
 */
export function NotebookSaveButton({
  title, markdown, kind, params, result,
}: {
  title: string;
  markdown: string;
  kind: AnalysisKind;
  params: unknown;
  result: unknown;
}) {
  const ws = useWorkspace();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function handle() {
    ws.addClip(title, markdown);
    if (!ws.experimentId || !ws.labId) return;
    setState("saving");
    const res = await saveAnalysis({
      labId: ws.labId,
      experimentId: ws.experimentId,
      datasetId: null,
      kind,
      title,
      params,
      result,
    });
    setState(res.ok ? "saved" : "error");
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" icon="notebook" onClick={handle} disabled={state === "saving"}>
        {state === "saving" ? "保存中…" : "ノートへ"}
      </Button>
      {state === "saved" && <Badge tone="good">実験に記録済み</Badge>}
      {state === "error" && <Badge tone="danger">記録に失敗</Badge>}
    </div>
  );
}
