"use client";

import { useState } from "react";
import { Button, Card, Field, TextArea, TextInput } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { ReviewerAvatar } from "@/components/peerReview/ReviewerAvatar";
import { REVIEWER_LABELS, type ReviewerRole } from "@/lib/ai/peerReviewReport";
import type { ReviewerProfile } from "@/lib/ai/reviewerProfiles";
import { updateReviewerProfile } from "@/lib/peerReview/reviewerProfileActions";

/**
 * Names and scoring rubric for the three AI Peer Review reviewers.
 *
 * Platform-wide, not per-lab (the page that renders this already enforces
 * `requirePlatformAdmin`): the three reviewers are one shared identity for
 * the whole deployment, the same way the OpenAI model ids in `.env.local`
 * are one deployment-wide choice.
 *
 * `rubricNotes` is free text appended to that reviewer's system prompt. It
 * tunes emphasis and strictness - "この分野では再現性の記述を特に厳しく見る"
 * - but can never add or remove one of the nine category score fields, since
 * those are fixed by the JSON schema every reviewer is asked to fill.
 */
export function ReviewerProfileEditor({
  profiles,
}: {
  profiles: Record<ReviewerRole, ReviewerProfile>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {(Object.keys(REVIEWER_LABELS) as ReviewerRole[]).map((role) => (
        <ReviewerCard key={role} role={role} profile={profiles[role]} />
      ))}
    </div>
  );
}

function ReviewerCard({ role, profile }: { role: ReviewerRole; profile: ReviewerProfile }) {
  const { toast } = useToast();
  const { title, focus } = REVIEWER_LABELS[role];

  const [name, setName] = useState(profile.name);
  const [rubricNotes, setRubricNotes] = useState(profile.rubricNotes);
  const [saving, setSaving] = useState(false);

  const dirty = name !== profile.name || rubricNotes !== profile.rubricNotes;

  async function save() {
    setSaving(true);
    try {
      const res = await updateReviewerProfile(role, name, rubricNotes);
      if (!res.ok) throw new Error(res.error ?? "保存に失敗しました。");
      toast(`${name} のプロフィールを保存しました。`, { tone: "good" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。", { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={`${title}（${focus}）`}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2 sm:w-32">
          <ReviewerAvatar name={name || "?"} size={72} />
          <p className="text-center text-[11px] text-ink-3">名前から自動生成</p>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <Field label="名前">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="" />
          </Field>
          <Field
            label="採点ルーブリックの追加指示"
            hint="この査読者のプロンプトに追記されます。厳しさの調整や重視する観点の指定に使えます。9つのスコア項目自体は変更されません。"
          >
            <TextArea
              value={rubricNotes}
              onChange={(e) => setRubricNotes(e.target.value)}
              rows={4}
              placeholder=""
            />
          </Field>
          <div className="flex justify-end">
            <Button
              size="sm" variant="primary" icon="save"
              disabled={!dirty || saving || !name.trim()}
              onClick={save}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
