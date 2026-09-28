import "server-only";

/**
 * Who must not be mailed again, and the links that let anyone join that list.
 *
 * An unsubscribe that is only a header is not an unsubscribe: the address has
 * to be recorded and then actually skipped, including by a campaign that was
 * queued before the person opted out. So this module owns both ends -
 * building the signed link that goes in every broadcast, and the list the
 * sender checks before each batch.
 *
 * Bounces land here too. A hard rejection ("no such user") that keeps being
 * retried is one of the fastest ways to lose a sending reputation, so a
 * permanently failed address is suppressed exactly like an opt-out.
 *
 * `email_suppressions` arrived in a later migration section, so every read
 * degrades to "nobody is suppressed" rather than refusing to send - except
 * the write path behind the unsubscribe endpoint, which reports failure
 * honestly because silently losing an opt-out is not an option.
 */

import { createAdminSupabase } from "@/lib/supabase/server";
import { signUnsubscribeToken } from "@/lib/email/token";
import {
  footerHtml, footerText, type SenderIdentity, type UnsubscribeLinks,
} from "@/lib/email/compliance";

export type SuppressionReason = "unsubscribe" | "bounce" | "complaint" | "manual";

export interface SuppressionRecord {
  email: string;
  reason: SuppressionReason;
  note: string | null;
  createdAt: string;
}

/** Public origin, without a trailing slash. Empty when not configured. */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
}

/** Address that accepts opt-outs by mail, for the `mailto:` half of the header. */
function unsubscribeMailto(): string | undefined {
  return (
    process.env.EMAIL_UNSUBSCRIBE_MAILTO ||
    process.env.SMTP_FROM ||
    process.env.CONTACT_RECEIVE_EMAIL ||
    undefined
  );
}

/**
 * The one-click URL for one address, or null when it cannot be built - no
 * public origin, or no secret to sign with. Null is honest: an unsubscribe
 * link that 404s is worse than none, because the header promises it works.
 */
export function unsubscribeUrlFor(email: string): string | null {
  const origin = siteOrigin();
  if (!origin) return null;
  const token = signUnsubscribeToken(email);
  if (!token) return null;
  return `${origin}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

/**
 * Links for one recipient, or for a Bcc batch when `email` is null.
 *
 * The batch case still gets a URL - the page asks which address to remove -
 * but not `oneClick`, because a provider POSTing it could not be told who to
 * unsubscribe. See `unsubscribeHeaders` in smtp.ts.
 */
export function unsubscribeLinks(email: string | null): UnsubscribeLinks {
  const mailto = unsubscribeMailto();
  if (!email) {
    const origin = siteOrigin();
    return { url: origin ? `${origin}/unsubscribe` : undefined, mailto, oneClick: false };
  }
  const url = unsubscribeUrlFor(email) ?? undefined;
  return { url, mailto, oneClick: Boolean(url) };
}

/**
 * Who the mail is from, as 特定電子メール法 requires it to be stated in the
 * body. Everything except the name is optional here but not legally: a
 * deployment that sends advertising mail should set the postal address.
 */
export function senderIdentity(): SenderIdentity {
  return {
    name: process.env.EMAIL_SENDER_NAME || "LABNOTE",
    operator: process.env.EMAIL_SENDER_OPERATOR || undefined,
    postalAddress: process.env.EMAIL_SENDER_POSTAL_ADDRESS || undefined,
    siteUrl: siteOrigin() || undefined,
    contact:
      process.env.EMAIL_SENDER_CONTACT ||
      process.env.CONTACT_RECEIVE_EMAIL ||
      process.env.SMTP_FROM ||
      undefined,
  };
}

/**
 * The two callbacks every broadcast payload carries: unsubscribe links, and
 * the footer built from them. Spread into a `TransactionMessage` so the
 * headers and the visible footer can never describe different links.
 */
export function bulkCompliance(): {
  unsubscribe: (email: string | null) => UnsubscribeLinks;
  footer: (links: UnsubscribeLinks) => { text: string; html: string };
} {
  const sender = senderIdentity();
  return {
    unsubscribe: unsubscribeLinks,
    footer: (links) => ({ text: footerText(sender, links), html: footerHtml(sender, links) }),
  };
}

/* ------------------------------------------------------------------ */
/* The list itself                                                     */
/* ------------------------------------------------------------------ */

/** Records an opt-out. Returns false when it could not be stored. */
export async function suppress(
  email: string,
  reason: SuppressionReason,
  note?: string,
): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const { error } = await createAdminSupabase()
    .from("email_suppressions")
    .upsert(
      { email: address, reason, note: note ?? null },
      // Already-unsubscribed is success, not a conflict to report: the caller
      // asked for the address to stop receiving mail, and it does.
      { onConflict: "email", ignoreDuplicates: true },
    );
  return !error;
}

/** Removes an address from the list - an explicit re-subscribe. */
export async function unsuppress(email: string): Promise<boolean> {
  const { error } = await createAdminSupabase()
    .from("email_suppressions")
    .delete()
    .eq("email", email.trim().toLowerCase());
  return !error;
}

export async function isSuppressed(email: string): Promise<boolean> {
  const { data, error } = await createAdminSupabase()
    .from("email_suppressions")
    .select("email")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/**
 * The suppressed subset of a list of addresses.
 *
 * Queried in chunks because a campaign may carry thousands of addresses and
 * PostgREST puts them all in the URL; 200 at a time keeps every request well
 * inside any proxy's line limit.
 */
export async function suppressedAmong(emails: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const addresses = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (addresses.length === 0) return found;

  const admin = createAdminSupabase();
  for (let i = 0; i < addresses.length; i += 200) {
    const slice = addresses.slice(i, i + 200);
    const { data, error } = await admin
      .from("email_suppressions")
      .select("email")
      .in("email", slice);
    // No table yet: treat the list as empty rather than blocking the send.
    // The migration adds it; until then the headers and footer still offer a
    // working opt-out by mail.
    if (error) return found;
    for (const row of data ?? []) found.add(row.email);
  }
  return found;
}

export async function listSuppressions(limit = 50): Promise<SuppressionRecord[]> {
  const { data, error } = await createAdminSupabase()
    .from("email_suppressions")
    .select("email, reason, note, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => ({
    email: row.email,
    reason: row.reason as SuppressionReason,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/**
 * How many addresses are suppressed, or null when the table is missing.
 *
 * Deliberately not a `head: true` count: PostgREST answers a head request
 * with 204 even for a relation that does not exist, so a missing table would
 * probe as "zero suppressions" instead of "not installed yet" - the same trap
 * `readEmailSchema` documents in campaign.ts.
 */
export async function suppressionCount(): Promise<number | null> {
  const { count, error } = await createAdminSupabase()
    .from("email_suppressions")
    .select("email", { count: "exact" })
    .limit(1);
  if (error) return null;
  return count ?? 0;
}
