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
 * Trend: HealthKit has no trend / direction information — it is just a
 * stream of point-in-time samples. We return the neutral "stable" trend
 * value so the unified Reading type stays clean. The downstream UI
 * (CurrentDayGlucoseCard etc.) computes its own delta-based arrow from
 * the readings array, so the missing native trend is invisible to the
 * user.
 */

import { adminClient } from "./supabase";
import type { Reading } from "./llu";

/** Hot-path window for getHistory — matches the 12 h covered by the
 *  Nightscout adapter (see lib/cgm/nightscout.ts) so post-meal +1 h /
 *  +2 h CGM follow-ups always have enough rows to scan. */
const HISTORY_HOURS = 12;
const HISTORY_LIMIT = 200;

interface DbRow {
  value_mg_dl: number;
  timestamp: string;
}

function rowToReading(row: DbRow | null | undefined): Reading | null {
  if (!row) return null;
  return {
    value: row.value_mg_dl,
    unit: "mg/dL",
    timestamp: row.timestamp,
    // Apple Health blood-glucose samples carry no trend/direction;
    // emit the neutral value so the unified Reading shape is consistent
    // and the dashboard's delta-based arrow takes over.
    trend: "stable",
  };
}

export async function getLatest(
  userId: string
): Promise<{ current: Reading | null }> {
  const { data, error } = await adminClient()
    .from("apple_health_readings")
    .select("value_mg_dl, timestamp")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const e: Error & { upstream?: boolean; status?: number } = new Error(
      "supabase: " + error.message
    );
    e.upstream = true;
    e.status = 502;
    throw e;
  }
  return { current: rowToReading(data as DbRow | null) };
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
    .map((r) => rowToReading(r))
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
