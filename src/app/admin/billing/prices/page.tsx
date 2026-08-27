import { redirect } from "next/navigation";

/**
 * Price editing used to live here. Checkout now finds or creates Stripe
 * Prices from the catalogue in `plans.ts`, so administrators no longer need
 * a separate settings page. Keep this route as a redirect for old bookmarks.
 */
export default function AdminBillingPricesPage() {
  redirect("/admin/billing");
}
