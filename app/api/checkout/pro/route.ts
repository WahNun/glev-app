// Pro Checkout — läuft über diese API-Route (kein Stripe Payment Link mehr).
// trial_end ist FEST auf 1. Juli 2026 00:00 UTC gesetzt (Unix 1782864000),
// unabhängig vom Anmeldedatum. Damit endet der Trial für JEDEN Kunden zur
// gleichen Sekunde — egal ob er sich heute anmeldet oder am 30. Juni.
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fester Trial-End-Timestamp für ALLE Pro-Tester: 1. Juli 2026 00:00:00 UTC.
 * Quick-Check: `date -u -d "@1782864000"` → "Wed Jul  1 00:00:00 UTC 2026".
 */
const PRO_TRIAL_END = 1782864000;

/**
 * Stripe verlangt dass `trial_end` mindestens 48 Stunden in der Zukunft liegt.
 * Wir nehmen 60 Minuten Sicherheitspuffer dazu (für Clock-Drift / Stripe-Latency).
 */
const STRIPE_TRIAL_MIN_LEAD_MS = 48 * 60 * 60 * 1000 + 60 * 60 * 1000;

/**
 * POST /api/checkout/pro
 *
 * Schlanker Pro-Checkout-Endpoint analog zu /api/checkout/beta.
 * Erstellt eine Stripe-Subscription-Session für STRIPE_PRO_PRICE_ID
 * (€24,90 / Monat) mit fixem Trial-End am Launch-Tag (1. Juli 2026):
 * Karte wird heute hinterlegt, erste Buchung am Launch-Tag.
 *
 * Falls die Route nach Launch (oder weniger als ~49h davor) aufgerufen wird,
 * wird kein Trial gesetzt — Stripe würde sonst mit "trial_end must be at
 * least 48 hours in the future" abbrechen. Der Kunde wird dann sofort
 * abgebucht (sinnvolles Default-Verhalten post-Launch).
 *
 * Stripe sammelt die Email selbst auf der gehosteten Checkout-Page —
 * wir fragen sie hier nicht ab. Die "reiche" Variante mit Email-Guard
 * + DB-Tracking lebt weiter unter /api/pro/checkout und ist nicht an
 * den Hero-CTA gewired.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email : undefined;

    if (!process.env.STRIPE_PRO_PRICE_ID) {
      throw new Error("Missing STRIPE_PRO_PRICE_ID");
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error("Missing NEXT_PUBLIC_APP_URL");
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

    // Trial nur setzen wenn Launch-Datum noch genug Vorlauf hat (Stripe-Constraint).
    const nowMs = Date.now();
    const trialEndMs = PRO_TRIAL_END * 1000;
    const trialIsViable = trialEndMs - nowMs >= STRIPE_TRIAL_MIN_LEAD_MS;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID,
          quantity: 1,
        },
      ],
      // "Karte heute hinterlegen, keine Buchung bis Launch" — payment_method
      // wird IMMER eingesammelt (Default bei Trials wäre "if_required").
      payment_method_collection: "always",
      subscription_data: trialIsViable ? { trial_end: PRO_TRIAL_END } : undefined,
      success_url: `${appUrl}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pro/cancelled`,
      locale: "de",
      custom_fields: [
        {
          key: "full_name",
          label: { type: "custom", custom: "Vollständiger Name" },
          type: "text",
          optional: false,
        },
      ],
    };

    if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    // eslint-disable-next-line no-console
    console.error("[checkout/pro]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
