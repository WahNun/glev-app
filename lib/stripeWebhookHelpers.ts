/**
 * Pure helper functions shared across Stripe webhook route handlers.
 *
 * Extracted so route files (Next.js App Router) only export HTTP methods and
 * config — additional named exports from route.ts can block Turbopack
 * compilation in Next.js 16. Unit tests import directly from here.
 */

/**
 * Map a Stripe subscription status to the constrained set we store in
 * `pro_subscriptions.status`. Returns null when the input is unknown — caller
 * should fall back to a sensible default ('trialing' on creation, 'active'
 * on update). Stripe's 'canceled' is normalized to 'cancelled' (British
 * spelling — consistent across all Glev webhook endpoints).
 */
export function mapStripeStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  switch (s) {
    case "trialing":
    case "active":
    case "past_due":
      return s;
    case "canceled":
    case "incomplete_expired":
    case "unpaid":
      return "cancelled";
    default:
      // 'incomplete', 'paused' etc. — treat as past_due so we don't grant
      // access but also don't claim cancelled.
      return "past_due";
  }
}

/**
 * Map a Stripe subscription status to `profiles.plan`.
 *
 * "trialing" / "active" / "past_due" → "pro" (Plus grants the same gated
 * features as Pro; the `subscription_status = 'plus'` column distinguishes
 * the billing tier without requiring a new plan value).
 * Terminal states → null (downgrade to free).
 * Unknown states → undefined (leave plan untouched).
 */
export function mapStripeStatusToPlan(
  s: string | null | undefined,
): "pro" | null | undefined {
  if (!s) return undefined;
  switch (s) {
    case "trialing":
    case "active":
    case "past_due":
      return "pro";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return null;
    default:
      return undefined;
  }
}
