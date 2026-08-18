"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  Button, Callout, Card, EmptyState, Field, Select, TextArea, TextInput,
} from "@/components/ui";
import { useDownload, useWorkspace } from "@/components/workspace";
import {
  BUILT_IN_TEMPLATES, renderTemplate, validateTemplateValues,
  type NotebookTemplate, type TemplateValues,
} from "@/lib/notebook/templates";
import { renderMarkdown } from "@/lib/notebook/markdown";
import { buildReport } from "@/lib/notebook/report";

export default function NotebookPage() {
  const ws = useWorkspace();
  const download = useDownload();
  const [templateId, setTemplateId] = useState(BUILT_IN_TEMPLATES[0].id);
  const [values, setValues] = useState<TemplateValues>({});
  const [copied, setCopied] = useState(false);

  const template = useMemo<NotebookTemplate>(
    () => BUILT_IN_TEMPLATES.find((t) => t.id === templateId) ?? BUILT_IN_TEMPLATES[0],
    [templateId],
  );

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

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">実験ノート自動化</h1>
        <p className="mt-1 text-sm text-ink-2">
          テンプレートを一度埋め、キューした解析ブロックを貼り付けて、完成したエントリを書き出します。
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="テンプレート" subtitle={template.description}>
            <Field label="種類">
              <Select value={templateId} onChange={(e) => { setTemplateId(e.target.value); }}>
                {BUILT_IN_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.category}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>

          <Card
            title="入力"
            subtitle="星印の項目だけ必須です。残りは進めながら埋められます。"
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
            subtitle="データ整理と統計解析のページからキューされます。"
            actions={
              ws.clips.length > 0 && (
                <Button size="sm" variant="danger" onClick={ws.clearClips}>
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
                    <Button size="sm" variant="ghost" onClick={() => ws.removeClip(c.id)}>
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
                  {copied ? "コピー済 ✓" : "コピー"}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
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
