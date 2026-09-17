"use client";

import { useState } from "react";
import { AssistantChatModal, type ChatViewer } from "./AssistantChatModal";
import { Icon } from "@/components/icons";

/**
 * The one assistant chatbot, on the home page (`/`). Usable without signing
 * in (the API routes are open to guests, rate limited).
 *
 * Opens as a single modal on arrival; closing collapses it to a small live
 * launcher in the lower-left so it stays reachable while scrolling.
 */
export function LandingChatbot({
  fallbackLabId,
  historyScope,
  viewer,
}: {
  fallbackLabId: string | null;
  /** Local history partition: the account, or "guest". */
  historyScope: string;
  viewer: ChatViewer;
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <AssistantChatModal
        open={open}
        onClose={() => setOpen(false)}
        fallbackLabId={fallbackLabId}
        historyScope={historyScope}
        viewer={viewer}
      />
      {!open && (
        <button
          type="button"
          className="group fixed bottom-5 left-5 z-40 flex items-center gap-3 rounded-full bg-surface-1/95 p-1.5 pr-5 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.35)] ring-1 ring-black/5 backdrop-blur transition hover:-translate-y-0.5"
          aria-label="研究アシスタントと話す"
          onClick={() => setOpen(true)}
        >
          <span className="relative grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-white">
            <Icon name="mic" className="h-5 w-5" />
            <span
              aria-hidden
              className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white"
            />
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[14px] font-semibold text-ink">研究アシスタント</span>
            <span className="mt-0.5 block text-[12px] text-ink-3">話しかける</span>
          </span>
        </button>
      )}
    </>
  );
}
