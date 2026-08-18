import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, ButtonHTMLAttributes } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  title, subtitle, children, actions, className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-xl border border-line bg-surface-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({
  variant = "secondary", size = "md", className, ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  const variants = {
    primary:
      "bg-accent text-accent-contrast hover:opacity-90 disabled:hover:opacity-50",
    secondary:
      "border border-line-strong bg-surface-1 text-ink hover:bg-surface-2",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "border border-line-strong bg-surface-1 text-danger hover:bg-danger-soft",
  }[variant];
  return <button className={cx(base, sizes, variants, className)} {...rest} />;
}

export function Field({
  label, hint, children, htmlFor, className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}

const controlClass =
  "w-full rounded-lg border border-line-strong bg-surface-1 px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent";

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClass, className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(controlClass, "min-h-20 resize-y", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(controlClass, "cursor-pointer", className)} {...rest}>
      {children}
    </select>
  );
}

export function Badge({
  children, tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger" | "accent";
}) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    accent: "bg-accent-soft text-accent",
  }[tone];
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tones)}>
      {children}
    </span>
  );
}

/**
 * Status messages. The icon and label carry the meaning alongside colour so
 * the state is never communicated by colour alone.
 */
export function Callout({
  tone = "info", title, children,
}: {
  tone?: "info" | "good" | "warn" | "danger";
  title?: ReactNode;
  children?: ReactNode;
}) {
  const config = {
    info: { cls: "border-line bg-surface-2 text-ink-2", icon: "i", label: "お知らせ" },
    good: { cls: "border-good/30 bg-good-soft text-ink", icon: "✓", label: "正常" },
    warn: { cls: "border-warn/40 bg-warn-soft text-ink", icon: "!", label: "警告" },
    danger: { cls: "border-danger/40 bg-danger-soft text-ink", icon: "✕", label: "エラー" },
  }[tone];
  return (
    <div className={cx("flex gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", config.cls)}>
      <span aria-hidden className="mt-px font-bold">{config.icon}</span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{config.label}: </span>
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 text-xs text-ink-3">{children}</div>}
    </div>
  );
}

/** Data table. Always wrapped in its own horizontal scroller. */
export function DataTable({
  headers, rows, maxHeight, align,
}: {
  headers: readonly ReactNode[];
  rows: readonly (readonly ReactNode[])[];
  maxHeight?: string;
  align?: ("left" | "right")[];
}) {
  return (
    <div className="scroll-x rounded-lg border border-line" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className={cx(
                  "whitespace-nowrap border-b border-line px-2.5 py-2 font-semibold text-ink-2",
                  align?.[i] === "right" ? "text-right" : "text-left",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="even:bg-surface-2/40">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={cx(
                    "border-b border-line px-2.5 py-1.5 text-ink",
                    align?.[ci] === "right" ? "text-right tabular-nums" : "text-left",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-ink-3">行がありません。</p>
      )}
    </div>
  );
}

export function StatTile({
  label, value, hint, tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "warn" | "danger" | "accent";
}) {
  const valueTone = tone
    ? { good: "text-good", warn: "text-warn", danger: "text-danger", accent: "text-accent" }[tone]
    : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={cx("mt-0.5 text-xl font-semibold tabular-nums", valueTone)}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}
