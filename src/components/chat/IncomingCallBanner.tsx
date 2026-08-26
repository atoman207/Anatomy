"use client";

import { Icon } from "@/components/icons";
import type { CallKind } from "@/lib/chat/types";

/** Mounted once for the whole /chat/[labId] tree, so an incoming DM call rings regardless of which conversation is open. */
export function IncomingCallBanner({
  callerName, kind, onAccept, onDecline,
}: {
  callerName: string;
  kind: CallKind;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-line bg-surface-1 p-3 shadow-xl">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-[15px] font-bold text-accent-contrast">
        {callerName.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-ink">{callerName}</p>
        <p className="text-[11px] text-ink-3">{kind === "video" ? "ビデオ通話" : "音声通話"}の着信</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          aria-label="応答"
          onClick={onAccept}
          className="rounded-full bg-good p-2 text-white hover:opacity-90"
        >
          <Icon name="phone" className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="拒否"
          onClick={onDecline}
          className="rounded-full bg-danger p-2 text-white hover:opacity-90"
        >
          <Icon name="phoneOff" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
