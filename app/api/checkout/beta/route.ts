import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Beta-Checkout — currency wird per Locale aus dem Request-Body gewählt.
 *
 * `locale: "en"` → USD-Charge ($9/Monat)
 * `locale: "de"` (Default + Fallback) → EUR-Charge (€9/Monat)
 *
 * Keine Coupons mehr — Subscription läuft direkt auf dem Vollpreis (€9/$9)
 * pro Monat. Erste Abbuchung erfolgt am `STRIPE_BILLING_ANCHOR` (Launch-
 * Datum, z.B. 2026-07-01T00:00:00Z) — heute wird die Karte hinterlegt,
 * aber nichts gebucht.
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

    if (!subscriptionPriceId) {
      throw new Error(
        useUsd
          ? 'Missing STRIPE_PRICE_BETA_ID_US'
          : 'Missing STRIPE_PRICE_BETA_ID',
      );
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error('Missing NEXT_PUBLIC_APP_URL');
    }
    if (!process.env.STRIPE_BILLING_ANCHOR) {
      throw new Error('Missing STRIPE_BILLING_ANCHOR');
    }

    const trialEnd = Math.floor(
      new Date(process.env.STRIPE_BILLING_ANCHOR).getTime() / 1000,
    );
    if (!Number.isFinite(trialEnd) || trialEnd <= 0) {
      throw new Error(
        'Invalid STRIPE_BILLING_ANCHOR (expected ISO date, e.g. 2026-07-01T00:00:00Z)',
      );
    }

    // Referred users get 50% off their first month instead of the free trial.
    let isReferred = false;
    let personalTrialEndSec: number | null = null;
    try {
      const supabaseUrl  = process.env.SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL  || '';
      const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
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
            .from('profiles')
            .select('signup_source, trial_end_at')
            .eq('user_id', user.id)
            .maybeSingle();
          isReferred = (profile as { signup_source?: string | null; trial_end_at?: string | null } | null)
            ?.signup_source?.startsWith('ref:') ?? false;
          const rawTrialEnd = (profile as { trial_end_at?: string | null } | null)?.trial_end_at;
          if (rawTrialEnd) {
            const ms = new Date(rawTrialEnd).getTime();
            if (Number.isFinite(ms) && ms > Date.now()) {
              personalTrialEndSec = Math.floor(ms / 1000);
            }
          }
        }
      }
    } catch {
      // Non-fatal — no coupon applied, no personal trial end
    }

    // Use the later of the user's personal trial end and the billing anchor,
    // so upgrading early still lets the user enjoy the full 7-day trial.
    const STRIPE_TRIAL_MIN_LEAD_MS = 48 * 60 * 60 * 1000 + 60 * 60 * 1000;
    const effectiveTrialEnd = personalTrialEndSec
      ? Math.max(personalTrialEndSec, trialEnd)
      : trialEnd;
    const effectiveTrialIsViable =
      effectiveTrialEnd * 1000 - Date.now() >= STRIPE_TRIAL_MIN_LEAD_MS;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: subscriptionPriceId, // €9 oder $9 / Monat (recurring, Vollpreis)
          quantity: 1,
        },
      ],
      // Karte heute hinterlegen, erste Abbuchung am Trial-Ende.
      payment_method_collection: 'always',
      ...(isReferred ? { discounts: [{ coupon: 'glev_referral_50' }] } : {}),
      subscription_data: {
        // Trial bis zum späteren von: persönlichem Trial-Ende oder Billing-Anchor.
        // Stripe verlangt mind. 48h Vorlauf — falls nicht erfüllt, kein Trial.
        ...(effectiveTrialIsViable ? { trial_end: effectiveTrialEnd } : {}),
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
      consent_collection: {
        terms_of_service: 'required',
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
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    // eslint-disable-next-line no-console
    console.error('[checkout/beta]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
