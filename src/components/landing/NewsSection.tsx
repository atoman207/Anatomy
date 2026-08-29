"use client";

import { useState } from "react";
import { Reveal } from "./Reveal";
import { SectionTitle } from "./SectionTitle";
import type { SiteNewsRow } from "@/lib/supabase/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Latest announcements, fetched server-side (see /admin/news and
 * src/lib/news/actions.ts) and handed down as plain data so this stays a
 * small, self-contained client component - only the expand/collapse
 * interaction needs the browser.
 */
export function NewsSection({ articles }: { articles: SiteNewsRow[] }) {
  if (articles.length === 0) return null;

  return (
    <section id="news" className="scroll-mt-8 border-b border-line">
      <div className="mx-auto w-full max-w-[1100px] px-5 py-20 sm:px-8">
        <Reveal>
          <header className="mx-auto max-w-[60ch] text-center">
            <SectionTitle japanese="お知らせ" english="News" />
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
              新しく追加した機能や変更をお知らせします。
            </p>
          </header>
        </Reveal>

        <ol className="mt-10 flex flex-col divide-y divide-[var(--border)]">
          {articles.map((a, i) => (
            <Reveal key={a.id} as="li" delayMs={Math.min(i, 4) * 70}>
              <NewsItem article={a} />
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function NewsItem({ article }: { article: SiteNewsRow }) {
  const [open, setOpen] = useState(false);
  const hasBody = article.body_md.trim().length > 0;

  return (
    <article className="py-6 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-8">
        <time
          dateTime={article.published_at}
          className="shrink-0 text-[13px] font-medium tracking-wide text-ink-3 sm:w-[11ch]"
        >
          {formatDate(article.published_at)}
        </time>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg font-semibold text-ink">{article.title}</h3>
          {article.summary && (
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{article.summary}</p>
          )}
          {hasBody && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="landing-news-toggle mt-2 text-[13px] font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:decoration-accent"
              >
                {open ? "閉じる" : "詳しく見る"}
              </button>
              <div className={`landing-news-body ${open ? "is-open" : ""}`}>
                <div className="min-h-0">
                  <p className="whitespace-pre-line pb-1 pt-2 text-[14px] leading-relaxed text-ink-2">
                    {article.body_md}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
