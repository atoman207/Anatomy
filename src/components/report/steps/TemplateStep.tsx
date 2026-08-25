"use client";

import { useEffect, useState } from "react";
import { Callout, Card, Field, Select } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { TemplateManager } from "@/components/notebook/TemplateManager";
import {
  BUILT_IN_BY_CATEGORY, BUILT_IN_TEMPLATES, templateFromCustomRow,
  type NotebookTemplate,
} from "@/lib/notebook/templates";
import { listLabTemplates } from "@/lib/notebook/templateActions";
import type { NotebookTemplateRow } from "@/lib/supabase/types";
import { SelectionSummary } from "../SelectionSummary";

/**
 * Step 3: create or pick the template today's 実験ノート will follow.
 *
 * Split out from the notebook step itself so the choice (and the ability to
 * build a lab's own template) happens before writing starts, not as a small
 * dropdown squeezed above the writing area - the template determines which
 * fields the AI-structuring step will even try to fill.
 */
export function TemplateStep() {
  const ws = useWorkspace();
  const [customTemplates, setCustomTemplates] = useState<NotebookTemplateRow[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  function refresh(labId: string) {
    listLabTemplates(labId).then((res) => {
      if (res.ok && res.data) setCustomTemplates(res.data);
      setLoadedFor(labId);
    });
  }

  useEffect(() => {
    if (!ws.labId || ws.labId === loadedFor) return;
    refresh(ws.labId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.labId]);

  const templateKey = ws.templateKey ?? BUILT_IN_TEMPLATES[0].id;

  function resolve(key: string): NotebookTemplate {
    if (key.startsWith("custom:")) {
      const slug = key.slice("custom:".length);
      const row = customTemplates.find((t) => t.slug === slug);
      if (row) return templateFromCustomRow(row);
    }
    return BUILT_IN_TEMPLATES.find((t) => t.id === key) ?? BUILT_IN_TEMPLATES[0];
  }

  const template = resolve(templateKey);

  function choose(key: string) {
    const t = resolve(key);
    ws.setTemplate({ key, label: t.name });
  }

  // A template is always selected (defaults to the generic built-in), so the
  // workspace should reflect that default the first time this step is seen
  // rather than staying null until the user opens the dropdown.
  useEffect(() => {
    if (ws.templateKey) return;
    ws.setTemplate({ key: BUILT_IN_TEMPLATES[0].id, label: BUILT_IN_TEMPLATES[0].name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.templateKey]);

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="info">
        今日の実験ノートが従うテンプレートを選びます。既存のテンプレートを使うか、このラボ専用のテンプレートを作成できます。
      </Callout>

      <SelectionSummary upTo={3} />

      <Card title="テンプレートを選ぶ" subtitle={template.description}>
        <Field label="種類">
          <Select value={templateKey} onChange={(e) => choose(e.target.value)}>
            {BUILT_IN_BY_CATEGORY.map(([category, list]) => (
              <optgroup key={category} label={category}>
                {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            ))}
            {customTemplates.length > 0 && (
              <optgroup label="カスタム（このラボ）">
                {customTemplates.map((t) => (
                  <option key={t.id} value={`custom:${t.slug}`}>{t.name} — {t.category || "カスタム"}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        {template.fields.length > 0 && (
          <div className="mt-4">
            <p className="text-[12px] font-medium text-ink-2">このテンプレートの項目</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {template.fields.map((f) => (
                <span
                  key={f.key}
                  className="rounded bg-surface-2 px-2 py-1 text-[11px] text-ink-2"
                >
                  {f.label}{f.required && <span className="text-danger">*</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {ws.labId ? (
        <TemplateManager
          labId={ws.labId}
          templates={customTemplates}
          onChanged={() => refresh(ws.labId!)}
        />
      ) : (
        <Callout tone="warn">
          自分のテンプレートを作成するには、先にステップ1で実験を選んでください（テンプレートはラボ単位で保存されます）。
        </Callout>
      )}
    </div>
  );
}
