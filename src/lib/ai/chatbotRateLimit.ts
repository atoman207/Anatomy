/**
 * Sliding-window limiter for the assistant chatbot when the caller has no
 * paid AI plan (guests and free labs).
 *
 * Memory-only: counts live per server instance and reset on restart. That is
 * enough to stop a visitor from looping the endpoint and running up the
 * OpenAI bill; it is not a billing-grade quota.
 */

export interface RateWindow {
  limit: number;
  windowMs: number;
}

export interface RateDecision {
  ok: boolean;
  /** Seconds until the oldest counted hit leaves the window (0 when ok). */
  retryAfterSec: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windows: RateWindow[]) {}

  /** Records a hit for `key` if every window has room. */
  take(key: string, now = Date.now()): RateDecision {
    const longest = Math.max(...this.windows.map((w) => w.windowMs));
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < longest);

    for (const w of this.windows) {
      const inWindow = recent.filter((t) => now - t < w.windowMs);
      if (inWindow.length >= w.limit) {
        const oldest = inWindow[inWindow.length - w.limit];
        this.hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + w.windowMs - now) / 1000)) };
      }
    }

    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now, longest);
    return { ok: true, retryAfterSec: 0 };
  }

  private prune(now: number, longest: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= longest)) this.hits.delete(key);
    }
  }
}

/** Best-effort client address behind Vercel / a reverse proxy. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
