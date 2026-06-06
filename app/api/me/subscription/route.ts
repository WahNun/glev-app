/**
 * GET /api/me/subscription
 *
 * Returns the current Stripe subscription details for the signed-in user:
 *   { status, current_period_end, cancel_at_period_end, subscription_id }
 *
 * Lookup path:
 *   1. Resolve user email from session.
 *   2. Find the most recent `pro_subscriptions` row with a stripe_subscription_id.
 *   3. Retrieve the live subscription object from Stripe (no caching — always fresh).
 *
 * Returns 404 when no subscription is found (free / beta users).
 * Returns 502 if the Stripe retrieve call fails.
 *
 * Note: In Stripe v22 (API 2025-06-30) `current_period_end` is no longer a
 * top-level property on Stripe.Subscription; access it via type-cast as done
 * in the existing webhook routes (`as unknown as { current_period_end?: number }`).
 *
 * Auth: cookie session (web) or Bearer token (native shells).
 */
import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/lib/api/authedClient";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripeServer";

type SubscriptionV1 = { current_period_end?: number; cancel_at_period_end?: boolean };

export async function GET(req: NextRequest) {
  const a = await authedClient(req);
  if (!a.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userEmail = a.user.email?.toLowerCase();
  if (!userEmail) {
    return NextResponse.json({ error: "no_email" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: sub, error } = await admin
    .from("pro_subscriptions")
    .select("stripe_subscription_id, status, current_period_end")
    .eq("email", userEmail)
    .not("stripe_subscription_id", "is", null)
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (error || !sub?.stripe_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }

  try {
    const stripe = getStripe();
    const raw = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const stripeSub = raw as typeof raw & SubscriptionV1;
    const cpe = stripeSub.current_period_end;
    return NextResponse.json(
      {
        status: raw.status,
        current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
        cancel_at_period_end: stripeSub.cancel_at_period_end ?? raw.cancel_at_period_end ?? false,
        subscription_id: sub.stripe_subscription_id,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/me/subscription] stripe retrieve failed:", e);
    return NextResponse.json(
      { error: "stripe_error", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
