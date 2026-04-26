import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripeServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ valid: false, reason: "missing_session_id" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const valid = session.payment_status === "paid";
    const email =
      (typeof session.customer_email === "string" && session.customer_email) ||
      (typeof session.customer_details?.email === "string" && session.customer_details.email) ||
      null;
    return NextResponse.json({ valid, email });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[verify-payment] retrieve failed:", e);
    return NextResponse.json({ valid: false, reason: "retrieve_failed" }, { status: 400 });
  }
}
