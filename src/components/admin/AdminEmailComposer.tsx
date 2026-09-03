"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Button, Callout, Card, Field, Select, TextArea, TextInput } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { sendAdminEmailAction } from "@/lib/email/adminActions";
import type { EmailAudienceUser } from "@/lib/email/adminActions";
// The same splitting and validation the action uses, so the count shown on
// the button is the count that will actually be sent.
import { EMAIL_RE, parseAddressList } from "@/lib/email/compose";

interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Compose one message and send it to one account, several, or everyone.
 *
 * The recipient list lives in React state rather than in the checkboxes
 * themselves: searching and filtering by laboratory unmounts rows, and an
 * unmounted checkbox contributes nothing to the submitted form. Keeping the
 * selection separate is what lets an administrator narrow the list to one lab,
 * tick a few people, then search for someone else without silently losing the
 * first few. The hidden inputs below are what actually gets posted.
 *
 * The server re-reads every address from the account id anyway (see
 * sendAdminEmailAction), so this component decides *who*, never *where*.
 */
export function AdminEmailComposer({
  users, labs, sender,
}: {
  users: EmailAudienceUser[];
  labs: string[];
  sender: string | null;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    sendAdminEmailAction,
    null,
  );
  useResultToast(state);

  const [query, setQuery] = useState("");
  const [labFilter, setLabFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [format, setFormat] = useState<"text" | "html">("text");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (labFilter && !u.labs.includes(labFilter)) return false;
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.labs.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [users, query, labFilter]);

  const manualAddresses = useMemo(() => parseAddressList(manual), [manual]);
  const manualInvalid = manualAddresses.filter((a) => !EMAIL_RE.test(a));

  // Selected accounts and typed addresses can name the same inbox; the server
  // dedupes on the address, so the count shown here has to as well.
  const selectedEmails = useMemo(
    () => new Set(users.filter((u) => selected.has(u.id)).map((u) => u.email.toLowerCase())),
    [users, selected],
  );
  const total = selectedEmails.size + manualAddresses.filter((a) => !selectedEmails.has(a)).length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelected((prev) => new Set([...prev, ...visible.map((u) => u.id)]));
  };
  const clearSelection = () => setSelected(new Set());

  const allVisibleSelected = visible.length > 0 && visible.every((u) => selected.has(u.id));

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        // A test goes only to the administrator, so it needs no confirmation.
        if (submitter?.value === "test") return;
        if (total === 0) {
          e.preventDefault();
          window.alert("宛先を1件以上選択または入力してください。");
          return;
        }
        if (!window.confirm(`${total} 件の宛先にメールを送信します。よろしいですか？`)) {
          e.preventDefault();
        }
      }}
    >
      {/* What actually gets posted - see the note at the top of this file. */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="user_ids" value={id} />
      ))}

      <Card
        title="宛先"
        subtitle="1人でも、複数人でも、全員でも送信できます。"
        actions={
          <Badge tone={total > 0 ? "accent" : "neutral"}>{total} 件を選択中</Badge>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="検索" htmlFor="email-search">
              <TextInput
                id="email-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="メール・名前・研究室で絞り込み"
              />
            </Field>
            <Field label="研究室" htmlFor="email-lab">
              <Select
                id="email-lab"
                value={labFilter}
                onChange={(e) => setLabFilter(e.target.value)}
              >
                <option value="">すべての研究室</option>
                {labs.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon="check" onClick={selectVisible} disabled={allVisibleSelected}>
              {labFilter || query ? `表示中の ${visible.length} 名を選択` : `全 ${users.length} 名を選択`}
            </Button>
            <Button size="sm" variant="ghost" icon="clear" onClick={clearSelection} disabled={selected.size === 0}>
              選択を解除
            </Button>
          </div>

          <div className="scroll-x max-h-80 overflow-y-auto rounded-lg border border-line">
            {visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-ink-3">
                該当するユーザーがいません。
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {visible.map((u) => (
                  <li key={u.id} className="even:bg-surface-2/40">
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                        checked={selected.has(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[13px] text-ink">
                          {u.email}
                        </span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {u.displayName}
                          {u.labs.length > 0 && `・${u.labs.join("、")}`}
                        </span>
                      </span>
                      {!u.confirmed && <Badge tone="warn">未確認</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Field
            label="その他のアドレス"
            htmlFor="manual-emails"
            hint="アカウントを持たない相手にも送れます。カンマ・改行・空白区切り。"
          >
            <TextArea
              id="manual-emails"
              name="manual_emails"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="someone@example.com, another@example.com"
              rows={2}
            />
          </Field>
          {manualInvalid.length > 0 && (
            <Callout tone="warn" title="メールアドレスの形式が正しくありません">
              {manualInvalid.slice(0, 5).join("、")}
            </Callout>
          )}
        </div>
      </Card>

      <Card
        title="本文"
        subtitle={
          sender
            ? `差出人: ${sender}（返信先を空欄にすると、このアドレスに返信が届きます）`
            : "SMTPが未設定のため送信できません。"
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="件名" htmlFor="email-subject">
              <TextInput
                id="email-subject"
                name="subject"
                required
                maxLength={200}
                placeholder="【LABNOTE】メンテナンスのお知らせ"
              />
            </Field>
            <Field label="形式" htmlFor="email-format">
              <Select
                id="email-format"
                name="body_format"
                value={format}
                onChange={(e) => setFormat(e.target.value === "html" ? "html" : "text")}
              >
                <option value="text">プレーンテキスト</option>
                <option value="html">HTML</option>
              </Select>
            </Field>
          </div>

          <Field
            label="返信先（任意）"
            htmlFor="email-replyto"
            hint="空欄の場合は差出人アドレスが返信先になります。"
          >
            <TextInput id="email-replyto" name="reply_to" type="email" placeholder="support@example.com" />
          </Field>

          <Field
            label="本文"
            htmlFor="email-body"
            hint={
              format === "html"
                ? "HTMLタグを使えます。テキストしか読めない環境向けに、タグを除いた本文も自動で同送されます。{{name}} と {{email}} は宛先ごとに差し替えられます。"
                : "{{name}} と {{email}} は宛先ごとに差し替えられます（{{name}} はアカウントの表示名、手入力アドレスは@より前）。"
            }
          >
            <TextArea
              id="email-body"
              name="body"
              required
              maxLength={20000}
              rows={12}
              placeholder={"{{name}} 様\n\nいつもLABNOTEをご利用いただきありがとうございます。"}
            />
          </Field>

          <Callout tone="info">
            宛先ごとに1通ずつ送信されるため、受信者に他の宛先が見えることはありません。
            1回の送信は最大500件までです。
          </Callout>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <TestButton />
            <SendButton count={total} disabled={!sender} />
          </div>
        </div>
      </Card>
    </form>
  );
}

/**
 * Both buttons submit the same form; the clicked button's `value` arrives as
 * `mode`, which is how one action serves a real send and a test send without
 * duplicating the composed message into a second form.
 */
function SendButton({ count, disabled }: { count: number; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="mode"
      value="send"
      variant="primary"
      icon="send"
      disabled={pending || disabled}
    >
      {pending ? "送信中…" : count > 0 ? `${count} 件に送信` : "送信"}
    </Button>
  );
}

function TestButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="mode" value="test" icon="mail" disabled={pending}>
      自分にテスト送信
    </Button>
  );
}

/**
 * Reports the action's result as a toast the moment it changes - the same
 * contract every other admin form has, via ActionForm's `useResultToast`.
 * A send can take a while, so the toast is the only signal that it finished.
 */
function useResultToast(state: ActionResult | null) {
  const { toast } = useToast();
  const last = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    toast(state.message, { tone: state.ok ? "good" : "danger" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}
