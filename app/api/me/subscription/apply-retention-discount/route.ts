/**
 * POST /api/me/subscription/apply-retention-discount
 *
 * Applies the retention discount coupon `GLEV_RETENTION_20` to the user's
 * active Stripe subscription. This gives the user a 20% discount on their
 * next billing period.
 *
 * IMPORTANT: The coupon `GLEV_RETENTION_20` must be created manually in the
 * Stripe Dashboard before this endpoint will work. Steps:
 *   1. Stripe Dashboard → Products → Coupons → "Create coupon"
 *   2. ID: GLEV_RETENTION_20
 *   3. Type: Percentage discount, 20%
 *   4. Duration: Once (applies to the next invoice only)
 *   5. Do NOT set a max redemption limit (or set it high — one per user)
 *
 * Note: In Stripe v22 (API 2025-06-30), applying a coupon uses
 * `discounts: [{ coupon: ID }]` not the legacy `coupon` top-level param.
 * Reading the applied discount uses `sub.discounts[0]`.
 *
 * Idempotent: if the coupon is already applied, returns { ok: true, already_applied: true }.
 *
 * Auth: cookie session (web) or Bearer token (native shells).
 */
import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/lib/api/authedClient";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripeServer";
import { writeAuditLog } from "@/lib/admin/audit";
import type Stripe from "stripe";

const RETENTION_COUPON = "GLEV_RETENTION_20";

type SubWithDiscounts = { discounts?: Array<{ coupon?: { id?: string } }> };

function getFirstCouponId(sub: Stripe.Subscription & SubWithDiscounts): string | null {
  const d = sub.discounts;
  if (Array.isArray(d) && d.length > 0) {
    return d[0]?.coupon?.id ?? null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const a = await authedClient(req);
  if (!a.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userEmail = a.user.email?.toLowerCase();
  if (!userEmail) {
    return NextResponse.json({ error: "no_email" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: sub } = await admin
    .from("pro_subscriptions")
    .select("stripe_subscription_id")
    .eq("email", userEmail)
    .not("stripe_subscription_id", "is", null)
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 404 });
  }

  try {
    const stripe = getStripe();
    const before = (await stripe.subscriptions.retrieve(sub.stripe_subscription_id)) as Stripe.Subscription & SubWithDiscounts;

    // Idempotency: if the coupon is already applied, return ok without re-applying
    const existingCoupon = getFirstCouponId(before);
    if (existingCoupon === RETENTION_COUPON) {
      return NextResponse.json({ ok: true, already_applied: true });
    }

    // Stripe v22: apply discount via `discounts` array
    const after = (await stripe.subscriptions.update(sub.stripe_subscription_id, {
      discounts: [{ coupon: RETENTION_COUPON }],
    })) as Stripe.Subscription & SubWithDiscounts;

    await writeAuditLog({
      action: "stripe_retention_discount",
      targetEmail: userEmail,
      before: { coupon: existingCoupon },
      after: { coupon: getFirstCouponId(after) },
      note: `Retention coupon ${RETENTION_COUPON} applied by user`,
      adminToken: process.env.ADMIN_API_SECRET ?? "",
    }).catch((e) => console.warn("[retention-discount] audit log failed:", e));

    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[api/me/subscription/apply-retention-discount] stripe error:", e);
    return NextResponse.json(
      { error: "stripe_error", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
