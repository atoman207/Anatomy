import { NextResponse } from "next/server";
import { dispatchMessage, listPendingCampaigns, readBudget } from "@/lib/email/campaign";
import { isEmailConfigured } from "@/lib/email/smtp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drains queued broadcast recipients, so a campaign larger than one hour's
 * sending allowance finishes on its own.
 *
 * Why this is a route and not a background task: the mailbox allows a fixed
 * number of messages per trailing hour, so a large campaign is necessarily
 * spread across hours. Nothing inside a Next.js request can wait that long,
 * and an in-process timer would not survive a restart or run correctly on two
 * instances. An endpoint that a scheduler pokes every so often is the piece
 * that makes "all of them, eventually" true without anyone clicking.
 *
 * Point any cron at it, hourly is plenty:
 *
 *   curl -X POST https://<host>/api/admin/email/dispatch \
 *        -H "Authorization: Bearer $EMAIL_DISPATCH_TOKEN"
 *
 * Authentication is a shared secret rather than a session, because the caller
 * is a machine. It is required, not optional: without `EMAIL_DISPATCH_TOKEN`
 * set the route refuses to run at all, so an unconfigured deployment cannot
 * leave an unauthenticated send endpoint exposed. Administrators who want to
 * push a queue along by hand have the "残りを送信" button instead, which is
 * protected by the normal platform-admin check.
 */
export async function POST(request: Request) {
  const expected = process.env.EMAIL_DISPATCH_TOKEN;
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "EMAIL_DISPATCH_TOKEN が設定されていないため、自動送信は無効です。" +
          "設定するか、管理画面の「残りを送信」を使用してください。",
      },
      { status: 503 },
    );
  }

  const offered =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-dispatch-token") ??
    "";
  if (offered !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: false, error: "SMTP is not configured" }, { status: 503 });
  }

  const budget = await readBudget();
  if (budget.remaining === 0) {
    return NextResponse.json({
      ok: true,
      skipped: "rate-limited",
      budget,
      dispatched: [],
    });
  }

  // Oldest campaign first, so a queue drains in the order it was created
  // rather than newest-first starving whatever is already waiting.
  const pending = await listPendingCampaigns(20);
  const dispatched: {
    id: string;
    sent: number;
    failed: number;
    pending: number;
    messages: number;
    rateLimited: boolean;
  }[] = [];

  for (const campaign of pending) {
    const result = await dispatchMessage(campaign.id);
    dispatched.push({
      id: campaign.id,
      sent: result.sent,
      failed: result.failed,
      pending: result.pending,
      messages: result.messages,
      rateLimited: result.rateLimited,
    });
    // Throttled or out of allowance: stop the whole run rather than trying
    // the next campaign, which would only collect the same rejection.
    if (result.rateLimited || result.budgetExhausted) break;
  }

  return NextResponse.json({
    ok: true,
    budget: await readBudget(),
    dispatched,
  });
}
