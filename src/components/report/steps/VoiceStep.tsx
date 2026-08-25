"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, Card, EmptyState, Field, StatTile, TextArea, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useWorkspace } from "@/components/workspace";
import { Recorder, type Recording } from "@/components/voice/Recorder";
import { LiveTranscriber } from "@/components/voice/LiveTranscriber";
import { renderMarkdown } from "@/lib/notebook/markdown";
import type { StructuredVoiceNote } from "@/lib/ai/voiceNote";
import {
  startVoiceNote, updateVoiceNoteEdit, updateVoiceNoteStructured, confirmVoiceNote,
  listVoiceNotes, type VoiceNoteSummary,
} from "@/lib/voice/actions";

type Stage = "record" | "transcript" | "structured";
type Engine = "browser" | "openai";

interface StructureResponse {
  note: StructuredVoiceNote;
  markdown: string;
  missing: string[];
  model: string;
  usage: { totalTokens: number };
  elapsedMs: number;
  error?: string;
}

/**
 * Step 3: capture today's work by voice (or typed text) and let AI structure
 * it. The structured note is handed up to the wizard so step 4 can prefill
 * from it - the same mapping `/notebook` already used, just without a route
 * change or a sessionStorage handoff in between.
 */
export function VoiceStep({
  onStructured,
}: {
  onStructured: (note: StructuredVoiceNote | null) => void;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const { toast } = useToast();

  const [engine, setEngine] = useState<Engine>("browser");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [rawTranscript, setRawTranscript] = useState("");
  const [editedTranscript, setEditedTranscript] = useState("");
  const [structured, setStructured] = useState<StructureResponse | null>(null);
  const [busy, setBusy] = useState<null | "transcribe" | "structure">(null);
  const [meta, setMeta] = useState<{ model: string; seconds: number | null; ms: number } | null>(null);

  const [voiceNoteId, setVoiceNoteId] = useState<string | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState<VoiceNoteSummary[]>([]);

  const stage: Stage = structured ? "structured" : rawTranscript ? "transcript" : "record";
  const transcriptEdited = rawTranscript !== editedTranscript;
  const locked = confirmedAt !== null;

  useEffect(() => {
    if (!ws.experimentId) return;
    let cancelled = false;
    listVoiceNotes(ws.experimentId).then((res) => {
      if (!cancelled && res.ok && res.data) setHistory(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [ws.experimentId]);

  async function selectEngine(next: Engine) {
    if (next === "browser") {
      setEngine("browser");
      return;
    }
    try {
      const q = ws.labId ? `?labId=${encodeURIComponent(ws.labId)}` : "";
      const res = await fetch(`/api/ai/access${q}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast(
          json.error ??
            "AI機能は有料プランのご契約が必要です。「料金・支払い」から個人研究者プランをお選びください。",
          { tone: "danger", title: "エラー" },
        );
        router.push("/billing");
        return;
      }
      setEngine("openai");
    } catch (e) {
      toast(e instanceof Error ? e.message : "プランの確認に失敗しました。", { tone: "danger", title: "エラー" });
    }
  }

  function redirectIfPaymentRequired(status: number, message: string): boolean {
    if (status !== 402) return false;
    toast(message, { tone: "danger", title: "エラー" });
    router.push("/billing");
    return true;
  }

  async function persistRawTranscript(
    text: string,
    engine: "browser" | "openai" | "manual",
    model: string | null,
    audioSeconds: number | null,
  ): Promise<string | null> {
    if (!ws.experimentId || !ws.labId || voiceNoteId) return voiceNoteId;
    const res = await startVoiceNote({
      labId: ws.labId, experimentId: ws.experimentId,
      engine, model, audioSeconds, rawTranscript: text,
    });
    if (res.ok && res.data) {
      setVoiceNoteId(res.data.id);
      return res.data.id;
    }
    toast(res.error ?? "音声メモの記録に失敗しました。", { tone: "danger" });
    return null;
  }

  async function transcribe(rec: Recording) {
    setBusy("transcribe");
    try {
      const form = new FormData();
      const ext = rec.mimeType.includes("mp4") ? "mp4" : rec.mimeType.includes("ogg") ? "ogg" : "webm";
      form.append("audio", rec.blob, `memo.${ext}`);
      form.append("language", "ja");
      if (ws.labId) form.append("labId", ws.labId);

      const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        const message = json.error ?? `文字起こしに失敗しました (${res.status})`;
        if (redirectIfPaymentRequired(res.status, message)) return;
        throw new Error(message);
      }

      setRawTranscript(json.text);
      setEditedTranscript(json.text);
      setMeta({ model: json.model, seconds: json.audioSeconds, ms: json.elapsedMs });
      void persistRawTranscript(json.text, "openai", json.model, json.audioSeconds);
    } catch (e) {
      toast(e instanceof Error ? e.message : "文字起こしに失敗しました。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function structure(idOverride?: string | null) {
    setBusy("structure");
    try {
      const noteId = idOverride ?? voiceNoteId;
      if (noteId && transcriptEdited) {
        await updateVoiceNoteEdit(noteId, editedTranscript);
      }
      const res = await fetch("/api/voice/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labId: ws.labId,
          transcript: editedTranscript,
          referenceDate: new Date().toISOString().slice(0, 10),
        }),
      });
      const json = (await res.json()) as StructureResponse;
      if (!res.ok) {
        const message = json.error ?? `構造化に失敗しました (${res.status})`;
        if (redirectIfPaymentRequired(res.status, message)) return;
        throw new Error(message);
      }
      setStructured(json);
      onStructured(json.note);
      if (noteId) {
        await updateVoiceNoteStructured(noteId, json.note, json.model);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "構造化に失敗しました。", { tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!voiceNoteId || !ws.labId || !structured) return;
    setConfirming(true);
    try {
      const res = await confirmVoiceNote({
        id: voiceNoteId, labId: ws.labId, finalMarkdown: structured.markdown,
      });
      if (!res.ok) throw new Error(res.error ?? "確定に失敗しました。");
      setConfirmedAt(new Date().toISOString());
      toast("確定しました。この記録は今後変更できません。", { tone: "good" });
      if (ws.experimentId) {
        const refreshed = await listVoiceNotes(ws.experimentId);
        if (refreshed.ok && refreshed.data) setHistory(refreshed.data);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "確定に失敗しました。", { tone: "danger" });
    } finally {
      setConfirming(false);
    }
  }

  function reset() {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setRawTranscript("");
    setEditedTranscript("");
    setStructured(null);
    onStructured(null);
    setMeta(null);
    setVoiceNoteId(null);
    setConfirmedAt(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="info">
        今日の作業を話すか入力すると、AIが次の実験ノートの項目に振り分けます。このステップは任意です — 何もなければそのまま「次へ」で構いません。
      </Callout>

      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {[
          { id: "record", label: engine === "browser" ? "1. 話す" : "1. 録音" },
          { id: "transcript", label: "2. 書き起こしを確認" },
          { id: "structured", label: "3. ノートに整形" },
        ].map((s) => (
          <li
            key={s.id}
            className={cx(
              "rounded-full px-3 py-1 font-medium",
              stage === s.id ? "bg-accent text-accent-contrast" : "bg-surface-2 text-ink-3",
            )}
          >
            {s.label}
          </li>
        ))}
      </ol>

      <Card title="文字起こしの方法">
        <div className="grid gap-2 sm:grid-cols-2">
          <EngineOption
            selected={engine === "browser"}
            onSelect={() => void selectEngine("browser")}
            title="無料"
            badge={<Badge tone="good">ブラウザ</Badge>}
            detail="ブラウザの音声認識でリアルタイムに文字にします。追加費用はかかりません。"
          />
          <EngineOption
            selected={engine === "openai"}
            onSelect={() => void selectEngine("openai")}
            title="有料"
            badge={<Badge tone="neutral">従量課金</Badge>}
            detail="録音した音声をAIが文字起こしします。研究室が有料プランを契約している必要があります。"
          />
        </div>
      </Card>

      {engine === "browser" && (
        <Card
          title="話して文字にする"
          actions={rawTranscript && <Button size="sm" variant="danger" icon="refresh" onClick={reset}>やり直す</Button>}
        >
          <LiveTranscriber
            disabled={busy !== null}
            committedText={editedTranscript}
            onCommittedTextChange={setEditedTranscript}
            onCommit={(text) => {
              setRawTranscript(text);
              setEditedTranscript(text);
              setMeta(null);
              void persistRawTranscript(text, "browser", null, null);
            }}
            onUnavailable={(reason) => {
              toast(reason, { tone: "danger", title: "エラー" });
              void selectEngine("openai");
            }}
          />
        </Card>
      )}

      <Card
        title="録音"
        className={engine === "browser" ? "hidden" : undefined}
        actions={(recording || rawTranscript) && <Button size="sm" variant="danger" icon="refresh" onClick={reset}>やり直す</Button>}
      >
        <Recorder
          disabled={busy !== null}
          onComplete={(rec) => {
            setRecording(rec);
            void transcribe(rec);
          }}
        />
        {recording && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="長さ" value={`${recording.seconds.toFixed(1)} 秒`} />
              <StatTile label="サイズ" value={`${(recording.bytes / 1024).toFixed(0)} KB`} />
              <StatTile label="形式" value={recording.mimeType.split(";")[0].replace("audio/", "")} />
              {meta && <StatTile label="処理時間" value={`${(meta.ms / 1000).toFixed(1)} 秒`} />}
            </div>
            <audio controls src={recording.url} className="w-full" />
          </div>
        )}
        {busy === "transcribe" && (
          <div className="mt-3">
            <Callout tone="info">文字起こし中…（録音の長さに応じて数秒〜数十秒）</Callout>
          </div>
        )}
      </Card>

      {stage === "record" && !recording && engine !== "browser" && (
        <Card title="または書き起こしを直接入力">
          <Field label="テキスト">
            <TextArea
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
              className="min-h-28"
            />
          </Field>
          <div className="mt-3">
            <Button
              variant="primary"
              icon="notebook"
              disabled={!editedTranscript.trim() || busy !== null}
              onClick={async () => {
                setRawTranscript(editedTranscript);
                const id = await persistRawTranscript(editedTranscript, "manual", null, null);
                void structure(id);
              }}
            >
              ノートに整形
            </Button>
          </div>
        </Card>
      )}

      {rawTranscript && (
        <Card
          title="書き起こし"
          subtitle={meta ? `音声 ${meta.seconds ? meta.seconds.toFixed(1) + " 秒" : "長さ不明"}` : "手入力"}
          actions={
            <>
              {transcriptEdited && <Badge tone="warn">編集済み</Badge>}
              {locked && <Badge tone="good">確定済み・変更不可</Badge>}
              <Button
                size="sm"
                variant="primary"
                icon="notebook"
                onClick={() => structure()}
                disabled={busy !== null || !editedTranscript.trim() || locked}
              >
                {busy === "structure" ? "整形中…" : structured ? "再整形" : "ノートに整形"}
              </Button>
            </>
          }
        >
          <TextArea
            value={editedTranscript}
            onChange={(e) => setEditedTranscript(e.target.value)}
            className="min-h-32 font-mono text-[13px] leading-relaxed"
            aria-label="書き起こしテキスト"
            disabled={locked}
          />
          {transcriptEdited && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-ink-2">元の書き起こしを表示（変更前）</summary>
              <pre className="scroll-x mt-2 rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink-3">
                {rawTranscript}
              </pre>
            </details>
          )}
        </Card>
      )}

      {structured && (
        <>
          {structured.missing.length > 0 && (
            <Callout tone="warn" title="音声に含まれていなかった項目">
              {structured.missing.join("、")} — AIは推測しません。実験ノートで補ってください。
            </Callout>
          )}
          {structured.note.uncertain_terms.length > 0 && (
            <Callout tone="warn" title="聞き取りが不確実な語">
              {structured.note.uncertain_terms.join("、")}
            </Callout>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="抽出された項目"
              subtitle={`${structured.usage.totalTokens} トークン · ${(structured.elapsedMs / 1000).toFixed(1)} 秒`}
            >
              <ExtractedFields note={structured.note} />
            </Card>

            <Card
              title="ノート形式のプレビュー"
              actions={
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  onClick={confirm}
                  disabled={!voiceNoteId || !ws.experimentId || confirming || locked}
                  title={!ws.experimentId ? "上で実験を選択してください" : locked ? "すでに確定済みです" : undefined}
                >
                  {locked ? "確定済み" : confirming ? "確定中…" : "確定して記録"}
                </Button>
              }
            >
              {locked && (
                <Callout tone="good">
                  {new Date(confirmedAt!).toLocaleString()} に確定しました。この記録は今後変更できません。
                </Callout>
              )}
              <div
                className="prose-note max-h-[32rem] overflow-y-auto rounded-lg border border-line bg-surface-1 px-4 py-3"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(structured.markdown) }}
              />
            </Card>
          </div>

          <Callout tone="good">この内容は次の「実験ノート」ステップに自動的に反映されます。</Callout>
        </>
      )}

      {ws.experimentId && history.length > 0 && (
        <Card title={`この実験の音声メモ履歴（${history.length}）`} subtitle="確定済みの記録は変更できません。">
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-ink-2">
                    {(h.edited_transcript || h.raw_transcript || "（書き起こしなし）").slice(0, 80)}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    {new Date(h.created_at).toLocaleString()}
                    {h.engine && <> · {h.engine}</>}
                  </p>
                </div>
                {h.confirmed_at ? <Badge tone="good">確定済み</Badge> : <Badge tone="warn">未確定</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {stage === "record" && !recording && !editedTranscript && (
        <EmptyState title="録音するとここに結果が表示されます">
          「録音開始」を押すか、上のテキスト欄に直接入力してください。
        </EmptyState>
      )}
    </div>
  );
}

function ExtractedFields({ note }: { note: StructuredVoiceNote }) {
  const dash = <span className="text-ink-3">未記録</span>;
  const row = (label: string, value: React.ReactNode) => (
    <div key={label} className="flex gap-3 border-b border-line py-1.5 last:border-0">
      <span className="w-24 shrink-0 text-xs text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 text-xs text-ink">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col">
      {row("実験日", note.experiment_date ?? dash)}
      {row("実験名", note.experiment_name ?? dash)}
      {row("担当者", note.operator ?? dash)}
      {row("目的", note.purpose ?? dash)}
      {row("サンプル数", note.sample_count === null ? dash : String(note.sample_count))}
      {row(
        "試薬",
        note.reagents.length === 0 ? dash : note.reagents.map((r, i) => (
          <span key={i} className="mr-2 inline-block">
            {r.name}
            {r.lot && <span className="text-ink-3"> (Lot {r.lot})</span>}
            {r.amount && <span className="text-ink-3"> {r.amount}</span>}
          </span>
        )),
      )}
      {row(
        "処理",
        note.treatments.length === 0 ? dash : note.treatments.map((t, i) => (
          <span key={i} className="mr-2 inline-block">
            {t.agent}
            {t.concentration && <span className="text-ink-3"> {t.concentration}</span>}
            {t.duration && <span className="text-ink-3"> / {t.duration}</span>}
          </span>
        )),
      )}
      {row(
        "実施内容",
        note.procedure.length === 0 ? dash : (
          <ol className="list-decimal pl-4">{note.procedure.map((p, i) => <li key={i}>{p}</li>)}</ol>
        ),
      )}
      {note.observations.length > 0 &&
        row("観察", <ul className="list-disc pl-4">{note.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>)}
      {note.next_actions.length > 0 &&
        row("次の予定", <ul className="list-disc pl-4">{note.next_actions.map((a, i) => <li key={i}>{a}</li>)}</ul>)}
    </div>
  );
}

function EngineOption({
  selected, onSelect, title, badge, detail,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge: React.ReactNode;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "rounded-lg border p-3 text-left transition-colors",
        selected ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong hover:bg-surface-2",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cx("grid h-4 w-4 place-items-center rounded-full border", selected ? "border-accent" : "border-line-strong")}
        >
          {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        <span className="text-sm font-medium text-ink">{title}</span>
        {badge}
      </span>
      <span className="mt-2 block pl-6 text-[12px] text-ink-2">{detail}</span>
    </button>
  );
}
