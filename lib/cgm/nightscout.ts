/**
 * Nightscout CGM adapter — second CGM source alongside LibreLinkUp (llu.ts)
 * and LibreView-via-Junction. Nightscout is an open-source self-hosted CGM
 * platform that proxies Dexcom, FreeStyle Libre, Accu-Chek SmartGuide and
 * others, so adding this one integration covers virtually all major CGMs
 * without device-specific APIs.
 *
 * Public API mirrors lib/cgm/llu.ts so lib/cgm/index.ts can dispatch
 * uniformly:
 *   getCredentials(userId) → { url, token | null } | null
 *   setCredentials(userId, { url, token }) → void
 *   clearCredentials(userId) → void
 *   verifyCredentials(url, token) → quick test fetch (throws on failure)
 *   getLatest(userId)  → { current: Reading | null }
 *   getHistory(userId) → { current: Reading | null, history: Reading[] }
 *
 * Storage: profiles.nightscout_url (plain) + profiles.nightscout_token_enc
 * (AES-256-GCM via lib/cgm/crypto.ts, same key as cgm_credentials.
 * llu_password_encrypted). URL is plain because it isn't a secret on its
 * own and matches the llu_email plain-text pattern. Token can be NULL —
 * the public test instance https://cgm-remote-monitor.nightscout.me works
 * unauthenticated.
 *
 * Wire format: GET {baseUrl}/api/v1/entries.json?count={n}[&token={token}]
 * → array of entries shaped { sgv, date, direction, ... } in DESCENDING
 * date order. We map sgv→Reading.value (already mg/dL — Nightscout stores
 * SGV in mg/dL globally even when the user's profile shows mmol/L) and
 * normalize the trend arrow strings to LLU's vocabulary so the rest of
 * the app sees one unified Reading shape regardless of source.
 */

import { encrypt, decrypt } from "./crypto";
import { adminClient } from "./supabase";
import type { Reading } from "./llu";

// ---------------------------------------------------------------------------
// Trend normalization
// ---------------------------------------------------------------------------
// Nightscout direction strings (per upstream OpenAPS / xDrip+ convention)
// → LLU's TREND vocabulary used everywhere else in Glev. Keeps the source
// badge UI from having to special-case Nightscout values.
const NS_TREND_MAP: Record<string, string> = {
  DoubleUp:        "risingQuickly",
  SingleUp:        "rising",
  FortyFiveUp:     "rising",
  Flat:            "stable",
  FortyFiveDown:   "falling",
  SingleDown:      "falling",
  DoubleDown:      "fallingQuickly",
  "NOT COMPUTABLE": "stable",
  "NOT_COMPUTABLE": "stable",
  NONE:            "stable",
};

function mapTrend(raw: string | null | undefined): string {
  if (!raw) return "stable";
  return NS_TREND_MAP[raw] || "stable";
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface NightscoutCreds {
  url: string;
  token: string | null;
}

export async function getCredentials(
  userId: string
): Promise<NightscoutCreds | null> {
  const { data, error } = await adminClient()
    .from("profiles")
    .select("nightscout_url, nightscout_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("supabase: " + error.message);
  if (!data?.nightscout_url) return null;
  const token = data.nightscout_token_enc
    ? safeDecrypt(data.nightscout_token_enc)
    : null;
  return { url: data.nightscout_url, token };
}

function safeDecrypt(payload: string): string | null {
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

export async function setCredentials(
  userId: string,
  args: { url: string; token?: string | null }
): Promise<void> {
  const url = (args.url || "").trim().replace(/\/+$/, "");
  if (!url || !/^https?:\/\//i.test(url)) {
    const e: Error & { status?: number } = new Error(
      "nightscout url must start with http:// or https://"
    );
    e.status = 400;
    throw e;
  }
  const tokenRaw = args.token == null ? null : String(args.token).trim();
  const tokenEnc = tokenRaw ? encrypt(tokenRaw) : null;

  const { error } = await adminClient()
    .from("profiles")
    .update({
      nightscout_url: url,
      nightscout_token_enc: tokenEnc,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
}

export async function clearCredentials(userId: string): Promise<void> {
  const { error } = await adminClient()
    .from("profiles")
    .update({
      nightscout_url: null,
      nightscout_token_enc: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
}

// ---------------------------------------------------------------------------
// Upstream fetch
// ---------------------------------------------------------------------------

interface NsEntry {
  sgv?: number;
  date?: number;        // ms epoch
  dateString?: string;  // ISO
  direction?: string;
  type?: string;
}

function entriesUrl(baseUrl: string, token: string | null, count: number): string {
  const u = new URL(baseUrl.replace(/\/+$/, "") + "/api/v1/entries.json");
  u.searchParams.set("count", String(count));
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

async function fetchEntries(
  baseUrl: string,
  token: string | null,
  count: number
): Promise<NsEntry[]> {
  const url = entriesUrl(baseUrl, token, count);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Nightscout instances on free hosts (Heroku, Fly) can be slow on
      // cold start. 12s is comfortably under our route's 30s soft limit.
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      const t: Error & { upstream?: boolean } = new Error("nightscout timeout");
      t.upstream = true;
      throw t;
    }
    throw e;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const e: Error & { upstream?: boolean; status?: number } = new Error(
      `nightscout ${res.status}${body ? ": " + body.slice(0, 120) : ""}`
    );
    e.upstream = true;
    e.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw e;
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(json)) return [];
  return json as NsEntry[];
}

function mapEntry(e: NsEntry): Reading | null {
  if (typeof e.sgv !== "number" || !Number.isFinite(e.sgv)) return null;
  let timestamp: string | null = null;
  if (e.dateString) {
    timestamp = e.dateString;
  } else if (typeof e.date === "number") {
    timestamp = new Date(e.date).toISOString();
  }
  return {
    value: e.sgv,
    unit: "mg/dL",
    timestamp,
    trend: mapTrend(e.direction),
  };
}

// ---------------------------------------------------------------------------
// Public verify / read API
// ---------------------------------------------------------------------------

/**
 * Quick test fetch used by the Settings page "Verbinden"-Button BEFORE
 * persisting. Throws with `.status = 401` on auth failure so the route
 * can map to a 401 the way LLU's verifyCredentials does. Returns the
 * latest reading so the UI can show "✓ Verbunden — letzter Wert: X mg/dL"
 * immediately.
 */
export async function verifyCredentials(
  url: string,
  token: string | null
): Promise<{ current: Reading | null }> {
  const cleanUrl = (url || "").trim().replace(/\/+$/, "");
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    const e: Error & { status?: number } = new Error(
      "nightscout url must start with http:// or https://"
    );
    e.status = 400;
    throw e;
  }
  const entries = await fetchEntries(cleanUrl, token, 1);
  return { current: entries[0] ? mapEntry(entries[0]) : null };
}

// ---------------------------------------------------------------------------
// Cache helpers — read from / write to nightscout_readings
// ---------------------------------------------------------------------------

interface CacheRow {
  value_mgdl: number;
  recorded_at: string;
  direction: string | null;
}

function cacheRowToReading(r: CacheRow): Reading {
  return {
    value: r.value_mgdl,
    unit: "mg/dL",
    timestamp: r.recorded_at,
    trend: mapTrend(r.direction),
  };
}

/**
 * Write a batch of entries into nightscout_readings (upsert — idempotent).
 * Silently swallows errors so a cache failure never breaks the main flow.
 */
export async function writeCacheEntries(
  userId: string,
  entries: NsEntry[]
): Promise<void> {
  const rows = entries
    .filter((e) => typeof e.sgv === "number" && (e.date || e.dateString))
    .map((e) => ({
      user_id: userId,
      recorded_at: e.dateString ?? new Date(e.date!).toISOString(),
      value_mgdl: e.sgv as number,
      direction: e.direction ?? null,
      source: "nightscout",
    }));
  if (rows.length === 0) return;
  const { error } = await adminClient()
    .from("nightscout_readings")
    .upsert(rows, { onConflict: "user_id,recorded_at" });
  if (error) {
    console.error("[nightscout] cache write failed:", error.message);
  }
}

export async function getLatest(
  userId: string
): Promise<{ current: Reading | null }> {
  const creds = await getCredentials(userId);
  if (!creds) {
    const e: Error & { status?: number } = new Error("nightscout not connected");
    e.status = 404;
    throw e;
  }

  // Cache-first: if we have a reading from the last 30 min, use it.
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: cached } = await adminClient()
    .from("nightscout_readings")
    .select("value_mgdl, recorded_at, direction")
    .eq("user_id", userId)
    .gte("recorded_at", cutoff)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return { current: cacheRowToReading(cached as CacheRow) };
  }

  // Cache miss — live fetch and write to cache.
  const entries = await fetchEntries(creds.url, creds.token, 1);
  await writeCacheEntries(userId, entries);
  return { current: entries[0] ? mapEntry(entries[0]) : null };
}

/**
 * Returns the last 12h of readings (~144 entries at 5-min cadence) plus the
 * single most-recent reading as `current`. Cache-first: reads from
 * nightscout_readings if available, falls back to live fetch and writes
 * the result into the cache so subsequent calls are instant even when the
 * Nightscout instance is down.
 */
export async function getHistory(
  userId: string
): Promise<{ current: Reading | null; history: Reading[] }> {
  const creds = await getCredentials(userId);
  if (!creds) {
    const e: Error & { status?: number } = new Error("nightscout not connected");
    e.status = 404;
    throw e;
  }

  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await adminClient()
    .from("nightscout_readings")
    .select("value_mgdl, recorded_at, direction")
    .eq("user_id", userId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false });

  if (cached && cached.length > 0) {
    const history = (cached as CacheRow[]).map(cacheRowToReading);
    return { current: history[0] ?? null, history };
  }

  // Cache miss — live fetch and populate cache.
  // 144 ≈ 12h at 5-min cadence.
  const entries = await fetchEntries(creds.url, creds.token, 144);
  await writeCacheEntries(userId, entries);
  const history = entries
    .map(mapEntry)
    .filter((x): x is Reading => x !== null);
  return { current: history[0] ?? null, history };
}
