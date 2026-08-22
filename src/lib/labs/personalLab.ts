import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * Ensures a signed-in account owns at least one laboratory.
 *
 * Most research data is still lab-scoped (experiments, notebooks, quotas,
 * team subscriptions). Solo users should not have to discover that and
 * create a lab by hand - a personal workspace is provisioned the first time
 * they sign in with none. Platform admins creating shared labs for teams is
 * unchanged; this only fills the empty case.
 */
export async function ensurePersonalLab(
  userId: string,
  displayName: string,
): Promise<{ labId: string; labName: string } | null> {
  if (!userId) return null;

  const admin = createAdminSupabase();

  const { data: existing, error: existingError } = await admin
    .from("lab_members")
    .select("lab_id, laboratories(id, name)")
    .eq("user_id", userId)
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

  const base = (displayName.trim() || "個人").slice(0, 80);
  const name = `${base}のワークスペース`.slice(0, 120);

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

  return { labId: lab.id, labName: lab.name };
}
