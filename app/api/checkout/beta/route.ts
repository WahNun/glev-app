import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === 'string' ? body.email : undefined;

    if (!process.env.STRIPE_PRICE_SUBSCRIPTION_ID) {
      throw new Error('Missing STRIPE_PRICE_SUBSCRIPTION_ID');
    }
    if (!process.env.STRIPE_PRICE_SETUP_FEE_ID) {
      throw new Error('Missing STRIPE_PRICE_SETUP_FEE_ID');
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error('Missing NEXT_PUBLIC_APP_URL');
    }

    // Stripe Checkout in `mode: 'subscription'` akzeptiert sowohl recurring als auch
    // one-time Prices in `line_items`. Der one-time Price (Setup-Fee €19) wird
    // automatisch der ERSTEN Rechnung der neuen Subscription hinzugefügt — exakt
    // das gewünschte Verhalten "€19 sofort + €4,50/Monat ab Tag 1".
    //
    // Die ältere Variante `subscription_data.add_invoice_items` ist NICHT für
    // Checkout.Sessions verfügbar (nur für Subscriptions.create direkt) — Stripe
    // lehnt sie mit 400 "Received unknown parameter" ab.
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_SUBSCRIPTION_ID, // €4,50/Monat (recurring)
          quantity: 1,
        },
        {
          price: process.env.STRIPE_PRICE_SETUP_FEE_ID, // €19 einmalig (one-time)
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta`,
      custom_fields: [
        {
          key: 'full_name',
          label: { type: 'custom', custom: 'Vollständiger Name' },
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
