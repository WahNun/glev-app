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

  if (session.payment_status !== "paid") {
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

  return NextResponse.json({ valid: true, email });
}
