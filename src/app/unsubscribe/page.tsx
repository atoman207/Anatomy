import type { Metadata } from "next";

import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Callout } from "@/components/ui";
import { getSessionContext } from "@/lib/auth/guards";
import { verifyUnsubscribeToken } from "@/lib/email/token";
import { senderIdentity } from "@/lib/email/suppressions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "メール配信の停止",
  description: "LABNOTE からのお知らせメールの配信を停止します。",
  // Not something to have indexed: it exists for people holding a link.
  robots: { index: false, follow: false },
};

/**
 * Where an unsubscribe link lands a person.
 *
 * The removal happens on POST to /api/email/unsubscribe, never on arriving
 * here: mail scanners fetch links before anyone reads them, and a page that
 * unsubscribed on sight would opt people out who never clicked. So this shows
 * the address and asks once - one button, no account needed.
 *
 * Kept on the public shell rather than the app shell because the reader may
 * well not have an account at all.
 */
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const search = await props.searchParams;
  const ctx = await getSessionContext();

  const token = typeof search.t === "string" ? search.t : null;
  const state = typeof search.state === "string" ? search.state : null;
  const email = verifyUnsubscribeToken(token);
  const sender = senderIdentity();

  return (
    <div className="flex min-h-dvh flex-col bg-surface-0">
      <SiteHeader signedIn={Boolean(ctx)} />

      <main className="mx-auto w-full max-w-[560px] flex-1 px-5 py-16 sm:px-8">
        <h1 className="font-serif text-2xl font-semibold text-ink">メール配信の停止</h1>

        {state === "done" ? (
          <div className="mt-6">
            <Callout tone="good" title="配信を停止しました">
              {email ? <strong>{email}</strong> : "このアドレス"}{" "}
              宛のお知らせメールを、今後お送りしません。
              <br />
              お問い合わせへの返信など、ご自身の操作に対するメールは引き続きお送りします。
            </Callout>
          </div>
        ) : state === "error" ? (
          <div className="mt-6">
            <Callout tone="danger" title="停止の記録に失敗しました">
              一時的な不具合の可能性があります。もう一度お試しいただくか、
              {sender.contact ? <> <strong>{sender.contact}</strong> 宛に</> : "運営宛に"}
              ご連絡ください。配信停止のご依頼として手作業で処理します。
            </Callout>
          </div>
        ) : !email ? (
          <div className="mt-6">
            <Callout tone="warn" title="リンクを確認できませんでした">
              リンクが途中で切れているか、期限のない形式に対応していない可能性があります。
              お手数ですが、届いたメールの「配信を停止する」リンクをもう一度お開きください。
              {sender.contact && (
                <>
                  {" "}
                  うまくいかない場合は <strong>{sender.contact}</strong>{" "}
                  宛に空メールをお送りいただければ、こちらで停止します。
                </>
              )}
            </Callout>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              <strong className="text-ink">{email}</strong>{" "}
              宛の、{sender.name} からのお知らせメールの配信を停止します。
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
              停止後も、お問い合わせへの返信やアカウントに関する連絡はお送りします。
            </p>

            {/* A plain form post - no JavaScript, and the same endpoint the
                mail provider's one-click button uses. */}
            <form
              method="post"
              action={`/api/email/unsubscribe?t=${encodeURIComponent(token ?? "")}`}
              className="mt-6"
            >
              <button
                type="submit"
                className="rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-contrast transition hover:opacity-90"
              >
                配信を停止する
              </button>
            </form>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
