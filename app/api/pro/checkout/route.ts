import { NextRequest, NextResponse } from "next/server";
import { classifyCheckoutError, getStripe } from "@/lib/stripeServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { proTrialPeriodDays } from "@/lib/proPlan";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR = "Leider hat der Checkout nicht funktioniert — probier es gleich nochmal";
const ACTIVE_STATUSES = new Set(["trialing", "active"]);

/**
 * Roll back a freshly-created `pending` subscription row to `cancelled` after
 * Stripe rejects the session create. The `eq("status", "pending")` guard is
 * defense-in-depth: if a webhook for a *prior* successful checkout for the
 * same email lands between our update and this rollback, we must not touch a
 * row that has since flipped to `trialing`/`active`. Best-effort — failure to
 * rollback is logged but does not change the user-visible response.
 */
async function rollbackPendingSubscription(
  sb: SupabaseClient,
  rowId: string,
): Promise<void> {
  try {
    const { error } = await sb
      .from("pro_subscriptions")
      .update({ status: "cancelled" })
      .eq("id", rowId)
      .eq("status", "pending");
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[pro/checkout] rollback failed:", error.code, error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pro/checkout] rollback threw:", e);
  }
}

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

    // From here on, the row in `pro_subscriptions` is `pending`. Any failure
    // path below MUST roll it back to `cancelled` — `email` is unique, so a
    // stale pending row blocks the user from retrying with the same address
    // (insert path returns a duplicate-key error masked as GENERIC_ERROR).
    let session;
    try {
      session = await stripe.checkout.sessions.create({
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
    } catch (stripeErr) {
      // Full Stripe error (with code/param/request_id) is logged for ops.
      // The user gets a category-specific message via classifyCheckoutError,
      // not the generic "try again" — config errors don't fix themselves.
      // eslint-disable-next-line no-console
      console.error("[pro/checkout] stripe error:", stripeErr);
      await rollbackPendingSubscription(sb, rowId);
      const { userError, status } = classifyCheckoutError(stripeErr);
      return NextResponse.json({ error: userError }, { status });
    }

    if (!session.url) {
      // eslint-disable-next-line no-console
      console.error("[pro/checkout] session.url missing for session", session.id);
      await rollbackPendingSubscription(sb, rowId);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    // Last-line catch — any unexpected throw before/after the Stripe try/catch
    // (e.g. supabase admin client init blowing up). Inner branches handle the
    // common failure modes and roll back the pending row themselves.
    // eslint-disable-next-line no-console
    console.error("[pro/checkout] unexpected:", e);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
