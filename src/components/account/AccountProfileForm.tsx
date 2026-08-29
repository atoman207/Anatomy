"use client";

import { useRef, useState } from "react";
import { ActionForm } from "@/components/admin/ActionForm";
import { Field, TextInput } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/shell/Toast";
import {
  AVATAR_MAX_SOURCE_BYTES,
  resizeAvatarToDataUrl,
} from "@/lib/auth/avatar";
import { JP_DIAL_CODE } from "@/lib/auth/profileFields";
import { updateProfileAction } from "@/lib/auth/actions";

export function AccountProfileForm({
  displayName,
  dateOfBirth,
  phoneNational,
  major,
  avatarUrl,
}: {
  displayName: string;
  dateOfBirth: string | null;
  phoneNational: string;
  major: string | null;
  avatarUrl: string | null;
}) {
  const { toast } = useToast();
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(avatarUrl);

  async function onAvatarSelected(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("画像ファイルを選択してください。", { tone: "danger" });
      return;
    }
    if (file.size > AVATAR_MAX_SOURCE_BYTES) {
      toast("画像サイズが大きすぎます（8MB以下にしてください）。", { tone: "danger" });
      return;
    }
    try {
      setAvatarPreview(await resizeAvatarToDataUrl(file));
    } catch {
      toast("画像を処理できませんでした。", { tone: "danger" });
    }
  }

  return (
    <ActionForm action={updateProfileAction} submitLabel="保存" icon="save">
      <input type="hidden" name="avatar_url" value={avatarPreview ?? ""} />

      <Field label="アバター画像">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => avatarInput.current?.click()}
            aria-label="アバター画像を選択"
            className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-surface-2 text-ink-3 transition-colors hover:border-accent hover:text-accent"
          >
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- profile preview or stored data URL
              <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="user" className="h-10 w-10" />
            )}
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => avatarInput.current?.click()}
              className="text-[14px] font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
            >
              画像を変更
            </button>
            {avatarPreview && (
              <button
                type="button"
                onClick={() => setAvatarPreview(null)}
                className="text-[14px] font-medium text-ink-3 underline decoration-line underline-offset-2 hover:text-ink"
              >
                削除
              </button>
            )}
          </div>
        </div>
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onAvatarSelected(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Field>

      <Field label="表示名" htmlFor="account-display-name">
        <TextInput
          id="account-display-name"
          name="display_name"
          defaultValue={displayName}
          required
          maxLength={80}
          autoComplete="name"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="生年月日" htmlFor="account-dob">
          <TextInput
            id="account-dob"
            name="date_of_birth"
            type="date"
            autoComplete="bday"
            defaultValue={dateOfBirth ?? ""}
          />
        </Field>
        <Field label="電話番号" htmlFor="account-phone">
          <div className="flex">
            <span className="inline-flex items-center rounded-l-md border border-r-0 border-line bg-surface-2 px-3 text-[15px] text-ink-2">
              {JP_DIAL_CODE}
            </span>
            <TextInput
              id="account-phone"
              name="phone_national"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              defaultValue={phoneNational}
              className="rounded-l-none"
              placeholder="90-1234-5678"
            />
          </div>
        </Field>
      </div>

      <Field label="専攻" htmlFor="account-major">
        <TextInput id="account-major" name="major" defaultValue={major ?? ""} maxLength={120} />
      </Field>
    </ActionForm>
  );
}
