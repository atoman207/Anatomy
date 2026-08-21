/**
 * Creates the Stripe products and prices this app sells.
 *
 *   npm run stripe:setup
 *
 * Amounts come from src/lib/billing/plans.ts, so the price Stripe charges and
 * the price the app displays cannot drift apart: this script is the one place
 * that copies one into the other. It prints the resulting price ids to paste
 * into .env.local.
 *
 * JPY is a zero-decimal currency, so `unit_amount: 50` is ¥50 - not 50 sen -
 * and ¥50 is also Stripe's minimum charge for the currency, which is why the
 * cheapest plan sits exactly there. With a live key this creates prices that
 * charge real cards, so it prints the amounts and says so before doing it.
 *
 * Safe to re-run: products and prices are looked up by a stable lookup key and
 * reused. Stripe prices are immutable, so changing an amount creates a new
 * price and leaves the old one in place (existing subscriptions keep billing at
 * the price they were created with until they are migrated).
 */
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error(
    "\nSTRIPE_SECRET_KEY is not set.\n\n" +
      "Add your key to .env.local:\n" +
      "  STRIPE_SECRET_KEY=sk_test_...  (or sk_live_... to sell for real)\n\n" +
      "then run: npm run stripe:setup\n",
  );
  process.exit(1);
}

const liveMode = secret.startsWith("sk_live_");
if (liveMode) {
  console.warn(
    "\n⚠  STRIPE_SECRET_KEY is a live-mode key.\n" +
      "   This creates real products and prices that will charge real cards.\n",
  );
} else if (!secret.startsWith("sk_test_")) {
  console.warn(
    "\n⚠  STRIPE_SECRET_KEY does not look like sk_test_... or sk_live_....\n" +
      "   Continuing anyway - Stripe will reject it below if it is invalid.\n",
  );
}

/*
 * Mirrors PAID_PLANS in src/lib/billing/plans.ts. Kept as a literal rather than
 * imported because this script is plain Node and that module is TypeScript;
 * tests/billing.test.ts asserts the two agree.
 */
const PAID_PLANS = [
  { id: "pro", name: "chondro プロ", amountJpy: 50, envVar: "STRIPE_PRICE_PRO" },
  { id: "team", name: "chondro チーム", amountJpy: 90, envVar: "STRIPE_PRICE_TEAM" },
];

const STRIPE_MIN_JPY = 50;
/** Not a product limit - a guard against a typo that would charge 100x the intent. */
const MAX_REASONABLE_JPY = 100_000;

for (const plan of PAID_PLANS) {
  if (plan.amountJpy < STRIPE_MIN_JPY) {
    console.error(`\n${plan.id}: ¥${plan.amountJpy} is below Stripe's ¥${STRIPE_MIN_JPY} minimum for JPY.\n`);
    process.exit(1);
  }
  if (plan.amountJpy >= MAX_REASONABLE_JPY) {
    console.error(`\n${plan.id}: ¥${plan.amountJpy} is past the ¥${MAX_REASONABLE_JPY} sanity ceiling - typo?\n`);
    process.exit(1);
  }
}

if (liveMode) {
  console.log(
    `\nPrices about to be created (LIVE - real cards will be charged):\n` +
      PAID_PLANS.map((p) => `  ${p.id.padEnd(5)} ¥${p.amountJpy}/month`).join("\n") +
      "\n\nThese come from src/lib/billing/plans.ts. Stop now and edit that file\n" +
      "if these are still the beta amounts rather than your real prices.\n",
  );
}

const stripe = new Stripe(secret, { maxNetworkRetries: 2 });

/**
 * A product per plan, so re-runs do not duplicate it.
 *
 * By deterministic id first, then by metadata. The id makes the lookup exact
 * - Stripe's search index lags creation by up to a minute - and the metadata
 * search still finds a product an earlier version of this script created
 * without one, so both paths keep converging on a single product per plan.
 * `src/lib/billing/priceActions.ts` looks it up the same way.
 */
async function findOrCreateProduct(plan) {
  const id = `chondro_${plan.id}`;

  try {
    const existing = await stripe.products.retrieve(id);
    return existing.active ? existing : await stripe.products.update(id, { active: true });
  } catch {
    // Not created yet under that id.
  }

  const search = await stripe.products.search({
    query: `metadata['chondro_plan']:'${plan.id}' AND active:'true'`,
    limit: 1,
  });
  if (search.data[0]) return search.data[0];

  return stripe.products.create({
    id,
    name: plan.name,
    metadata: { chondro_plan: plan.id },
  });
}

/**
 * A monthly JPY price at the configured amount.
 *
 * Prices are immutable in Stripe, so an existing price at a different amount is
 * left alone and a new one is created - which is also why the lookup filters on
 * the amount and not only on the plan.
 */
async function findOrCreatePrice(product, plan) {
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = existing.data.find(
    (p) =>
      p.currency === "jpy" &&
      p.unit_amount === plan.amountJpy &&
      p.recurring?.interval === "month",
  );
  if (match) return match;

  return stripe.prices.create({
    product: product.id,
    currency: "jpy",
    unit_amount: plan.amountJpy,
    recurring: { interval: "month" },
    metadata: { chondro_plan: plan.id },
  });
}

const lines = [];
const created = [];

for (const plan of PAID_PLANS) {
  const product = await findOrCreateProduct(plan);
  const price = await findOrCreatePrice(product, plan);
  console.log(`${plan.id.padEnd(5)} ¥${String(plan.amountJpy).padStart(3)}/月  ${price.id}  (product ${product.id})`);
  lines.push(`${plan.envVar}=${price.id}`);
  created.push({ plan: plan.id, priceId: price.id, amountJpy: price.unit_amount ?? plan.amountJpy });
}

/*
 * Store the ids in plan_prices as well as printing them.
 *
 * This is what makes the script enough on its own: the app reads the database
 * first, so a deployed build starts selling at these prices without anyone
 * copying the ids into a hosting dashboard and redeploying. The printed env
 * lines below are still offered as a fallback for a deployment that has no
 * database write access.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let storedInDatabase = false;

if (supabaseUrl && serviceKey) {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.from("plan_prices").upsert(
    created.map((c) => ({ plan: c.plan, stripe_price_id: c.priceId, amount_jpy: c.amountJpy })),
    { onConflict: "plan" },
  );
  if (error) {
    console.warn(`\n⚠  Could not write plan_prices: ${error.message}`);
    console.warn("   Apply supabase/migrations/all.sql, or paste the env lines below.\n");
  } else {
    storedInDatabase = true;
    console.log(
      "\n✓ Saved to plan_prices - every deployment reading this database picks",
      "\n  them up. No env vars or redeploy needed.",
    );
  }
} else {
  console.warn("\n⚠  Supabase not configured here; skipping the plan_prices write.");
}

const nextSteps = liveMode
  ? "Then, in the Stripe dashboard (make sure you are viewing Live mode, not\n" +
    "Test mode - the two do not share configuration):\n\n" +
    "  1. Developers -> Webhooks -> add an endpoint at\n" +
    "     https://<your-domain>/api/stripe/webhook, subscribed to:\n" +
    "       checkout.session.completed\n" +
    "       customer.subscription.created / .updated / .deleted\n" +
    "       invoice.payment_failed\n" +
    "     Copy its signing secret into STRIPE_WEBHOOK_SECRET.\n\n" +
    "  2. Settings -> Billing -> Customer portal - save a configuration here too;\n" +
    "     it is per-mode, so the one you set up under Test mode does not carry over.\n\n" +
    "  3. Set NEXT_PUBLIC_SITE_URL in .env.local to your real https:// domain -\n" +
    "     Checkout and the billing portal redirect back there after payment.\n"
  : "Then forward webhooks while developing:\n\n" +
    "  stripe listen --forward-to localhost:3000/api/stripe/webhook\n\n" +
    "and copy the printed signing secret into STRIPE_WEBHOOK_SECRET.\n";

console.log(
  (storedInDatabase
    ? "\nPrices are stored in the database. Change them later at /admin/billing"
      + " -\nno env vars and no redeploy.\n\n"
      + "Optional fallback, only for a deployment that cannot reach the database:\n\n"
    : "\nAdd these to .env.local AND to your hosting provider's environment:\n\n") +
    lines.map((l) => `  ${l}`).join("\n") +
    "\n\n" +
    nextSteps,
);
