import { VISEME_COUNT, sampleTrack, emptyFrame, type VisemeTrack } from "@/lib/voice/lipSync";

/**
 * Compact encodings for the Pixel Streaming data channel, whose messages must
 * stay small: visemes resampled to a fixed rate and quantised to bytes, audio
 * as base64 chunks.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Row per frame, `VISEME_COUNT` bytes per row (0..255), base64. */
export function encodeVisemeTrack(track: VisemeTrack, fps = 30): string {
  const frames = Math.max(1, Math.ceil(track.duration * fps));
  const out = new Uint8Array(frames * VISEME_COUNT);
  const frame = emptyFrame();
  for (let f = 0; f < frames; f++) {
    sampleTrack(track, f / fps, frame);
    for (let v = 0; v < VISEME_COUNT; v++) {
      out[f * VISEME_COUNT + v] = Math.round(Math.min(1, Math.max(0, frame.weights[v])) * 255);
    }
  }
  return bytesToBase64(out);
}

export function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [""];
}
