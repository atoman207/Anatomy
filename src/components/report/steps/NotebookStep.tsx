"use client";

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  Badge, Button, Callout, Card, EmptyState, Field, PendingOverlay, Select, TextArea, TextInput, cx,
} from "@/components/ui";
import { MediaPreviewModal } from "@/components/MediaPreviewModal";
import { useToast } from "@/components/shell/Toast";
import { useWorkspace } from "@/components/workspace";
import { Recorder, type Recording } from "@/components/voice/Recorder";
import { LiveTranscriber } from "@/components/voice/LiveTranscriber";
import {
  BUILT_IN_TEMPLATES, renderTemplate, templateFromCustomRow, validateTemplateValues,
  type NotebookTemplate, type TemplateValues,
} from "@/lib/notebook/templates";
import { listLabTemplates } from "@/lib/notebook/templateActions";
import { renderMarkdown, extractMarkdownImageSrc } from "@/lib/notebook/markdown";
import { buildReport } from "@/lib/notebook/report";
import {
  buildTodayDefaults,
  isNotebookEntryEditable,
  mapVoiceNoteToValues,
  mergePrefillLayers,
  prefillFromPrevious,
  prefillFromRawCapture,
  prefillLotsFromReagents,
} from "@/lib/notebook/prefill";
import {
  getNotebookPrefillContext,
  listNotebookEntries,
  saveNotebookEntry,
  updateNotebookEntry,
  type NotebookEntrySummary,
} from "@/lib/notebook/actions";
import { listFigures, saveFigure, type FigureSummary } from "@/lib/analyze/actions";
import { svgToDataUri } from "@/lib/plots/svg";
import type { NotebookTemplateRow } from "@/lib/supabase/types";
import type { WorkspaceClip } from "@/components/workspace";
import { SubmissionFilesManager } from "@/components/notebook/SubmissionFilesManager";
import { SelectionSummary } from "../SelectionSummary";

type Phase = "capture" | "review" | "media";
type Engine = "browser" | "openai";
type SpeechLang = "ja-JP" | "en-US";
type FigureSize = "small" | "medium" | "large" | "full";

const FIGURE_SIZE_OPTIONS: { id: FigureSize; label: string }[] = [
  { id: "small", label: "小" },
  { id: "medium", label: "中" },
  { id: "large", label: "大" },
  { id: "full", label: "全幅" },
];

/** Embeds a data URI as a clip's sole content, carrying the chosen display size. */
function imageClipMarkdown(label: string, dataUri: string, size: FigureSize): string {
  return `![${label}](${dataUri} "size:${size}")\n`;
}

export interface NotebookStepHandle {
  /** Saves the current draft as a notebook entry, same action the button uses. */
  save: () => Promise<{ ok: boolean; error?: string }>;
  /** The rendered preview element, rasterized into the finish-step PDF. */
  getPreviewElement: () => HTMLDivElement | null;
  getTitle: () => string;
}

/**
 * Step 4: capture today's work, then generate and finish the report.
 *
 * Three phases, in order:
 * ① 話す・書く → ② 内容を確認・修正する → ③ グラフ・画像を挿入する.
 * 「完了」saves only from the bottom of ③; images there are optional.
 */
export const NotebookStep = forwardRef<NotebookStepHandle>(
  function NotebookStep(_props, ref) {
    const ws = useWorkspace();
    const router = useRouter();
    const { toast } = useToast();
    const previewRef = useRef<HTMLDivElement>(null);

    const [phase, setPhase] = useState<Phase>("capture");

    // --- ① capture -----------------------------------------------------
    const [rawText, setRawText] = useState("");
    const [engine, setEngine] = useState<Engine>("browser");
    const [speechLang, setSpeechLang] = useState<SpeechLang>("ja-JP");
    const [transcribing, setTranscribing] = useState(false);
    const [structuring, setStructuring] = useState(false);
    const [structuredWithAi, setStructuredWithAi] = useState(false);

    // --- ② review / fields ----------------------------------------------
    const [customTemplates, setCustomTemplates] = useState<NotebookTemplateRow[]>([]);
    const [customLoadedFor, setCustomLoadedFor] = useState<string | null>(null);
    const [values, setValues] = useState<TemplateValues>({});
    const [prefillHint, setPrefillHint] = useState<string | null>(null);
    const [prefillBusy, setPrefillBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [history, setHistory] = useState<NotebookEntrySummary[]>([]);
    const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
    const [viewing, setViewing] = useState<NotebookEntrySummary | null>(null);

    // --- ③ media ----------------------------------------------------------
    const [figures, setFigures] = useState<FigureSummary[]>([]);
    const [figuresOpen, setFiguresOpen] = useState(false);
    const [imagePrompt, setImagePrompt] = useState("");
    const [imageBusy, setImageBusy] = useState(false);
    const [previewClip, setPreviewClip] = useState<WorkspaceClip | null>(null);
    const [insertSize, setInsertSize] = useState<FigureSize>("medium");

    useEffect(() => {
      if (!ws.labId || ws.labId === customLoadedFor) return;
      listLabTemplates(ws.labId).then((res) => {
        if (res.ok && res.data) setCustomTemplates(res.data);
        setCustomLoadedFor(ws.labId);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ws.labId]);

    const template = useMemo<NotebookTemplate>(() => {
      const key = ws.templateKey ?? BUILT_IN_TEMPLATES[0].id;
      if (key.startsWith("custom:")) {
        const slug = key.slice("custom:".length);
        const row = customTemplates.find((t) => t.slug === slug);
        if (row) return templateFromCustomRow(row);
      }
      return BUILT_IN_TEMPLATES.find((t) => t.id === key) ?? BUILT_IN_TEMPLATES[0];
    }, [ws.templateKey, customTemplates]);

    const today = useClientToday();

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
            json.error ?? "AI機能（高精度文字起こしなど）は個人研究者プラン以上のご契約が必要です。「料金・支払い」からプランをお選びください。",
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

    function appendCaptured(text: string) {
      setRawText((prev) => (prev.trim() ? `${prev}\n${text}` : text));
    }

    async function transcribePaid(rec: Recording) {
      setTranscribing(true);
      try {
        const form = new FormData();
        const ext = rec.mimeType.includes("mp4") ? "mp4" : rec.mimeType.includes("ogg") ? "ogg" : "webm";
        form.append("audio", rec.blob, `memo.${ext}`);
        form.append("language", speechLang.startsWith("en") ? "en" : "ja");
        if (ws.labId) form.append("labId", ws.labId);

        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 402) {
            toast(json.error ?? "支払いが必要です。", { tone: "danger", title: "エラー" });
            router.push("/billing");
            return;
          }
          throw new Error(json.error ?? `文字起こしに失敗しました (${res.status})`);
        }
        appendCaptured(json.text as string);
        toast("文字起こしを追加しました。", { tone: "good" });
      } catch (e) {
        toast(e instanceof Error ? e.message : "文字起こしに失敗しました。", { tone: "danger" });
      } finally {
        setTranscribing(false);
      }
    }

    /**
     * ① → ②: paid plans use AI to map capture text into template fields;
     * the free plan prefills the template directly (previous entry, lots, raw text).
     */
    async function proceedToReview() {
      if (!rawText.trim()) {
        toast("内容を記録してください（テキストの入力または音声入力）。", { tone: "warn" });
        return;
      }
      setStructuring(true);
      try {
        let templateLayer: TemplateValues = {};
        if (ws.labId && ws.experimentId) {
          const ctx = await getNotebookPrefillContext(ws.labId, ws.experimentId, template.id);
          if (ctx.ok && ctx.data) {
            const selected = ws.selectedReagentIds.length
              ? ctx.data.reagents.filter((r) => ws.selectedReagentIds.includes(r.id))
              : ctx.data.reagents;
            templateLayer = mergePrefillLayers(
              buildTodayDefaults(ctx.data.operator),
              prefillFromPrevious(template, ctx.data.previousValues),
              prefillLotsFromReagents(template, selected),
            );
            if (ctx.data.previousSavedAt) {
              setPrefillHint(
                `${new Date(ctx.data.previousSavedAt).toLocaleString("ja-JP")} の記録からプロトコル・試薬などを引き継ぎました。`,
              );
            }
          }
        } else if (ws.labId) {
          const ctx = await getNotebookPrefillContext(ws.labId, "", template.id);
          if (ctx.ok && ctx.data) {
            templateLayer = buildTodayDefaults(ctx.data.operator);
          }
        }

        if (ws.experimentLabel?.trim()) {
          templateLayer = mergePrefillLayers(templateLayer, {
            experiment_name: ws.experimentLabel.trim(),
          });
        }

        const q = ws.labId ? `?labId=${encodeURIComponent(ws.labId)}` : "";
        const accessRes = await fetch(`/api/ai/access${q}`, { cache: "no-store" });
        const access = (await accessRes.json()) as { ok: boolean };

        if (access.ok) {
          const res = await fetch("/api/voice/structure", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: rawText,
              labId: ws.labId ?? undefined,
              referenceDate: today || undefined,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "AIによる整形に失敗しました。");

          setValues((prev) =>
            mergePrefillLayers(templateLayer, mapVoiceNoteToValues(json.note), prev),
          );
          setStructuredWithAi(true);
          toast("内容を項目に振り分けました。下で確認・修正してください。", { tone: "good" });
        } else {
          setValues((prev) =>
            mergePrefillLayers(templateLayer, prefillFromRawCapture(template, rawText), prev),
          );
          setStructuredWithAi(false);
          toast("テンプレートの入力欄を用意しました。内容を確認・修正してください。", { tone: "good" });
        }

        ws.setReportContext(rawText);
        setPhase("review");
      } catch (e) {
        toast(e instanceof Error ? e.message : "次のステップへ進めませんでした。", { tone: "danger" });
      } finally {
        setStructuring(false);
      }
    }

    const applyTodayNotebook = useCallback(
      async (opts: { silent?: boolean } = {}) => {
        if (!ws.labId || !ws.experimentId) {
          if (!opts.silent) toast("先にステップ1で実験を選択してください。", { tone: "warn" });
          return;
        }
        setPrefillBusy(true);
        try {
          const res = await getNotebookPrefillContext(ws.labId, ws.experimentId, template.id);
          if (!res.ok || !res.data) throw new Error(res.error ?? "雛形の準備に失敗しました。");
          const selected = ws.selectedReagentIds.length
            ? res.data.reagents.filter((r) => ws.selectedReagentIds.includes(r.id))
            : res.data.reagents;

          const merged = mergePrefillLayers(
            buildTodayDefaults(res.data.operator),
            prefillFromPrevious(template, res.data.previousValues),
            prefillLotsFromReagents(template, selected),
            values,
          );
          setValues(merged);

          setPrefillHint(
            res.data.previousSavedAt
              ? `${new Date(res.data.previousSavedAt).toLocaleString("ja-JP")} の記録からプロトコル・試薬などを引き継ぎました。`
              : "試薬Lotと今日の日付・時刻を入力しました。",
          );
          if (!opts.silent) toast("前回の記録を引き継ぎました。", { tone: "good" });
        } catch (e) {
          if (!opts.silent) toast(e instanceof Error ? e.message : "雛形の準備に失敗しました。", { tone: "danger" });
        } finally {
          setPrefillBusy(false);
        }
      },
      [template, toast, values, ws.experimentId, ws.labId, ws.selectedReagentIds],
    );

    const effective = useMemo<TemplateValues>(() => {
      const defaults: TemplateValues = {};
      if (today) defaults.experiment_date = today;
      if (ws.sheet?.rows.length) defaults.sample_count = String(ws.sheet.rows.length);
      return { ...defaults, ...values };
    }, [today, ws.sheet, values]);

    const validation = validateTemplateValues(template, effective);
    const body = useMemo(() => renderTemplate(template, effective), [template, effective]);

    const full = useMemo(() => {
      const clips = ws.clips.map((c) => c.markdown);
      if (clips.length === 0) return body;
      const attachmentsMd = clips.join("\n\n");
      // Every built-in template reserves a trailing "## 添付ファイル" heading
      // for exactly this - dropping images in right after it keeps them part
      // of the report's own flow instead of bolted on as a second, redundant
      // "解析結果・添付" section below a divider. Older/custom templates that
      // never had that heading keep the previous append-at-the-end behavior.
      const heading = "## 添付ファイル";
      const idx = body.indexOf(heading);
      if (idx !== -1) {
        const insertAt = idx + heading.length;
        return (
          body.slice(0, insertAt) + "\n\n" + attachmentsMd + "\n" + body.slice(insertAt)
        ).replace(/\n{3,}/g, "\n\n");
      }
      return `${body}\n\n---\n\n${buildReport("解析結果・添付", clips, {
        operator: typeof effective.operator === "string" ? effective.operator : undefined,
        date: typeof effective.experiment_date === "string" ? effective.experiment_date : undefined,
      })}`;
    }, [body, ws.clips, effective]);

    const html = useMemo(() => renderMarkdown(full), [full]);
    const title = (typeof effective.experiment_name === "string" && effective.experiment_name) || "実験";
    const dateStr = (typeof effective.experiment_date === "string" && effective.experiment_date) || today || "";

    useEffect(() => {
      const experimentId = ws.experimentId;
      if (!experimentId) return;
      let cancelled = false;
      listNotebookEntries(experimentId).then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) setHistory(res.data);
        setHistoryLoadedFor(experimentId);
      });
      return () => {
        cancelled = true;
      };
    }, [ws.experimentId]);

    async function save(): Promise<{ ok: boolean; error?: string }> {
      if (!ws.experimentId || !ws.labId) return { ok: false, error: "実験を選択してください。" };
      setSaving(true);
      try {
        const res = editingId
          ? await updateNotebookEntry({
              id: editingId,
              title: `${dateStr} ${title}`.trim(),
              values: effective as Record<string, unknown>,
              bodyMd: full,
            })
          : await saveNotebookEntry({
              labId: ws.labId,
              experimentId: ws.experimentId,
              templateSlug: template.id,
              title: `${dateStr} ${title}`.trim(),
              values: effective as Record<string, unknown>,
              bodyMd: full,
            });
        if (!res.ok) throw new Error(res.error ?? "保存に失敗しました。");
        if (!editingId && "id" in (res.data ?? {})) {
          setEditingId((res.data as { id: string }).id);
        }
        toast(editingId ? "更新しました。" : "今日のラボレポートを作成しました。", { tone: "good" });
        const refreshed = await listNotebookEntries(ws.experimentId);
        if (refreshed.ok && refreshed.data) setHistory(refreshed.data);
        return { ok: true };
      } catch (e) {
        const error = e instanceof Error ? e.message : "保存に失敗しました。";
        toast(error, { tone: "danger" });
        return { ok: false, error };
      } finally {
        setSaving(false);
      }
    }

    /** ② → ③: open the optional media step; does not save yet. */
    function proceedToMedia() {
      if (!validation.valid) {
        toast(`未入力の必須項目があります: ${validation.missing.join(", ")}`, { tone: "warn" });
        return;
      }
      setPhase("media");
    }

    /** Saves from the bottom of ③ (images are optional). */
    async function complete() {
      await save();
    }

    useImperativeHandle(ref, () => ({
      save,
      getPreviewElement: () => previewRef.current,
      getTitle: () => `${dateStr} ${title}`.trim(),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [editingId, effective, full, template.id, ws.experimentId, ws.labId, dateStr, title]);

    function keyForTemplateSlug(slug: string | null): string {
      if (!slug) return BUILT_IN_TEMPLATES[0].id;
      if (BUILT_IN_TEMPLATES.some((t) => t.id === slug)) return slug;
      if (customTemplates.some((t) => t.slug === slug)) return `custom:${slug}`;
      return BUILT_IN_TEMPLATES[0].id;
    }

    function startEditing(entry: NotebookEntrySummary) {
      if (!isNotebookEntryEditable(entry.created_at)) return;
      setEditingId(entry.id);
      ws.setTemplate({
        key: keyForTemplateSlug(entry.template_slug),
        label: entry.template_slug ?? BUILT_IN_TEMPLATES[0].name,
      });
      setValues(entry.values as TemplateValues);
      setPrefillHint(null);
      setViewing(null);
      setPhase("review");
      toast("この記録を編集しています。保存すると上書きされます。", { tone: "info" });
    }

    async function onUploadImage(file: File) {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("読み込みに失敗しました。"));
        reader.readAsDataURL(file);
      }).catch((e: Error) => {
        toast(e.message, { tone: "danger" });
        return null;
      });
      if (!dataUri) return;
      const label = file.name || "画像";
      ws.addClip(label, imageClipMarkdown(label, dataUri, insertSize));
      toast("画像を追加しました。", { tone: "good" });
    }

    async function openFigurePicker() {
      setFiguresOpen((v) => !v);
      if (!figuresOpen && ws.experimentId) {
        const res = await listFigures(ws.experimentId);
        if (res.ok && res.data) setFigures(res.data);
      }
    }

    function insertFigure(f: FigureSummary) {
      if (!f.svg) return;
      const dataUri = svgToDataUri(f.svg);
      ws.addClip(f.title, imageClipMarkdown(f.title, dataUri, insertSize));
      toast("図を追加しました。", { tone: "good" });
    }

    /** Drafts a prompt from everything entered so far - the raw capture text, not just the template's purpose/procedure fields - so the generated figure is grounded in the actual report. */
    function suggestImagePrompt() {
      const parts = [template.name];
      if (rawText.trim()) parts.push(rawText.trim().split("\n").slice(0, 3).join(" "));
      else if (typeof effective.purpose === "string" && effective.purpose.trim()) {
        parts.push(effective.purpose.trim());
      }
      setImagePrompt(parts.join(" — ").slice(0, 300));
    }

    async function generateImage() {
      if (!imagePrompt.trim()) {
        toast("画像の説明を入力してください。", { tone: "warn" });
        return;
      }
      setImageBusy(true);
      try {
        const res = await fetch("/api/notebook/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: imagePrompt.trim(), labId: ws.labId ?? undefined }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "画像の生成に失敗しました。");
        const label = imagePrompt.trim().slice(0, 40);
        const dataUri = json.dataUri as string;
        ws.addClip(`AI生成: ${label}`, imageClipMarkdown(`AI生成: ${label}`, dataUri, insertSize));

        if (ws.labId && ws.experimentId) {
          const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" ` +
            `viewBox="0 0 1024 1024"><image href="${dataUri}" width="1024" height="1024"/></svg>`;
          const saved = await saveFigure({
            labId: ws.labId,
            experimentId: ws.experimentId,
            analysisId: null,
            kind: "ai_image",
            title: `AI生成: ${label}`,
            options: { prompt: imagePrompt.trim(), model: json.model },
            svg,
          });
          if (!saved.ok) {
            toast("画像は記録に追加されましたが、保存済みの図としては記録できませんでした。", { tone: "warn" });
          }
        }

        setImagePrompt("");
        toast("AIが画像を生成しました。", { tone: "good" });
      } catch (e) {
        toast(e instanceof Error ? e.message : "画像の生成に失敗しました。", { tone: "danger" });
      } finally {
        setImageBusy(false);
      }
    }

    const phaseDone = { capture: phase !== "capture", review: phase === "media" };

    return (
      <div className="flex flex-col gap-5">
        {imageBusy && (
          <PendingOverlay
            title="処理中…"
            hint="AIが模式図を生成しています。しばらくお待ちください。"
          />
        )}

        {previewClip && (
          <MediaPreviewModal title={previewClip.title} onClose={() => setPreviewClip(null)}>
            <ClipPreview markdown={previewClip.markdown} title={previewClip.title} />
          </MediaPreviewModal>
        )}

        <Callout tone="info">
          テンプレート「{template.name}」に沿って今日のラボレポートを作成します。
        </Callout>

        <SelectionSummary upTo={4} />

        {/* ---------------------------------------------------------- ① 話す・書く */}
        <Card
          title={<>① 話す・書く {phaseDone.capture && <Badge tone="good">入力済み</Badge>}</>}
          subtitle="今日行った作業を書くか、話して文字にしてください。何度でも追加・修正できます。"
        >
          {phase !== "capture" ? (
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-[13px] text-ink-2">{rawText.split("\n")[0]}</p>
              <Button size="sm" variant="ghost" onClick={() => setPhase("capture")}>編集する</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <EngineOption
                  active={engine === "browser"}
                  onClick={() => void selectEngine("browser")}
                  title="無料 — ブラウザの音声認識"
                  badge={<Badge tone="good">無料</Badge>}
                  detail="追加費用なし。話しながらリアルタイムに文字になります。Chrome・Edge・Safariで利用できます（Firefoxは非対応）。認識精度はブラウザ任せのため、専門用語や雑音の多い環境ではやや不安定です。"
                />
                <EngineOption
                  active={engine === "openai"}
                  onClick={() => void selectEngine("openai")}
                  title="従量課金 — AIによる高精度文字起こし"
                  badge={<Badge tone="neutral">従量課金</Badge>}
                  detail="録音した音声をAIが後から文字起こしします。専門用語や雑音にも比較的強く、認識精度が高めです。研究室が有料プランを契約している必要があります。"
                />
              </div>

              <Field label="認識する言語" className="max-w-[220px]">
                <Select value={speechLang} onChange={(e) => setSpeechLang(e.target.value as SpeechLang)}>
                  <option value="ja-JP">日本語（既定）</option>
                  <option value="en-US">English</option>
                </Select>
              </Field>

              {engine === "browser" ? (
                <LiveTranscriber
                  lang={speechLang}
                  disabled={structuring}
                  committedText={rawText}
                  onCommittedTextChange={setRawText}
                  onCommit={(text) => {
                    // Full current text (typed + spoken), not an append — the
                    // live box already holds the continuous transcript.
                    setRawText(text);
                  }}
                  onUnavailable={(reason) => {
                    toast(reason, { tone: "danger", title: "エラー" });
                    void selectEngine("openai");
                  }}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <Recorder
                    disabled={transcribing}
                    onComplete={(rec) => void transcribePaid(rec)}
                  />
                  {transcribing && <p className="text-[12px] text-ink-3">文字起こし中…</p>}
                  <TextArea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    className="min-h-28 font-mono text-[13px] leading-relaxed"
                    placeholder="録音するか、ここに直接貼り付け・入力してください。"
                    aria-label="記録するテキスト"
                  />
                </div>
              )}

              <div className="flex items-center justify-end">
                <Button
                  variant="primary" icon="arrow"
                  onClick={() => void proceedToReview()}
                  disabled={!rawText.trim() || structuring}
                >
                  {structuring ? "準備中…" : "次のステップ"}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------- ② 内容を確認・修正する */}
        {(phase === "review" || phase === "media") && (
          <>
            {editingId && phase === "review" && (
              <Callout tone="info" title="編集中">
                「次のステップ」で画像の追加へ進み、③の「完了」で上書き保存されます。
              </Callout>
            )}

            {phase === "review" && (
              <Card
                title="今日のノート（前回から引き継ぐ）"
                subtitle="前回のプロトコル・選択した試薬のLotを、現在の項目に追記します（既存の入力は上書きしません）。"
                actions={
                  <Button
                    size="sm" variant="primary" icon="notebook"
                    disabled={prefillBusy || !ws.experimentId}
                    onClick={() => void applyTodayNotebook()}
                  >
                    {prefillBusy ? "準備中…" : "前回の内容を引き継ぐ"}
                  </Button>
                }
              >
                {prefillHint && <Callout tone="good">{prefillHint}</Callout>}
              </Card>
            )}

            <Card
              title={<>② 内容を確認・修正する {phaseDone.review && <Badge tone="good">完了済み</Badge>}</>}
              subtitle={
                structuredWithAi
                  ? "星印は必須。AIが振り分けた内容をここで確認・修正してください。"
                  : "星印は必須。テンプレートの各項目に入力・修正してください。"
              }
            >
              {phase === "media" ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] text-ink-2">内容の確認が終わりました。</p>
                  <Button size="sm" variant="ghost" onClick={() => setPhase("review")}>内容を修正する</Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-3">
                    {template.fields.map((f) => {
                      const v = effective[f.key];
                      const str = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("\n") : String(v);
                      const set = (nv: string) => setValues({ ...values, [f.key]: nv });
                      return (
                        <Field
                          key={f.key}
                          htmlFor={`f-${f.key}`}
                          label={<>{f.label}{f.required && <span className="ml-1 text-danger">*</span>}</>}
                          hint={f.help}
                        >
                          {f.type === "textarea" || f.type === "list" ? (
                            <TextArea
                              id={`f-${f.key}`} value={str}
                              placeholder={f.placeholder ?? (f.type === "list" ? "1行に1項目" : "")}
                              onChange={(e) => set(e.target.value)}
                            />
                          ) : f.type === "select" ? (
                            <Select id={`f-${f.key}`} value={str} onChange={(e) => set(e.target.value)}>
                              <option value="">—</option>
                              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          ) : (
                            <TextInput
                              id={`f-${f.key}`}
                              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                              value={str} placeholder={f.placeholder}
                              onChange={(e) => set(e.target.value)}
                            />
                          )}
                        </Field>
                      );
                    })}
                  </div>

                  {!validation.valid && (
                    <div className="mt-3">
                      <Callout tone="warn" title="未入力の必須項目">{validation.missing.join(", ")}</Callout>
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <Button variant="primary" icon="arrow" onClick={proceedToMedia}>
                      次のステップ
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </>
        )}

        {/* ---------------------------------------------------- ③ グラフ・画像を挿入する
            Images are optional. 「完了」 lives at the bottom of this step only. */}
        {phase === "media" && (
          <Card
            title={`③ グラフ・画像を挿入する（${ws.clips.length}）`}
            subtitle="画像・図の追加は任意です。不要ならそのまま下の「完了」でレポートを保存できます。"
            actions={ws.clips.length > 0 && (
              <Button size="sm" variant="danger" icon="trash" onClick={ws.clearClips}>すべて消去</Button>
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-[13px] font-medium text-ink hover:border-accent hover:text-accent">
                画像をアップロード
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUploadImage(f); e.target.value = ""; }}
                />
              </label>
              <Button size="sm" onClick={openFigurePicker} disabled={!ws.experimentId}>
                {figuresOpen ? "図の一覧を閉じる" : "保存済みの図から選ぶ"}
              </Button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-ink-3">挿入サイズ（次に追加する画像に適用）:</span>
              <div className="inline-flex overflow-hidden rounded-md border border-line">
                {FIGURE_SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setInsertSize(opt.id)}
                    className={cx(
                      "px-2.5 py-1 text-[12px]",
                      insertSize === opt.id
                        ? "bg-accent text-white"
                        : "bg-surface-1 text-ink-2 hover:bg-surface-2",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {figuresOpen && (
              <div className="mt-3 rounded-lg border border-line p-3">
                {figures.length === 0 ? (
                  <p className="text-xs text-ink-3">この実験に保存された図はまだありません（統計・図の「ノートへ」から保存できます）。</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {figures.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-ink-2">{f.title}</span>
                        <Button size="sm" icon="plus" onClick={() => insertFigure(f)}>追加</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field
                label="AIで画像を生成"
                hint="ここまでの入力内容をもとに、生化学・生物学の模式図のみを生成します（BioRenderのような、ラベル付きのフラットな図解スタイル）。"
                className="min-w-[240px] flex-1"
              >
                <TextInput
                  value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="例: 96ウェルプレートのTMT標識レイアウト図"
                />
              </Field>
              <Button onClick={suggestImagePrompt} disabled={imageBusy} title="ここまでの入力内容から提案します">
                内容から提案
              </Button>
              <Button variant="primary" onClick={generateImage} disabled={imageBusy}>
                {imageBusy ? "生成中…" : "生成して追加"}
              </Button>
            </div>

            {ws.clips.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="図・画像はまだありません（任意）">
                  追加しなくても、下の「完了」でレポートを保存できます。
                </EmptyState>
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {ws.clips.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink">{c.title}</p>
                      <p className="text-[11px] text-ink-3">{new Date(c.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="eye"
                        onClick={() => setPreviewClip(c)}
                      >
                        プレビュー
                      </Button>
                      <Button size="sm" variant="ghost" icon="x" onClick={() => ws.removeClip(c.id)}>削除</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex justify-end border-t border-line pt-4">
              <Button variant="primary" icon="check" onClick={() => void complete()} disabled={saving}>
                {saving ? (editingId ? "更新中…" : "作成中…") : editingId ? "完了（更新）" : "完了"}
              </Button>
            </div>
          </Card>
        )}

        {ws.experimentId && <SubmissionFilesManager labId={ws.labId} experimentId={ws.experimentId} />}

        {ws.experimentId && (
          <Card
            title={`保存履歴（${history.length}）`}
            subtitle={historyLoadedFor !== ws.experimentId ? "読み込み中…" : "作成した日のうちだけ編集できます。"}
          >
            {history.length === 0 ? (
              <EmptyState title="この実験にはまだ保存された版がありません" />
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((h) => {
                  const editable = isNotebookEntryEditable(h.created_at);
                  return (
                    <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink">
                          {h.title}
                          {editingId === h.id && <> <Badge tone="accent">編集中</Badge></>}
                        </p>
                        <p className="text-[11px] text-ink-3">
                          {new Date(h.created_at).toLocaleString()}
                          {h.template_slug && <> · <Badge>{h.template_slug}</Badge></>}
                          {editable && <> · <Badge tone="good">本日中は編集可</Badge></>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {editable && (
                          <Button size="sm" variant="ghost" icon="edit" onClick={() => startEditing(h)}>編集</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setViewing(viewing?.id === h.id ? null : h)}>
                          {viewing?.id === h.id ? "閉じる" : "表示"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {viewing && (
              <div
                className="prose-note mt-3 max-h-[50vh] overflow-y-auto rounded-lg border border-line bg-surface-2 px-4 py-3"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(viewing.body_md) }}
              />
            )}
          </Card>
        )}

        <div className="pointer-events-none absolute -left-[200vw] top-0 w-[794px]">
          <div
            ref={previewRef}
            className="prose-note report-paper rounded-lg bg-white px-4 py-3 text-black"
            // renderMarkdown escapes all input before inserting any markup.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    );
  },
);

function ClipPreview({ markdown, title }: { markdown: string; title: string }) {
  const imageSrc = extractMarkdownImageSrc(markdown);
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={title}
        className="mx-auto max-h-[70vh] max-w-full rounded-lg border border-line object-contain"
      />
    );
  }
  return (
    <div
      className="prose-note text-[13px] leading-relaxed text-ink"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}

function EngineOption({
  active, onClick, title, badge, detail,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  badge: React.ReactNode;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
        active ? "border-accent bg-accent-soft/40" : "border-line hover:border-accent/50",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-ink">{title}</span>
        {badge}
      </span>
      <span className="text-[11px] leading-relaxed text-ink-3">{detail}</span>
    </button>
  );
}

function useClientToday(): string {
  return useSyncExternalStore(
    () => () => {},
    () => new Date().toISOString().slice(0, 10),
    () => "",
  );
}
