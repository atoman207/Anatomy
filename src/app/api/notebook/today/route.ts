import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/guards";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface TodayEntry {
  id: string;
  title: string;
  experimentId: string;
  experimentName: string;
  labId: string;
  labName: string;
  createdAt: string;
}

export interface TodayResponse {
  entries: TodayEntry[];
}

/**
 * Whether the signed-in user has already written a lab report today, and
 * which ones - backs the header's "今日の実験記録" / "今日の実験記録を見る"
 * button. Scoped to `created_by = caller`, not "anyone in my labs": the
 * question this answers is personal ("have I logged today"), the same way
 * the notebook's own same-day edit lock is about the entry's own creator's
 * day, not the lab's.
 */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ entries: [] } satisfies TodayResponse);

  // Same JST day boundary as listMyReportsToday (src/lib/reports/actions.ts)
  // and isNotebookEntryEditable (src/lib/notebook/prefill.ts) - built from
  // Date.UTC rather than the server process's own local timezone, so it is
  // exact regardless of where this runs.
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })
    .format(new Date())
    .split("-")
    .map(Number);
  const startUtcIso = new Date(Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000).toISOString();

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notebook_entries")
    .select("id, title, created_at, experiment_id, lab_id, experiments(name), laboratories(name)")
    .eq("created_by", ctx.user.id)
    .gte("created_at", startUtcIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ entries: [] } satisfies TodayResponse);

  const entries: TodayEntry[] = (data ?? []).map((r) => {
    const raw = r as unknown as {
      id: string; title: string; created_at: string; experiment_id: string; lab_id: string;
      experiments: { name: string } | { name: string }[] | null;
      laboratories: { name: string } | { name: string }[] | null;
    };
    const experiment = Array.isArray(raw.experiments) ? raw.experiments[0] : raw.experiments;
    const lab = Array.isArray(raw.laboratories) ? raw.laboratories[0] : raw.laboratories;
    return {
      id: raw.id,
      title: raw.title,
      experimentId: raw.experiment_id,
      experimentName: experiment?.name ?? "—",
      labId: raw.lab_id,
      labName: lab?.name ?? "—",
      createdAt: raw.created_at,
    };
  });

  return NextResponse.json({ entries } satisfies TodayResponse);
}
