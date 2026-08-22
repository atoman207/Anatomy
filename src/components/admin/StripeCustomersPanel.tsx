"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, TextInput, cx } from "@/components/ui";
import { useToast } from "@/components/shell/Toast";
import { addStripeCustomer } from "@/lib/billing/dashboardActions";
import { formatMoney } from "@/lib/billing/revenue";
import type { CustomerRecord } from "@/lib/billing/dashboardTypes";

/**
 * The Stripe dashboard's Customers list, inside this admin panel.
 *
 * Laid out to match dashboard.stripe.com/customers: the same four columns in
 * the same order, Export and "+ Add customer" at the top right in that order,
 * search below the heading, and Previous / Next at the bottom right. Column
 * headers and button labels are left in Stripe's English on purpose - an
 * administrator moving between the two views should not have to re-learn
 * which control is which, and a translated "顧客を追加" beside a Stripe tab
 * reading "Add customer" is a worse experience than one consistent label.
 *
 * The rows are live Stripe objects, not a mirror table, so what is shown here
 * is what the Stripe dashboard would show at the moment the page was loaded.
 */

const PAGE_SIZE = 10;

export interface StripeCustomersPanelProps {
  customers: CustomerRecord[];
  /** True while a `sk_test_` key is in use, so deep links keep the /test/ prefix. */
  testMode: boolean;
  /** True while newer data is loading. */
  stale?: boolean;
}

export function StripeCustomersPanel({
  customers, testMode, stale = false,
}: StripeCustomersPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q),
    );
  }, [customers, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function exportCsv() {
    const header = ["id", "name", "email", "card_brand", "card_last4", "delinquent", "created"];
    const body = filtered.map((c) => [
      c.id,
      c.name ?? "",
      c.email ?? "",
      c.cardBrand ?? "",
      c.cardLast4 ?? "",
      String(c.delinquent),
      new Date(c.createdAt).toISOString(),
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","))
      .join("\r\n");

    // A BOM so Excel on a Japanese Windows install opens it as UTF-8 rather
    // than mojibake - the same reason the other CSV exports in this app add one.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stripe-customers-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
    toast(filtered.length + " 件を CSV に書き出しました。", { tone: "good" });
  }

  return (
    <section
      className={cx(
        "rounded-lg border border-line bg-surface-1 shadow-[var(--shadow-sm)] transition-opacity duration-200",
        stale && "opacity-60",
      )}
    >
      {/* Heading row - Export then Add customer, matching Stripe's order. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-[17px] font-semibold text-ink">Customers</h2>
          <Badge tone="neutral">{filtered.length}</Badge>
          {testMode && <Badge tone="warn">Test mode</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon="download" onClick={exportCsv}>
            Export
          </Button>
          <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add customer
          </Button>
        </div>
      </header>

      <div className="border-b border-line px-4 py-2.5">
        <TextInput
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          placeholder="Search by name, email, or ID"
          aria-label="Search customers"
          className="max-w-sm text-[13px]"
        />
      </div>

      {adding && (
        <AddCustomerForm
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            toast("顧客 " + id + " を作成しました。", { tone: "good" });
            router.refresh();
          }}
        />
      )}

      <div className="scroll-x">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2">
              <th className="whitespace-nowrap border-b border-line px-4 py-2 text-left font-semibold text-ink-2">Name</th>
              <th className="whitespace-nowrap border-b border-line px-4 py-2 text-left font-semibold text-ink-2">Email</th>
              <th className="whitespace-nowrap border-b border-line px-4 py-2 text-left font-semibold text-ink-2">Default payment method</th>
              <th className="whitespace-nowrap border-b border-line px-4 py-2 text-right font-semibold text-ink-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2/60">
                <td className="border-b border-line px-4 py-2.5">
                  <a
                    href={"https://dashboard.stripe.com/" + (testMode ? "test/" : "") + "customers/" + c.id}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-ink underline decoration-transparent underline-offset-2 hover:text-accent hover:decoration-inherit"
                  >
                    {c.name?.trim() || "（無名）"}
                  </a>
                  <span className="ml-2 inline-flex gap-1.5 align-middle">
                    {c.delinquent && <Badge tone="danger">Past due</Badge>}
                    {c.balance > 0 && (
                      <Badge tone="warn">{formatMoney(c.balance, c.currency)} 未収</Badge>
                    )}
                  </span>
                </td>
                <td className="border-b border-line px-4 py-2.5 text-ink-2">{c.email ?? "—"}</td>
                <td className="border-b border-line px-4 py-2.5 text-ink-2">
                  {c.cardLast4 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium uppercase text-ink-2">
                        {c.cardBrand ?? "card"}
                      </span>
                      <span className="tabular-nums">•••• {c.cardLast4}</span>
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap border-b border-line px-4 py-2.5 text-right tabular-nums text-ink-2">
                  {stripeDate(c.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-ink-3">
            {customers.length === 0
              ? "まだ顧客がいません。決済が行われると自動的に作成されます。"
              : "検索条件に一致する顧客はいません。"}
          </p>
        )}
      </div>

      {/* Previous / Next at the bottom right, as on the Stripe dashboard. */}
      <footer className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-[12px] tabular-nums text-ink-3">
          {filtered.length === 0
            ? "0"
            : current * PAGE_SIZE + 1 + "–" + Math.min((current + 1) * PAGE_SIZE, filtered.length)}
          {" of "}{filtered.length}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="secondary"
            disabled={current === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm" variant="secondary"
            disabled={current >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </Button>
        </div>
      </footer>
    </section>
  );
}

/** Stripe's own created-column format: `Aug 21, 10:32 AM`. */
function stripeDate(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return day + ", " + time;
}

/**
 * Stripe's "Add customer" dialog, reduced to the two fields that matter.
 *
 * The real dialog also collects an address, tax ids and shipping details.
 * Reproducing those would be a worse copy of a form one click away, so this
 * creates the customer with a name and an email and links out for the rest.
 */
function AddCustomerForm({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await addStripeCustomer(name, email);
      if (!res.ok || !res.data) throw new Error(res.error ?? "顧客を作成できませんでした。");
      onCreated(res.data.id);
      setName("");
      setEmail("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "顧客を作成できませんでした。", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-line bg-surface-2/60 px-4 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name" className="min-w-[180px] flex-1">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="研究室名または担当者名"
            className="text-[13px]"
          />
        </Field>
        <Field label="Email" className="min-w-[220px] flex-1">
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="text-[13px]"
          />
        </Field>
        <Button
          size="sm" variant="primary" icon="plus"
          disabled={busy || email.trim() === ""}
          onClick={submit}
        >
          {busy ? "Adding…" : "Add customer"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        請求先住所や税IDなどの詳細は Stripe ダッシュボード側で追加できます。
        ここで作成されるのは顧客レコードのみで、請求は発生しません。
      </p>
    </div>
  );
}
