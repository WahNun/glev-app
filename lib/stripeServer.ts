import Stripe from "stripe";

export const BETA_CAPACITY = 500;
export const BETA_AMOUNT_CENTS = 1900;

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  _stripe = new Stripe(key);
  return _stripe;
}

const GENERIC_CHECKOUT_ERROR =
  "Leider hat der Checkout nicht funktioniert — probier es gleich nochmal";

const CONFIG_CHECKOUT_ERROR =
  "Zahlungs-Konfiguration fehlerhaft — wir wurden benachrichtigt. Bitte hello@glev.app kontaktieren.";

const TRANSIENT_CHECKOUT_ERROR =
  "Zahlung gerade nicht verfügbar — bitte später nochmal probieren oder hello@glev.app kontaktieren.";

/**
 * Classify a thrown Stripe (or unknown) error into a safe user-facing message
 * + HTTP status. The full error is always logged server-side by the caller —
 * this helper only decides what the *browser* sees so misconfigurations don't
 * silently re-show the generic "try again" message that just makes the user
 * retry forever.
 *
 * - resource_missing / parameter_invalid_empty on a price → almost always a
 *   live↔test mode mismatch or a deleted price. User retrying won't fix it,
 *   we want them to email us so we can fix the env.
 * - any other StripeError (rate limit, API down, network) → transient, user
 *   may retry, but we surface the contact email as escape hatch.
 * - non-Stripe error → keep the existing generic copy so we don't leak
 *   internal failure modes (DB outage, etc.).
 */
export function classifyCheckoutError(e: unknown): {
  userError: string;
  status: number;
  category: "config" | "transient" | "unknown";
} {
  if (e && typeof e === "object" && "type" in e) {
    const err = e as { type?: string; code?: string; param?: string };
    const isPriceMissing =
      err.type === "StripeInvalidRequestError" &&
      (err.code === "resource_missing" || err.code === "parameter_invalid_empty") &&
      (err.param?.includes("price") ?? true);
    if (isPriceMissing) {
      return { userError: CONFIG_CHECKOUT_ERROR, status: 500, category: "config" };
    }
    if (typeof err.type === "string" && err.type.startsWith("Stripe")) {
      return { userError: TRANSIENT_CHECKOUT_ERROR, status: 502, category: "transient" };
    }
  }
  return { userError: GENERIC_CHECKOUT_ERROR, status: 500, category: "unknown" };
}
