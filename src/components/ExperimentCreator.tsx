"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Callout, Card, Field, Select, TextInput } from "./ui";
import { createClient } from "@/lib/supabase/client";

export interface LabOption {
  id: string;
  name: string;
  description: string | null;
  role: string;
}

/**
 * Creates a laboratory (via the SECURITY DEFINER RPC, which also inserts the
 * owner membership) and experiments within it.
 */
export function ExperimentCreator({ labs }: { labs: LabOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [labName, setLabName] = useState("");
  const [expName, setExpName] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [operator, setOperator] = useState("");
  const [labId, setLabId] = useState(labs[0]?.id ?? "");

  async function createLab(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("create_laboratory", {
        lab_name: labName.trim(),
        lab_description: null,
      });
      if (error) throw error;
      setLabName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the laboratory.");
    } finally {
      setBusy(false);
    }
  }

  async function createExperiment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the experiment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Callout tone="danger" title="Save failed">{error}</Callout>}

      {labs.length === 0 ? (
        <Card title="研究室を作成 / Create a laboratory" subtitle="Experiments and data are scoped to a laboratory.">
          <form onSubmit={createLab} className="flex flex-wrap items-end gap-3">
            <Field label="名称 / Name" className="min-w-56 flex-1">
              <TextInput
                value={labName}
                onChange={(e) => setLabName(e.target.value)}
                placeholder="Cartilage Biology Lab"
                required
              />
            </Field>
            <Button type="submit" variant="primary" disabled={busy || !labName.trim()}>
              作成 / Create
            </Button>
          </form>
        </Card>
      ) : (
        <Card title="実験を作成 / New experiment">
          <form onSubmit={createExperiment} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <Field label="研究室 / Laboratory">
              <Select value={labId} onChange={(e) => setLabId(e.target.value)}>
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="実験名 / Name" className="lg:col-span-2">
              <TextInput
                value={expName}
                onChange={(e) => setExpName(e.target.value)}
                placeholder="TMT labeling"
                required
              />
            </Field>
            <Field label="日付 / Date">
              <TextInput type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
            </Field>
            <Field label="担当者 / Operator">
              <TextInput value={operator} onChange={(e) => setOperator(e.target.value)} />
            </Field>
            <div className="lg:col-span-5">
              <Button type="submit" variant="primary" disabled={busy || !expName.trim() || !labId}>
                作成 / Create experiment
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
