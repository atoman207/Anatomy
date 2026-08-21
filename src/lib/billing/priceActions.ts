"use server";

/**
 * Administering what each plan costs.
 *
 * Platform-admin only: this decides what every customer's card is charged, so
 * it is the same level of authority as `/admin/users`, not something a lab
 * owner can reach.
 *
 * Stripe Prices are immutable by design - there is no "edit the amount" call.
 * Changing a price means creating a new Price object and selling that one
 * from now on, which is what `createPlanPrice` does. Anyone already
 * subscribed keeps paying the price their subscription was created with until
 * they are migrated, and the UI says so, because silently re-pricing existing
 * subscribers is the kind of surprise that produces chargebacks.
 */

import { revalidatePath } from "next/cache";
import { getSessionContext, logAudit } from "@/lib/auth/guards";
import {
  isPlanId, PLANS, STRIPE_MIN_JPY, MAX_REASONABLE_JPY, type PlanId,
} from "./plans";
import { getStripe, isStripeConfigured } from "./stripe";
import { getPlanPrices, savePlanPrice, type PlanPrice } from "./priceStore";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function platformAdmin() {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("ログインしていません。");
  if (!ctx.isPlatformAdmin) throw new Error("システム管理者のみ利用できます。");
  return ctx;
}

function message(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : fallback;
  // The one setup step that has to happen outside the app. Say which, rather
  // than surfacing 'relation "public.plan_prices" does not exist'.
  if (/plan_prices/.test(raw) && /does not exist|schema cache/i.test(raw)) {
    return (
      "plan_prices テーブルがまだ作成されていません。" +
      "supabase/migrations/all.sql を Supabase の SQL エディタで実行してください。"
    );
  }
  return raw;
}

/**
 * The one Stripe Product a plan's prices hang off.
 *
 * Looked up by a deterministic id first, then by the metadata search that
 * `scripts/stripe-setup.mjs` has always used, and only created if neither
 * finds anything. Search alone is not enough here: Stripe's search index
 * lags object creation by up to a minute, so an administrator who set a
 * price and corrected it straight away would have produced a second product
 * - and the "reuse an existing price" check below, which lists prices *of a
 * product*, would then have missed the price it had just made.
 *
 * Creating with an explicit id makes the lookup exact from the first call,
 * and trying the metadata search before creating means an account already
 * set up by the script converges on the product it made rather than growing
 * a duplicate.
 */
async function findOrCreateProduct(plan: Exclude<PlanId, "free">) {
  const stripe = getStripe();
  const id = `chondro_${plan}`;

  try {
    const existing = await stripe.products.retrieve(id);
    // Archived rather than gone: reactivate it. Creating would fail anyway -
    // the id is taken - and leaving it archived would mean Checkout refusing
    // the price a moment after this page said it had made one.
    return existing.active ? existing : await stripe.products.update(id, { active: true });
  } catch {
    // No product with that id yet - fall through to the search.
  }

  const search = await stripe.products.search({
    query: `metadata['chondro_plan']:'${plan}' AND active:'true'`,
    limit: 1,
  });
  if (search.data[0]) return search.data[0];

  return stripe.products.create({
    id,
    name: `chondro ${PLANS[plan].name}`,
    metadata: { chondro_plan: plan },
  });
}

/**
 * Creates a new Stripe Price for a plan and starts selling at it.
 *
 * Reuses an existing active price at the same amount rather than creating a
 * duplicate, so pressing the button twice does not litter the Stripe account
 * with identical prices.
 */
export async function createPlanPrice(
  plan: string,
  amountJpy: number,
): Promise<ActionResult<PlanPrice>> {
  try {
    const ctx = await platformAdmin();

    if (!isPlanId(plan) || plan === "free") {
      return { ok: false, error: "有料プランを選択してください。" };
    }
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }
    if (!Number.isInteger(amountJpy)) {
      return { ok: false, error: "金額は円単位の整数で入力してください。" };
    }
    if (amountJpy < STRIPE_MIN_JPY) {
      return {
        ok: false,
        error: `Stripe は日本円で ${STRIPE_MIN_JPY} 円未満の請求を受け付けません。`,
      };
    }
    if (amountJpy >= MAX_REASONABLE_JPY) {
      return {
        ok: false,
        error: `金額が大きすぎます（${MAX_REASONABLE_JPY.toLocaleString("ja-JP")} 円未満）。桁を確認してください。`,
      };
    }

    const stripe = getStripe();
    const product = await findOrCreateProduct(plan);

    const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const reused = existing.data.find(
      (p) => p.currency === "jpy" && p.unit_amount === amountJpy && p.recurring?.interval === "month",
    );
    const price =
      reused ??
      (await stripe.prices.create(
        {
          product: product.id,
          currency: "jpy",
          unit_amount: amountJpy,
          recurring: { interval: "month" },
          metadata: { chondro_plan: plan },
        },
        // A double-submit that outruns the list above still creates one price
        // rather than two: the key is derived from exactly the fields being
        // sent, so a repeat is the same request and Stripe replays its answer.
        { idempotencyKey: `plan-price:${product.id}:${amountJpy}` },
      ));

    await savePlanPrice(plan, price.id, price.unit_amount ?? amountJpy, ctx.user.id);

    await logAudit({
      labId: null, userId: ctx.user.id, action: "billing.plan_price_set",
      entity: "plan_price", entityId: plan,
      detail: { plan, amount_jpy: amountJpy, price_id: price.id, reused: Boolean(reused) },
    });

    revalidatePath("/admin/billing");
    revalidatePath("/billing");

    return {
      ok: true,
      data: {
        plan,
        priceId: price.id,
        amountJpy: price.unit_amount ?? amountJpy,
        source: "database",
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: message(e, "価格を作成できませんでした。") };
  }
}

/**
 * Re-reads the stored price from Stripe and refreshes the cached amount.
 *
 * Used when a price was changed in the Stripe dashboard directly, or to
 * confirm that a price id configured through the old environment variables
 * still resolves against the current key.
 */
export async function syncPlanPrice(plan: string): Promise<ActionResult<PlanPrice>> {
  try {
    const ctx = await platformAdmin();
    if (!isPlanId(plan) || plan === "free") {
      return { ok: false, error: "有料プランを選択してください。" };
    }
    if (!isStripeConfigured()) {
      return { ok: false, error: "決済が設定されていません（STRIPE_SECRET_KEY）。" };
    }

    const prices = await getPlanPrices();
    const current = prices[plan];
    if (!current?.priceId) {
      return { ok: false, error: "このプランにはまだ価格がありません。" };
    }

    const price = await getStripe().prices.retrieve(current.priceId);
    if (!price.active) {
      return {
        ok: false,
        error: "この価格は Stripe 側で無効化されています。新しい価格を作成してください。",
      };
    }

    await savePlanPrice(plan, price.id, price.unit_amount, ctx.user.id);
    revalidatePath("/admin/billing");
    revalidatePath("/billing");

    return {
      ok: true,
      data: {
        plan,
        priceId: price.id,
        amountJpy: price.unit_amount,
        source: "database",
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: message(e, "価格を同期できませんでした。") };
  }
}
