import type { AvatarState } from "./protocol";

/**
 * Conversation state of the avatar: IDLE → LISTENING → THINKING → SPEAKING,
 * with INTERRUPTED when the user cuts in while it is talking.
 *
 * Pure so the transitions can be tested; `useAvatarController` owns the
 * timers (INTERRUPTED settles into LISTENING, SPEAKING into IDLE).
 */

export type AvatarEvent =
  | { type: "USER_STARTED" } // mic opened / user began typing a question
  | { type: "USER_STOPPED" } // mic closed without sending
  | { type: "REQUEST_SENT" } // question submitted, waiting for the model
  | { type: "REPLY_FAILED" }
  | { type: "SPEECH_STARTED" }
  | { type: "SPEECH_FINISHED" }
  | { type: "INTERRUPT_SETTLED" }
  | { type: "RESET" };

/** How long the "caught mid-sentence" reaction plays before listening. */
export const INTERRUPT_SETTLE_MS = 650;

export function nextAvatarState(state: AvatarState, event: AvatarEvent): AvatarState {
  switch (event.type) {
    case "RESET":
      return "IDLE";
    case "USER_STARTED":
      return state === "SPEAKING" ? "INTERRUPTED" : "LISTENING";
    case "USER_STOPPED":
      return state === "LISTENING" ? "IDLE" : state;
    case "REQUEST_SENT":
      return "THINKING";
    case "REPLY_FAILED":
      return state === "THINKING" ? "IDLE" : state;
    case "SPEECH_STARTED":
      // A reply that arrives after the user already cut in is not spoken over them.
      return state === "LISTENING" || state === "INTERRUPTED" ? state : "SPEAKING";
    case "SPEECH_FINISHED":
      return state === "SPEAKING" ? "IDLE" : state;
    case "INTERRUPT_SETTLED":
      return state === "INTERRUPTED" ? "LISTENING" : state;
  }
}
