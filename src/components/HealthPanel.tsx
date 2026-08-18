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
      setError(e instanceof Error ? e.message : "Health check failed");
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
        if (!cancelled) setError(e instanceof Error ? e.message : "Health check failed");
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
      title="接続状態 / Connection"
      subtitle={report?.url ?? "Supabase"}
      actions={
        <>
          <Badge tone={tone}>
            {loading ? "checking…" : report?.ok ? "connected" : report?.configured ? "setup needed" : "not configured"}
          </Badge>
          <Button size="sm" onClick={check} disabled={loading}>
            再確認 / Recheck
          </Button>
        </>
      }
    >
      {error && <Callout tone="danger" title="Health check failed">{error}</Callout>}

      {report && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <StatusRow label="Auth" ok={report.auth.ok} detail={report.auth.detail} />
            <StatusRow label="REST API" ok={report.rest.ok} detail={report.rest.detail} />
            <StatusRow label="Schema" ok={report.schema.ok} detail={report.schema.detail} />
          </div>

          {report.configured && !report.schema.ok && report.schema.missing.length > 0 && (
            <Callout tone="warn" title="Database schema is not applied yet">
              <p className="mt-1">
                Saving experiments, notebook entries and figures needs the tables from{" "}
                <code>supabase/migrations/0001_init.sql</code>. Apply it with{" "}
                <code>npm run db:push</code> (after setting <code>SUPABASE_DB_URL</code>),
                or paste the file into the Supabase SQL editor.
              </p>
              <p className="mt-1.5 text-ink-3">
                Missing: {report.schema.missing.slice(0, 6).join(", ")}
                {report.schema.missing.length > 6 ? ` +${report.schema.missing.length - 6} more` : ""}
              </p>
              <p className="mt-1.5">
                Everything on the organize, analyze and notebook pages works without this.
              </p>
            </Callout>
          )}

          {!report.configured && (
            <Callout tone="info" title="Supabase is not configured">
              Copy <code>.env.example</code> to <code>.env.local</code> and fill in the project
              URL and keys. The analysis tools work without it.
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
          <span className="sr-only">: {ok ? "ok" : "not ready"}</span>
        </p>
        <p className="truncate text-[11px] text-ink-3" title={detail}>{detail}</p>
      </div>
    </div>
  );
}
