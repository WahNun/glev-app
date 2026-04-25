import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripeServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/beta/webhook
 *
 * Stripe-signed webhook. We verify the signature against the raw body
 * (request.text()), then handle `checkout.session.completed` to mark
 * the matching beta_reservations row as paid.
 *
 * On success we leave a TODO for the future email sender — first version
 * intentionally does not depend on a transactional email provider.
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  if (!sig || !webhookSecret) {
    // eslint-disable-next-line no-console
    console.error("[beta/webhook] missing signature or STRIPE_WEBHOOK_SECRET");
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[beta/webhook] signature verify failed:", (err as Error).message);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    // Ack other events without doing work; configure the dashboard to send only this one.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const sessionId = session.id;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const email =
    session.customer_details?.email?.toLowerCase() ??
    session.customer_email?.toLowerCase() ??
    null;

  try {
    const sb = getSupabaseAdmin();

    // Match the pending row by stripe_session_id (set when we created the session).
    // Only ever transition *out of* pending — never overwrite an already paid /
    // refunded / cancelled row (idempotent for Stripe retries).
    const { data: updatedBySession, error: updErr } = await sb
      .from("beta_reservations")
      .update({
        status: "paid",
        fulfilled_at: new Date().toISOString(),
        stripe_customer_id: customerId,
      })
      .eq("stripe_session_id", sessionId)
      .eq("status", "pending")
      .select("id, email")
      .maybeSingle();

    if (updErr) {
      // eslint-disable-next-line no-console
      console.error("[beta/webhook] update by session_id failed:", updErr.code, updErr.message);
      // Still 200 so Stripe doesn't retry forever; we'll fix manually.
      return NextResponse.json({ received: true, error: "db_update_failed" });
    }

    // Fallback: row may exist by email if stripe_session_id wasn't persisted yet
    // (e.g., the checkout-session-create callback failed to persist before the
    // user paid). Same idempotency guard.
    if (!updatedBySession && email) {
      const { error: emailUpdErr } = await sb
        .from("beta_reservations")
        .update({
          status: "paid",
          fulfilled_at: new Date().toISOString(),
          stripe_session_id: sessionId,
          stripe_customer_id: customerId,
        })
        .eq("email", email)
        .eq("status", "pending");

      if (emailUpdErr) {
        // eslint-disable-next-line no-console
        console.error("[beta/webhook] update by email failed:", emailUpdErr.code, emailUpdErr.message);
        return NextResponse.json({ received: true, error: "db_update_failed" });
      }
    }

    // TODO(email): wire up a transactional sender (Resend / Postmark) and send:
    //
    //   Subject: Dein Glev Beta-Platz ist gesichert
    //   Body: "Hey [Vorname],
    //
    //   Danke für dein Vertrauen. Dein Beta-Platz ist reserviert.
    //
    //   Wir melden uns zwei Wochen vor dem öffentlichen Launch mit deinem Zugangslink.
    //   In der Zwischenzeit: wenn du Fragen hast, einfach auf diese Email antworten.
    //
    //   Bis bald,
    //   Lucas
    //   hello@glev.app"
    //
    // For v1 we log the intent so it shows up in deployment logs.
    // eslint-disable-next-line no-console
    console.log("[beta/webhook] paid:", { email, sessionId, customerId });

    return NextResponse.json({ received: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[beta/webhook] unexpected:", e);
    // Return 200 to avoid retry storms — we already verified the signature.
    return NextResponse.json({ received: true, error: "unexpected" });
  }
}
