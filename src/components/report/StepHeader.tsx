"use client";

import { Button, cx } from "@/components/ui";

export interface WizardStep {
  id: number;
  label: string;
}

export function StepHeader({
  steps, current, onJump,
}: {
  steps: WizardStep[];
  current: number;
  /** Jumping is allowed only backward, to a step already visited. */
  onJump: (step: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {steps.map((s) => {
        const done = s.id < current;
        const active = s.id === current;
        return (
          <li key={s.id}>
            <button
              type="button"
              disabled={s.id > current}
              onClick={() => onJump(s.id)}
              className={cx(
                "rounded-full px-3 py-1 font-medium transition-colors disabled:cursor-not-allowed",
                active
                  ? "bg-accent text-accent-contrast"
                  : done
                    ? "bg-accent-soft/50 text-accent hover:bg-accent-soft"
                    : "bg-surface-2 text-ink-3",
              )}
            >
              {s.id}. {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StepFooter({
  current, total, canGoNext, nextLabel, busy, onBack, onNext,
}: {
  current: number;
  total: number;
  canGoNext: boolean;
  nextLabel: string;
  busy?: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
      <Button variant="ghost" icon="arrow" onClick={onBack} disabled={current === 1 || busy}>
        戻る
      </Button>
      <p className="text-xs text-ink-3">
        ステップ {current} / {total}
      </p>
      <Button variant="primary" icon={current === total ? "check" : "arrow"} onClick={onNext} disabled={!canGoNext || busy}>
        {nextLabel}
      </Button>
    </div>
  );
}
