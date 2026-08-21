import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { isPlanId, formatJpy, PLANS } from "@/lib/billing/plans";
import { isMockCheckoutAllowed } from "@/lib/billing/stripe";
import { MockPayButton } from "@/components/billing/MockPayButton";

export const dynamic = "force-dynamic";

/**
 * The payment step `startCheckout` sends the browser to while no Stripe
 * account is connected.
 *
 * Reachable only through that redirect, and only while
 * `isStripeConfigured()` is false — once real keys are added this route
 * stops being linked to at all, and a stray visit here bounces straight back
 * to `/billing`. Authority is re-checked from the session on every load, the
 * same as every other billing page: the lab id in the URL is treated as a
 * request, never as proof of who is allowed to pay.
 */
export default async function MockCheckoutPage(props: PageProps<"/billing/checkout">) {
  // Off once Stripe is connected, and off on any production build even
  // without it - a live site must never present a page that grants a paid
  // plan for free.
  if (!isMockCheckoutAllowed()) redirect("/billing");

  const ctx = await requireUser("/billing");
  const search = await props.searchParams;

  const labId = typeof search.lab === "string" ? search.lab : "";
  const planParam = typeof search.plan === "string" ? search.plan : "";

  const membership = ctx.memberships.find((m) => m.labId === labId);
  const canPay = Boolean(membership && (membership.role === "owner" || ctx.isPlatformAdmin));
  if (!labId || !canPay || !isPlanId(planParam) || planParam === "free") {
    redirect("/billing");
  }

  const plan = PLANS[planParam];

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-5 py-4">
      <header>
        <h1 className="font-serif text-2xl font-semibold text-ink">お支払い</h1>
      </header>

      <Card className="border-t-[3px] border-t-accent shadow-[var(--shadow-md)]">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div>
              <p className="text-[13px] text-ink-3">{membership!.labName}</p>
              <p className="font-serif text-lg font-semibold text-ink">{plan.name}プラン</p>
            </div>
            <p className="font-serif text-2xl font-semibold text-ink">
              {formatJpy(plan.amountJpy)}
              <span className="text-[13px] font-normal text-ink-3"> / 月</span>
            </p>
          </div>

          <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-2">
            {plan.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span aria-hidden className="text-accent">・</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <MockPayButton labId={labId} plan={planParam} amountJpy={plan.amountJpy} />

          <p className="text-center text-[11px] text-ink-3">テスト環境のため、実際の請求は発生しません。</p>
        </div>
      </Card>
    </div>
  );
}
