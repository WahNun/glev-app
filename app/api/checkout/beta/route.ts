import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 1. Juli 2026 00:00:00 UTC — fix für ALLE Beta-Tester
const BETA_TRIAL_END = 1751328000;

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

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_SUBSCRIPTION_ID, // €4.50/Monat
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_end: BETA_TRIAL_END, // 1. Juli 2026 — erste echte Abbuchung
        // Stripe SDK v22.1.0 types lag behind the REST API: `add_invoice_items`
        // IS a documented field on Checkout.Session.subscription_data
        // (https://stripe.com/docs/api/checkout/sessions/create) but is currently
        // typed only on Subscriptions.create. Safe to send — Stripe accepts it.
        // @ts-expect-error -- valid REST property, missing from SDK types
        add_invoice_items: [
          {
            price: process.env.STRIPE_PRICE_SETUP_FEE_ID, // €19 einmalig, sofort
          },
        ],
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta`,
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
