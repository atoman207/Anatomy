"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Callout, Card } from "./ui";
import type { HealthReport } from "@/app/api/health/route";

/**
 * Connection status for the database.
 *
 * The analysis tools work without Supabase, so a failure here is reported as
 * "saving unavailable" rather than as a fatal error.
 */
export function HealthPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setReport((await res.json()) as HealthReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "接続確認に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  // The first check runs on mount. Every state write happens after the await,
  // so mounting does not trigger a second synchronous render pass.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const json = (await res.json()) as HealthReport;
        if (!cancelled) setReport(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "接続確認に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tone = !report ? "neutral" : report.ok ? "good" : report.configured ? "warn" : "neutral";

  return (
    <Card
      title="接続状態"
      subtitle={report?.url ?? "Supabase"}
      actions={
        <>
          <Badge tone={tone}>
            {loading
              ? "確認中…"
              : report?.ok
                ? "接続済み"
                : report?.configured
                  ? "設定が必要"
                  : "未設定"}
          </Badge>
          <Button size="sm" onClick={check} disabled={loading}>
            再確認
          </Button>
        </>
      }
    >
      {error && <Callout tone="danger" title="接続確認に失敗しました">{error}</Callout>}

      {report && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <StatusRow label="認証" ok={report.auth.ok} detail={report.auth.detail} />
            <StatusRow label="REST API" ok={report.rest.ok} detail={report.rest.detail} />
            <StatusRow label="スキーマ" ok={report.schema.ok} detail={report.schema.detail} />
          </div>

          {report.configured && !report.schema.ok && report.schema.missing.length > 0 && (
            <Callout tone="warn" title="データベーススキーマが未適用です">
              <p className="mt-1">
                実験・ノート・図の保存には{" "}
                <code>supabase/migrations/0001_init.sql</code>{" "}
                のテーブルが必要です。<code>SUPABASE_DB_URL</code>{" "}
                を設定したうえで <code>npm run db:push</code>{" "}
                を実行するか、Supabase SQL エディタに貼り付けてください。
              </p>
              <p className="mt-1.5 text-ink-3">
                不足: {report.schema.missing.slice(0, 6).join(", ")}
                {report.schema.missing.length > 6 ? ` 他${report.schema.missing.length - 6}件` : ""}
              </p>
              <p className="mt-1.5">
                データ整理・統計解析・ノートの各ページは、この設定なしでも利用できます。
              </p>
            </Callout>
          )}

          {!report.configured && (
            <Callout tone="info" title="Supabase が未設定です">
              <code>.env.example</code> を <code>.env.local</code>{" "}
              にコピーし、プロジェクト URL とキーを入力してください。解析機能は設定なしでも利用できます。
            </Callout>
          )}
        </div>
      )}
    </Card>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line px-3 py-2">
      <span
        aria-hidden
        className={ok ? "mt-0.5 text-good" : "mt-0.5 text-warn"}
      >
        {ok ? "✓" : "!"}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink">
          {label}
          <span className="sr-only">: {ok ? "正常" : "未準備"}</span>
        </p>
        <p className="truncate text-[11px] text-ink-3" title={detail}>{detail}</p>
      </div>
    </div>
  );
}
