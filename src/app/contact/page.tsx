import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/guards";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { Callout } from "@/components/ui";
import { ContactForm } from "@/components/landing/ContactForm";
import { SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "お問い合わせ",
  description: "機能に関するご質問、導入のご相談、不具合のご報告など、LABNOTE へのお問い合わせフォームです。",
  alternates: { canonical: `${SITE_URL}/contact` },
};

export default async function ContactPage() {
  const ctx = await getSessionContext();
  const signedIn = Boolean(ctx);

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0 [--text-primary:#000] [--text-secondary:#000] [--text-muted:#000]">
      <SiteHeader signedIn={signedIn} />

      <main className="mx-auto w-full max-w-[640px] flex-1 px-5 py-16 sm:px-8">
        <h1 className="font-serif text-3xl font-semibold text-ink">お問い合わせ</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          機能に関するご質問、導入のご相談、不具合のご報告など、お気軽にお問い合わせください。
        </p>

        <div className="mt-6">
          <Callout tone="info" title="ご意見・ご要望をお待ちしています">
            <p>
              現在のシステムには、まだ改善の余地があります。使いにくい点、不足している機能、
              期待と異なる動作など、遠慮なくお知らせください。
            </p>
            <p className="mt-2">
              いただいたフィードバックを参考に、今後もシステムの改善を進めてまいります。
            </p>
          </Callout>
        </div>

        <ContactForm />
      </main>

      <SiteFooter />
    </div>
  );
}
