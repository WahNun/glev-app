import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { proTrialPeriodDays } from "@/lib/proPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/pro
 *
 * Schlanker Pro-Checkout-Endpoint analog zu /api/checkout/beta.
 * Erstellt eine Stripe-Subscription-Session für STRIPE_PRO_PRICE_ID
 * (€24,90 / Monat) mit Trial bis zum Launch-Tag (1. Juli 2026):
 * Karte wird heute hinterlegt, erste Buchung am Launch-Tag.
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

    const trialDays = proTrialPeriodDays();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

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
      subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
      success_url: `${appUrl}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pro/cancelled`,
      locale: "de",
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
