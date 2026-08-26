import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server";
import { ensureGeneralChannel } from "@/lib/chat/queries";

/**
 * Ensures a signed-in account owns at least one laboratory.
 *
 * Most research data is still lab-scoped (experiments, notebooks, quotas,
 * team subscriptions). Solo users should not have to discover that and
 * create a lab by hand - a personal workspace is provisioned the first time
 * they sign in with none. Platform admins creating shared labs for teams is
 * unchanged; this only fills the empty case.
 *
 * Goes through the `ensure_personal_lab` RPC rather than a plain
 * check-then-insert, because this function is called from several places on
 * the same page load (the layout, the page, /api/me, /api/notifications,
 * /api/notebook/today) with no coordination between them - a bare
 * check-then-insert let concurrent calls for a brand-new account each see
 * zero labs and each create their own, which is exactly what happened in
 * production (one account ended up owning five duplicate workspaces). The
 * RPC takes a Postgres advisory lock keyed on the user id so only the first
 * caller actually creates anything; see the migration for details.
 *
 * Falls back to the old check-then-insert if the RPC itself is missing
 * (PostgREST's "could not find function" error, PGRST202/42883) rather than
 * returning null - this migration has to be pasted into the Supabase SQL
 * Editor by hand before it takes effect, so there is a real window where
 * live signups would otherwise silently get zero labs and a broken
 * onboarding. The fallback accepts the original race again during that
 * window, which is strictly no worse than before this fix existed.
 */
export async function ensurePersonalLab(
  userId: string,
  displayName: string,
): Promise<{ labId: string; labName: string } | null> {
  if (!userId) return null;

  const base = (displayName.trim() || "個人").slice(0, 80);
  const name = `${base}のワークスペース`.slice(0, 120);
  const admin = createAdminSupabase();

  const { data, error } = await admin.rpc("ensure_personal_lab", {
    target_user: userId,
    workspace_name: name,
  });
  if (!error && data && data.length > 0) {
    const row = data[0];
    if (row.created) await ensureGeneralChannel(row.lab_id, userId);
    return { labId: row.lab_id, labName: row.lab_name };
  }
  if (error && error.code !== "PGRST202" && error.code !== "42883") {
    // A real failure (not "function doesn't exist yet") - do not paper over
    // it with the racy fallback.
    return null;
  }

  return ensurePersonalLabLegacy(admin, userId, name);
}

/** Pre-migration fallback: the original check-then-insert, race and all. */
async function ensurePersonalLabLegacy(
  admin: ReturnType<typeof createAdminSupabase>,
  userId: string,
  name: string,
): Promise<{ labId: string; labName: string } | null> {
  const { data: existing, error: existingError } = await admin
    .from("lab_members")
    .select("lab_id, laboratories(id, name)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1);
  if (existingError) return null;
  if (existing && existing.length > 0) {
    const embedded = existing[0].laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { id: string; name: string }
      | null;
    if (lab) return { labId: lab.id, labName: lab.name };
    return { labId: existing[0].lab_id, labName: "ワークスペース" };
  }

  const { data: lab, error: labError } = await admin
    .from("laboratories")
    .insert({
      name,
      description: "個人用に自動作成されたワークスペースです。チームで共有する場合は管理者に研究室へ招待してもらってください。",
      owner_id: userId,
    })
    .select("id, name")
    .single();
  if (labError || !lab) return null;

  const { error: memberError } = await admin
    .from("lab_members")
    .insert({ lab_id: lab.id, user_id: userId, role: "owner" });
  if (memberError) {
    await admin.from("laboratories").delete().eq("id", lab.id);
    return null;
  }
  await ensureGeneralChannel(lab.id, userId);

  return { labId: lab.id, labName: lab.name };
}
