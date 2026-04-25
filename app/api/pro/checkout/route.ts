import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripeServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { proTrialPeriodDays } from "@/lib/proPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR = "Leider hat der Checkout nicht funktioniert — probier es gleich nochmal";
const ACTIVE_STATUSES = new Set(["trialing", "active"]);

function getOrigin(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (env) return env.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

/**
 * POST /api/pro/checkout
 *
 * Creates a Stripe Subscription Checkout Session with a trial period that
 * ends at the public launch (1 July 2026) — so the customer's card is
 * collected today, and the first €24.90 is billed on launch day.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_RE.test(email) || email.length > 200) {
      return NextResponse.json({ error: "Bitte gib eine gültige Email-Adresse ein." }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRO_PRICE_ID) {
      // eslint-disable-next-line no-console
      console.error("[pro/checkout] Stripe env not configured");
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 503 });
    }

    const sb = getSupabaseAdmin();

    // 1. Look up any existing row before writing — refuse to start a *new*
    //    checkout if this email already has a live (trialing/active) subscription.
    //    We allow re-checkout for cancelled / past_due / pending so users can
    //    recover from abandonment or churn.
    const { data: existing, error: lookupErr } = await sb
      .from("pro_subscriptions")
      .select("id, status")
      .eq("email", email)
      .maybeSingle();

    if (lookupErr) {
      // eslint-disable-next-line no-console
      console.error("[pro/checkout] lookup error:", lookupErr.code, lookupErr.message);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    if (existing?.status && ACTIVE_STATUSES.has(existing.status)) {
      return NextResponse.json(
        { error: "Diese Email hat bereits eine aktive Mitgliedschaft." },
        { status: 409 },
      );
    }

    // 2. Insert (no row) or refresh the existing non-active row to pending.
    let rowId: string;
    if (!existing) {
      const { data: inserted, error: insertErr } = await sb
        .from("pro_subscriptions")
        .insert({
          email,
          status: "pending",
          stripe_price_id: process.env.STRIPE_PRO_PRICE_ID,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        // eslint-disable-next-line no-console
        console.error("[pro/checkout] insert error:", insertErr?.code, insertErr?.message);
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
      }
      rowId = inserted.id;
    } else {
      // Defense-in-depth: never overwrite a row that has turned active/trialing
      // between the lookup and this update (e.g. webhook races). We .select()
      // the affected row count and treat 0 rows as a lost race → return 409
      // instead of creating a duplicate Stripe Checkout Session.
      const { data: updatedRows, error: updErr } = await sb
        .from("pro_subscriptions")
        .update({
          status: "pending",
          stripe_price_id: process.env.STRIPE_PRO_PRICE_ID,
        })
        .eq("id", existing.id)
        .not("status", "in", "(trialing,active)")
        .select("id");

      if (updErr) {
        // eslint-disable-next-line no-console
        console.error("[pro/checkout] refresh error:", updErr.code, updErr.message);
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
      }
      if (!updatedRows || updatedRows.length === 0) {
        // Lost race: row is now trialing/active. Refuse like the initial guard.
        return NextResponse.json(
          { error: "Diese Email hat bereits eine aktive Mitgliedschaft." },
          { status: 409 },
        );
      }
      rowId = existing.id;
    }

    // 3. Compute trial days from now → 2026-07-01. 0 if launch is past.
    const trialDays = proTrialPeriodDays();

    const origin = getOrigin(req);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
      customer_email: email,
      // Always collect a payment method, even during trial — that's the whole
      // point of "card on file today, no charge until launch day".
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: trialDays > 0 ? trialDays : undefined,
        metadata: {
          feature: "pro_subscription",
          subscription_row_id: rowId,
        },
      },
      metadata: {
        feature: "pro_subscription",
        subscription_row_id: rowId,
      },
      success_url: `${origin}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pro/cancelled`,
      locale: "de",
    });

    if (!session.url) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pro/checkout] unexpected:", e);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
