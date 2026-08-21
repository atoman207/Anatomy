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
 * **Beta pricing.** Every amount is deliberately under ¥100. JPY is a
 * zero-decimal currency, so `unit_amount: 50` is ¥50 - not 50 sen - and ¥50 is
 * also Stripe's minimum charge for the currency, which is why the cheapest
 * paid plan sits exactly there.
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
const BETA_MAX_JPY = 100;

for (const plan of PAID_PLANS) {
  if (plan.amountJpy < STRIPE_MIN_JPY) {
    console.error(`\n${plan.id}: ¥${plan.amountJpy} is below Stripe's ¥${STRIPE_MIN_JPY} minimum for JPY.\n`);
    process.exit(1);
  }
  if (plan.amountJpy >= BETA_MAX_JPY) {
    console.error(`\n${plan.id}: ¥${plan.amountJpy} is not under the ¥${BETA_MAX_JPY} beta ceiling.\n`);
    process.exit(1);
  }
}

const stripe = new Stripe(secret, { maxNetworkRetries: 2 });

/** A product per plan, found by metadata so re-runs do not duplicate it. */
async function findOrCreateProduct(plan) {
  const search = await stripe.products.search({
    query: `metadata['chondro_plan']:'${plan.id}' AND active:'true'`,
    limit: 1,
  });
  if (search.data[0]) return search.data[0];

  return stripe.products.create({
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

for (const plan of PAID_PLANS) {
  const product = await findOrCreateProduct(plan);
  const price = await findOrCreatePrice(product, plan);
  console.log(`${plan.id.padEnd(5)} ¥${String(plan.amountJpy).padStart(3)}/月  ${price.id}  (product ${product.id})`);
  lines.push(`${plan.envVar}=${price.id}`);
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
  "\nAdd these to .env.local:\n\n" +
    lines.map((l) => `  ${l}`).join("\n") +
    "\n\n" +
    nextSteps,
);
