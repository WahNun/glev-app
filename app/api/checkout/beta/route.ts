import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Beta-Checkout — currency wird per Locale aus dem Request-Body gewählt.
 *
 * `locale: "en"` → USD-Charge (Setup $19 + $4.50/Monat)
 * `locale: "de"` (Default + Fallback) → EUR-Charge (Setup €19 + €4,50/Monat)
 *
 * Env-Var-Lookup ist backward-compatible: die neuen `STRIPE_PRICE_BETA_*_EUR_ID`
 * Namen werden zuerst probiert, mit Fallback auf die alten `STRIPE_PRICE_*_ID`
 * Namen — damit funktioniert Production weiter, auch wenn die Migration zu den
 * neuen Namen erst später passiert.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      locale?: unknown;
    };
    const email = typeof body.email === 'string' ? body.email : undefined;
    const locale = body.locale === 'en' ? 'en' : 'de';
    const useUsd = locale === 'en';

    const subscriptionPriceId = useUsd
      ? process.env.STRIPE_PRICE_BETA_SUBSCRIPTION_USD_ID
      : process.env.STRIPE_PRICE_BETA_SUBSCRIPTION_EUR_ID
        ?? process.env.STRIPE_PRICE_SUBSCRIPTION_ID;

    const setupFeePriceId = useUsd
      ? process.env.STRIPE_PRICE_BETA_SETUP_FEE_USD_ID
      : process.env.STRIPE_PRICE_BETA_SETUP_FEE_EUR_ID
        ?? process.env.STRIPE_PRICE_SETUP_FEE_ID;

    if (!subscriptionPriceId) {
      throw new Error(
        useUsd
          ? 'Missing STRIPE_PRICE_BETA_SUBSCRIPTION_USD_ID'
          : 'Missing STRIPE_PRICE_BETA_SUBSCRIPTION_EUR_ID (or legacy STRIPE_PRICE_SUBSCRIPTION_ID)',
      );
    }
    if (!setupFeePriceId) {
      throw new Error(
        useUsd
          ? 'Missing STRIPE_PRICE_BETA_SETUP_FEE_USD_ID'
          : 'Missing STRIPE_PRICE_BETA_SETUP_FEE_EUR_ID (or legacy STRIPE_PRICE_SETUP_FEE_ID)',
      );
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error('Missing NEXT_PUBLIC_APP_URL');
    }

    // Stripe Checkout in `mode: 'subscription'` akzeptiert sowohl recurring als auch
    // one-time Prices in `line_items`. Der one-time Price (Setup-Fee €19/$19) wird
    // automatisch der ERSTEN Rechnung der neuen Subscription hinzugefügt — exakt
    // das gewünschte Verhalten "€19/$19 sofort + €4,50/$4.50 pro Monat ab Tag 1".
    //
    // Die ältere Variante `subscription_data.add_invoice_items` ist NICHT für
    // Checkout.Sessions verfügbar (nur für Subscriptions.create direkt) — Stripe
    // lehnt sie mit 400 "Received unknown parameter" ab.
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: subscriptionPriceId, // €4,50 oder $4.50 / Monat (recurring)
          quantity: 1,
        },
        {
          price: setupFeePriceId, // €19 oder $19 einmalig (one-time)
          quantity: 1,
        },
      ],
      // Stripe-Hosted-Checkout-UI in passender Sprache anzeigen.
      locale,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta`,
      custom_fields: [
        {
          key: 'full_name',
          label: {
            type: 'custom',
            custom: useUsd ? 'Full name' : 'Vollständiger Name',
          },
          type: 'text',
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
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    // eslint-disable-next-line no-console
    console.error('[checkout/beta]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
