"use client";

import { useCallback, useMemo } from "react";
import { Callout } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { ReagentManager, type LabOption } from "@/components/reagents/ReagentManager";
import { SelectionSummary } from "../SelectionSummary";

/**
 * Step 2: pick which of this experiment's reagents today's report is built
 * on - from the existing registry, or newly registered here (auto-selected
 * the moment they're created). The full CRUD registry is unchanged; this
 * only adds a checkbox column on top of it, tracked in the workspace so
 * later steps (the summary bar, the notebook's Lot prefill) can see the
 * selection without re-fetching it themselves.
 */
export function ReagentsStep({ labs }: { labs: LabOption[] }) {
  const ws = useWorkspace();
  const selectedIds = useMemo(() => new Set(ws.selectedReagentIds), [ws.selectedReagentIds]);

  const toggle = useCallback((id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    ws.setSelectedReagents([...next]);
  }, [selectedIds, ws]);

  const onExperimentChange = useCallback((exp: {
    id: string;
    name: string;
    experiment_date: string;
    lab_id: string;
  } | null) => {
    if (exp) {
      if (exp.id === ws.experimentId) return;
      ws.setExperiment({
        experimentId: exp.id,
        labId: exp.lab_id,
        label: `${exp.name}（${exp.experiment_date}）`,
      });
    } else if (ws.experimentId !== null) {
      ws.setExperiment({ experimentId: null, labId: labIdFromLabs(labs, ws.labId), label: null });
    } else {
      return;
    }
    // A different experiment means a different reagent registry - a
    // stale selection from the previous one would silently attach the
    // wrong Lot numbers to today's report.
    ws.setSelectedReagents([]);
  }, [labs, ws]);

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info">
        今日使う試薬・Lotを、一覧から選ぶか新しく登録してください。選んだ試薬は次のステップ以降に引き継がれます。選ばなくても先に進めます。
      </Callout>

      <SelectionSummary upTo={2} />

      <ReagentManager
        labs={labs}
        initialLabId={ws.labId}
        initialExperimentId={ws.experimentId}
        selectable
        selectedIds={selectedIds}
        onToggleSelected={toggle}
        onExperimentChange={onExperimentChange}
      />
    </div>
  );
}

function labIdFromLabs(labs: LabOption[], currentLabId: string | null): string | null {
  if (currentLabId && labs.some((lab) => lab.id === currentLabId)) return currentLabId;
  return labs[0]?.id ?? null;
}
