/**
 * CGM source dispatcher — picks the right adapter for a given user so the
 * rest of the app can stay source-agnostic. Today's sources:
 *   1. LibreLinkUp (lib/cgm/llu.ts) — direct LLU credentials in
 *      `cgm_credentials`. The original integration. Used by the
 *      cgm-jobs/process worker for post-meal BG follow-ups.
 *   2. Nightscout (lib/cgm/nightscout.ts) — open-source CGM platform
 *      proxying Dexcom / Libre / Accu-Chek. URL + token in `profiles`.
 *   3. (Junction/Vital lives separately in /api/cgm/glucose route — it
 *      uses Junction's hosted UI flow with a different shape and isn't
 *      part of this dispatcher today; the route handles its own dispatch.)
 *
 * Resolution rule (cheapest first): if the user has a non-null
 * `profiles.nightscout_url` we route to Nightscout; otherwise we fall back
 * to LLU. Nightscout wins because it's the user's explicit choice — they
 * had to type a URL in Settings, vs. LLU which may be lingering from an
 * earlier connection. Future preference column (`profiles.cgm_provider`)
 * could pin a choice, but with two sources the URL-presence check is
 * unambiguous and avoids an extra migration.
 */

import { adminClient } from "./supabase";
import * as llu from "./llu";
import * as nightscout from "./nightscout";
import type { Reading } from "./llu";

export type { Reading };
export type CgmSource = "llu" | "nightscout";

/**
 * Determine which CGM source a user is using. Returns "nightscout" if
 * their profile has nightscout_url set, else "llu" (the long-standing
 * default). Cheap single-row select; safe to call on hot paths.
 */
export async function resolveSource(userId: string): Promise<CgmSource> {
  const { data, error } = await adminClient()
    .from("profiles")
    .select("nightscout_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Don't block on profile-read failures — fall through to LLU which
    // will return its own clean error if not connected either.
    return "llu";
  }
  return data?.nightscout_url ? "nightscout" : "llu";
}

/**
 * Source-agnostic getHistory. Returns the same {current, history} shape
 * as both adapters. If the user is on Nightscout but the call fails
 * (timeout / 401 / 5xx), we DO NOT silently fall back to LLU — the user
 * picked Nightscout explicitly and silently using LLU could surface
 * stale or wrong-account data. Callers must surface the error.
 */
export async function getHistory(
  userId: string
): Promise<{ current: Reading | null; history: Reading[]; source: CgmSource }> {
  const source = await resolveSource(userId);
  if (source === "nightscout") {
    const r = await nightscout.getHistory(userId);
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
  const r = await llu.getLatest(userId);
  return { ...r, source };
}
