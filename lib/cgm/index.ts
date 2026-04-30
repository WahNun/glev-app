/**
 * CGM source dispatcher — picks the right adapter for a given user so the
 * rest of the app can stay source-agnostic. Today's sources:
 *   1. LibreLinkUp (lib/cgm/llu.ts) — direct LLU credentials in
 *      `cgm_credentials`. The original integration. Used by the
 *      cgm-jobs/process worker for post-meal BG follow-ups.
 *   2. Nightscout (lib/cgm/nightscout.ts) — open-source CGM platform
 *      proxying Dexcom / Libre / Accu-Chek. URL + token in `profiles`.
 *   3. Apple Health (lib/cgm/appleHealth.ts) — HealthKit samples synced
 *      from the iOS native shell into `apple_health_readings`. The
 *      backend can never reach a user's iPhone directly; the device
 *      pushes deltas via POST /api/cgm/apple-health/sync and this
 *      dispatcher reads them out of the cache.
 *   4. (Junction/Vital lives separately in /api/cgm/glucose route — it
 *      uses Junction's hosted UI flow with a different shape and isn't
 *      part of this dispatcher today; the route handles its own dispatch.)
 *
 * Resolution rule:
 *   1. If `profiles.cgm_source` is set explicitly to one of
 *      'llu' | 'nightscout' | 'apple_health', honour the user's pinned
 *      preference. This is the path Apple Health *must* take because it
 *      has no per-user credentials in `profiles` — there's nothing to
 *      auto-detect from.
 *   2. Otherwise (cgm_source is NULL — legacy users / pre-migration
 *      rows), fall back to the historical URL-presence rule: if the
 *      user has a non-null `profiles.nightscout_url` route to
 *      Nightscout, else LLU. This keeps existing users working
 *      untouched without forcing a backfill of the new column.
 */

import { adminClient } from "./supabase";
import * as llu from "./llu";
import * as nightscout from "./nightscout";
import * as appleHealth from "./appleHealth";
import type { Reading } from "./llu";

export type { Reading };
export type CgmSource = "llu" | "nightscout" | "apple_health";

const VALID_SOURCES = new Set<CgmSource>(["llu", "nightscout", "apple_health"]);

/**
 * Determine which CGM source a user is using. Cheap single-row select;
 * safe to call on hot paths.
 *
 * Order:
 *   1. Explicit `profiles.cgm_source` if it's one of the known values.
 *   2. Else legacy auto-detect: nightscout_url present → "nightscout",
 *      otherwise "llu".
 */
export async function resolveSource(userId: string): Promise<CgmSource> {
  const { data, error } = await adminClient()
    .from("profiles")
    .select("cgm_source, nightscout_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Don't block on profile-read failures — fall through to LLU which
    // will return its own clean error if not connected either.
    return "llu";
  }
  const explicit = data?.cgm_source as CgmSource | null | undefined;
  if (explicit && VALID_SOURCES.has(explicit)) return explicit;
  return data?.nightscout_url ? "nightscout" : "llu";
}

/**
 * Source-agnostic getHistory. Returns the same {current, history} shape
 * as all adapters. If the user is on Nightscout / Apple Health but the
 * call fails (timeout / 401 / 5xx / no cached readings), we DO NOT
 * silently fall back to LLU — the user picked the source explicitly and
 * silently using LLU could surface stale or wrong-account data. Callers
 * must surface the error.
 */
export async function getHistory(
  userId: string
): Promise<{ current: Reading | null; history: Reading[]; source: CgmSource }> {
  const source = await resolveSource(userId);
  if (source === "nightscout") {
    const r = await nightscout.getHistory(userId);
    return { ...r, source };
  }
  if (source === "apple_health") {
    const r = await appleHealth.getHistory(userId);
    return { ...r, source };
  }
  const r = await llu.getHistory(userId);
  return { ...r, source };
}

/**
 * Source-agnostic getLatest. Same dispatch rules as getHistory.
 */
export async function getLatest(
  userId: string
): Promise<{ current: Reading | null; source: CgmSource }> {
  const source = await resolveSource(userId);
  if (source === "nightscout") {
    const r = await nightscout.getLatest(userId);
    return { ...r, source };
  }
  if (source === "apple_health") {
    const r = await appleHealth.getLatest(userId);
    return { ...r, source };
  }
  const r = await llu.getLatest(userId);
  return { ...r, source };
}
