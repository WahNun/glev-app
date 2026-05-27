// Plus Checkout — schlanker Endpoint analog zu /api/checkout/pro.
// trial_end ist FEST auf 1. Juli 2026 00:00 UTC (Unix 1782864000), so dass der
// Trial für JEDEN Kunden zur gleichen Sekunde endet — egal wann er sich
// anmeldet. Karte wird heute hinterlegt, erste Buchung am Launch-Tag.
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLUS_TRIAL_END = 1782864000;
const STRIPE_TRIAL_MIN_LEAD_MS = 48 * 60 * 60 * 1000 + 60 * 60 * 1000;

/**
 * POST /api/checkout/plus
 *
 * Glev+ Lifetime-Lock Checkout (€29 bzw. $29/Monat). Currency per Locale:
 *   `locale: "en"` → USD via STRIPE_PLUS_PRICE_ID_US
 *   `locale: "de"` (Default) → EUR via STRIPE_PLUS_PRICE_ID
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
      ? process.env.STRIPE_PLUS_PRICE_ID_US
      : process.env.STRIPE_PLUS_PRICE_ID;

    if (!priceId) {
      throw new Error(
        useUsd
          ? "Missing STRIPE_PLUS_PRICE_ID_US"
          : "Missing STRIPE_PLUS_PRICE_ID",
      );
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error("Missing NEXT_PUBLIC_APP_URL");
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

    const nowMs = Date.now();
    const trialEndMs = PLUS_TRIAL_END * 1000;
    const trialIsViable = trialEndMs - nowMs >= STRIPE_TRIAL_MIN_LEAD_MS;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: "always",
      subscription_data: {
        ...(trialIsViable ? { trial_end: PLUS_TRIAL_END } : {}),
        metadata: { feature: "plus_subscription", plan_name: "Glev+", plan_id: "glev-plus-monthly" },
      },
      metadata: { feature: "plus_subscription", plan_name: "Glev+", plan_id: "glev-plus-monthly" },
      success_url: `${appUrl}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pro/cancelled`,
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
    };

    if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    // eslint-disable-next-line no-console
    console.error("[checkout/plus]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
