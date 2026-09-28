import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed address inside an unsubscribe link.
 *
 * A one-click unsubscribe (RFC 8058) is a POST from the recipient's mail
 * provider with no session and no confirmation step, so the link itself has
 * to say - unforgeably - whose subscription it ends. That is all this token
 * is: the address, plus an HMAC over it.
 *
 * Deliberately without an expiry. A newsletter someone kept for a year must
 * still unsubscribe them when they finally get round to it; an expired opt-out
 * link is both useless to the recipient and, under the Japanese 特定電子メール法
 * (and Gmail's bulk-sender rules), not a working opt-out at all. The token
 * grants nothing except "stop mailing this address", so age costs nothing.
 *
 * Kept free of `server-only` and of any database import so the signing rules
 * can be tested directly - see tests/emailCompliance.test.ts.
 */

export type EnvLike = Record<string, string | undefined>;

/**
 * Anything stable and secret will do, but it must outlive a deployment: a
 * rotated secret invalidates every unsubscribe link already in people's
 * inboxes. `EMAIL_UNSUBSCRIBE_SECRET` is the one to set explicitly; the
 * fallbacks only spare a working deployment from having no links at all.
 */
export function unsubscribeSecret(env: EnvLike = process.env): string | null {
  return (
    env.EMAIL_UNSUBSCRIBE_SECRET ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SMTP_PASSWORD ||
    null
  );
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** `<base64url(address)>.<mac>`, or null when no secret is configured. */
export function signUnsubscribeToken(email: string, env: EnvLike = process.env): string | null {
  const secret = unsubscribeSecret(env);
  if (!secret) return null;
  const address = email.trim().toLowerCase();
  if (!address) return null;
  const body = Buffer.from(address, "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The address a token vouches for, or null if it is malformed or unsigned. */
export function verifyUnsubscribeToken(
  token: unknown,
  env: EnvLike = process.env,
): string | null {
  const secret = unsubscribeSecret(env);
  if (!secret) return null;
  if (typeof token !== "string" || token.length > 512) return null;

  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  try {
    const expected = Buffer.from(sign(body, secret));
    const given = Buffer.from(mac);
    // Compared in constant time, and only after the lengths match - timingSafeEqual
    // throws on a length mismatch rather than returning false.
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const address = Buffer.from(body, "base64url").toString("utf8").trim().toLowerCase();
    return address.includes("@") ? address : null;
  } catch {
    return null;
  }
}
