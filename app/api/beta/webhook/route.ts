import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/beta/webhook — DEPRECATED (410 Gone)
 *
 * Replaced by `/api/webhooks/stripe`, which is now the single beta webhook
 * and handles BOTH:
 *   - flipping `beta_reservations.status` from `pending` → `paid`
 *   - upserting `profiles.subscription_status` to `beta`
 *   - sending the welcome email (with the resume `/welcome?session_id=…` link)
 *
 * If you see this 410 in deployment logs, the Stripe Dashboard webhook is
 * still pointing at the old endpoint. Reconfigure it to:
 *
 *   POST {ORIGIN}/api/webhooks/stripe
 *
 * with signing secret `STRIPE_BETA_WEBHOOK_SECRET`.
 *
 * We deliberately return 410 (not 404) so the misconfiguration surfaces
 * clearly in Stripe's webhook delivery log instead of silently 404-ing.
 */
export async function POST(req: NextRequest) {
  // eslint-disable-next-line no-console
  console.warn(
    "[beta/webhook] deprecated endpoint hit — Stripe should be reconfigured to /api/webhooks/stripe",
    {
      ua: req.headers.get("user-agent") ?? null,
      hasSig: Boolean(req.headers.get("stripe-signature")),
    },
  );
  return NextResponse.json(
    {
      error:
        "deprecated_endpoint: this webhook has been retired. Reconfigure Stripe to POST to /api/webhooks/stripe (secret: STRIPE_BETA_WEBHOOK_SECRET).",
    },
    { status: 410 },
  );
}
