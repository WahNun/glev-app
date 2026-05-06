import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Beta-Checkout — currency wird per Locale aus dem Request-Body gewählt.
 *
 * `locale: "en"` → USD-Charge ($9/Monat, mit Coupon erste 3 Monate $4.50)
 * `locale: "de"` (Default + Fallback) → EUR-Charge (€9/Monat, mit Coupon
 * erste 3 Monate €4,50)
 *
 * Setup-Gebühr fällt komplett weg. Statt eines reduzierten Preises läuft
 * die Subscription auf den Vollpreis (€9/$9), und ein 3-Monats-Coupon
 * (`STRIPE_BETA_COUPON_ID` / `STRIPE_BETA_COUPON_ID_US`) macht die ersten
 * 3 Monate auf €4,50/$4.50 günstiger. Erste Abbuchung erfolgt am
 * `STRIPE_BILLING_ANCHOR` (Launch-Datum, z.B. 2026-07-01T00:00:00Z) —
 * heute wird die Karte hinterlegt, aber nichts gebucht.
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
      ? process.env.STRIPE_PRICE_BETA_ID_US
      : process.env.STRIPE_PRICE_BETA_ID;

    const couponId = useUsd
      ? process.env.STRIPE_BETA_COUPON_ID_US
      : process.env.STRIPE_BETA_COUPON_ID;

    if (!subscriptionPriceId) {
      throw new Error(
        useUsd
          ? 'Missing STRIPE_PRICE_BETA_ID_US'
          : 'Missing STRIPE_PRICE_BETA_ID',
      );
    }
    if (!couponId) {
      throw new Error(
        useUsd
          ? 'Missing STRIPE_BETA_COUPON_ID_US'
          : 'Missing STRIPE_BETA_COUPON_ID',
      );
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error('Missing NEXT_PUBLIC_APP_URL');
    }
    if (!process.env.STRIPE_BILLING_ANCHOR) {
      throw new Error('Missing STRIPE_BILLING_ANCHOR');
    }

    const billingCycleAnchor = Math.floor(
      new Date(process.env.STRIPE_BILLING_ANCHOR).getTime() / 1000,
    );
    if (!Number.isFinite(billingCycleAnchor) || billingCycleAnchor <= 0) {
      throw new Error(
        'Invalid STRIPE_BILLING_ANCHOR (expected ISO date, e.g. 2026-07-01T00:00:00Z)',
      );
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: subscriptionPriceId, // €9 oder $9 / Monat (recurring, Vollpreis)
          quantity: 1,
        },
      ],
      // 3-Monats-Coupon (Beta-Discount auf €4,50/$4.50). Stripe wendet ihn
      // automatisch auf die ersten 3 Rechnungen der Subscription an.
      discounts: [{ coupon: couponId }],
      // Karte heute hinterlegen, erste Abbuchung am Launch-Tag.
      payment_method_collection: 'always',
      subscription_data: {
        // Erste Rechnung am Launch-Datum (z.B. 1. Juli 2026 00:00 UTC).
        // proration_behavior: 'none' verhindert dass Stripe für die Tage
        // zwischen Sign-up und Anchor anteilig abrechnet.
        billing_cycle_anchor: billingCycleAnchor,
        proration_behavior: 'none',
        metadata: { feature: 'beta_subscription' },
      },
      metadata: { feature: 'beta_subscription' },
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
