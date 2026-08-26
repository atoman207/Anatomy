"use client";

import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { shouldInitiateOffer } from "./shared";
import type { CallKind } from "./types";

export { shouldInitiateOffer };

/**
 * WebRTC mesh calling: every participant opens a direct RTCPeerConnection to
 * every other participant, signaled over a per-call Supabase Realtime
 * Broadcast+Presence channel (`call:{callId}`) rather than a dedicated
 * signaling server. STUN only (Google's public server) - there is no TURN
 * relay, so a call will not connect for participants behind a symmetric NAT
 * or a restrictive corporate firewall. Mesh bandwidth scales with N-1
 * connections per participant, which is fine for 1:1 and small group calls
 * but degrades past roughly 4-6 people - `MAX_CALL_PARTICIPANTS` in
 * `shared.ts` caps this server-side, not just as a UI suggestion.
 *
 * This is a deliberate, documented scope boundary, not an oversight: a
 * proper SFU/TURN setup needs hosted media-server infrastructure this
 * project does not have.
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type SignalPayload =
  | { type: "offer"; to: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; to: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; to: string; from: string; candidate: RTCIceCandidateInit };

export interface CallManagerHandlers {
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerLeft: (peerId: string) => void;
  onLocalStream?: (stream: MediaStream) => void;
}

/**
 * Opens the local mic (and camera for video calls). Camera absence falls
 * back to audio-only rather than aborting the call; a missing mic is a hard
 * failure with a Japanese message instead of a raw DOMException overlay.
 */
async function acquireLocalMedia(kind: CallKind): Promise<{ stream: MediaStream; videoEnabled: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("このブラウザでは通話用のマイク／カメラを使えません。");
  }

  const wantVideo = kind === "video";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantVideo,
    });
    return { stream, videoEnabled: wantVideo && stream.getVideoTracks().length > 0 };
  } catch (e) {
    if (wantVideo && e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return { stream, videoEnabled: false };
      } catch (audioErr) {
        throw friendlyMediaError(audioErr);
      }
    }
    throw friendlyMediaError(e);
  }
}

function friendlyMediaError(e: unknown): Error {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      return new Error("マイク／カメラの使用が許可されていません。ブラウザの権限設定を確認してください。");
    }
    if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
      return new Error("マイクが見つかりません。接続を確認してください。");
    }
    if (e.name === "NotReadableError" || e.name === "TrackStartError") {
      return new Error("マイク／カメラを開けませんでした。他のアプリが使用中かもしれません。");
    }
    if (e.message) return new Error(e.message);
  }
  return e instanceof Error ? e : new Error("マイク／カメラを開始できませんでした。");
}

export class CallManager {
  private readonly supabase = createClient();
  private readonly selfId: string;
  private readonly selfName: string;
  private readonly handlers: CallManagerHandlers;
  private channel: RealtimeChannel | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private videoEnabled: boolean;

  constructor(selfId: string, selfName: string, handlers: CallManagerHandlers) {
    this.selfId = selfId;
    this.selfName = selfName;
    this.handlers = handlers;
    this.videoEnabled = false;
  }

  get stream(): MediaStream | null {
    return this.localStream;
  }

  async join(callId: string, kind: CallKind): Promise<void> {
    const acquired = await acquireLocalMedia(kind);
    this.videoEnabled = acquired.videoEnabled;
    this.localStream = acquired.stream;
    this.handlers.onLocalStream?.(this.localStream);

    const channel = this.supabase.channel(`call:${callId}`, {
      config: { presence: { key: this.selfId }, broadcast: { self: false } },
    });
    this.channel = channel;

    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      void this.handleSignal(payload as SignalPayload);
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ displayName: string }>();
      const peerIds = Object.keys(state).filter((id) => id !== this.selfId);
      for (const peerId of peerIds) {
        if (!this.peers.has(peerId) && shouldInitiateOffer(this.selfId, peerId)) {
          void this.startOffer(peerId);
        }
      }
      for (const peerId of this.peers.keys()) {
        if (!peerIds.includes(peerId)) this.removePeer(peerId);
      }
    });

    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ displayName: this.selfName });
          resolve();
        }
      });
    });
  }

  private send(payload: SignalPayload): void {
    void this.channel?.send({ type: "broadcast", event: "signal", payload });
  }

  private ensurePeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    for (const track of this.localStream?.getTracks() ?? []) {
      pc.addTrack(track, this.localStream!);
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({ type: "ice", to: peerId, from: this.selfId, candidate: e.candidate.toJSON() });
      }
    };
    pc.ontrack = (e) => {
      this.handlers.onRemoteStream(peerId, e.streams[0]);
    };
    this.peers.set(peerId, pc);
    return pc;
  }

  private async startOffer(peerId: string): Promise<void> {
    const pc = this.ensurePeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", to: peerId, from: this.selfId, sdp: offer });
  }

  private async handleSignal(payload: SignalPayload): Promise<void> {
    if (payload.to !== this.selfId) return;
    const pc = this.ensurePeerConnection(payload.from);

    if (payload.type === "offer") {
      await pc.setRemoteDescription(payload.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: "answer", to: payload.from, from: this.selfId, sdp: answer });
    } else if (payload.type === "answer") {
      await pc.setRemoteDescription(payload.sdp);
    } else if (payload.type === "ice") {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        // A candidate can arrive before setRemoteDescription in rare
        // orderings; dropping it is safe, ICE will still converge on the
        // remaining candidates.
      }
    }
  }

  private removePeer(peerId: string): void {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    pc.close();
    this.peers.delete(peerId);
    this.handlers.onPeerLeft(peerId);
  }

  setMuted(muted: boolean): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  setCameraOn(on: boolean): void {
    for (const track of this.localStream?.getVideoTracks() ?? []) track.enabled = on;
  }

  async startScreenShare(): Promise<MediaStream> {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) void sender.replaceTrack(screenTrack);
    }
    screenTrack.onended = () => void this.stopScreenShare();
    return screenStream;
  }

  async stopScreenShare(): Promise<void> {
    const cameraTrack = this.localStream?.getVideoTracks()[0];
    if (!cameraTrack) return;
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) void sender.replaceTrack(cameraTrack);
    }
  }

  leave(): void {
    for (const peerId of [...this.peers.keys()]) this.removePeer(peerId);
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    if (this.channel) void this.supabase.removeChannel(this.channel);
    this.channel = null;
  }
}
