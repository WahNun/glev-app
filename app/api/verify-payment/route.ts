import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripeServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/verify-payment?session_id=…
 *
 * Used by /welcome to confirm the buyer actually completed Stripe Checkout
 * before letting them set a password. Stripe keeps `checkout.session`
 * objects retrievable for a long time after creation (well beyond a single
 * tab session), so this endpoint MUST keep working hours/days later when
 * the buyer comes back via the email resume link.
 *
 * Distinct `reason` values let the client show targeted copy:
 *   - missing_session_id → no session_id query param
 *   - not_found          → Stripe doesn't know this id (typo / wrong env)
 *   - not_paid           → session exists but payment_status != "paid"
 *                          (e.g. user closed Stripe Checkout before paying)
 *   - retrieve_failed    → unexpected Stripe error
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json(
      { valid: false, reason: "missing_session_id" },
      { status: 400 },
    );
  }

  let session: Stripe.Checkout.Session;
  try {
    const stripe = getStripe();
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (e) {
    // Stripe-level "no such checkout.session" comes back as a
    // StripeInvalidRequestError with code "resource_missing". Surface
    // it as not_found so the UI can show "Session abgelaufen / nicht
    // gefunden — bitte hello@glev.app kontaktieren" instead of the
    // generic "kein gültiger Beta-Zugang".
    const err = e as { type?: string; code?: string; message?: string };
    if (err?.code === "resource_missing") {
      // eslint-disable-next-line no-console
      console.warn("[verify-payment] session not found:", sessionId, err.message);
      return NextResponse.json(
        { valid: false, reason: "not_found" },
        { status: 404 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[verify-payment] retrieve failed:", { sessionId, err });
    return NextResponse.json(
      { valid: false, reason: "retrieve_failed" },
      { status: 502 },
    );
  }

  const email =
    (typeof session.customer_email === "string" && session.customer_email) ||
    (typeof session.customer_details?.email === "string" &&
      session.customer_details.email) ||
    null;

  // Two valid shapes — both emit a `kind` so consumers can narrow:
  //
  //   1. "paid" — immediate charge succeeded. Beta uses this (setup-fee
  //      line item charges day 1). A post-launch Pro subscription with no
  //      trial would also land here.
  //
  //   2. "subscription_trial" — mode === "subscription", payment_status
  //      "no_payment_required", and a subscription was created. Pro pre-
  //      launch trial uses this (card on file, no charge until trial end).
  //
  // We *also* surface `feature` (read from session.metadata.feature, which
  // /api/checkout/pro and /api/pro/checkout both stamp as "pro_subscription").
  // That tag — not just `kind` — is how /pro/success and /welcome refuse the
  // other flow's session. `kind` alone is ambiguous post-launch: a paid Pro
  // sub and a paid Beta sub both look like "paid".
  //
  // Anything else (open / unpaid / expired) → `not_paid`.
  const paid = session.payment_status === "paid";
  const subscriptionTrial =
    session.mode === "subscription" &&
    session.payment_status === "no_payment_required" &&
    Boolean(session.subscription);

  if (!paid && !subscriptionTrial) {
    return NextResponse.json(
      {
        valid: false,
        reason: "not_paid",
        payment_status: session.payment_status,
        email,
      },
      { status: 200 },
    );
  }

  const kind: "paid" | "subscription_trial" = paid ? "paid" : "subscription_trial";
  const feature =
    typeof session.metadata?.feature === "string" ? session.metadata.feature : null;

  return NextResponse.json({ valid: true, email, kind, feature });
}
