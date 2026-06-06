/**
 * POST /api/me/subscription/apply-retention-trial
 *
 * Extends the trial_end of the user's Stripe subscription by 90 days.
 * If the subscription has no existing trial (trial_end is null/past), the
 * extension starts from now. If there is still an active trial, it extends
 * from the current trial_end.
 *
 * ONE-TIME GUARD: Stores `metadata.retention_trial_granted = "1"` on the
 * Stripe subscription after applying. If the flag already exists, the endpoint
 * returns { ok: true, already_applied: true } without modifying the subscription
 * again. This prevents users from stacking free months by calling the endpoint
 * repeatedly.
 *
 * Auth: cookie session (web) or Bearer token (native shells).
 */
import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/lib/api/authedClient";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripeServer";
import { writeAuditLog } from "@/lib/admin/audit";

const TRIAL_EXTENSION_DAYS = 90;
const RETENTION_TRIAL_META_KEY = "retention_trial_granted";

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
    const before = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

    // ONE-TIME GUARD: if retention trial was already granted, return early
    const alreadyGranted = before.metadata?.[RETENTION_TRIAL_META_KEY] === "1";
    if (alreadyGranted) {
      return NextResponse.json(
        { ok: true, already_applied: true },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const baseSec = Math.max(before.trial_end ?? 0, nowSec);
    const newTrialEnd = baseSec + TRIAL_EXTENSION_DAYS * 86_400;

    const after = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      trial_end: newTrialEnd,
      proration_behavior: "none",
      metadata: {
        ...before.metadata,
        [RETENTION_TRIAL_META_KEY]: "1",
      },
    });

    // Best-effort sync local row
    try {
      await admin
        .from("pro_subscriptions")
        .update({ trial_ends_at: new Date(newTrialEnd * 1000).toISOString() })
        .eq("stripe_subscription_id", sub.stripe_subscription_id);
    } catch (e) {
      console.warn("[retention-trial] local sync failed:", e);
    }

    await writeAuditLog({
      action: "stripe_retention_trial",
      targetEmail: userEmail,
      before: { trial_end: before.trial_end },
      after: { trial_end: after.trial_end },
      note: `Retention trial extended by ${TRIAL_EXTENSION_DAYS} days (user-initiated, one-time)`,
      adminToken: process.env.ADMIN_API_SECRET ?? "",
    }).catch((e) => console.warn("[retention-trial] audit log failed:", e));

    return NextResponse.json(
      {
        ok: true,
        trial_end: new Date(newTrialEnd * 1000).toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/me/subscription/apply-retention-trial] stripe error:", e);
    return NextResponse.json(
      { error: "stripe_error", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
