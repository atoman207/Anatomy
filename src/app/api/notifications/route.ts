import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/guards";
import { createAdminSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import { isAiEnabled } from "@/lib/ai/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type NoticeTone = "info" | "good" | "warn" | "danger";

export interface Notice {
  id: string;
  tone: NoticeTone;
  title: string;
  detail: string;
  /** ISO timestamp, when the notice refers to a moment in time. */
  at: string | null;
  href: string | null;
}

export interface NotificationsResponse {
  notices: Notice[];
  unread: number;
  signedIn: boolean;
}

/** Only changes that affect other people raise a notification. */
const NOTIFIABLE = /^(member|lab|user)\./;

const ACTION_LABELS: Record<string, string> = {
  "lab.created": "研究室が作成されました",
  "lab.updated": "研究室情報が更新されました",
  "lab.deleted": "研究室が削除されました",
  "lab.ownership_transferred": "オーナーが変更されました",
  "member.added": "メンバーが追加されました",
  "member.invited": "メンバーを招待しました",
  "member.removed": "メンバーが削除されました",
  "member.role_changed": "メンバーの権限が変更されました",
  "user.created": "ユーザーが作成されました",
  "user.deleted": "ユーザーが削除されました",
  "user.confirmed": "ユーザーが確認済みになりました",
  "user.password_reset_sent": "パスワード再設定を送信しました",
  "auth.password_changed": "パスワードが変更されました",
  "auth.sign_out": "サインアウト",
  "profile.rename": "表示名が変更されました",
};

/**
 * Things the user should actually know about.
 *
 * Deliberately sourced from real state rather than invented: setup problems
 * that block saving, and recent administrative changes to the user's own
 * laboratories. A bell that lights up for nothing trains people to ignore it.
 */
export async function GET() {
  const notices: Notice[] = [];
  const ctx = await getSessionContext();

  // --- setup problems, shown to everyone who can act on them ---
  if (!isSupabaseConfigured()) {
    notices.push({
      id: "setup-supabase",
      tone: "warn",
      title: "データベースが未設定です",
      detail: "解析機能は使えますが、実験やノートの保存はできません。",
      at: null,
      href: "/",
    });
  }
  if (!isAiEnabled()) {
    notices.push({
      id: "setup-ai",
      tone: "info",
      title: "AI機能が無効です",
      detail: "AI APIキーを設定すると音声メモの整形と論文検索が使えます。",
      at: null,
      href: "/",
    });
  }

  if (!ctx) {
    return NextResponse.json<NotificationsResponse>(
      { notices, unread: notices.length, signedIn: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!ctx.user.email_confirmed_at) {
    notices.push({
      id: "email-unconfirmed",
      tone: "warn",
      title: "メールアドレスが未確認です",
      detail: "確認メールのリンクを開いてください。",
      at: null,
      href: "/account",
    });
  }

  // Personal workspaces are auto-provisioned on sign-in. This notice only
  // remains as a rare fallback if that step failed (e.g. database offline).
  if (ctx.memberships.length === 0 && !ctx.isPlatformAdmin) {
    notices.push({
      id: "no-lab",
      tone: "warn",
      title: "ワークスペースを準備できませんでした",
      detail: "ページを再読み込みするか、しばらくしてから再度お試しください。",
      at: null,
      href: "/",
    });
  }

  // --- recent administrative activity in labs this user administers ---
  if (ctx.canAccessAdmin) {
    try {
      const admin = createAdminSupabase();
      const labIds = ctx.adminLabs.map((l) => l.labId);

      let query = admin
        .from("audit_logs")
        .select("id, action, created_at, lab_id, user_id, detail")
        .order("created_at", { ascending: false })
        .limit(8);
      if (!ctx.isPlatformAdmin) {
        if (labIds.length === 0) {
          return NextResponse.json<NotificationsResponse>(
            { notices, unread: notices.length, signedIn: true },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        query = query.in("lab_id", labIds);
      }

      const { data: logs } = await query;
      const actorIds = [...new Set((logs ?? []).map((l) => l.user_id).filter(Boolean))] as string[];
      const { data: profiles } = actorIds.length
        ? await admin.from("profiles").select("id, email, display_name").in("id", actorIds)
        : { data: [] };
      const byId = new Map(
        (profiles ?? []).map((p) => [p.id, p.display_name || p.email || "不明"]),
      );

      for (const log of logs ?? []) {
        // The user's own actions are not news to them.
        if (log.user_id === ctx.user.id) continue;
        // Sign-ins and personal profile edits are not team news; the audit
        // log still records them, but they do not belong in an alert list.
        if (!NOTIFIABLE.test(log.action)) continue;
        const label = ACTION_LABELS[log.action] ?? log.action;
        const actor = log.user_id ? byId.get(log.user_id) ?? "不明" : "システム";
        notices.push({
          id: `audit-${log.id}`,
          tone: log.action.endsWith(".deleted") ? "danger" : "info",
          title: label,
          detail: `${actor} による操作`,
          at: log.created_at,
          href: "/admin/audit",
        });
      }

      // --- platform admins: accounts that cannot sign in yet ---
      if (ctx.isPlatformAdmin) {
        const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const unconfirmed = (data?.users ?? []).filter((u) => !u.email_confirmed_at);
        if (unconfirmed.length > 0) {
          notices.push({
            id: "unconfirmed-users",
            tone: "warn",
            title: `${unconfirmed.length} 件のアカウントが未確認です`,
            detail: "管理画面から確認済みにできます。",
            at: null,
            href: "/admin/users",
          });
        }
      }
    } catch {
      // Notifications are supplementary; never fail the shell over them.
    }
  }

  return NextResponse.json<NotificationsResponse>(
    { notices, unread: notices.length, signedIn: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
