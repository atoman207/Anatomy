"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Callout, Card, Field, Select, TextInput } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useWorkspace } from "@/components/workspace";
import { createClient } from "@/lib/supabase/client";

interface ExperimentOption {
  id: string;
  name: string;
  experiment_date: string;
  lab_id: string;
  lab_name: string;
  created_by: string | null;
}

/**
 * Picks the experiment that every "保存" action on this page will target.
 *
 * Every data-producing tool (data整理, 統計・図, 音声, 論文検索, 実験ノート) shares
 * one workspace-level selection, so a researcher sets this once and every
 * save afterwards is already scoped to the right experiment.
 */
export function ExperimentPicker({
  helpText = "ここで選んだ実験に、この画面の保存操作が記録されます。",
}: {
  helpText?: string;
}) {
  const ws = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [options, setOptions] = useState<ExperimentOption[]>([]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLabId, setNewLabId] = useState("");
  const [labs, setLabs] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  function message(e: unknown): string {
    if (typeof e === "object" && e !== null && "message" in e) {
      const msg = (e as { message: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
    return "実験を作成できませんでした。";
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          if (!cancelled) {
            setSignedIn(false);
            setLoading(false);
          }
          return;
        }
        if (cancelled) return;
        setSignedIn(true);
        setUserId(userData.user.id);

        // Filter to this user explicitly. RLS on lab_members lets any member
        // read the lab's whole roster, so an unfiltered query returns one row
        // per teammate and the same lab appears repeatedly in the dropdown.
        const { data: memberRows } = await supabase
          .from("lab_members")
          .select("lab_id, laboratories(id, name, owner_id)")
          .eq("user_id", userData.user.id)
          .order("joined_at", { ascending: true });
        const seen = new Set<string>();
        const ownedLabIds: string[] = [];
        const labList = (memberRows ?? [])
          .map((r) => {
            const embedded = r.laboratories as unknown;
            const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
              | { id: string; name: string; owner_id: string }
              | null
              | undefined;
            return lab ? { id: lab.id, name: lab.name, owner_id: lab.owner_id } : null;
          })
          .filter((l): l is { id: string; name: string; owner_id: string } => {
            if (!l || seen.has(l.id)) return false;
            seen.add(l.id);
            if (l.owner_id === userData.user.id) ownedLabIds.push(l.id);
            return true;
          });
        if (cancelled) return;
        setLabs(labList.map((l) => ({ id: l.id, name: l.name })));
        setNewLabId((prev) => prev || labList[0]?.id || "");

        // Own experiments always. Lab creators also load every experiment in
        // labs they created, for read-only review of members' daily notes.
        const { data: ownRows, error: ownError } = await supabase
          .from("experiments")
          .select("id, name, experiment_date, lab_id, created_by, laboratories(name)")
          .eq("created_by", userData.user.id)
          .order("experiment_date", { ascending: false })
          .limit(100);
        if (ownError) throw ownError;

        let reviewRows: typeof ownRows = [];
        if (ownedLabIds.length > 0) {
          const { data, error } = await supabase
            .from("experiments")
            .select("id, name, experiment_date, lab_id, created_by, laboratories(name)")
            .in("lab_id", ownedLabIds)
            .order("experiment_date", { ascending: false })
            .limit(200);
          if (error) throw error;
          reviewRows = data ?? [];
        }

        const byId = new Map<string, {
          id: string;
          name: string;
          experiment_date: string;
          lab_id: string;
          created_by: string | null;
          laboratories: unknown;
        }>();
        for (const r of [...(ownRows ?? []), ...reviewRows]) {
          byId.set(r.id, r as typeof byId extends Map<string, infer V> ? V : never);
        }

        const opts: ExperimentOption[] = [...byId.values()].map((r) => {
          const embedded = r.laboratories as unknown;
          const lab = (Array.isArray(embedded) ? embedded[0] : embedded) as
            | { name: string }
            | null
            | undefined;
          return {
            id: r.id,
            name: r.name,
            experiment_date: r.experiment_date,
            lab_id: r.lab_id,
            lab_name: lab?.name ?? "—",
            created_by: r.created_by,
          };
        });
        opts.sort((a, b) => b.experiment_date.localeCompare(a.experiment_date));
        if (cancelled) return;
        setOptions(opts);

        // Restore a previous selection if it is still valid; otherwise pick
        // nothing rather than guess, so a save can never land in the wrong
        // experiment silently.
        if (ws.experimentId && !opts.some((o) => o.id === ws.experimentId)) {
          ws.setExperiment({ experimentId: null, labId: null, label: null });
        }
      } catch (e) {
        if (!cancelled) {
          toast(e instanceof Error ? e.message : "実験を読み込めませんでした。", {
            tone: "danger",
            title: "エラー",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once: the picker owns its own fetch, and selecting
    // an experiment updates the shared workspace store directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createExperiment(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newLabId) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const today = new Date().toISOString().slice(0, 10);
      const { data, error: insertError } = await supabase
        .from("experiments")
        .insert({
          lab_id: newLabId,
          name: newName.trim(),
          experiment_date: today,
          created_by: userData.user?.id ?? null,
        })
        .select("id, name, experiment_date, lab_id, created_by")
        .single();
      if (insertError) throw insertError;

      const labName = labs.find((l) => l.id === newLabId)?.name ?? "—";
      const opt: ExperimentOption = {
        ...data,
        lab_name: labName,
        created_by: data.created_by ?? userData.user?.id ?? null,
      };
      setOptions((prev) => [opt, ...prev]);
      ws.setExperiment({
        experimentId: opt.id,
        labId: opt.lab_id,
        label: `${opt.name}（${opt.experiment_date}）`,
      });
      setNewName("");
      setCreating(false);
      toast("実験を作成しました。", { tone: "good" });
    } catch (e) {
      toast(message(e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-xs text-ink-3">実験を読み込み中…</p>;
  }

  if (!signedIn) {
    return (
      <Callout tone="info" title="ログインすると保存できます">
        <Link href="/login" className="text-accent underline">ログイン</Link>
        すると、この画面の結果を実験に記録できます。ログインなしでも計算・作図はそのまま使えます。
      </Callout>
    );
  }

  return (
    <Card title="対象の実験" subtitle={helpText}>
      <div className="flex flex-col gap-3">
        {options.length === 0 && !creating ? (
          <Callout tone="info" title="実験がまだありません">
            新しい実験を作成する必要があります。
            <Link href="/labs" className="text-accent underline">研究室</Link>
            で研究室と実験を作成するか、下から作成してください。
          </Callout>
        ) : !creating ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="実験" className="min-w-[240px] flex-1">
              <Select
                value={ws.experimentId ?? ""}
                onChange={(e) => {
                  const opt = options.find((o) => o.id === e.target.value);
                  ws.setExperiment(
                    opt
                      ? {
                          experimentId: opt.id,
                          labId: opt.lab_id,
                          label: `${opt.name}（${opt.experiment_date}）`,
                        }
                      : { experimentId: null, labId: null, label: null },
                  );
                }}
              >
                <option value="">未選択（保存しない）</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.experiment_date} · {o.name} — {o.lab_name}
                    {userId && o.created_by && o.created_by !== userId ? "（閲覧）" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="button" size="sm" icon="plus" onClick={() => setCreating(true)}>
              新規実験
            </Button>
          </div>
        ) : (
          <form onSubmit={createExperiment} className="flex flex-wrap items-end gap-2">
            <Field label="実験名" className="min-w-[200px] flex-1">
              <TextInput
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder=""
              />
            </Field>
            {labs.length > 1 && (
              <Field label="研究室">
                <Select value={newLabId} onChange={(e) => setNewLabId(e.target.value)}>
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Button type="submit" size="sm" variant="primary" disabled={busy || !newName.trim()}>
              {busy ? "…" : "作成して選択"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Button>
            <p className="basis-full text-[11px] text-ink-3">
              研究室の作成者は複数作成できます。招待されたユーザーは研究室ごとに1件までです。
            </p>
          </form>
        )}

        {ws.experimentId && (
          <p className="text-xs text-ink-3">
            <Badge tone="accent">選択中</Badge>{" "}
            {ws.experimentLabel ?? ws.experimentId}
          </p>
        )}
      </div>
    </Card>
  );
}
