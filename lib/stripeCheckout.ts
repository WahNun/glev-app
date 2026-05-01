import type Stripe from 'stripe';

/**
 * Pull the buyer's full name out of a Checkout Session's `custom_fields`.
 *
 * All four checkout-create routes (Pro and Beta, lean and DB-tracked variants)
 * configure a mandatory text field with `key: 'full_name'` (label
 * "Vollständiger Name"). Stripe echoes the value back on
 * `checkout.session.completed` under `session.custom_fields[].text.value`.
 *
 * Returns the trimmed string, or `null` when the field is missing/empty so
 * callers can fall back to `customer_details.name` (which Stripe collects
 * separately as part of billing details).
 *
 * Lives in its own module — separate from `lib/stripe.ts` — so importing it
 * does NOT trigger the eager `STRIPE_SECRET_KEY` check, since some webhook
 * handlers construct their Stripe client lazily via `lib/stripeServer.ts`.
 */
export function extractFullNameFromSession(
  session: Stripe.Checkout.Session,
): string | null {
  const fields = session.custom_fields ?? [];
  const field = fields.find((f) => f.key === 'full_name');
  if (!field) return null;
  // Stripe's TS types make `text` optional because the field can be of type
  // `numeric` or `dropdown` too — for our `text` field it's always present.
  const raw = field.text?.value ?? null;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
