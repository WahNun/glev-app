// Cron worker — checks for drip opt-out spikes and emails the admin.
//
// Schedule expectation: once per day at 09:30 UTC (30 min after the drip
// send cron at 09:00), so fresh sends from the morning run are already
// counted in the 7-day window before we check. See vercel.json.
//
// Logic:
//   1. Fetch all sent drip rows + all unsubscribes from Supabase.
//   2. Run aggregateDripStats() — same helper the admin page uses.
//   3. Run findAlertableSpikes() to find types where the 7-day rate is
//      ≥ 2× the 30-day baseline AND the 7-day volume is ≥ 5 sends.
//   4. If any spikes found → send a single digest email to the admin
//      address via Resend. Silent on calm weeks (no email = no noise).
//
// Auth: Bearer CRON_SECRET — same pattern as /api/cron/drip.
//
// Response: { ok: true, alerts: <count>, spikes: [...] }
//
// Smoke-test (manual):
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "$APP_URL/api/cron/drip-spike-check"
//   → { ok: true, alerts: 0, spikes: [] }   (if no real spike data)

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  aggregateDripStats,
  findAlertableSpikes,
  type SentRow,
  type UnsubRow,
} from "@/lib/emails/drip-stats";
import {
  dripSpikeAlertHtml,
  dripSpikeAlertSubject,
  DRIP_ALERT_FROM,
  DRIP_ALERT_TO,
} from "@/lib/emails/drip-spike-alert";
import { getDripResend } from "@/lib/emails/drip-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    // eslint-disable-next-line no-console
    console.error(
      "[cron/drip-spike-check] CRON_SECRET not configured or too short (min 16 chars)",
    );
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return unauthorized();
  }

  const admin = getSupabaseAdmin();

  // 1. Fetch all sent drip rows (sent_at IS NOT NULL).
  //    We request only the fields aggregateDripStats() needs so the
  //    payload stays small even if email_drip_schedule grows large.
  const { data: sentData, error: sentErr } = await admin
    .from("email_drip_schedule")
    .select("email, email_type, sent_at")
    .not("sent_at", "is", null);

  if (sentErr) {
    // eslint-disable-next-line no-console
    console.error("[cron/drip-spike-check] sent-rows select failed:", sentErr);
    return NextResponse.json(
      { error: `sent-rows select failed: ${sentErr.message}` },
      { status: 500 },
    );
  }

  // 2. Fetch all unsubscribes.
  const { data: unsubData, error: unsubErr } = await admin
    .from("email_drip_unsubscribes")
    .select("email, unsubscribed_at");

  if (unsubErr) {
    // eslint-disable-next-line no-console
    console.error("[cron/drip-spike-check] unsubscribes select failed:", unsubErr);
    return NextResponse.json(
      { error: `unsubscribes select failed: ${unsubErr.message}` },
      { status: 500 },
    );
  }

  // 3. Aggregate + detect spikes.
  const stats = aggregateDripStats(
    (sentData ?? []) as SentRow[],
    (unsubData ?? []) as UnsubRow[],
  );
  const spikes = findAlertableSpikes(stats);

  if (spikes.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[cron/drip-spike-check] no spikes detected — no email sent");
    return NextResponse.json({ ok: true, alerts: 0, spikes: [] });
  }

  // 4. Send digest email.
  const checkedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const html = dripSpikeAlertHtml(spikes, checkedAt);
  const subject = dripSpikeAlertSubject(spikes.length);

  const resend = getDripResend();
  const { error: sendErr } = await resend.emails.send({
    from: DRIP_ALERT_FROM,
    to: DRIP_ALERT_TO,
    subject,
    html,
  });

  if (sendErr) {
    // eslint-disable-next-line no-console
    console.error("[cron/drip-spike-check] alert email send failed:", {
      spikes: spikes.map((s) => s.type),
      err: `${sendErr.name ?? "ResendError"}: ${sendErr.message ?? "unknown"}`,
    });
    return NextResponse.json(
      { error: `alert email send failed: ${sendErr.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // eslint-disable-next-line no-console
  console.log("[cron/drip-spike-check] alert sent:", {
    to: DRIP_ALERT_TO,
    alerts: spikes.length,
    spikes: spikes.map((s) => ({
      type: s.type,
      rate7d: `${(s.rate7d * 100).toFixed(1)}%`,
      rate30d: `${(s.rate30d * 100).toFixed(1)}%`,
      ratio: Number.isFinite(s.ratio) ? `${s.ratio.toFixed(1)}×` : "∞×",
    })),
  });

  return NextResponse.json({ ok: true, alerts: spikes.length, spikes });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
