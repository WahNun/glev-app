// Pro Checkout — läuft über diese API-Route (kein Stripe Payment Link mehr).
// trial_end ist FEST auf 1. Juli 2026 00:00 UTC gesetzt (Unix 1782864000),
// unabhängig vom Anmeldedatum. Damit endet der Trial für JEDEN Kunden zur
// gleichen Sekunde — egal ob er sich heute anmeldet oder am 30. Juni.
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
 * Erstellt eine Stripe-Subscription-Session für den Pro-Price (€14,90 bzw.
 * $14.90 / Monat) mit fixem Trial-End am Launch-Tag (1. Juli 2026):
 * Karte wird heute hinterlegt, erste Buchung am Launch-Tag.
 *
 * Currency wird per Locale aus dem Request-Body gewählt:
 *   `locale: "en"` → USD-Charge ($14.90/Monat) via STRIPE_PRICE_PRO_USD_ID
 *   `locale: "de"` (Default + Fallback) → EUR-Charge (€14,90/Monat) via
 *     STRIPE_PRICE_PRO_EUR_ID, mit backward-compat Fallback auf den alten
 *     Namen STRIPE_PRO_PRICE_ID damit Production weiterläuft.
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
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      locale?: unknown;
    };
    const email = typeof body.email === "string" ? body.email : undefined;
    const locale = body.locale === "en" ? "en" : "de";
    const useUsd = locale === "en";

    const priceId = useUsd
      ? process.env.STRIPE_PRICE_PRO_USD_ID
      : process.env.STRIPE_PRICE_PRO_EUR_ID
        ?? process.env.STRIPE_PRO_PRICE_ID;

    if (!priceId) {
      throw new Error(
        useUsd
          ? "Missing STRIPE_PRICE_PRO_USD_ID"
          : "Missing STRIPE_PRICE_PRO_EUR_ID (or legacy STRIPE_PRO_PRICE_ID)",
      );
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error("Missing NEXT_PUBLIC_APP_URL");
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

    // Trial nur setzen wenn Launch-Datum noch genug Vorlauf hat (Stripe-Constraint).
    const nowMs = Date.now();
    const trialEndMs = PRO_TRIAL_END * 1000;
    const trialIsViable = trialEndMs - nowMs >= STRIPE_TRIAL_MIN_LEAD_MS;

    // Referred users get 50% off their first month instead of the free trial.
    let isReferred = false;
    try {
      const supabaseUrl  = process.env.SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
      const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
      const cookieStore  = await cookies();
      const all = cookieStore.getAll();
      if (all.length > 0) {
        const sbUser = createServerClient(supabaseUrl, supabaseAnon, {
          cookies: { getAll: () => all.map((c) => ({ name: c.name, value: c.value })), setAll: () => {} },
        });
        const { data: { user } } = await sbUser.auth.getUser();
        if (user) {
          const sbAdmin = getSupabaseAdmin();
          const { data: profile } = await sbAdmin
            .from("profiles")
            .select("signup_source")
            .eq("user_id", user.id)
            .maybeSingle();
          isReferred = (profile as { signup_source?: string | null } | null)
            ?.signup_source?.startsWith("ref:") ?? false;
        }
      }
    } catch {
      // Non-fatal — no coupon applied
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // "Karte heute hinterlegen, keine Buchung bis Launch" — payment_method
      // wird IMMER eingesammelt (Default bei Trials wäre "if_required").
      payment_method_collection: "always",
      // Referred users skip the trial — the 50% coupon is the benefit instead.
      ...(isReferred ? { discounts: [{ coupon: "glev_referral_50" }] } : {}),
      subscription_data: {
        // Trial only when launch is far enough out AND user is not referred.
        ...(!isReferred && trialIsViable ? { trial_end: PRO_TRIAL_END } : {}),
        // Stamp the subscription so the webhook + downstream tooling can
        // tell apart Pro from Beta even without looking at the price id.
        metadata: { feature: "pro_subscription", plan_name: "Glev Pro", plan_id: "glev-pro-monthly" },
      },
      // Top-level metadata mirrors subscription_data.metadata so the
      // session itself (used by /api/verify-payment) carries the feature
      // tag — that's how /pro/success refuses Beta sessions and vice-versa.
      metadata: { feature: "pro_subscription", plan_name: "Glev Pro", plan_id: "glev-pro-monthly" },
      success_url: `${appUrl}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pro/cancelled`,
      // Stripe-Hosted-Checkout-UI in passender Sprache anzeigen.
      locale,
      custom_fields: [
        {
          key: "full_name",
          label: {
            type: "custom",
            custom: useUsd ? "Full name" : "Vollständiger Name",
          },
          type: "text",
          optional: false,
        },
      ],
      consent_collection: {
        terms_of_service: "required",
      },
      custom_text: {
        terms_of_service_acceptance: {
          message: useUsd
            ? 'I agree to the <a href="https://glev.app/legal?tab=agb">Terms of Service</a>.'
            : 'Ich stimme den <a href="https://glev.app/legal?tab=agb">Allgemeinen Geschäftsbedingungen</a> zu.',
        },
      },
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
