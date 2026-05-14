// Source-agnostic continuous-CGM-readings helper.
//
// Returns CGM samples for a user across BOTH continuous-stream tables:
//   - cgm_samples            (LLU + Nightscout, written by */5min cron
//                             /api/cron/cgm-poll)
//   - apple_health_readings  (Apple Health, pushed from the iOS shell
//                             via /api/cgm/apple-health/sync)
//
// Callers (Insights, future Engine trend, weekly report, etc.) just
// ask `getCgmSamples(userId, fromMs, toMs)` and don't care which table
// the rows came from. The two sources can never overlap for the same
// user because Apple Health users are explicitly skipped by the cron
// (see lib/cgm/index.ts resolveSource() — Apple Health is set
// explicitly, the cron only polls llu/nightscout users).
//
// All values are returned as { v: mg/dL, t: ms-since-epoch } to match
// the BgReading shape used in app/(protected)/insights/page.tsx so
// callers can spread directly into existing reading arrays.

import { adminClient } from "./supabase";

export type ContinuousReading = { v: number; t: number };

/**
 * Pull every continuous CGM reading for a user in [fromMs, toMs).
 * Both sources are queried in parallel; results are merged and sorted
 * ascending by timestamp.
 *
 * Caps at 5_000 rows per source — 14 days × 288 readings/day ≈ 4_032,
 * so the cap covers the standard Insights window with headroom but
 * keeps a runaway query bounded if a future caller asks for "all of
 * 2027". Bump this if you start passing larger windows.
 */
export async function getCgmSamples(
  userId: string,
  fromMs: number,
  toMs: number,
): Promise<ContinuousReading[]> {
  if (!userId) return [];
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];

  const fromIso = new Date(fromMs).toISOString();
  const toIso   = new Date(toMs).toISOString();
  const admin   = adminClient();

  const [pollRes, hkRes] = await Promise.all([
    admin
      .from("cgm_samples")
      .select("timestamp, value_mgdl")
      .eq("user_id", userId)
      .gte("timestamp", fromIso)
      .lt("timestamp", toIso)
      .order("timestamp", { ascending: true })
      .limit(5000),
    admin
      .from("apple_health_readings")
      .select("timestamp, value_mg_dl")
      .eq("user_id", userId)
      .gte("timestamp", fromIso)
      .lt("timestamp", toIso)
      .order("timestamp", { ascending: true })
      .limit(5000),
  ]);

  const out: ContinuousReading[] = [];

  if (!pollRes.error && Array.isArray(pollRes.data)) {
    for (const r of pollRes.data as { timestamp: string; value_mgdl: number }[]) {
      const t = Date.parse(r.timestamp);
      const v = Number(r.value_mgdl);
      if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
      out.push({ v, t });
    }
  }
  if (!hkRes.error && Array.isArray(hkRes.data)) {
    for (const r of hkRes.data as { timestamp: string; value_mg_dl: number }[]) {
      const t = Date.parse(r.timestamp);
      const v = Number(r.value_mg_dl);
      if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) continue;
      out.push({ v, t });
    }
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}
