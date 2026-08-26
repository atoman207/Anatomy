"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { CallManager } from "@/lib/chat/webrtc";
import { startOrJoinCallAction, joinCallAction, leaveCallAction } from "@/lib/chat/actions";
import type { CallKind } from "@/lib/chat/types";
import { useToast } from "@/components/shell/Toast";
import { CallPanel } from "./CallPanel";
import { IncomingCallBanner } from "./IncomingCallBanner";

export type CallTarget =
  | { channelId: string; title: string }
  | { dmConversationId: string; otherUserId: string; title: string };

interface ActiveCall {
  callId: string;
  kind: CallKind;
  target: CallTarget;
}

interface IncomingCall {
  callId: string;
  callerName: string;
  kind: CallKind;
  dmConversationId: string;
  otherUserId: string;
}

interface CallContextValue {
  activeCall: ActiveCall | null;
  startCall: (target: CallTarget, kind: CallKind) => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useChatCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useChatCall must be used within CallProvider");
  return ctx;
}

/**
 * Owns call state for the whole /chat/[labId] subtree - lifted above the
 * per-conversation `ChatRoom` so switching channels or DMs mid-call does
 * not tear down the `RTCPeerConnection`s, the same way Slack huddles
 * survive a channel switch.
 */
export function CallProvider({
  labId, viewerId, viewerDisplayName, children,
}: {
  labId: string;
  viewerId: string;
  viewerDisplayName: string;
  children: ReactNode;
}) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const managerRef = useRef<CallManager | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`user:${viewerId}:ring`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "ring" }, ({ payload }) => setIncoming(payload as IncomingCall)).subscribe();
    return () => void supabase.removeChannel(channel);
  }, [viewerId]);

  const joinAndTrack = useCallback(
    async (callId: string, kind: CallKind, target: CallTarget) => {
      // Idempotent for the call's starter (startCallAction already inserted
      // their row) - upserting again just refreshes joined_at/clears
      // left_at, and this is the one place a joiner's MAX_CALL_PARTICIPANTS
      // check actually runs.
      const joined = await joinCallAction(callId);
      if (!joined.ok) {
        toast(joined.error ?? "通話に参加できませんでした。", { tone: "danger", title: "エラー" });
        return false;
      }

      const manager = new CallManager(viewerId, viewerDisplayName, {
        onRemoteStream: (peerId, stream) =>
          setRemoteStreams((prev) => new Map(prev).set(peerId, stream)),
        onPeerLeft: (peerId) =>
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          }),
        onLocalStream: setLocalStream,
      });
      try {
        await manager.join(callId, kind);
      } catch (e) {
        manager.leave();
        void leaveCallAction(callId);
        toast(e instanceof Error ? e.message : "通話を開始できませんでした。", {
          tone: "danger",
          title: "エラー",
        });
        return false;
      }
      managerRef.current = manager;
      setActiveCall({ callId, kind, target });
      return true;
    },
    [viewerId, viewerDisplayName, toast],
  );

  const startCall = useCallback(
    (target: CallTarget, kind: CallKind) => {
      if (activeCall) return;
      void (async () => {
        const result = await startOrJoinCallAction({
          labId,
          channelId: "channelId" in target ? target.channelId : undefined,
          dmConversationId: "dmConversationId" in target ? target.dmConversationId : undefined,
          kind,
        });
        if (!result.ok || !result.data) {
          toast(result.error ?? "通話を開始できませんでした。", { tone: "danger", title: "エラー" });
          return;
        }
        const joined = await joinAndTrack(result.data.callId, kind, target);
        if (!joined) return;

        // Only ring for a call this action actually created - joining one
        // already in progress (someone else's huddle, or a DM call that
        // already rang once) should not ring a second time.
        if (result.data.created && "dmConversationId" in target) {
          const supabase = createClient();
          const ringChannel = supabase.channel(`user:${target.otherUserId}:ring`);
          ringChannel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              void ringChannel.send({
                type: "broadcast",
                event: "ring",
                payload: {
                  callId: result.data!.callId,
                  callerName: viewerDisplayName,
                  kind,
                  dmConversationId: target.dmConversationId,
                  otherUserId: viewerId,
                } satisfies IncomingCall,
              });
              setTimeout(() => void supabase.removeChannel(ringChannel), 2000);
            }
          });
        }
      })();
    },
    [activeCall, labId, joinAndTrack, viewerDisplayName, viewerId, toast],
  );

  const acceptIncoming = useCallback(() => {
    if (!incoming) return;
    const target: CallTarget = {
      dmConversationId: incoming.dmConversationId,
      otherUserId: incoming.otherUserId,
      title: incoming.callerName,
    };
    void joinAndTrack(incoming.callId, incoming.kind, target);
    setIncoming(null);
  }, [incoming, joinAndTrack]);

  const endCall = useCallback(() => {
    if (!activeCall) return;
    managerRef.current?.leave();
    managerRef.current = null;
    void leaveCallAction(activeCall.callId);
    setActiveCall(null);
    setLocalStream(null);
    setRemoteStreams(new Map());
  }, [activeCall]);

  // Best-effort cleanup if the tab closes mid-call.
  useEffect(() => {
    if (!activeCall) return;
    const onUnload = () => managerRef.current?.leave();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [activeCall]);

  const value = useMemo(() => ({ activeCall, startCall }), [activeCall, startCall]);

  return (
    <CallContext.Provider value={value}>
      {/* Relative frame so an expanded CallPanel can cover the whole message
          pane (sidebar stays visible) without escaping into the lab chrome. */}
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {children}
        {activeCall && (
          <CallPanel
            title={activeCall.target.title}
            kind={activeCall.kind}
            localStream={localStream}
            remoteStreams={remoteStreams}
            onLeave={endCall}
            onToggleMute={(muted) => managerRef.current?.setMuted(muted)}
            onToggleCamera={(on) => managerRef.current?.setCameraOn(on)}
          />
        )}
        {incoming && !activeCall && (
          <IncomingCallBanner
            callerName={incoming.callerName}
            kind={incoming.kind}
            onAccept={acceptIncoming}
            onDecline={() => setIncoming(null)}
          />
        )}
      </div>
    </CallContext.Provider>
  );
}
