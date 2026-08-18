import Link from "next/link";
import { Badge, Callout, Card, EmptyState } from "@/components/ui";
import { createServerSupabase, getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";
import { ExperimentCreator, type LabOption } from "@/components/ExperimentCreator";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Callout tone="info" title="Supabase is not configured">
        Add the project URL and keys to <code>.env.local</code> to save experiments. The
        organize, analyze and notebook pages work without it.
      </Callout>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-ink">実験一覧 / Experiments</h1>
        <Callout tone="info" title="Sign in to save experiments">
          <Link href="/login" className="text-accent underline">ログイン / Sign in</Link>{" "}
          to keep experiments, notebook entries and figures. Everything else works signed out.
        </Callout>
      </div>
    );
  }

  const supabase = await createServerSupabase();

  const { data: memberships, error: memberError } = await supabase
    .from("lab_members")
    .select("lab_id, role, laboratories(id, name, description)")
    .order("joined_at", { ascending: true });

  if (memberError) {
    return (
      <Callout tone="danger" title="Could not load laboratories">
        {memberError.message}
        {/relation|does not exist|Could not find the table/i.test(memberError.message) && (
          <p className="mt-1.5">
            The schema has not been applied yet — run <code>npm run db:push</code>.
          </p>
        )}
      </Callout>
    );
  }

  const labs: LabOption[] = [];
  for (const m of memberships ?? []) {
    // The embedded relation arrives as an object (or array, depending on the
    // inferred cardinality); normalize both shapes.
    const embedded = m.laboratories as unknown;
    const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
      | { id: string; name: string; description: string | null }
      | null
      | undefined;
    if (lab) labs.push({ ...lab, role: String(m.role) });
  }

  const { data: experiments } = await supabase
    .from("experiments")
    .select("id, name, experiment_date, operator, status, lab_id")
    .order("experiment_date", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">実験一覧 / Experiments</h1>
          <p className="mt-1 text-sm text-ink-2">
            Signed in as {user.email}
          </p>
        </div>
      </header>

      <ExperimentCreator labs={labs} />

      {labs.length === 0 ? (
        <EmptyState title="No laboratory yet">
          Create one above to start recording experiments.
        </EmptyState>
      ) : (experiments ?? []).length === 0 ? (
        <EmptyState title="No experiments yet">
          Create your first experiment above.
        </EmptyState>
      ) : (
        <Card title={`${experiments!.length} experiment(s)`}>
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {experiments!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{e.name}</p>
                  <p className="text-xs text-ink-3">
                    {e.experiment_date}
                    {e.operator ? ` · ${e.operator}` : ""}
                    {" · "}
                    {labs.find((l) => l.id === e.lab_id)?.name ?? "—"}
                  </p>
                </div>
                <Badge
                  tone={
                    e.status === "complete" ? "good"
                      : e.status === "archived" ? "neutral"
                        : e.status === "planned" ? "accent" : "warn"
                  }
                >
                  {e.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
