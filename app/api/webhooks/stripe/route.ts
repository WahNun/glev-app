// KRITISCH: Edge Runtime bricht Stripe Signaturprüfung — Node.js zwingend!
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { betaWelcomeHtml } from '@/lib/emails/beta-welcome';

// Lazy clients — constructing Resend at module load throws if the API key
// contains non-ASCII chars (e.g. accidentally pasted "re_••••" placeholder),
// which would 500 every webhook delivery. Defer to first use so a bad key
// only fails the email send (logged + swallowed per spec) instead of the
// whole route.
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  // Env Var heißt in Vercel/Replit: STRIPE_BETA_WEBHOOK_SECRET
  if (!sig || !process.env.STRIPE_BETA_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_BETA_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook verification failed';
    // eslint-disable-next-line no-console
    console.error('[webhook] Signature verification failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    const email = session.customer_email ?? session.customer_details?.email;
    const name = session.customer_details?.name ?? null;

    if (!email) {
      // eslint-disable-next-line no-console
      console.warn('[webhook] checkout.session.completed — no email found, skipping');
      return NextResponse.json({ received: true });
    }

    // 1. Welcome Email via Resend
    try {
      const resend = getResend();
      await resend.emails.send({
        from: 'Glev <info@glev.app>',
        to: email,
        subject: 'Willkommen bei Glev — dein Beta-Zugang ist aktiv 🎉',
        html: betaWelcomeHtml(name),
      });
      // eslint-disable-next-line no-console
      console.log(`[webhook] Welcome email sent to ${email}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] Failed to send welcome email:', err);
      // Nicht abbrechen — Supabase-Update trotzdem versuchen
    }

    // 2. Supabase Profile updaten
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_status: 'beta',
          plan: 'beta',
        })
        .eq('email', email);

      if (error) {
        // eslint-disable-next-line no-console
        console.error('[webhook] Supabase update failed:', error.message);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[webhook] Supabase profile updated for ${email}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] Supabase update error:', err);
    }
  }

  return NextResponse.json({ received: true });
}
