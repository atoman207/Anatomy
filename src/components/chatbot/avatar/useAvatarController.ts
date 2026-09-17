"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PerformancePlan } from "@/lib/avatar/planner";
import type { AvatarState, ToUnrealMessage } from "@/lib/avatar/protocol";
import {
  INTERRUPT_SETTLE_MS,
  nextAvatarState,
  type AvatarEvent,
} from "@/lib/avatar/stateMachine";

/**
 * A connected Unreal Engine avatar (MetaHuman over Pixel Streaming).
 * Registered by `PixelStreamingAvatar` once its data channel is open.
 */
export interface RemoteAvatar {
  send(message: ToUnrealMessage): void;
  /**
   * Streams one utterance (WAV audio + cues + fallback visemes) to Unreal and
   * resolves when Unreal reports the speech finished (or a safety timeout).
   */
  speak(args: {
    wav: Uint8Array;
    durationSec: number;
    text: string;
    plan: PerformancePlan;
    visemes: string;
    signal: AbortSignal;
  }): Promise<void>;
}

/** Read every animation frame by the renderers; never triggers React renders. */
export interface AvatarDriver {
  state(): AvatarState;
  /** `performance.now()` seconds when the current state was entered. */
  stateSince(): number;
  /** Cues of the utterance being spoken, or null. */
  plan(): PerformancePlan | null;
  /** `performance.now()` seconds of the latest sign the user is talking. */
  lastUserActivity(): number;
}

export interface AvatarController {
  state: AvatarState;
  driver: AvatarDriver;
  dispatch(event: AvatarEvent): void;
  utteranceStarted(plan: PerformancePlan): void;
  utteranceEnded(): void;
  /** Call on each transcript update while the user speaks. */
  userActivity(): void;
  setRemote(remote: RemoteAvatar | null): void;
  remote(): RemoteAvatar | null;
}

const now = () => performance.now() / 1000;

/**
 * Owns the avatar's conversation state (IDLE / LISTENING / THINKING /
 * SPEAKING / INTERRUPTED) and the current utterance's cue plan, and mirrors
 * both to Unreal when a remote avatar is connected.
 */
export function useAvatarController(): AvatarController {
  const [state, setState] = useState<AvatarState>("IDLE");
  const stateRef = useRef<AvatarState>("IDLE");
  const sinceRef = useRef(0);
  const planRef = useRef<PerformancePlan | null>(null);
  const activityRef = useRef(-100);
  const lastActivitySentRef = useRef(0);
  const remoteRef = useRef<RemoteAvatar | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** INTERRUPTED settles via a timer, which needs the latest dispatch. */
  const dispatchRef = useRef<(event: AvatarEvent) => void>(() => {});

  const dispatch = useCallback((event: AvatarEvent) => {
    const current = stateRef.current;
    const next = nextAvatarState(current, event);
    if (next === current) return;
    stateRef.current = next;
    sinceRef.current = now();
    setState(next);
    remoteRef.current?.send({ type: "state", state: next });

    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (next === "INTERRUPTED") {
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        dispatchRef.current({ type: "INTERRUPT_SETTLED" });
      }, INTERRUPT_SETTLE_MS);
    }
  }, []);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const utteranceStarted = useCallback(
    (plan: PerformancePlan) => {
      planRef.current = plan;
      dispatch({ type: "SPEECH_STARTED" });
    },
    [dispatch],
  );

  const utteranceEnded = useCallback(() => {
    planRef.current = null;
    dispatch({ type: "SPEECH_FINISHED" });
  }, [dispatch]);

  const userActivity = useCallback(() => {
    const t = now();
    activityRef.current = t;
    // Listener nods on the Unreal side need a heartbeat, not every interim result.
    if (remoteRef.current && t - lastActivitySentRef.current > 0.4) {
      lastActivitySentRef.current = t;
      remoteRef.current.send({ type: "listen.activity", level: 1 });
    }
  }, []);

  const setRemote = useCallback((remote: RemoteAvatar | null) => {
    remoteRef.current = remote;
    remote?.send({ type: "state", state: stateRef.current });
  }, []);

  const remote = useCallback(() => remoteRef.current, []);

  const driver = useMemo<AvatarDriver>(
    () => ({
      state: () => stateRef.current,
      stateSince: () => sinceRef.current,
      plan: () => planRef.current,
      lastUserActivity: () => activityRef.current,
    }),
    [],
  );

  return useMemo(
    () => ({ state, driver, dispatch, utteranceStarted, utteranceEnded, userActivity, setRemote, remote }),
    [state, driver, dispatch, utteranceStarted, utteranceEnded, userActivity, setRemote, remote],
  );
}
