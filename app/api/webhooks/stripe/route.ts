// KRITISCH: Edge Runtime bricht Stripe Signaturprüfung — Node.js zwingend!
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { extractFullNameFromSession } from '@/lib/stripeCheckout';
import { createClient } from '@supabase/supabase-js';
import { enqueueEmail } from '@/lib/emails/outbox';
import { scheduleDripEmails } from '@/lib/emails/drip-scheduler';

// Lazy admin client — constructing it at module load is fine (no
// network), but the env vars may be missing in certain build contexts.
// Keeping it lazy mirrors the rest of the codebase.
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
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
    // Prefer the value collected via the mandatory `full_name` custom field
    // (task #68) — it's the one the buyer typed themselves on the Checkout
    // page. Fall back to Stripe's auto-collected billing-details name only
    // when the custom field is missing (e.g. older sessions, or the field
    // was somehow stripped).
    const fullName = extractFullNameFromSession(session);
    const name = fullName ?? session.customer_details?.name ?? null;
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

    // 1. Welcome Email — enqueue into the durable outbox instead of
    //    calling Resend synchronously here. The cron worker
    //    (/api/cron/flush-outbox) picks it up within ~1-2 min and
    //    handles retries with exponential backoff up to 5 attempts.
    //
    //    Why this MUST happen *first*, before any other work: if the
    //    outbox insert fails (Supabase unreachable, etc.) we want
    //    Stripe to retry the *entire* webhook, otherwise the buyer
    //    pays and never gets their welcome mail with the resume link
    //    — exactly the bug this task closes. Returning a non-2xx
    //    here is the trigger that asks Stripe to come back. The
    //    downstream profile/reservation updates are idempotent
    //    (status='pending' guards) so re-running them is safe.
    //
    //    The dedupe key (Stripe session id) makes that retry
    //    duplicate-proof: a partial unique index on
    //    (template, dedupe_key) means the second attempt returns the
    //    existing row id instead of creating a second mail.
    try {
      const { id: outboxId, deduplicated } = await enqueueEmail({
        recipient: email,
        template: 'beta-welcome',
        payload: { name, sessionId, appUrl },
        dedupeKey: sessionId,
      });
      // eslint-disable-next-line no-console
      console.log('[webhook] Welcome email enqueued:', {
        to: email,
        sessionId,
        outboxId,
        deduplicated,
      });

      // Drip-Sequenz Tag 7/14/30 einplanen (Task #160). Direkt nach
      // dem erfolgreichen Welcome-Enqueue, damit ein fehlgeschlagener
      // Welcome-Enqueue (oben → 500 + Stripe-Retry) keine Drip-Termine
      // ohne zugehörige Welcome-Mail hinterlässt. scheduleDripEmails
      // wirft nicht — bei DB-Fehlern wird nur geloggt, der Stripe-
      // Retry-Pfad bleibt unverändert.
      await scheduleDripEmails(email, name, 'beta');
    } catch (err) {
      // Surface the failure to Stripe with a 500 so it retries the
      // delivery (Stripe retries up to 3 days at increasing intervals).
      // We bail out *before* the profile/reservation updates so the
      // retry runs the whole pipeline coherently — the email is the
      // load-bearing piece (it carries the resume link the buyer
      // needs to complete signup), so without it nothing else should
      // happen either.
      // eslint-disable-next-line no-console
      console.error('[webhook] Outbox enqueue failed — asking Stripe to retry:', {
        to: email,
        sessionId,
        eventId: event.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'outbox enqueue failed, please retry' },
        { status: 500 },
      );
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
      // Only stamp full_name when we actually got one — never overwrite a
      // previously stored name with NULL if Stripe somehow omits the field
      // on a retry.
      const betaUpdate: Record<string, unknown> = {
        status: 'paid',
        fulfilled_at: nowIso,
        stripe_customer_id: customerId,
      };
      if (fullName) betaUpdate.full_name = fullName;

      const { data: bySession, error: sessionUpdErr } = await supabaseAdmin
        .from('beta_reservations')
        .update(betaUpdate)
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
        const betaUpdateByEmail: Record<string, unknown> = {
          status: 'paid',
          fulfilled_at: nowIso,
          stripe_session_id: sessionId,
          stripe_customer_id: customerId,
        };
        if (fullName) betaUpdateByEmail.full_name = fullName;

        const { data: byEmail, error: emailUpdErr } = await supabaseAdmin
          .from('beta_reservations')
          .update(betaUpdateByEmail)
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
