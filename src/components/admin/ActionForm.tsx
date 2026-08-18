"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Callout } from "@/components/ui";

export interface ActionResult {
  ok: boolean;
  message: string;
}

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * Wraps a server action with its pending state and result message.
 *
 * Every admin mutation reports back in the same shape, so success and failure
 * always land in the same place on screen instead of each form inventing its
 * own feedback.
 */
export function ActionForm({
  action, children, submitLabel, variant = "primary", className, hidden,
  confirm,
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
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);

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
      {state && (
        <Callout tone={state.ok ? "good" : "danger"}>{state.message}</Callout>
      )}
      <SubmitButton variant={variant}>{submitLabel}</SubmitButton>
    </form>
  );
}

/** Inline variant for row-level controls, where a full form block is too heavy. */
export function InlineActionForm({
  action, children, submitLabel, variant = "secondary", hidden, confirm,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  hidden?: Record<string, string>;
  confirm?: string;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);

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
      <SubmitButton variant={variant} size="sm">{submitLabel}</SubmitButton>
      {state && (
        <span
          role="status"
          className={state.ok ? "text-[11px] text-good" : "text-[11px] text-danger"}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}

function SubmitButton({
  children, variant, size = "md",
}: {
  children: ReactNode;
  variant: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
}) {
  // useFormStatus must be read from a child of the form, not the form itself.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? "処理中…" : children}
    </Button>
  );
}
