"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Field, Select, TextInput } from "./ui";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/shell/Toast";

export interface LabOption {
  id: string;
  name: string;
  description: string | null;
  role: string;
}

/**
 * Creates experiments within a laboratory the signed-in user already
 * belongs to.
 *
 * Laboratory creation itself is an administrative function only, reachable
 * from `/admin/labs` - a regular user cannot spin up a laboratory from this
 * page, only work inside one an administrator has already added them to.
 */
export function ExperimentCreator({ labs }: { labs: LabOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const [expName, setExpName] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [operator, setOperator] = useState("");
  const [labId, setLabId] = useState(labs[0]?.id ?? "");

  async function createExperiment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("experiments").insert({
        lab_id: labId,
        project_id: null,
        name: expName.trim(),
        experiment_date: expDate,
        operator: operator.trim() || null,
        purpose: null,
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;
      setExpName("");
      setOperator("");
      toast("実験を作成しました。", { tone: "good" });
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "実験を作成できませんでした。", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {labs.length === 0 ? (
        <EmptyState title="所属している研究室がありません">
          研究室の作成はシステム管理者のみが行えます。管理者に依頼して研究室に追加してもらってください。
        </EmptyState>
      ) : (
        <Card title="実験を作成">
          <form onSubmit={createExperiment} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <Field label="研究室">
              <Select value={labId} onChange={(e) => setLabId(e.target.value)}>
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="実験名" className="lg:col-span-2">
              <TextInput
                value={expName}
                onChange={(e) => setExpName(e.target.value)}
                required
              />
            </Field>
            <Field label="日付">
              <TextInput type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
            </Field>
            <Field label="担当者">
              <TextInput value={operator} onChange={(e) => setOperator(e.target.value)} />
            </Field>
            <div className="lg:col-span-5">
              <Button type="submit" variant="primary" icon="plus" disabled={busy || !expName.trim() || !labId}>
                実験を作成
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
