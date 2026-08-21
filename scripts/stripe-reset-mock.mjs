/**
 * Finds laboratories still holding a subscription from the mock checkout
 * (`/billing/checkout`) and resets them to the free plan.
 *
 *   npm run stripe:reset-mock          # report only
 *   npm run stripe:reset-mock -- --apply
 *
 * Before a Stripe account was connected, `startCheckout` sent the browser to
 * an in-app mock payment page instead of real Stripe, and "paying" there
 * wrote a `lab_subscriptions` row with a `mock_`-prefixed customer and
 * subscription id (see src/lib/billing/actions.ts:completeMockCheckout).
 * Nothing about going live retires those rows automatically - a lab that
 * clicked through the mock flow during testing stays marked as a paying
 * customer indefinitely unless something resets it, which would mean every
 * lab that tried the beta silently keeps its paid plan for free once real
 * billing is switched on.
 *
 * Only rows with a `mock_` id are touched. A real Stripe subscription (any
 * id Stripe itself issued) is never modified by this script - resetting a
 * real subscriber's plan is Stripe's job, driven by the webhook, not this
 * script's.
 *
 * Safe to re-run: with nothing left to reset, both modes report zero rows
 * and change nothing.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.\n",
    );
    return 1;
  }

  const apply = process.argv.includes("--apply");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await admin
    .from("lab_subscriptions")
    .select("lab_id, plan, status, stripe_customer_id, stripe_subscription_id, laboratories(name)");
  if (error) {
    console.error(`\nCould not read lab_subscriptions: ${error.message}\n`);
    return 1;
  }

  const isMock = (id) => typeof id === "string" && id.startsWith("mock_");
  const mockRows = (rows ?? []).filter(
    (r) => isMock(r.stripe_customer_id) || isMock(r.stripe_subscription_id),
  );

  if (mockRows.length === 0) {
    console.log("\nNo mock-checkout subscriptions found. Nothing to reset.\n");
    return 0;
  }

  console.log(`\n${mockRows.length} laboratory(ies) currently paid only via the mock checkout:\n`);
  for (const r of mockRows) {
    const labName = Array.isArray(r.laboratories) ? r.laboratories[0]?.name : r.laboratories?.name;
    console.log(`  - ${labName ?? r.lab_id} (${r.lab_id}): plan=${r.plan} status=${r.status}`);
  }

  if (!apply) {
    console.log(
      "\nThis was a dry run - nothing was changed.\n" +
        "Re-run with --apply to reset these to the free plan:\n\n" +
        "  npm run stripe:reset-mock -- --apply\n",
    );
    return 0;
  }

  const { error: updateError } = await admin
    .from("lab_subscriptions")
    .update({ plan: "free", status: "canceled", cancel_at_period_end: false })
    .in("lab_id", mockRows.map((r) => r.lab_id));
  if (updateError) {
    console.error(`\nReset failed: ${updateError.message}\n`);
    return 1;
  }

  console.log(`\nReset ${mockRows.length} laboratory(ies) to the free plan.\n`);
  return 0;
}

process.exitCode = await main();
