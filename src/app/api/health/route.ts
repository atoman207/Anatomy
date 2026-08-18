import { NextResponse } from "next/server";
import { createAdminSupabase, isSupabaseConfigured, readSupabaseEnv } from "@/lib/supabase/server";
import { checkAi, aiConfig } from "@/lib/ai/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tables the app expects; a missing one means migrations have not been run. */
const EXPECTED_TABLES = [
  "profiles", "laboratories", "lab_members", "projects", "experiments",
  "notebook_templates", "notebook_entries", "raw_files", "sample_sheets",
  "rename_operations", "datasets", "analyses", "figures", "audit_logs",
] as const;

export interface HealthReport {
  ok: boolean;
  configured: boolean;
  url: string | null;
  auth: { ok: boolean; detail: string };
  rest: { ok: boolean; detail: string };
  schema: { ok: boolean; present: string[]; missing: string[]; detail: string };
  ai: { ok: boolean; enabled: boolean; detail: string; models: string[] };
  checkedAt: string;
}

/**
 * Reports whether the Supabase project is reachable and the schema applied.
 *
 * Used by the dashboard so a missing migration shows up as a clear setup step
 * rather than a runtime error on the first query.
 */
export async function GET() {
  const checkedAt = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    return NextResponse.json<HealthReport>({
      ok: false,
      configured: false,
      url: null,
      auth: { ok: false, detail: "未設定" },
      rest: { ok: false, detail: "未設定" },
      schema: { ok: false, present: [], missing: [...EXPECTED_TABLES], detail: "未設定" },
      ai: { ok: false, enabled: false, detail: "未設定", models: [] },
      checkedAt,
    });
  }

  const { url } = readSupabaseEnv();
  const report: HealthReport = {
    ok: false,
    configured: true,
    url,
    auth: { ok: false, detail: "" },
    rest: { ok: false, detail: "" },
    schema: { ok: false, present: [], missing: [], detail: "" },
    ai: { ok: false, enabled: false, detail: "", models: [] },
    checkedAt,
  };

  // --- Auth service ---
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: "no-store",
    });
    report.auth = res.ok
      ? { ok: true, detail: "GoTrue 到達可能" }
      : { ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    report.auth = { ok: false, detail: e instanceof Error ? e.message : "到達不可" };
  }

  // --- REST + schema ---
  // The service key is needed because an empty schema returns nothing useful
  // through the anon role, and RLS would hide tables from an unauthenticated call.
  let admin: ReturnType<typeof createAdminSupabase> | null = null;
  try {
    admin = createAdminSupabase();
  } catch (e) {
    report.rest = {
      ok: false,
      detail: e instanceof Error ? e.message : "サービスキーがありません",
    };
  }

  if (admin) {
    const present: string[] = [];
    const missing: string[] = [];
    let restOk = true;
    let restDetail = "REST 到達可能";

    for (const table of EXPECTED_TABLES) {
      // A HEAD request (`head: true`) comes back 204 with no body even when
      // the relation is missing, so the error never surfaces and every table
      // looks present. A normal select returns PGRST205 as it should.
      const { error } = await admin
        .from(table as never)
        .select("*")
        .limit(1);
      if (!error) {
        present.push(table);
        continue;
      }
      // PGRST205 / 42P01 both mean "relation does not exist".
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        /does not exist|Could not find the table/i.test(error.message)
      ) {
        missing.push(table);
      } else {
        restOk = false;
        restDetail = `${error.code ?? ""} ${error.message}`.trim();
        missing.push(table);
      }
    }

    report.rest = { ok: restOk, detail: restDetail };
    report.schema = {
      ok: missing.length === 0,
      present,
      missing,
      detail:
        missing.length === 0
          ? `全 ${present.length} テーブルが存在します`
          : `${missing.length} 件のテーブルが不足しています — 実行: npm run db:push`,
    };
  }

  // --- OpenAI ---
  // AI is optional: the analysis tools never call a model, so a failure here
  // is reported but does not make the deployment unhealthy.
  const ai = await checkAi();
  report.ai = { ...ai, enabled: aiConfig().enabled };

  report.ok = report.auth.ok && report.rest.ok && report.schema.ok;
  // Always 200: the endpoint itself succeeded, and "schema not applied yet" is
  // a setup state the dashboard renders, not a server failure. Returning 503
  // would log a console error on a page that is working correctly.
  return NextResponse.json(report, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
