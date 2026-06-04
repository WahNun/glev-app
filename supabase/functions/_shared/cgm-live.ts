/**
 * cgm-live.ts — Deno-compatible live CGM source dispatcher for alarm edge functions.
 *
 * Mirrors the logic of lib/cgm/index.ts (Node.js) but uses only Deno-compatible
 * APIs: Web Crypto for AES-256-GCM decryption, global fetch for HTTP calls.
 *
 * Source priority per user:
 *   1. LLU (LibreLinkUp) — fetches live from Abbott's API using cached credentials
 *   2. Nightscout — reads nightscout_readings cache (refreshed when user opens app),
 *      falling back to a live Nightscout API call if cache is empty for the window
 *   3. Apple Health — reads apple_health_readings (device pushes deltas on every sync)
 *   DB fallback: cgm_samples (Junction/Vital) is handled in the callers below
 *
 * Required Supabase Edge Function Secret (in addition to push secrets):
 *   ENCRYPTION_KEY  — 64-hex-character string (32 bytes) matching Vercel's ENCRYPTION_KEY.
 *                     Used to decrypt llu_password_encrypted and nightscout_token_enc.
 *                     Set via: supabase secrets set ENCRYPTION_KEY=<value>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

const LLU_APP_VERSION = "4.16.0";

/* ── Utility ─────────────────────────────────────────────────────────────── */

function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

/**
 * AES-256-GCM decrypt using Web Crypto (Deno-compatible).
 * Payload format is `iv_hex:tag_hex:ciphertext_hex` — identical to lib/cgm/crypto.ts.
 */
async function decryptAesGcm(payload: string, keyHex: string): Promise<string> {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("decrypt: malformed payload");
  const [ivHex, tagHex, ctHex] = parts;

  const keyBytes = fromHex(keyHex);
  const iv = fromHex(ivHex);
  const tag = fromHex(tagHex);
  const ct = fromHex(ctHex);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  // Web Crypto AES-GCM expects ciphertext || authTag concatenated
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    combined,
  );
  return new TextDecoder().decode(plain);
}

/* ── Source resolution ───────────────────────────────────────────────────── */

type CgmSource = "llu" | "nightscout" | "apple_health";

interface ProfileRow {
  cgm_source: string | null;
  nightscout_url: string | null;
  nightscout_token_enc: string | null;
}

async function resolveSource(
  sb: SupabaseClient,
  userId: string,
): Promise<{ source: CgmSource; profile: ProfileRow | null }> {
  const { data } = await sb
    .from("profiles")
    .select("cgm_source, nightscout_url, nightscout_token_enc")
    .eq("user_id", userId)
    .maybeSingle();

  const profile = data as ProfileRow | null;
  const explicit = profile?.cgm_source;
  if (explicit === "llu" || explicit === "nightscout" || explicit === "apple_health") {
    return { source: explicit, profile };
  }
  // Legacy auto-detect: nightscout_url present → nightscout, else llu
  const source: CgmSource = profile?.nightscout_url ? "nightscout" : "llu";
  return { source, profile };
}

/* ── LLU live fetch ──────────────────────────────────────────────────────── */

interface LluCredRow {
  llu_email: string;
  llu_password_encrypted: string;
  llu_region: string | null;
  cached_token: string | null;
  cached_token_expires: string | null;
  cached_account_id_hash: string | null;
}

interface LluAuthBody {
  status?: number;
  error?: { message?: string };
  data?: {
    redirect?: boolean;
    region?: string;
    step?: { type?: string };
    authTicket?: { token?: string; expires?: number };
    user?: { id?: string };
  };
}

function lluBaseUrl(region: string) {
  return `https://api-${(region || "eu").toLowerCase()}.libreview.io`;
}

function lluHeaders(extra?: Record<string, string>) {
  return {
    "Content-Type": "application/json",
    product: "llu.android",
    version: LLU_APP_VERSION,
    "Accept-Encoding": "gzip",
    ...(extra ?? {}),
  };
}

async function lluLoginRaw(
  region: string,
  email: string,
  password: string,
): Promise<{ region: string; token: string; accountIdHash: string; expires: number }> {
  const res = await fetch(`${lluBaseUrl(region)}/llu/auth/login`, {
    method: "POST",
    headers: lluHeaders(),
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as LluAuthBody;

  if (body?.data?.redirect === true && body?.data?.region) {
    return lluLoginRaw(body.data.region, email, password);
  }

  if (body?.data?.step?.type === "tou") {
    const touRes = await fetch(`${lluBaseUrl(region)}/auth/continue/tou`, {
      method: "POST",
      headers: lluHeaders({ Authorization: `Bearer ${body.data?.authTicket?.token ?? ""}` }),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    });
    const touBody = (await touRes.json()) as LluAuthBody;
    return extractLluResult(region, touBody);
  }

  return extractLluResult(region, body);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractLluResult(
  region: string,
  body: LluAuthBody,
): { region: string; token: string; accountIdHash: string; expires: number } {
  const ticket = body?.data?.authTicket;
  const user = body?.data?.user;
  if (!ticket?.token || !user?.id) {
    const msg = body?.error?.message || "LLU login failed";
    throw new Error(msg);
  }
  const expires = ticket.expires ? Number(ticket.expires) * 1000 : Date.now() + 50 * 60_000;
  // accountIdHash will be computed async; placeholder — filled after call
  return { region, token: ticket.token, accountIdHash: user.id, expires };
}

interface LluConnectionsBody {
  data?: Array<{
    patientId?: string;
    glucoseMeasurement?: {
      Value?: number;
      ValueInMgPerDl?: number;
      FactoryTimestamp?: string;
      Timestamp?: string;
      TrendArrow?: number;
    };
  }>;
}

async function lluGetCurrent(
  region: string,
  token: string,
  accountIdHash: string,
): Promise<{ value: number } | null> {
  const res = await fetch(`${lluBaseUrl(region)}/llu/connections`, {
    method: "GET",
    headers: lluHeaders({ Authorization: `Bearer ${token}`, "Account-Id": accountIdHash }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) {
    const e: Error & { status401?: boolean } = new Error("LLU 401");
    e.status401 = true;
    throw e;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as LluConnectionsBody;
  const m = body?.data?.[0]?.glucoseMeasurement;
  if (!m) return null;
  const value = m.ValueInMgPerDl ?? m.Value ?? null;
  if (value == null) return null;
  return { value };
}

async function fetchLlu(
  sb: SupabaseClient,
  userId: string,
  encKey: string,
  tag: string,
): Promise<{ value: number; source: "llu"; logReason: string } | null> {
  const { data: credData, error: credError } = await sb
    .from("cgm_credentials")
    .select(
      "llu_email, llu_password_encrypted, llu_region, cached_token, cached_token_expires, cached_account_id_hash",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (credError || !credData) {
    return null;
  }

  const row = credData as LluCredRow;
  const region = row.llu_region || "eu";

  // Try cached token first
  const tokenExp = row.cached_token_expires ? Date.parse(row.cached_token_expires) : 0;
  let token = row.cached_token;
  let accountIdHash = row.cached_account_id_hash;

  if (!token || !accountIdHash || tokenExp - Date.now() < 60_000) {
    // Token expired or missing — re-login
    if (!encKey) {
      console.log(`${tag} ENCRYPTION_KEY not set — cannot decrypt LLU password, skipping LLU live fetch`);
      return null;
    }
    let password: string;
    try {
      password = await decryptAesGcm(row.llu_password_encrypted, encKey);
    } catch (e) {
      console.log(`${tag} LLU password decrypt failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    let loginResult: { region: string; token: string; accountIdHash: string; expires: number };
    try {
      loginResult = await lluLoginRaw(region, row.llu_email, password);
      loginResult.accountIdHash = await sha256Hex(loginResult.accountIdHash);
    } catch (e) {
      console.log(`${tag} LLU re-login failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    token = loginResult.token;
    accountIdHash = loginResult.accountIdHash;

    // Persist new token (best-effort, don't block alarm on save failure)
    sb.from("cgm_credentials").update({
      llu_region: loginResult.region,
      cached_token: token,
      cached_token_expires: new Date(loginResult.expires).toISOString(),
      cached_account_id_hash: accountIdHash,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).then(() => {}).catch(() => {});
  }

  // Fetch current reading
  let reading: { value: number } | null = null;
  try {
    reading = await lluGetCurrent(region, token!, accountIdHash!);
  } catch (e: unknown) {
    const err = e as { status401?: boolean };
    if (err.status401) {
      // Token stale — re-login with fresh credentials
      if (!encKey) return null;
      let password: string;
      try {
        password = await decryptAesGcm(row.llu_password_encrypted, encKey);
      } catch {
        return null;
      }
      try {
        const loginResult = await lluLoginRaw(region, row.llu_email, password);
        loginResult.accountIdHash = await sha256Hex(loginResult.accountIdHash);
        reading = await lluGetCurrent(loginResult.region, loginResult.token, loginResult.accountIdHash);
        // Update cache (best-effort)
        sb.from("cgm_credentials").update({
          llu_region: loginResult.region,
          cached_token: loginResult.token,
          cached_token_expires: new Date(loginResult.expires).toISOString(),
          cached_account_id_hash: loginResult.accountIdHash,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId).then(() => {}).catch(() => {});
      } catch (e2) {
        console.log(`${tag} LLU 401 retry failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
        return null;
      }
    } else {
      console.log(`${tag} LLU connections error: ${e instanceof Error ? (e as Error).message : String(e)}`);
      return null;
    }
  }

  if (!reading) return null;
  return { value: reading.value, source: "llu", logReason: "llu-live" };
}

/* ── Nightscout fetch ────────────────────────────────────────────────────── */

async function fetchNightscout(
  sb: SupabaseClient,
  userId: string,
  profile: ProfileRow | null,
  encKey: string,
  lookbackMs: number,
  tag: string,
): Promise<{ value: number; source: "nightscout"; logReason: string } | null> {
  const nsUrl = profile?.nightscout_url;
  if (!nsUrl) return null;

  // 1. Check nightscout_readings cache within lookback window
  const cutoffIso = new Date(Date.now() - lookbackMs).toISOString();
  const { data: cached } = await sb
    .from("nightscout_readings")
    .select("value_mgdl, recorded_at")
    .eq("user_id", userId)
    .gte("recorded_at", cutoffIso)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached && typeof (cached as { value_mgdl?: unknown }).value_mgdl === "number") {
    const row = cached as { value_mgdl: number; recorded_at: string };
    return { value: row.value_mgdl, source: "nightscout", logReason: "nightscout-cache" };
  }

  // 2. Live fetch from Nightscout
  let nsToken: string | null = null;
  if (profile?.nightscout_token_enc && encKey) {
    try {
      nsToken = await decryptAesGcm(profile.nightscout_token_enc, encKey);
    } catch {
      // Token decrypt failure — try unauthenticated
    }
  }

  try {
    const url = new URL(nsUrl.replace(/\/+$/, "") + "/api/v1/entries.json");
    url.searchParams.set("count", "1");
    if (nsToken) url.searchParams.set("token", nsToken);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.log(`${tag} Nightscout live fetch ${res.status}`);
      return null;
    }
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const entry = json[0] as { sgv?: number; date?: number; dateString?: string };
    if (typeof entry.sgv !== "number") return null;

    // Check timestamp freshness
    const entryTs = entry.dateString
      ? Date.parse(entry.dateString)
      : typeof entry.date === "number"
      ? entry.date
      : 0;
    if (entryTs > 0 && Date.now() - entryTs > lookbackMs) {
      console.log(`${tag} Nightscout reading too old (${Math.round((Date.now() - entryTs) / 60000)}min)`);
      return null;
    }

    return { value: entry.sgv, source: "nightscout", logReason: "nightscout-live" };
  } catch (e) {
    console.log(`${tag} Nightscout live fetch error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/* ── Apple Health fetch ──────────────────────────────────────────────────── */

async function fetchAppleHealth(
  sb: SupabaseClient,
  userId: string,
  lookbackMs: number,
  tag: string,
): Promise<{ value: number; source: "apple_health"; logReason: string } | null> {
  const cutoffIso = new Date(Date.now() - lookbackMs).toISOString();
  const { data, error } = await sb
    .from("apple_health_readings")
    .select("value_mg_dl, timestamp")
    .eq("user_id", userId)
    .gte("timestamp", cutoffIso)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log(`${tag} apple_health_readings error: ${error.message}`);
    return null;
  }
  if (!data) return null;
  const row = data as { value_mg_dl: number; timestamp: string };
  return { value: row.value_mg_dl, source: "apple_health", logReason: "apple-health-db" };
}

/* ── Public API ─────────────────────────────────────────────────────────── */

export interface LiveReading {
  value: number;
  source: string;
  logReason: string;
}

/**
 * Fetch the latest CGM reading for a user, using the correct live source.
 *
 * Resolution order:
 *   1. Resolve source from profiles (cgm_source or nightscout_url presence)
 *   2. Try the live/cached source-specific fetch
 *   3. Return null if no fresh reading found (callers fall back to cgm_samples)
 *
 * @param sb           Supabase service-role client
 * @param userId       User UUID
 * @param encKey       ENCRYPTION_KEY hex string (for LLU password / NS token decrypt)
 * @param lookbackMs   Max age of reading to consider fresh (e.g. 10 * 60 * 1000)
 * @param tag          Log prefix, e.g. "[hypo-check]"
 */
export async function fetchLiveReading(
  sb: SupabaseClient,
  userId: string,
  encKey: string,
  lookbackMs: number,
  tag: string,
): Promise<LiveReading | null> {
  const { source, profile } = await resolveSource(sb, userId);

  if (source === "llu") {
    const r = await fetchLlu(sb, userId, encKey, tag);
    if (r) return r;
    // Fall through so caller can try cgm_samples
    return null;
  }

  if (source === "nightscout") {
    const r = await fetchNightscout(sb, userId, profile, encKey, lookbackMs, tag);
    if (r) return r;
    return null;
  }

  if (source === "apple_health") {
    const r = await fetchAppleHealth(sb, userId, lookbackMs, tag);
    if (r) return r;
    return null;
  }

  return null;
}
