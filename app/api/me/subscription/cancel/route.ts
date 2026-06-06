/**
 * POST /api/me/subscription/cancel
 *
 * Cancels the user's Stripe subscription at period end (not immediately).
 * The user retains Pro access until current_period_end.
 *
 * Body (optional JSON):
 *   { reasons: string[], custom_text: string | null }
 *
 * Saves cancellation feedback to `cancellation_feedback` table (best-effort —
 * failure to save feedback does NOT block the actual cancellation).
 *
 * Returns: { ok: true, period_end: ISO string }
 *
 * Note: immediate cancellation is intentionally NOT supported here. Admins can
 * cancel immediately via /glev-ops/users (stripeActions.cancelStripeSubAction).
 *
 * Note: In Stripe v22 (API 2025-06-30), `current_period_end` is not a direct
 * top-level property; access it via type cast as the existing webhook routes do.
 *
 * Auth: cookie session (web) or Bearer token (native shells).
 */
import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/lib/api/authedClient";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripeServer";
import { writeAuditLog } from "@/lib/admin/audit";

type SubscriptionV1 = { current_period_end?: number };

export async function POST(req: NextRequest) {
  const a = await authedClient(req);
  if (!a.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userEmail = a.user.email?.toLowerCase();
  if (!userEmail) {
    return NextResponse.json({ error: "no_email" }, { status: 400 });
  }

  let reasons: string[] = [];
  let customText: string | null = null;
  try {
    const body = (await req.json()) as { reasons?: string[]; custom_text?: string | null };
    reasons = Array.isArray(body.reasons) ? body.reasons.slice(0, 10) : [];
    customText =
      typeof body.custom_text === "string" && body.custom_text.trim()
        ? body.custom_text.trim().slice(0, 2000)
        : null;
  } catch {
    /* body is optional */
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
    // In Stripe v22 (API 2025-06-30) current_period_end is not a direct top-level
    // property on Stripe.Subscription; use the same type cast as existing webhook routes.
    const before = (await stripe.subscriptions.retrieve(
      sub.stripe_subscription_id,
    )) as Awaited<ReturnType<typeof stripe.subscriptions.retrieve>> & SubscriptionV1;

    // Idempotent: if already cancelling, return success without duplicating feedback
    if (before.cancel_at_period_end) {
      const cpe = before.current_period_end;
      return NextResponse.json(
        {
          ok: true,
          already_cancelling: true,
          period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const after = (await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    })) as Awaited<ReturnType<typeof stripe.subscriptions.update>> & SubscriptionV1;

    const cpe = after.current_period_end;
    const periodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;

    // Best-effort: save cancellation feedback
    if (reasons.length > 0 || customText) {
      try {
        await admin
          .from("cancellation_feedback")
          .insert({ user_id: a.user.id, reasons, custom_text: customText });
      } catch (e) {
        console.warn("[cancel-sub] feedback insert failed:", e);
      }
    }

    // Best-effort: sync local pro_subscriptions row
    try {
      await admin
        .from("pro_subscriptions")
        .update({ status: "active" })
        .eq("stripe_subscription_id", sub.stripe_subscription_id);
    } catch (e) {
      console.warn("[cancel-sub] local sync failed:", e);
    }

    await writeAuditLog({
      action: "stripe_cancel_period_end",
      targetEmail: userEmail,
      before: { cancel_at_period_end: before.cancel_at_period_end, status: before.status },
      after: { cancel_at_period_end: after.cancel_at_period_end },
      note: `User-initiated cancel at period end. Reasons: ${reasons.join(", ") || "none"}`,
      adminToken: process.env.ADMIN_API_SECRET ?? "",
    }).catch((e) => console.warn("[cancel-sub] audit log failed:", e));

    return NextResponse.json(
      { ok: true, period_end: periodEnd },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/me/subscription/cancel] stripe error:", e);
    return NextResponse.json(
      { error: "stripe_error", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
