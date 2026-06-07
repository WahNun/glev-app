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
 * Returns the set of known Stripe Price IDs for Plus subscriptions.
 *
 * Price IDs are read from env vars at call time so the function works both in
 * production (real IDs) and in unit tests (override via process.env). Any
 * undefined env var is simply excluded from the set — the empty set means no
 * price ID will ever be considered a Plus price.
 *
 * - STRIPE_PLUS_PRICE_ID    — EUR monthly (e.g. price_1Abc…)
 * - STRIPE_PLUS_PRICE_ID_US — USD monthly (e.g. price_1Def…)
 */
export function plusPriceIds(): string[] {
  const ids: string[] = [];
  if (process.env.STRIPE_PLUS_PRICE_ID) ids.push(process.env.STRIPE_PLUS_PRICE_ID);
  if (process.env.STRIPE_PLUS_PRICE_ID_US) ids.push(process.env.STRIPE_PLUS_PRICE_ID_US);
  return ids;
}

/**
 * Emits a console.error if neither STRIPE_PLUS_PRICE_ID nor
 * STRIPE_PLUS_PRICE_ID_US is set in the environment.
 *
 * Call once at module load time in the Plus webhook route so Vercel log
 * alerts / Datadog fire immediately on a misconfigured deployment — before
 * any real subscription event arrives and gets silently dropped.
 *
 * Safe to call in unit tests: tests override process.env directly so this
 * function naturally stays quiet when at least one ID is present.
 */
export function warnIfPlusPriceIdsAbsent(): void {
  if (!process.env.STRIPE_PLUS_PRICE_ID && !process.env.STRIPE_PLUS_PRICE_ID_US) {
    // eslint-disable-next-line no-console
    console.error(
      "[plus/webhook] MISCONFIGURATION: Neither STRIPE_PLUS_PRICE_ID nor " +
        "STRIPE_PLUS_PRICE_ID_US is set. ALL customer.subscription.* events " +
        "will be silently ACK'd and no Plus cancellation email will ever be " +
        "sent. Set these env vars in Vercel → Environment Variables immediately.",
    );
  }
}

/**
 * Returns true when `priceId` belongs to a Glev+ subscription price.
 *
 * Use this as a guard in `customer.subscription.*` handlers in the Plus
 * webhook to filter out Pro-Trial (or any other) subscriptions whose events
 * Stripe also delivers to the Plus webhook endpoint.
 *
 * Returns false for null / undefined / unknown price IDs.
 */
export function isPlusPriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false;
  return plusPriceIds().includes(priceId);
}

/**
 * Returns the set of known Stripe Price IDs for Pro subscriptions.
 *
 * Price IDs are read from env vars at call time so the function works both in
 * production (real IDs) and in unit tests (override via process.env). Any
 * undefined env var is simply excluded from the set — the empty set means no
 * price ID will ever be considered a Pro price.
 *
 * - STRIPE_PRO_PRICE_ID    — EUR monthly (e.g. price_1Abc…)
 * - STRIPE_PRO_PRICE_ID_US — USD monthly (e.g. price_1Def…)
 */
export function proPriceIds(): string[] {
  const ids: string[] = [];
  if (process.env.STRIPE_PRO_PRICE_ID) ids.push(process.env.STRIPE_PRO_PRICE_ID);
  if (process.env.STRIPE_PRO_PRICE_ID_US) ids.push(process.env.STRIPE_PRO_PRICE_ID_US);
  return ids;
}

/**
 * Returns true when `priceId` belongs to a Glev Pro subscription price.
 *
 * Use this as a guard in `customer.subscription.*` handlers in the Pro
 * webhook to filter out Plus (or any other) subscriptions whose events
 * Stripe also delivers to the Pro webhook endpoint.
 *
 * Returns false for null / undefined / unknown price IDs.
 */
export function isProPriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false;
  return proPriceIds().includes(priceId);
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
