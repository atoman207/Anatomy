"use client";

import { Callout } from "@/components/ui";
import { ExperimentPicker } from "@/components/ExperimentPicker";

/** Step 1: pick or create today's experiment. Every later step targets it. */
export function ExperimentStep() {
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info">
        まずこの記録を紐づける実験を選ぶか、新しく作成してください。この先の試薬・音声メモ・実験ノート・論文検索はすべてここで選んだ実験に記録されます。
      </Callout>
      <ExperimentPicker helpText="この記録全体を紐づける実験を選びます。" />
    </div>
  );
}
