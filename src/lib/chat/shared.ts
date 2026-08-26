/**
 * Constants shared between server code (`queries.ts`, `actions.ts`) and
 * client code (`realtime.ts`, chat components) - no `server-only` import
 * here, unlike those two, since this file has to be safe to bundle into
 * the browser too. Same split as `src/lib/submissionFiles/shared.ts`.
 */

export const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
export const CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;
export const MAX_CALL_PARTICIPANTS = 6;
export const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_MESSAGE_BODY_LENGTH = 4000;

/**
 * Canonical ordering for a DM pair: `dm_conversations` has a
 * `check (user_a < user_b)` constraint and a `unique (lab_id, user_a,
 * user_b)` index so the same two people always land on the same row
 * regardless of who started the conversation - every insert/lookup must
 * sort the pair the same way first, or a second "new" conversation just
 * fails the unique constraint instead of finding the existing one.
 */
export function sortDmPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Whether `selfId` should be the one to create the WebRTC offer to
 * `peerId`. Both sides of a call see each other's presence-join at roughly
 * the same time, so without a tie-break rule both would create an offer and
 * the two negotiations would race - the lower id always initiates. Kept
 * here (not in webrtc.ts, which pulls in browser-only APIs at module scope)
 * so it can be unit-tested without a live connection or a DOM.
 */
export function shouldInitiateOffer(selfId: string, peerId: string): boolean {
  return selfId < peerId;
}
