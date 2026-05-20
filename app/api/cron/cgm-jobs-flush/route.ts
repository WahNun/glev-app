import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/cron/cgm-jobs-flush
 *
 * Server-side cron that processes pending cgm_fetch_jobs for ALL users whose
 * fetch_time is now in the past — without requiring an open browser tab.
 *
 * Flow:
 *   1. Auth via Bearer CRON_SECRET (same secret used by flush-outbox cron).
 *   2. Query distinct user_ids with pending, due jobs.
 *   3. For each user, hit /api/cgm-jobs/process?userId=xxx with the same
 *      Bearer token so the existing processing logic runs unchanged.
 *
 * GitHub Actions calls this endpoint every 5 min via
 * .github/workflows/cgm-jobs-flush.yml.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 16) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // Find all distinct user_ids that have at least one pending job due now.
  // Cap at 100 users per run to keep the Vercel function within timeout.
  const { data: rows, error } = await admin
    .from("cgm_fetch_jobs")
    .select("user_id")
    .eq("status", "pending")
    .lte("fetch_time", nowIso)
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = [
    ...new Set(
      (rows ?? [])
        .map((r: { user_id: string }) => r.user_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  if (userIds.length === 0) {
    return NextResponse.json({ processed: 0, users: 0 });
  }

  // Determine the base URL: prefer the canonical prod domain, fall back to
  // VERCEL_URL (set automatically by Vercel on preview deployments), then
  // the request's own origin so this works in Replit dev too.
  const vercelUrl = process.env.VERCEL_URL;
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (vercelUrl ? `https://${vercelUrl}` : null) ??
    req.nextUrl.origin;

  const results: Array<{ userId: string; status: number }> = [];

  // Process users sequentially to avoid hammering the DB / CGM APIs in
  // parallel — each call is already fast (single user, capped at 50 jobs).
  for (const userId of userIds) {
    try {
      const url = `${origin}/api/cgm-jobs/process?userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cronSecret}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(25_000),
      });
      results.push({ userId, status: res.status });
    } catch (e) {
      results.push({ userId, status: 0 });
      console.error("[cgm-jobs-flush] user", userId, "failed:", e);
    }
  }

  const ok = results.filter((r) => r.status === 200).length;
  const failed = results.filter((r) => r.status !== 200).length;

  return NextResponse.json({
    users: userIds.length,
    processed: ok,
    failed,
  });
}
