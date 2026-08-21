"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import type { IconName } from "@/components/icons";

export interface ActionResult {
  ok: boolean;
  message: string;
}

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * Wraps a server action with its pending state and result message.
 *
 * Every admin mutation reports back in the same shape, so success and failure
 * always surface the same way — as a toast — instead of each form inventing
 * its own feedback.
 */
export function ActionForm({
  action, children, submitLabel, variant = "primary", className, hidden,
  confirm, icon,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  /** Fields sent with every submission. */
  hidden?: Record<string, string>;
  /** Browser confirmation shown before an irreversible action. */
  confirm?: string;
  icon?: IconName;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);
  useResultToast(state);

  return (
    <form
      action={formAction}
      className={className ?? "flex flex-col gap-3"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      {children}
      <SubmitButton variant={variant} icon={icon ?? (variant === "danger" ? "trash" : "check")}>{submitLabel}</SubmitButton>
    </form>
  );
}

/** Inline variant for row-level controls, where a full form block is too heavy. */
export function InlineActionForm({
  action, children, submitLabel, variant = "secondary", hidden, confirm, icon,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  hidden?: Record<string, string>;
  confirm?: string;
  icon?: IconName;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);
  useResultToast(state);

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      {children}
      <SubmitButton variant={variant} size="sm" icon={icon ?? (variant === "danger" ? "trash" : "check")}>{submitLabel}</SubmitButton>
    </form>
  );
}

/**
 * Reports an action's result as a toast the moment it changes.
 *
 * `useActionState` hands back a new object identity each time the action
 * completes (even a retried failure with the same text), so this fires
 * exactly once per submission rather than once per distinct message.
 */
function useResultToast(state: ActionResult | null) {
  const { toast } = useToast();
  const last = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    toast(state.message, { tone: state.ok ? "good" : "danger" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

function SubmitButton({
  children, variant, size = "md", icon,
}: {
  children: ReactNode;
  variant: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  icon?: IconName;
}) {
  // useFormStatus must be read from a child of the form, not the form itself.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} icon={icon}>
      {pending ? "処理中…" : children}
    </Button>
  );
}
