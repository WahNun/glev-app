import axios, { AxiosInstance } from "axios";
import http from "node:http";
import https from "node:https";

import { adminClient } from "./supabase";
import { encrypt, decrypt } from "./crypto";

// ---------------------------------------------------------------------------
// HTTP client — keep-alive, 8s timeout, one retry
// ---------------------------------------------------------------------------
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const http_: AxiosInstance = axios.create({
  timeout: 8000,
  httpAgent,
  httpsAgent,
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    const err = e as { code?: string; response?: { status?: number }; request?: unknown };
    const status = (err.response as { status?: number } | undefined)?.status;
    const transient =
      err.code === "ECONNABORTED" ||
      err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT" ||
      status === 502 ||
      status === 503 ||
      (!err.response && !!err.request);
    if (!transient) throw e;
    return await fn();
  }
}

// ---------------------------------------------------------------------------
// Region → base URL
// ---------------------------------------------------------------------------
const DEXCOM_APP_ID = "d89443d2-327c-4a6f-89e5-496bbb0317db";
const EU_BASE = "https://shareous1.dexcom.com";
const US_BASE = "https://share2.dexcom.com";

export type Region = "eu" | "us";

function baseUrl(region: Region | string | null | undefined): string {
  return (region || "eu").toLowerCase() === "us" ? US_BASE : EU_BASE;
}

// ---------------------------------------------------------------------------
// WT timestamp parser: "Date(1234567890000)" → epoch ms
// ---------------------------------------------------------------------------
function parseWt(wt: string | undefined | null): number | null {
  if (!wt) return null;
  const m = /Date\((\d+)\)/.exec(wt);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Trend mapping: Dexcom strings → Glev vocabulary
// ---------------------------------------------------------------------------
const TREND_MAP: Record<string, string> = {
  DoubleUp:       "risingQuickly",
  SingleUp:       "rising",
  FortyFiveUp:    "rising",
  Flat:           "stable",
  FortyFiveDown:  "falling",
  SingleDown:     "falling",
  DoubleDown:     "fallingQuickly",
  NotComputable:  "stable",
  RateOutOfRange: "stable",
};

export type Reading = {
  value: number | null;
  unit: "mg/dL";
  timestamp: string | null;
  trend: string;
};

// ---------------------------------------------------------------------------
// L1 in-memory session cache
// ---------------------------------------------------------------------------
type Session = {
  region: Region;
  sessionId: string;
  expires: number; // ms epoch
};

const L1 = new Map<string, Session>();

function l1Get(userId: string): Session | null {
  const e = L1.get(userId);
  if (!e) return null;
  if (e.expires - Date.now() < 60_000) return null;
  return e;
}

function l1Set(userId: string, s: Session) {
  L1.set(userId, s);
}

function l1Clear(userId: string) {
  L1.delete(userId);
}

// ---------------------------------------------------------------------------
// Supabase row IO
// ---------------------------------------------------------------------------
type Row = {
  user_id: string;
  dexcom_username: string | null;
  dexcom_password_encrypted: string | null;
  dexcom_region: string | null;
  dexcom_session_id: string | null;
  dexcom_session_expires: string | null;
};

async function loadRow(userId: string): Promise<Row | null> {
  const { data, error } = await adminClient()
    .from("cgm_credentials")
    .select(
      "user_id, dexcom_username, dexcom_password_encrypted, dexcom_region, dexcom_session_id, dexcom_session_expires"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("supabase: " + error.message);
  return (data as Row) || null;
}

async function saveSession(userId: string, sessionId: string, expires: number) {
  const { error } = await adminClient()
    .from("cgm_credentials")
    .update({
      dexcom_session_id: sessionId,
      dexcom_session_expires: new Date(expires).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
}

// ---------------------------------------------------------------------------
// Dexcom Share API calls
// ---------------------------------------------------------------------------
async function dexcomLogin(
  region: Region,
  username: string,
  password: string
): Promise<string> {
  const url = `${baseUrl(region)}/ShareWebServices/Services/General/LoginPublisherAccountByName`;
  const res = await withRetry(() =>
    http_.post<string>(url, {
      accountName: username,
      password,
      applicationId: DEXCOM_APP_ID,
    })
  );

  if (res.status === 401 || res.status === 400) {
    const e: Error & { upstream?: boolean } = new Error("AccountPasswordInvalid");
    e.upstream = true;
    throw e;
  }

  // Response is a JSON-encoded string (UUID with surrounding quotes)
  const raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  const sessionId = raw.replace(/^"|"$/g, "").trim();

  if (!sessionId || sessionId.length < 10 || sessionId === "null") {
    const e: Error & { upstream?: boolean } = new Error(
      "Dexcom login returned no session ID"
    );
    e.upstream = true;
    throw e;
  }

  return sessionId;
}

interface DexcomReading {
  Trend?: string;
  Value?: number;
  WT?: string;
}

async function fetchGlucose(
  region: Region,
  sessionId: string,
  minutes = 1440,
  maxCount = 288
): Promise<DexcomReading[]> {
  const url = `${baseUrl(region)}/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues`;
  const res = await withRetry(() =>
    http_.post<DexcomReading[]>(url, null, {
      params: { sessionId, minutes, maxCount },
    })
  );

  if (res.status === 401) {
    const e: Error & { status401?: boolean } = new Error("SessionIdNotFound");
    e.status401 = true;
    throw e;
  }

  return Array.isArray(res.data) ? res.data : [];
}

function mapReading(r: DexcomReading): Reading | null {
  const v = r.Value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const tMs = parseWt(r.WT);
  if (tMs == null) return null;
  return {
    value: v,
    unit: "mg/dL",
    timestamp: new Date(tMs).toISOString(),
    trend: TREND_MAP[r.Trend || ""] || "stable",
  };
}

// ---------------------------------------------------------------------------
// Session orchestration
// ---------------------------------------------------------------------------
async function getSession(userId: string): Promise<Session> {
  const hit = l1Get(userId);
  if (hit) return hit;

  const row = await loadRow(userId);
  if (!row?.dexcom_username || !row?.dexcom_password_encrypted) {
    const e: Error & { status?: number } = new Error("no Dexcom credentials for user");
    e.status = 404;
    throw e;
  }

  const region = ((row.dexcom_region || "eu").toLowerCase() as Region);

  // L2 cache: re-use stored session if still valid
  const l2Expires = row.dexcom_session_expires
    ? Date.parse(row.dexcom_session_expires)
    : 0;
  if (row.dexcom_session_id && l2Expires - Date.now() > 60_000) {
    const sess: Session = { region, sessionId: row.dexcom_session_id, expires: l2Expires };
    l1Set(userId, sess);
    return sess;
  }

  const password = decrypt(row.dexcom_password_encrypted);
  const sessionId = await dexcomLogin(region, row.dexcom_username, password);
  // Dexcom sessions last ~30-60 min; use 25 min for safety
  const expires = Date.now() + 25 * 60_000;
  const sess: Session = { region, sessionId, expires };
  l1Set(userId, sess);
  saveSession(userId, sessionId, expires).catch(() => {});
  return sess;
}

async function callWithSessionRetry<T>(
  userId: string,
  fn: (sess: Session) => Promise<T>
): Promise<T> {
  let sess = await getSession(userId);
  try {
    return await fn(sess);
  } catch (e: unknown) {
    const err = e as { status401?: boolean; response?: { status?: number } };
    const is401 = err.status401 || err.response?.status === 401;
    if (!is401) throw e;
    l1Clear(userId);
    void adminClient()
      .from("cgm_credentials")
      .update({ dexcom_session_id: null, dexcom_session_expires: null })
      .eq("user_id", userId);
    sess = await getSession(userId);
    return await fn(sess);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function verifyCredentials(
  username: string,
  password: string,
  region: Region | string
): Promise<{ sessionId: string; region: Region }> {
  const r = (region || "eu").toLowerCase() as Region;
  const sessionId = await dexcomLogin(r, username, password);
  return { sessionId, region: r };
}

export async function setCredentials(
  userId: string,
  args: { username?: string; password?: string; region?: Region | string }
): Promise<void> {
  const { username, password, region } = args;
  if (!username || !password) {
    const e: Error & { status?: number } = new Error("username and password required");
    e.status = 400;
    throw e;
  }
  const enc = encrypt(password);
  const reg = (region || "eu").toLowerCase() as Region;
  const now = new Date().toISOString();

  // Atomic upsert: insert-or-update on user_id conflict.
  // Only Dexcom columns are in the payload → llu_* columns are never
  // touched on UPDATE (PostgREST only SETs columns present in the payload).
  // For a brand-new row the DB default llu_region='eu' is applied.
  console.log("[dexcom] setCredentials upsert start — userId:", userId, "region:", reg);
  const { error } = await adminClient()
    .from("cgm_credentials")
    .upsert(
      {
        user_id: userId,
        dexcom_username: username,
        dexcom_password_encrypted: enc,
        dexcom_region: reg,
        dexcom_session_id: null,
        dexcom_session_expires: null,
        updated_at: now,
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[dexcom] setCredentials upsert FAILED — code:", error.code, "msg:", error.message, "details:", error.details);
    throw new Error("supabase: " + error.message);
  }
  console.log("[dexcom] setCredentials upsert OK — userId:", userId);

  l1Clear(userId);
}

export async function deleteCredentials(userId: string): Promise<void> {
  const { error } = await adminClient()
    .from("cgm_credentials")
    .update({
      dexcom_username: null,
      dexcom_password_encrypted: null,
      dexcom_region: null,
      dexcom_session_id: null,
      dexcom_session_expires: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
  l1Clear(userId);
}

export async function getLatest(
  userId: string
): Promise<{ current: Reading | null }> {
  return callWithSessionRetry(userId, async (sess) => {
    const readings = await fetchGlucose(sess.region, sess.sessionId, 10, 1);
    const current = readings.length > 0 ? mapReading(readings[0]) : null;
    return { current };
  });
}

export async function getHistory(
  userId: string,
  minAgo: number = 1440,
): Promise<{ current: Reading | null; history: Reading[] }> {
  return callWithSessionRetry(userId, async (sess) => {
    const maxCount = Math.min(Math.ceil(minAgo / 5) + 10, 288);
    const readings = await fetchGlucose(sess.region, sess.sessionId, minAgo, maxCount);
    const mapped = readings
      .map(mapReading)
      .filter((x): x is Reading => x !== null);
    return {
      current: mapped[0] ?? null,
      history: mapped,
    };
  });
}
