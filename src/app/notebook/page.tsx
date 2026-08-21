"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Badge, Button, Callout, Card, EmptyState, Field, Select, TextArea, TextInput,
} from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { useDownload, useWorkspace } from "@/components/workspace";
import { ExperimentPicker } from "@/components/ExperimentPicker";
import { TemplateManager } from "@/components/notebook/TemplateManager";
import {
  BUILT_IN_TEMPLATES, renderTemplate, validateTemplateValues,
  type NotebookTemplate, type TemplateField, type TemplateValues,
} from "@/lib/notebook/templates";
import { renderMarkdown } from "@/lib/notebook/markdown";
import { buildReport } from "@/lib/notebook/report";
import {
  saveNotebookEntry, listNotebookEntries, type NotebookEntrySummary,
} from "@/lib/notebook/actions";
import { listLabTemplates } from "@/lib/notebook/templateActions";
import type { NotebookTemplateRow } from "@/lib/supabase/types";

/**
 * Built-ins grouped by category so the picker stays scannable as the shipped
 * template set grows. Categories keep the order they first appear in
 * BUILT_IN_TEMPLATES rather than being sorted, so the generic template stays
 * at the top.
 */
const BUILT_IN_BY_CATEGORY: [string, NotebookTemplate[]][] = (() => {
  const groups = new Map<string, NotebookTemplate[]>();
  for (const t of BUILT_IN_TEMPLATES) {
    const list = groups.get(t.category);
    if (list) list.push(t);
    else groups.set(t.category, [t]);
  }
  return [...groups.entries()];
})();

/** The custom-template slug becomes the notebook template, keyed distinctly from built-ins in the picker only. */
function templateFromRow(row: NotebookTemplateRow): NotebookTemplate {
  const fields = Array.isArray(row.fields) ? (row.fields as unknown as TemplateField[]) : [];
  return {
    id: row.slug,
    name: row.name,
    description: row.description ?? "",
    category: row.category || "カスタム",
    fields,
    body: row.body,
  };
}

export default function NotebookPage() {
  const ws = useWorkspace();
  const download = useDownload();
  const [templateKey, setTemplateKey] = useState<string>(BUILT_IN_TEMPLATES[0].id);
  const [values, setValues] = useState<TemplateValues>({});
  const [copied, setCopied] = useState(false);

  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const [history, setHistory] = useState<NotebookEntrySummary[]>([]);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<string | null>(null);
  const historyLoading = ws.experimentId !== null && ws.experimentId !== historyLoadedFor;
  const [viewing, setViewing] = useState<NotebookEntrySummary | null>(null);

  const [customTemplates, setCustomTemplates] = useState<NotebookTemplateRow[]>([]);
  const [customLoadedFor, setCustomLoadedFor] = useState<string | null>(null);

  function refreshCustomTemplates(labId: string) {
    listLabTemplates(labId).then((res) => {
      if (res.ok && res.data) setCustomTemplates(res.data);
      setCustomLoadedFor(labId);
    });
  }

  useEffect(() => {
    if (!ws.labId || ws.labId === customLoadedFor) return;
    refreshCustomTemplates(ws.labId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.labId]);

  const template = useMemo<NotebookTemplate>(() => {
    if (templateKey.startsWith("custom:")) {
      const slug = templateKey.slice("custom:".length);
      const row = customTemplates.find((t) => t.slug === slug);
      if (row) return templateFromRow(row);
    }
    return BUILT_IN_TEMPLATES.find((t) => t.id === templateKey) ?? BUILT_IN_TEMPLATES[0];
  }, [templateKey, customTemplates]);

  const today = useClientToday();

  /*
   * Defaults are layered under the user's input rather than written into
   * state. Today's date has to come from the client (this page is
   * prerendered, so a build-time date would not match on hydration), and the
   * sample count follows the sample sheet until the user overrides it.
   */
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
    return `${body}\n\n---\n\n${buildReport("解析結果", clips, {
      operator: typeof effective.operator === "string" ? effective.operator : undefined,
      date: typeof effective.experiment_date === "string" ? effective.experiment_date : undefined,
    })}`;
  }, [body, ws.clips, effective]);

  const html = useMemo(() => renderMarkdown(full), [full]);

  const title =
    (typeof effective.experiment_name === "string" && effective.experiment_name) || "実験";
  const dateStr =
    (typeof effective.experiment_date === "string" && effective.experiment_date) || today || "";

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

  async function save() {
    if (!ws.experimentId || !ws.labId) return;
    setSaving(true);
    try {
      const res = await saveNotebookEntry({
        labId: ws.labId,
        experimentId: ws.experimentId,
        templateSlug: template.id,
        title: `${dateStr} ${title}`.trim(),
        values: effective as Record<string, unknown>,
        bodyMd: full,
      });
      if (!res.ok) throw new Error(res.error ?? "保存に失敗しました。");
      toast(
        `保存しました（${new Date().toLocaleString()}）。この版は編集・削除できない記録として残ります。`,
        { tone: "good" },
      );
      const refreshed = await listNotebookEntries(ws.experimentId);
      if (refreshed.ok && refreshed.data) setHistory(refreshed.data);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">実験ノート</h1>
      </header>

      <ExperimentPicker helpText="ここで選んだ実験の記録として、右のプレビューを保存できます。" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="テンプレート" subtitle={template.description}>
            <Field label="種類">
              <Select value={templateKey} onChange={(e) => { setTemplateKey(e.target.value); }}>
                {BUILT_IN_BY_CATEGORY.map(([category, list]) => (
                  <optgroup key={category} label={category}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {customTemplates.length > 0 && (
                  <optgroup label="カスタム（このラボ）">
                    {customTemplates.map((t) => (
                      <option key={t.id} value={`custom:${t.slug}`}>
                        {t.name} — {t.category || "カスタム"}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
          </Card>

          {ws.labId && (
            <TemplateManager
              labId={ws.labId}
              templates={customTemplates}
              onChanged={() => refreshCustomTemplates(ws.labId!)}
            />
          )}

          <Card
            title="入力"
            subtitle="星印の項目は必須です。"
          >
            <div className="flex flex-col gap-3">
              {template.fields.map((f) => {
                const v = effective[f.key];
                const str = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("\n") : String(v);
                const set = (nv: string) => setValues({ ...values, [f.key]: nv });
                return (
                  <Field
                    key={f.key}
                    htmlFor={`f-${f.key}`}
                    label={
                      <>
                        {f.label}
                        {f.required && <span className="ml-1 text-danger">*</span>}
                      </>
                    }
                    hint={f.help}
                  >
                    {f.type === "textarea" || f.type === "list" ? (
                      <TextArea
                        id={`f-${f.key}`}
                        value={str}
                        placeholder={f.placeholder ?? (f.type === "list" ? "1行に1項目" : "")}
                        onChange={(e) => set(e.target.value)}
                      />
                    ) : f.type === "select" ? (
                      <Select id={`f-${f.key}`} value={str} onChange={(e) => set(e.target.value)}>
                        <option value="">—</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </Select>
                    ) : (
                      <TextInput
                        id={`f-${f.key}`}
                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                        value={str}
                        placeholder={f.placeholder}
                        onChange={(e) => set(e.target.value)}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          </Card>

          <Card
            title={`解析ブロック（${ws.clips.length}）`}
            subtitle="データ整理と統計解析から追加されます。"
            actions={
              ws.clips.length > 0 && (
                <Button size="sm" variant="danger" icon="trash" onClick={ws.clearClips}>
                  すべて消去
                </Button>
              )
            }
          >
            {ws.clips.length === 0 ? (
              <EmptyState title="ブロックはキューされていません">
                結果の「ノートへ」からここに追加できます。
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {ws.clips.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink">{c.title}</p>
                      <p className="text-[11px] text-ink-3">
                        {new Date(c.createdAt).toLocaleString()} · {c.markdown.length} 文字
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" icon="x" onClick={() => ws.removeClip(c.id)}>
                      削除
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {!validation.valid && (
            <Callout tone="warn" title="未入力の必須項目">
              {validation.missing.join(", ")}
            </Callout>
          )}

          <Card
            title="プレビュー"
            subtitle={`${full.split("\n").length} 行`}
            actions={
              <>
                <Button
                  size="sm"
                  icon="copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(full);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "コピー済" : "コピー"}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon="download"
                  onClick={() =>
                    download(
                      `${dateStr}_${title}`.replace(/[^\w.-]+/g, "_") + ".md",
                      full,
                      "text/markdown",
                    )
                  }
                >
                  .md
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon="save"
                  disabled={saving || !ws.experimentId}
                  onClick={save}
                  title={ws.experimentId ? undefined : "上で実験を選択してください"}
                >
                  {saving ? "保存中…" : "実験に保存"}
                </Button>
              </>
            }
          >
            <div
              className="prose-note max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-surface-1 px-4 py-3"
              // renderMarkdown escapes all input before inserting any markup.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </Card>

          <Card title="Markdownソース">
            <pre className="scroll-x max-h-80 overflow-y-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink-2">
              {full}
            </pre>
          </Card>

          {ws.experimentId && (
            <Card
              title={`保存履歴（${history.length}）`}
              subtitle="保存された版は変更・削除できません。追記のみの記録です。"
            >
              {historyLoading ? (
                <p className="text-xs text-ink-3">読み込み中…</p>
              ) : history.length === 0 ? (
                <EmptyState title="この実験にはまだ保存された版がありません" />
              ) : (
                <ul className="flex flex-col gap-2">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink">{h.title}</p>
                        <p className="text-[11px] text-ink-3">
                          {new Date(h.created_at).toLocaleString()}
                          {h.template_slug && <> · <Badge>{h.template_slug}</Badge></>}
                        </p>
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setViewing(viewing?.id === h.id ? null : h)}
                      >
                        {viewing?.id === h.id ? "閉じる" : "表示"}
                      </Button>
                    </li>
                  ))}
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
        </div>
      </div>
    </div>
  );
}

/**
 * Today's date, but only after hydration.
 *
 * This page is prerendered, so reading the date during the server render
 * would bake in the build date and mismatch on the client. The server
 * snapshot is empty and the real date arrives with the first client read.
 */
function useClientToday(): string {
  return useSyncExternalStore(
    () => () => {},
    () => new Date().toISOString().slice(0, 10),
    () => "",
  );
}
