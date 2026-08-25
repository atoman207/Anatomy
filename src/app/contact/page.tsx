import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/guards";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { ContactForm } from "@/components/landing/ContactForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "お問い合わせ — LABNOTE.",
  description: "LABNOTE. に関するお問い合わせフォームです。",
};

export default async function ContactPage() {
  const ctx = await getSessionContext();
  const signedIn = Boolean(ctx);

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0">
      <SiteHeader signedIn={signedIn} />

      <main className="mx-auto w-full max-w-[640px] flex-1 px-5 py-16 sm:px-8">
        <h1 className="font-serif text-3xl font-semibold text-ink">お問い合わせ</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          機能に関するご質問、導入のご相談、不具合のご報告など、お気軽にお問い合わせください。
        </p>

        <ContactForm />
      </main>

      <SiteFooter />
    </div>
  );
}
