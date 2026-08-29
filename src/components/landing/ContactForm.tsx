"use client";

import { useRef, useState, useTransition } from "react";
import { Button, Callout, Field, TextArea, TextInput } from "@/components/ui";
import { submitContactMessage } from "@/lib/contact/actions";

type Status = { tone: "good" | "danger"; text: string } | null;

function RequiredMark() {
  return (
    <>
      <span className="ml-1 text-danger" aria-hidden>*</span>
      <span className="sr-only">（必須）</span>
    </>
  );
}

/** The /contact page's form: email, name, phone, and a short message. */
export function ContactForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setStatus(null);
    startTransition(async () => {
      const res = await submitContactMessage(formData);
      setStatus({ tone: res.ok ? "good" : "danger", text: res.message });
      if (res.ok) formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={onSubmit} className="mt-10 flex flex-col gap-5">
      <Field label={<>お名前<RequiredMark /></>} htmlFor="contact-name">
        <TextInput id="contact-name" name="name" type="text" required autoComplete="name" disabled={pending} />
      </Field>

      <Field label={<>メールアドレス<RequiredMark /></>} htmlFor="contact-email">
        <TextInput
          id="contact-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          disabled={pending}
        />
      </Field>

      <Field label="電話番号" htmlFor="contact-phone" hint="任意">
        <TextInput id="contact-phone" name="phone" type="tel" autoComplete="tel" disabled={pending} />
      </Field>

      <Field label={<>お問い合わせ内容<RequiredMark /></>} htmlFor="contact-message" hint="簡単な内容で構いません">
        <TextArea
          id="contact-message"
          name="message"
          required
          maxLength={2000}
          className="min-h-32"
          disabled={pending}
        />
      </Field>

      {status && (
        <Callout tone={status.tone} title={status.tone === "good" ? "送信しました" : "エラー"}>
          {status.text}
        </Callout>
      )}

      <Button type="submit" variant="primary" disabled={pending} className="w-fit !px-6 !py-3 !text-[15px]">
        {pending ? "送信中…" : "送信する"}
      </Button>
    </form>
  );
}
