"use client";

import { Button, cx } from "@/components/ui";

export interface WizardStep {
  id: number;
  label: string;
}

/**
 * Circular connected stepper (Lab Nexus–style).
 * Numbers sit in the circles; labels appear underneath.
 * Jumping is allowed only backward, to a step already visited.
 */
export function StepHeader({
  steps, current, onJump,
}: {
  steps: WizardStep[];
  current: number;
  onJump: (step: number) => void;
}) {
  return (
    <nav aria-label="記録の手順" className="w-full overflow-x-auto px-1 py-2">
      <ol className="mx-auto flex min-w-[min(100%,36rem)] max-w-3xl items-start justify-between">
        {steps.map((s, index) => {
          const done = s.id < current;
          const active = s.id === current;
          const reachable = s.id <= current;
          const lineDone = s.id < current;

          return (
            <li
              key={s.id}
              className={cx(
                "relative flex flex-1 flex-col items-center text-center",
                index < steps.length - 1 && "pr-1",
              )}
            >
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cx(
                    "absolute left-[calc(50%+1.125rem)] right-[calc(-50%+1.125rem)] top-4 h-0.5",
                    lineDone ? "bg-accent" : "bg-line",
                  )}
                />
              )}

              <button
                type="button"
                disabled={!reachable}
                onClick={() => onJump(s.id)}
                aria-current={active ? "step" : undefined}
                aria-label={`${s.id}. ${s.label}`}
                className={cx(
                  "relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  "disabled:cursor-not-allowed",
                  active || done
                    ? "bg-accent text-accent-contrast shadow-[var(--shadow-sm)]"
                    : "border-2 border-line bg-surface-1 text-ink-3",
                  done && !active && "hover:bg-[var(--accent-hover)]",
                  active && "ring-4 ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]",
                )}
              >
                {s.id}
              </button>

              <span
                className={cx(
                  "mt-2 max-w-[6.5rem] text-[11px] leading-snug sm:max-w-[7.5rem] sm:text-[12px]",
                  active
                    ? "font-semibold text-accent"
                    : done
                      ? "font-medium text-ink-2"
                      : "font-medium text-ink-3",
                )}
              >
                {s.id}. {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
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
      <Button variant="ghost" icon="arrowLeft" onClick={onBack} disabled={current === 1 || busy}>
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
