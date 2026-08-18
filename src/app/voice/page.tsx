"use client";

import { useMemo, useState } from "react";
import {
  Badge, Button, Callout, Card, EmptyState, Field, StatTile, TextArea, cx,
} from "@/components/ui";
import { useDownload, useWorkspace } from "@/components/workspace";
import { Recorder, type Recording } from "@/components/voice/Recorder";
import { LiveTranscriber } from "@/components/voice/LiveTranscriber";
import { renderMarkdown } from "@/lib/notebook/markdown";
import type { StructuredVoiceNote } from "@/lib/ai/voiceNote";

type Stage = "record" | "transcript" | "structured";
type Engine = "browser" | "openai";

interface TranscribeResponse {
  text: string;
  model: string;
  audioSeconds: number | null;
  elapsedMs: number;
  bytes: number;
  error?: string;
}

interface StructureResponse {
  note: StructuredVoiceNote;
  markdown: string;
  missing: string[];
  model: string;
  usage: { totalTokens: number };
  elapsedMs: number;
  error?: string;
}

export default function VoicePage() {
  const ws = useWorkspace();
  const download = useDownload();

  // Browser recognition is the default: it is free and shows text as you
  // speak. The paid path stays one click away for accuracy or for Firefox.
  const [engine, setEngine] = useState<Engine>("browser");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [rawTranscript, setRawTranscript] = useState("");
  const [editedTranscript, setEditedTranscript] = useState("");
  const [structured, setStructured] = useState<StructureResponse | null>(null);
  const [busy, setBusy] = useState<null | "transcribe" | "structure">(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model: string; seconds: number | null; ms: number } | null>(null);

  const stage: Stage = structured ? "structured" : rawTranscript ? "transcript" : "record";
  const transcriptEdited = rawTranscript !== editedTranscript;

  async function transcribe(rec: Recording) {
    setBusy("transcribe");
    setError(null);
    try {
      const form = new FormData();
      const ext = rec.mimeType.includes("mp4") ? "mp4" : rec.mimeType.includes("ogg") ? "ogg" : "webm";
      form.append("audio", rec.blob, `memo.${ext}`);
      form.append("language", "ja");

      const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
      const json = (await res.json()) as TranscribeResponse;
      if (!res.ok) throw new Error(json.error ?? `文字起こしに失敗しました (${res.status})`);

      setRawTranscript(json.text);
      setEditedTranscript(json.text);
      setMeta({ model: json.model, seconds: json.audioSeconds, ms: json.elapsedMs });
    } catch (e) {
      setError(e instanceof Error ? e.message : "文字起こしに失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  async function structure() {
    setBusy("structure");
    setError(null);
    try {
      const res = await fetch("/api/voice/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: editedTranscript,
          referenceDate: new Date().toISOString().slice(0, 10),
        }),
      });
      const json = (await res.json()) as StructureResponse;
      if (!res.ok) throw new Error(json.error ?? `構造化に失敗しました (${res.status})`);
      setStructured(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "構造化に失敗しました。");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setRawTranscript("");
    setEditedTranscript("");
    setStructured(null);
    setError(null);
    setMeta(null);
  }

  const previewHtml = useMemo(
    () => (structured ? renderMarkdown(structured.markdown) : ""),
    [structured],
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">音声メモ</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          実験中に話した内容を録音し、書き起こして実験ノートの形に整えます。
          音声・書き起こし・AI構造化・確定版を別々に保持するため、AIが誤って解釈しても元の記録は失われません。
        </p>
      </header>

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
              stage === s.id
                ? "bg-accent text-accent-contrast"
                : "bg-surface-2 text-ink-3",
            )}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {error && <Callout tone="danger" title="エラー">{error}</Callout>}

      <Card
        title="文字起こしの方法"
        subtitle="どちらの方法でも、この後の整形・ノート化は同じです。"
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <EngineOption
              selected={engine === "browser"}
              onSelect={() => setEngine("browser")}
              title="ブラウザ音声認識"
              badge={<Badge tone="good">無料</Badge>}
              points={[
                "APIキー不要・利用料なし",
                "話しながらリアルタイムで文字が出る",
                "Chrome / Edge / Safari のみ",
              ]}
            />
            <EngineOption
              selected={engine === "openai"}
              onSelect={() => setEngine("openai")}
              title="OpenAI で文字起こし"
              badge={<Badge tone="neutral">従量課金</Badge>}
              points={[
                "専門用語の精度が高い",
                "音声を残して聞き直せる",
                "すべてのブラウザで動作",
              ]}
            />
          </div>
          {engine === "browser" && (
            <Callout tone="info">
              音声はブラウザの音声認識サービス（Chrome/Edge は Google、Safari は Apple）に
              送られます。録音ファイルは作られず、テキストだけが手元に残ります。
            </Callout>
          )}
          {engine === "openai" && (
            <Callout tone="info">
              音声はサーバー経由で OpenAI に送られ、書き起こし後に破棄されます。
              保存されるのはテキストだけです。
            </Callout>
          )}
        </div>
      </Card>

      {engine === "browser" && (
        <Card
          title="話して文字にする"
          subtitle="話した内容がその場で文字になります。停止すると書き起こしが確定します。"
          actions={
            rawTranscript && (
              <Button size="sm" variant="danger" onClick={reset}>やり直す</Button>
            )
          }
        >
          <LiveTranscriber
            disabled={busy !== null}
            onCommit={(text) => {
              setRawTranscript(text);
              setEditedTranscript(text);
              setMeta(null);
              setError(null);
            }}
            onUnavailable={(reason) => {
              // Fall back rather than dead-end: the paid path works everywhere.
              setError(reason);
              setEngine("openai");
            }}
          />
        </Card>
      )}

      <Card
        title="録音"
        subtitle="音声はブラウザからサーバー経由で OpenAI に送られ、書き起こし後に破棄されます。保存されるのはテキストだけです。"
        className={engine === "browser" ? "hidden" : undefined}
        actions={
          (recording || rawTranscript) && (
            <Button size="sm" variant="danger" onClick={reset}>やり直す</Button>
          )
        }
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
            {/* Play it back: the researcher's own ears are the final check
                on whether the transcript is faithful. */}
            <audio controls src={recording.url} className="w-full" />
          </div>
        )}

        {busy === "transcribe" && (
          <div className="mt-3">
            <Callout tone="info">文字起こし中…（録音の長さに応じて数秒〜数十秒）</Callout>
          </div>
        )}
      </Card>

      {stage === "record" && !recording && (
        <Card title="または書き起こしを直接入力">
          <Field label="テキスト" hint="別の機器で録音した場合や、マイクが使えない場合に。">
            <TextArea
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
              placeholder="本日8月18日、TMT標識を実施します。サンプルは6検体…"
              className="min-h-28"
            />
          </Field>
          <div className="mt-3">
            <Button
              variant="primary"
              disabled={!editedTranscript.trim() || busy !== null}
              onClick={() => {
                setRawTranscript(editedTranscript);
                void structure();
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
          subtitle={
            meta
              ? `${meta.model} · 音声 ${meta.seconds ? meta.seconds.toFixed(1) + " 秒" : "長さ不明"}`
              : "手入力"
          }
          actions={
            <>
              {transcriptEdited && <Badge tone="warn">編集済み</Badge>}
              <Button
                size="sm"
                onClick={() => download(`transcript_${new Date().toISOString().slice(0, 10)}.txt`, editedTranscript)}
              >
                .txt
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={structure}
                disabled={busy !== null || !editedTranscript.trim()}
              >
                {busy === "structure" ? "整形中…" : structured ? "再整形" : "ノートに整形"}
              </Button>
            </>
          }
        >
          <Callout tone="info">
            送信前に読み返してください。専門用語やロット番号は聞き間違いが起きやすい箇所です。
          </Callout>
          <div className="mt-3">
            <TextArea
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
              className="min-h-32 font-mono text-[13px] leading-relaxed"
              aria-label="書き起こしテキスト"
            />
          </div>
          {transcriptEdited && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-ink-2">
                元の書き起こしを表示（変更前）
              </summary>
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
              {structured.missing.join("、")} — AIは推測しません。必要ならノート側で補ってください。
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
              subtitle={`${structured.model} · ${structured.usage.totalTokens} tokens · ${(structured.elapsedMs / 1000).toFixed(1)} 秒`}
            >
              <ExtractedFields note={structured.note} />
            </Card>

            <Card
              title="ノート形式のプレビュー"
              actions={
                <>
                  <Button
                    size="sm"
                    onClick={() =>
                      download(
                        `voice_note_${new Date().toISOString().slice(0, 10)}.md`,
                        structured.markdown,
                        "text/markdown",
                      )
                    }
                  >
                    .md
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      ws.addClip(
                        `音声メモ: ${structured.note.experiment_name ?? "無題"}`,
                        structured.markdown,
                      )
                    }
                  >
                    ノートへ
                  </Button>
                </>
              }
            >
              <div
                className="prose-note max-h-[32rem] overflow-y-auto rounded-lg border border-line bg-surface-1 px-4 py-3"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </Card>
          </div>
        </>
      )}

      {ws.clips.length > 0 && (
        <Callout tone="good" title={`ノートへ ${ws.clips.length} 件をキューに追加済み`}>
          <a className="underline" href="/notebook">実験ノート</a> を開いて組み立ててください。
        </Callout>
      )}

      {stage === "record" && !recording && !editedTranscript && (
        <EmptyState title="録音するとここに結果が表示されます">
          「録音開始」を押して、実験内容を話してください。
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
        note.reagents.length === 0
          ? dash
          : note.reagents.map((r, i) => (
              <span key={i} className="mr-2 inline-block">
                {r.name}
                {r.lot && <span className="text-ink-3"> (Lot {r.lot})</span>}
                {r.amount && <span className="text-ink-3"> {r.amount}</span>}
              </span>
            )),
      )}
      {row(
        "処理",
        note.treatments.length === 0
          ? dash
          : note.treatments.map((t, i) => (
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
          <ol className="list-decimal pl-4">
            {note.procedure.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        ),
      )}
      {note.observations.length > 0 &&
        row("観察", <ul className="list-disc pl-4">{note.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>)}
      {note.next_actions.length > 0 &&
        row("次の予定", <ul className="list-disc pl-4">{note.next_actions.map((a, i) => <li key={i}>{a}</li>)}</ul>)}
    </div>
  );
}

/**
 * One selectable transcription engine.
 *
 * The cost difference is the thing a researcher actually decides on, so it is
 * a badge rather than buried prose, and the browser-only limitation is stated
 * up front instead of surfacing as a failure later.
 */
function EngineOption({
  selected, onSelect, title, badge, points,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge: React.ReactNode;
  points: string[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-accent bg-accent-soft/40"
          : "border-line hover:border-line-strong hover:bg-surface-2",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cx(
            "grid h-4 w-4 place-items-center rounded-full border",
            selected ? "border-accent" : "border-line-strong",
          )}
        >
          {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        <span className="text-sm font-medium text-ink">{title}</span>
        {badge}
      </span>
      <ul className="mt-2 flex flex-col gap-0.5 pl-6">
        {points.map((p) => (
          <li key={p} className="text-[11px] text-ink-2">・{p}</li>
        ))}
      </ul>
    </button>
  );
}
