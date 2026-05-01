/**
 * Apple Health (HealthKit) CGM adapter — third source alongside
 * lib/cgm/llu.ts (LibreLinkUp) and lib/cgm/nightscout.ts (Nightscout).
 *
 * Architecture note: Apple HealthKit can ONLY be read on-device through
 * the Capacitor bridge — Apple does not expose HealthKit to a backend.
 * The iOS native shell (capacitor.config.ts → server.url = glev.app)
 * therefore pushes the user's blood-glucose samples to
 * `apple_health_readings` via POST /api/cgm/apple-health/sync. This
 * adapter then reads from that cache so the engine + post-meal CGM
 * follow-up jobs work the same way they do for Nightscout / LLU.
 *
 * Public API mirrors lib/cgm/llu.ts so lib/cgm/index.ts can dispatch
 * uniformly:
 *   getLatest(userId)  → { current: Reading | null }
 *   getHistory(userId) → { current: Reading | null, history: Reading[] }
 *
 * Trend: HealthKit blood-glucose samples carry no native trend field —
 * they are just point-in-time values. To bring visual parity with LLU
 * and Nightscout (which both surface a per-reading trend arrow) we
 * derive the trend ourselves by comparing each sample against the
 * closest older sample within a 5–20 min window and bucketing the
 * mg/dL-per-minute slope into the same vocabulary used elsewhere
 * (fallingQuickly / falling / stable / rising / risingQuickly).
 */

import { adminClient } from "./supabase";
import type { Reading } from "./llu";

/** Hot-path window for getHistory — matches the 12 h covered by the
 *  Nightscout adapter (see lib/cgm/nightscout.ts) so post-meal +1 h /
 *  +2 h CGM follow-ups always have enough rows to scan. */
const HISTORY_HOURS = 12;
const HISTORY_LIMIT = 200;

/** How many rows getLatest pulls so it has enough context to derive a
 *  trend for the freshest sample. CGMs typically emit one reading every
 *  5 min, so 4 rows comfortably covers the 5–20 min slope window below. */
const LATEST_LOOKBACK_ROWS = 4;

// ---------------------------------------------------------------------------
// Trend derivation
// ---------------------------------------------------------------------------
// Standard CGM convention (Dexcom-style): bucket the slope in
// mg/dL/min between the current sample and the closest older sample
// within a small time window. We require ≥ MIN_GAP between the two
// samples so a noisy back-to-back pair does not invent a "rising
// quickly" out of a 30-second jitter, and we cap the lookback at
// MAX_GAP so a long sensor outage doesn't average out an actually-
// fast trend over a stale baseline.
const TREND_MIN_GAP_MS = 5 * 60 * 1000;
const TREND_MAX_GAP_MS = 20 * 60 * 1000;
const TREND_FLAT_MAX_RATE = 1; // |slope| < 1 mg/dL/min  → stable
const TREND_QUICK_MIN_RATE = 2; // |slope| ≥ 2 mg/dL/min → *Quickly

interface DbRow {
  value_mg_dl: number;
  timestamp: string;
}

/** Pick the trend for `rows[index]` by looking at strictly older samples
 *  (i.e. higher indices, since the array is sorted newest-first) and
 *  using the first one that is at least TREND_MIN_GAP_MS away. Older
 *  samples beyond TREND_MAX_GAP_MS are ignored — at that point we'd
 *  rather render "stable" than back-date a stale slope onto a fresh
 *  reading. */
function deriveTrend(rows: DbRow[], index: number): string {
  const cur = rows[index];
  if (!cur) return "stable";
  const tCur = Date.parse(cur.timestamp);
  if (Number.isNaN(tCur)) return "stable";

  for (let i = index + 1; i < rows.length; i++) {
    const prev = rows[i];
    const tPrev = Date.parse(prev.timestamp);
    if (Number.isNaN(tPrev)) continue;
    const gap = tCur - tPrev;
    if (gap < TREND_MIN_GAP_MS) continue;
    if (gap > TREND_MAX_GAP_MS) return "stable";
    const ratePerMin = (cur.value_mg_dl - prev.value_mg_dl) / (gap / 60_000);
    const abs = Math.abs(ratePerMin);
    if (abs < TREND_FLAT_MAX_RATE) return "stable";
    if (ratePerMin > 0) {
      return abs >= TREND_QUICK_MIN_RATE ? "risingQuickly" : "rising";
    }
    return abs >= TREND_QUICK_MIN_RATE ? "fallingQuickly" : "falling";
  }
  return "stable";
}

function rowToReading(
  row: DbRow | null | undefined,
  trend: string
): Reading | null {
  if (!row) return null;
  return {
    value: row.value_mg_dl,
    unit: "mg/dL",
    timestamp: row.timestamp,
    trend,
  };
}

export async function getLatest(
  userId: string
): Promise<{ current: Reading | null }> {
  // Pull a small lookback window — even though only the freshest row
  // is returned, deriveTrend needs the next-older sample(s) to compute
  // the slope for the trend arrow.
  const { data, error } = await adminClient()
    .from("apple_health_readings")
    .select("value_mg_dl, timestamp")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(LATEST_LOOKBACK_ROWS);
  if (error) {
    const e: Error & { upstream?: boolean; status?: number } = new Error(
      "supabase: " + error.message
    );
    e.upstream = true;
    e.status = 502;
    throw e;
  }
  const rows = (data ?? []) as DbRow[];
  if (rows.length === 0) return { current: null };
  return { current: rowToReading(rows[0], deriveTrend(rows, 0)) };
}

export async function getHistory(
  userId: string
): Promise<{ current: Reading | null; history: Reading[] }> {
  const sinceIso = new Date(
    Date.now() - HISTORY_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await adminClient()
    .from("apple_health_readings")
    .select("value_mg_dl, timestamp")
    .eq("user_id", userId)
    .gte("timestamp", sinceIso)
    .order("timestamp", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) {
    const e: Error & { upstream?: boolean; status?: number } = new Error(
      "supabase: " + error.message
    );
    e.upstream = true;
    e.status = 502;
    throw e;
  }

  const rows = (data ?? []) as DbRow[];
  const history = rows
    .map((r, i) => rowToReading(r, deriveTrend(rows, i)))
    .filter((x): x is Reading => x !== null);

  return {
    current: history[0] ?? null,
    history,
  };
}

/**
 * Convenience helper for the Settings card — returns "do we have any
 * cached readings yet?" plus the freshest timestamp / value, without
 * forcing the dispatcher's source-resolution roundtrip. Cheap single
 * row select.
 */
export async function getSyncStatus(
  userId: string
): Promise<{
  count: number;
  lastTimestamp: string | null;
  lastValueMgDl: number | null;
}> {
  const sb = adminClient();

  const [countRes, latestRes] = await Promise.all([
    sb
      .from("apple_health_readings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    sb
      .from("apple_health_readings")
      .select("value_mg_dl, timestamp")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Surface DB errors instead of silently returning a "0 readings"
  // payload — the route helper turns these into a 502 so the Settings
  // card can render a real error state instead of pretending the
  // user's Apple Health cache is empty.
  if (countRes.error) {
    const e: Error & { upstream?: boolean; status?: number } = new Error(
      "supabase: " + countRes.error.message
    );
    e.upstream = true;
    e.status = 502;
    throw e;
  }
  if (latestRes.error) {
    const e: Error & { upstream?: boolean; status?: number } = new Error(
      "supabase: " + latestRes.error.message
    );
    e.upstream = true;
    e.status = 502;
    throw e;
  }

  const row = latestRes.data as DbRow | null;
  return {
    count: countRes.count ?? 0,
    lastTimestamp: row?.timestamp ?? null,
    lastValueMgDl: row?.value_mg_dl ?? null,
  };
}
