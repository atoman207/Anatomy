"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { pushClientNotice } from "@/components/shell/notificationStore";

/**
 * The single place every transient result — an error, a save confirmation, a
 * warning — surfaces. Pages used to render these inline with `<Callout>`,
 * which pushed the rest of the layout down and stuck around until something
 * else replaced it. A toast reports the same thing without disturbing the
 * page, and clears itself once it has been seen.
 *
 * Every toast is also written into the notification store so the header bell
 * keeps a durable copy after the floating card disappears.
 *
 * This is only for results of something that just happened. Standing
 * explanations that a page needs to keep showing — an empty state, "beta
 * pricing", why a button is disabled — are still `<Callout>`, because those
 * are content, not events, and disappearing after five seconds would just
 * hide information the page still needs to give.
 */

export type ToastTone = "info" | "good" | "warn" | "danger";

export interface ToastOptions {
  tone?: ToastTone;
  title?: string;
  /** Milliseconds before the toast dismisses itself. */
  duration?: number;
  /**
   * When false, the toast is visual-only and is not added to the Notifications
   * list. Used for server notices that are already present in that list.
   */
  persist?: boolean;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  title?: string;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Every toast stays up for about five seconds unless told otherwise. */
const DEFAULT_DURATION = 5000;

const TONE_STYLES: Record<ToastTone, { cls: string; icon: string; label: string }> = {
  info: { cls: "border-line bg-surface-2 text-ink-2", icon: "i", label: "お知らせ" },
  good: { cls: "border-good/30 bg-good-soft text-ink", icon: "✓", label: "正常" },
  warn: { cls: "border-warn/40 bg-warn-soft text-ink", icon: "!", label: "警告" },
  danger: { cls: "border-danger/40 bg-danger-soft text-ink", icon: "✕", label: "エラー" },
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, options?: ToastOptions) => {
    const tone = options?.tone ?? "info";
    const title = options?.title;
    const id = nextId.current++;
    setItems((prev) => [
      ...prev,
      {
        id,
        message,
        tone,
        title,
        duration: options?.duration ?? DEFAULT_DURATION,
      },
    ]);

    // Default: keep a copy in the bell. Skip when the caller already has the
    // same item in the notifications API response (see AppShell).
    if (options?.persist !== false) {
      pushClientNotice({
        tone,
        // Prefer an explicit title; otherwise the message is the headline.
        title: title ?? message,
        detail: title ? message : "",
      });
    }
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  items, onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      // Above the mobile drawer (z-50) and everything else in the shell.
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2 sm:right-5 sm:top-5"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => onDismiss(item.id)} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const config = TONE_STYLES[item.tone];
  const remaining = useRef(item.duration);
  // Always overwritten by arm() before it's read; 0 keeps this initializer pure.
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    startedAt.current = Date.now();
    timer.current = setTimeout(onDismiss, remaining.current);
  }, [onDismiss]);

  useEffect(() => {
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hovering (or focusing, for keyboard users) holds the toast open, so
  // reading a longer message doesn't race the five-second clock.
  const pause = () => {
    if (timer.current) clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  };
  const resume = () => {
    if (remaining.current > 0) arm();
  };

  return (
    <div
      role="status"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className={cx(
        "pointer-events-auto flex gap-2.5 rounded-md border px-4 py-3 text-[14px] leading-relaxed shadow-[var(--shadow-md)]",
        "motion-safe:animate-[toast-in_0.18s_ease-out]",
        config.cls,
      )}
    >
      <span aria-hidden className="mt-px font-bold">{config.icon}</span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{config.label}: </span>
        {item.title && <p className="font-semibold text-ink">{item.title}</p>}
        <p>{item.message}</p>
      </div>
      <button
        type="button"
        aria-label="閉じる"
        onClick={onDismiss}
        className="-m-1 shrink-0 self-start rounded p-1 text-ink-3 hover:bg-black/5 hover:text-ink"
      >
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
