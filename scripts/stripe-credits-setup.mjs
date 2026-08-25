/**
 * Creates the Stripe one-time Prices AI査読 credit packs sell.
 *
 *   npm run stripe:credits:setup
 *
 * Amounts come from src/lib/peerReview/creditPacks.ts, so the price Stripe
 * charges and the price the app displays cannot drift apart - mirrors
 * scripts/stripe-setup.mjs, which does the same for the subscription plans.
 *
 * JPY is a zero-decimal currency, so `unit_amount: 50` is ¥50, not 50 sen.
 * With a live key this creates prices that charge real cards, so it prints
 * the amounts and says so before doing it.
 *
 * Safe to re-run: products and prices are looked up by a stable id/lookup key
 * and reused. Stripe prices are immutable, so changing an amount creates a
 * new price and leaves the old one in place (a pack bought at the old price
 * keeps whatever it already granted - this only affects future purchases).
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
      "then run: npm run stripe:credits:setup\n",
  );
  process.exit(1);
}

const liveMode = secret.startsWith("sk_live_");
if (liveMode) {
  console.warn(
    "\n⚠  STRIPE_SECRET_KEY is a live-mode key.\n" +
      "   This creates real one-time prices that will charge real cards.\n",
  );
} else if (!secret.startsWith("sk_test_")) {
  console.warn(
    "\n⚠  STRIPE_SECRET_KEY does not look like sk_test_... or sk_live_....\n" +
      "   Continuing anyway - Stripe will reject it below if it is invalid.\n",
  );
}

/*
 * Mirrors PEER_REVIEW_CREDIT_PACKS in src/lib/peerReview/creditPacks.ts. Kept
 * as a literal rather than imported because this script is plain Node and
 * that module is TypeScript; tests/peerReview.test.ts asserts the two agree.
 */
const CREDIT_PACKS = [
  { id: "single", name: "1件", credits: 1, amountJpy: 100 },
  { id: "thirty", name: "30件セット", credits: 30, amountJpy: 2000 },
  { id: "monthly", name: "無制限（月額）", credits: 10000, amountJpy: 5000 },
];

const STRIPE_MIN_JPY = 50;
/** Not a product limit - a guard against a typo that would charge 100x the intent. */
const MAX_REASONABLE_JPY = 100_000;

for (const pack of CREDIT_PACKS) {
  if (pack.amountJpy < STRIPE_MIN_JPY) {
    console.error(`\n${pack.id}: ¥${pack.amountJpy} is below Stripe's ¥${STRIPE_MIN_JPY} minimum for JPY.\n`);
    process.exit(1);
  }
  if (pack.amountJpy >= MAX_REASONABLE_JPY) {
    console.error(`\n${pack.id}: ¥${pack.amountJpy} is past the ¥${MAX_REASONABLE_JPY} sanity ceiling - typo?\n`);
    process.exit(1);
  }
}

if (liveMode) {
  console.log(
    `\nPrices about to be created (LIVE - real cards will be charged):\n` +
      CREDIT_PACKS.map((p) => `  ${p.id.padEnd(7)} ¥${p.amountJpy} for ${p.credits} 回`).join("\n") +
      "\n\nThese come from src/lib/peerReview/creditPacks.ts. Stop now and edit that\n" +
      "file first if these are not the real prices.\n",
  );
}

const stripe = new Stripe(secret, { maxNetworkRetries: 2 });

/** A product per pack, so re-runs do not duplicate it. Same lookup shape as stripe-setup.mjs's findOrCreateProduct. */
async function findOrCreateProduct(pack) {
  const id = `chondro_peer_review_credits_${pack.id}`;

  try {
    const existing = await stripe.products.retrieve(id);
    return existing.active ? existing : await stripe.products.update(id, { active: true });
  } catch {
    // Not created yet under that id.
  }

  const search = await stripe.products.search({
    query: `metadata['chondro_credit_pack']:'${pack.id}' AND active:'true'`,
    limit: 1,
  });
  if (search.data[0]) return search.data[0];

  return stripe.products.create({
    id,
    name: `chondro AI査読 ${pack.name}`,
    metadata: { chondro_credit_pack: pack.id, credits: String(pack.credits) },
  });
}

/**
 * A one-time (non-recurring) JPY price at the configured amount.
 *
 * Prices are immutable in Stripe, so an existing price at a different amount
 * is left alone and a new one is created.
 */
async function findOrCreatePrice(product, pack) {
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = existing.data.find(
    (p) => p.currency === "jpy" && p.unit_amount === pack.amountJpy && !p.recurring,
  );
  if (match) return match;

  return stripe.prices.create({
    product: product.id,
    currency: "jpy",
    unit_amount: pack.amountJpy,
    metadata: { chondro_credit_pack: pack.id, credits: String(pack.credits) },
  });
}

const created = [];

for (const pack of CREDIT_PACKS) {
  const product = await findOrCreateProduct(pack);
  const price = await findOrCreatePrice(product, pack);
  console.log(`${pack.id.padEnd(7)} ¥${String(pack.amountJpy).padStart(5)}  ${price.id}  (product ${product.id})`);
  created.push({ packId: pack.id, priceId: price.id, amountJpy: price.unit_amount ?? pack.amountJpy });
}

/*
 * Store the ids in peer_review_credit_prices, the same way stripe-setup.mjs
 * stores plan prices in plan_prices: the app reads the database first, so a
 * deployed build starts selling at these prices with no redeploy.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let storedInDatabase = false;

if (supabaseUrl && serviceKey) {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.from("peer_review_credit_prices").upsert(
    created.map((c) => ({ pack_id: c.packId, stripe_price_id: c.priceId, amount_jpy: c.amountJpy })),
    { onConflict: "pack_id" },
  );
  if (error) {
    console.warn(`\n⚠  Could not write peer_review_credit_prices: ${error.message}`);
    console.warn("   Apply supabase/migrations/all.sql, or the packs will show as unavailable.\n");
  } else {
    storedInDatabase = true;
    console.log("\n✓ Saved to peer_review_credit_prices - every deployment reading this database picks them up.");
  }
} else {
  console.warn("\n⚠  Supabase not configured here; skipping the peer_review_credit_prices write.");
}

const webhookNote = liveMode
  ? "Make sure your Live-mode webhook endpoint (Developers -> Webhooks) is\n" +
    "subscribed to checkout.session.completed - the same endpoint the\n" +
    "subscription flow already uses handles credit purchases too.\n"
  : "Forward webhooks while developing, same as for subscriptions:\n\n" +
    "  stripe listen --forward-to localhost:3000/api/stripe/webhook\n";

console.log(
  (storedInDatabase
    ? "\nPrices are stored in the database - no env vars and no redeploy needed.\n\n"
    : "\nNo database write happened; the app will show these packs as\n" +
      "\"価格がまだ作成されていません\" until peer_review_credit_prices has them.\n") +
    webhookNote,
);
