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

function resolveAppUrl(req: NextRequest): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_ORIGIN ||
    '';
  if (env) return env.replace(/\/$/, '');
  // Fall back to the request host so the resume link still points at the
  // correct deployment if env isn't configured.
  const proto =
    req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  return `${proto}://${host}`;
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
    const sessionId = session.id;
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

    if (!email) {
      // eslint-disable-next-line no-console
      console.warn('[webhook] checkout.session.completed — no email found, skipping', {
        sessionId,
        eventId: event.id,
      });
      return NextResponse.json({ received: true });
    }

    const appUrl = resolveAppUrl(req);

    // 1. Welcome Email via Resend — INCLUDES the resume link so the buyer
    //    can come back days later and finish signup even if they closed
    //    the success-tab.
    try {
      const resend = getResend();
      const { data, error } = await resend.emails.send({
        from: 'Glev <info@glev.app>',
        to: email,
        subject: 'Willkommen bei Glev — bitte schließe deine Registrierung ab',
        html: betaWelcomeHtml(name, sessionId, appUrl),
      });

      if (error) {
        // Resend SDK returns errors as a structured object on the response,
        // not as a thrown exception (which only happens for transport-level
        // failures). Surface the full body — `name`, `message`, and the
        // statusCode if present — so prod logs actually show *why* delivery
        // failed (unverified domain, invalid recipient, etc.) instead of
        // the generic "Failed to send" we used to print.
        // eslint-disable-next-line no-console
        console.error('[webhook] Resend send returned error:', {
          to: email,
          sessionId,
          error,
        });
      } else if (data?.id) {
        // Success: log message-id so we can grep for delivery confirmations.
        // eslint-disable-next-line no-console
        console.log('[webhook] Welcome email sent:', {
          to: email,
          sessionId,
          messageId: data.id,
        });
      } else {
        // Should not happen — Resend always returns either data or error —
        // but keep a noisy log so we notice if the contract changes.
        // eslint-disable-next-line no-console
        console.warn('[webhook] Resend send returned no data and no error:', {
          to: email,
          sessionId,
        });
      }
    } catch (err) {
      // Transport-level / network error — Resend SDK threw. Include the
      // full error so the operator can see status code + body.
      // eslint-disable-next-line no-console
      console.error('[webhook] Resend send threw:', {
        to: email,
        sessionId,
        err,
      });
      // Nicht abbrechen — Supabase-Updates trotzdem versuchen
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Supabase profile updaten — wenn die Zeile schon existiert (zB. der
    //    User hatte vor dem Checkout schon einen Account), dann jetzt auf
    //    Beta hochstufen. Wenn nicht: einfach 0 rows updated, kein Fehler.
    //    Die Profil-Zeile entsteht erst beim Supabase-Signup auf /welcome,
    //    dort muss der Trigger / dort muss ein separater Hook nachziehen.
    try {
      const { data: profileUpdated, error } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_status: 'beta',
          plan: 'beta',
        })
        .eq('email', email)
        .select('id');

      if (error) {
        // eslint-disable-next-line no-console
        console.error('[webhook] Supabase profile update failed:', {
          email,
          sessionId,
          code: error.code,
          message: error.message,
          details: error.details,
        });
      } else {
        // eslint-disable-next-line no-console
        console.log('[webhook] Supabase profile update:', {
          email,
          sessionId,
          rowsUpdated: profileUpdated?.length ?? 0,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] Supabase profile update threw:', {
        email,
        sessionId,
        err,
      });
    }

    // 3. beta_reservations updaten — defensiv, falls der Käufer über den
    //    /api/beta/checkout (one-time) Flow gekommen ist, der vorab eine
    //    `pending`-Zeile anlegt. Bei /api/checkout/beta (subscription)
    //    existiert keine Reservation — dann läuft das Update einfach ins
    //    Leere. Idempotent: nur `pending` → `paid`, niemals eine bereits
    //    paid/refunded/cancelled Zeile überschreiben.
    try {
      // Match preferentially by stripe_session_id (gesetzt vom checkout-create),
      // fallback by email für den Fall dass die session_id nicht persistiert
      // werden konnte.
      const nowIso = new Date().toISOString();
      const { data: bySession, error: sessionUpdErr } = await supabaseAdmin
        .from('beta_reservations')
        .update({
          status: 'paid',
          fulfilled_at: nowIso,
          stripe_customer_id: customerId,
        })
        .eq('stripe_session_id', sessionId)
        .eq('status', 'pending')
        .select('id, email');

      if (sessionUpdErr) {
        // eslint-disable-next-line no-console
        console.error('[webhook] beta_reservations update by session_id failed:', {
          sessionId,
          code: sessionUpdErr.code,
          message: sessionUpdErr.message,
        });
      } else if (bySession && bySession.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[webhook] beta_reservations marked paid by session_id:', {
          sessionId,
          email,
          rows: bySession.length,
        });
      } else {
        // No pending row matched the session_id — try email as fallback.
        const { data: byEmail, error: emailUpdErr } = await supabaseAdmin
          .from('beta_reservations')
          .update({
            status: 'paid',
            fulfilled_at: nowIso,
            stripe_session_id: sessionId,
            stripe_customer_id: customerId,
          })
          .eq('email', email.toLowerCase())
          .eq('status', 'pending')
          .select('id');

        if (emailUpdErr) {
          // eslint-disable-next-line no-console
          console.error('[webhook] beta_reservations update by email failed:', {
            email,
            sessionId,
            code: emailUpdErr.code,
            message: emailUpdErr.message,
          });
        } else if (byEmail && byEmail.length > 0) {
          // eslint-disable-next-line no-console
          console.log('[webhook] beta_reservations marked paid by email:', {
            email,
            sessionId,
            rows: byEmail.length,
          });
        } else {
          // Neither path matched — typical for the subscription /api/checkout/beta
          // flow which doesn't pre-insert reservations. Not an error.
          // eslint-disable-next-line no-console
          console.log('[webhook] no beta_reservations row to update (subscription flow):', {
            email,
            sessionId,
          });
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhook] beta_reservations update threw:', {
        email,
        sessionId,
        err,
      });
    }
  }

  return NextResponse.json({ received: true });
}
