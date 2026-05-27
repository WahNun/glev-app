/**
 * GET /api/cgm/nightscout/cron
 *
 * Vercel Cron job (every 10 min) that fetches the last 30 readings from
 * every user's Nightscout instance and upserts them into nightscout_readings.
 * Post-meal CGM values (+30min, +1h, +2h, +3h) are then available even when
 * the user has the Glev app closed.
 *
 * Auth: Bearer CRON_SECRET (same secret used by flush-outbox + cgm-jobs-flush).
 */
import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/cgm/supabase";
import { decrypt } from "@/lib/cgm/crypto";
import { fillNearbyChecks } from "@/lib/mealTimelineChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDecrypt(payload: string): string | null {
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

interface ProfileRow {
  user_id: string;
  nightscout_url: string | null;
  nightscout_token_enc: string | null;
}

interface NsEntry {
  sgv?: number;
  date?: number;
  direction?: string;
}

export type NightscoutRow = {
  user_id: string;
  recorded_at: string;
  value_mgdl: number;
  direction: string | null;
  source: string;
};

/**
 * Upserts pre-fetched Nightscout rows into `nightscout_readings` and, on
 * success, fires `fillFn` (default: `fillNearbyChecks`) for each row.
 *
 * Extracted so the upsert + fill behaviour can be unit-tested without
 * spinning up a real Supabase instance or a real Nightscout server.
 */
export async function upsertAndFillNightscoutRows(
  admin: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  rows: NightscoutRow[],
  fillFn: typeof fillNearbyChecks = fillNearbyChecks,
): Promise<{ ok: boolean; error?: string }> {
  const { error: upsertErr } = await admin
    .from("nightscout_readings")
    .upsert(rows, { onConflict: "user_id,recorded_at" });

  if (upsertErr) {
    return { ok: false, error: upsertErr.message };
  }

  for (const row of rows) {
    fillFn(admin, userId, row.value_mgdl, new Date(row.recorded_at)).catch(() => {});
  }
  return { ok: true };
}

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

  const admin = adminClient();

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("user_id, nightscout_url, nightscout_token_enc")
    .not("nightscout_url", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { success: 0, failed: 0, skipped: 0 };

  for (const profile of (profiles ?? []) as ProfileRow[]) {
    if (!profile.nightscout_url) { results.skipped++; continue; }

    try {
      const nsToken = profile.nightscout_token_enc
        ? safeDecrypt(profile.nightscout_token_enc)
        : null;
      const baseUrl = profile.nightscout_url.replace(/\/+$/, "");
      const url = new URL(baseUrl + "/api/v1/entries.json");
      url.searchParams.set("count", "30");
      if (nsToken) url.searchParams.set("token", nsToken);

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) { results.failed++; continue; }

      const entries = (await res.json().catch(() => null)) as NsEntry[] | null;
      if (!Array.isArray(entries)) { results.skipped++; continue; }

      const rows = entries
        .filter((e) => typeof e.sgv === "number" && e.date)
        .map((e) => ({
          user_id: profile.user_id,
          recorded_at: new Date(e.date!).toISOString(),
          value_mgdl: e.sgv as number,
          direction: e.direction ?? null,
          source: "nightscout",
        }));

      if (rows.length === 0) { results.skipped++; continue; }

      const result = await upsertAndFillNightscoutRows(admin, profile.user_id, rows);
      if (!result.ok) {
        console.error("[nightscout/cron] upsert failed for", profile.user_id, result.error);
        results.failed++;
      } else {
        results.success++;
      }
    } catch (e) {
      console.error("[nightscout/cron] error for", profile.user_id, (e as Error).message);
      results.failed++;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
