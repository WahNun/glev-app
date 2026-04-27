import axios, { AxiosInstance } from "axios";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

import { adminClient } from "./supabase";
import { encrypt, decrypt } from "./crypto";

// ---------------------------------------------------------------------------
// HTTP client — single instance, keep-alive, 3s timeout, one retry
// ---------------------------------------------------------------------------
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const http_: AxiosInstance = axios.create({
  timeout: 3000,
  httpAgent,
  httpsAgent,
  headers: {
    "Content-Type": "application/json",
    product: "llu.android",
    version: "4.16.0",
    "Accept-Encoding": "gzip",
  },
  // We handle non-2xx ourselves where it matters.
  validateStatus: (s) => s >= 200 && s < 500,
});

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    const err = e as { code?: string; response?: unknown; request?: unknown };
    const transient =
      err.code === "ECONNABORTED" ||
      err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT" ||
      (!err.response && !!err.request);
    if (!transient) throw e;
    return await fn();
  }
}

function baseUrl(region: string | null | undefined): string {
  const r = (region || "eu").toLowerCase();
  return `https://api-${r}.libreview.io`;
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

// ---------------------------------------------------------------------------
// Best-effort warm-container L1 cache. May or may not survive across
// invocations on serverless — that's fine, Supabase is the canonical store.
// ---------------------------------------------------------------------------
type Session = {
  region: string;
  token: string;
  expires: number; // ms epoch
  accountIdHash: string;
  patientId?: string | null;
};

const L1 = new Map<string, Session>();

function l1Get(userId: string): Session | null {
  const e = L1.get(userId);
  if (!e) return null;
  if (e.expires && e.expires - Date.now() < 60_000) return null;
  return e;
}

function l1Set(userId: string, patch: Partial<Session>) {
  const cur = L1.get(userId);
  L1.set(userId, { ...(cur as Session), ...patch } as Session);
}

function l1Clear(userId: string) {
  L1.delete(userId);
}

// ---------------------------------------------------------------------------
// Supabase row IO
// ---------------------------------------------------------------------------
type Row = {
  user_id: string;
  llu_email: string;
  llu_password_encrypted: string;
  llu_region: string | null;
  cached_token: string | null;
  cached_token_expires: string | null;
  cached_patient_id: string | null;
  cached_account_id_hash: string | null;
};

async function loadRow(userId: string): Promise<Row | null> {
  const { data, error } = await adminClient()
    .from("cgm_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("supabase: " + error.message);
  return (data as Row) || null;
}

async function saveCacheFields(userId: string, fields: Record<string, unknown>) {
  const { error } = await adminClient()
    .from("cgm_credentials")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
}

// ---------------------------------------------------------------------------
// LLU calls
// ---------------------------------------------------------------------------
type LluLoginResult = {
  region: string;
  token: string;
  expires: number;
  accountIdHash: string;
};

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

async function lluLogin(region: string, email: string, password: string): Promise<LluLoginResult> {
  const url = `${baseUrl(region)}/llu/auth/login`;
  const res = await withRetry(() => http_.post<LluAuthBody>(url, { email, password }));
  const body = res.data;

  if (body?.data?.redirect === true && body?.data?.region) {
    return lluLogin(body.data.region, email, password);
  }

  if (body?.data?.step?.type === "tou") {
    const tou = await withRetry(() =>
      http_.post<LluAuthBody>(
        `${baseUrl(region)}/auth/continue/tou`,
        {},
        { headers: { Authorization: `Bearer ${body.data?.authTicket?.token || ""}` } }
      )
    );
    return finishLogin(region, tou.data);
  }

  return finishLogin(region, body);
}

function finishLogin(region: string, body: LluAuthBody): LluLoginResult {
  const ticket = body?.data?.authTicket;
  const user = body?.data?.user;
  if (!ticket?.token || !user?.id) {
    const status = body?.status;
    const msg = body?.error?.message || "LLU login failed";
    const err: Error & { upstream?: boolean } = new Error(`${msg}${status ? ` (status=${status})` : ""}`);
    err.upstream = true;
    throw err;
  }
  const expiresMs = ticket.expires ? Number(ticket.expires) * 1000 : Date.now() + 50 * 60_000;
  return {
    region,
    token: ticket.token,
    expires: expiresMs,
    accountIdHash: sha256Hex(user.id),
  };
}

function authedHeaders(token: string, accountIdHash: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Account-Id": accountIdHash,
  };
}

interface LluConnectionsBody {
  data?: Array<{
    patientId?: string;
    glucoseMeasurement?: LluMeasurement;
  }>;
}

interface LluMeasurement {
  Value?: number;
  ValueInMgPerDl?: number;
  Timestamp?: string;
  TrendArrow?: number;
}

interface LluGraphBody {
  data?: {
    connection?: { glucoseMeasurement?: LluMeasurement };
    graphData?: LluMeasurement[];
  };
}

async function lluConnections(region: string, token: string, accountIdHash: string): Promise<LluConnectionsBody> {
  const url = `${baseUrl(region)}/llu/connections`;
  const res = await withRetry(() => http_.get<LluConnectionsBody>(url, { headers: authedHeaders(token, accountIdHash) }));
  if (res.status === 401) {
    const e: Error & { status401?: boolean } = new Error("LLU 401");
    e.status401 = true;
    throw e;
  }
  return res.data;
}

async function lluGraph(region: string, token: string, accountIdHash: string, patientId: string): Promise<LluGraphBody> {
  const url = `${baseUrl(region)}/llu/connections/${patientId}/graph`;
  const res = await withRetry(() => http_.get<LluGraphBody>(url, { headers: authedHeaders(token, accountIdHash) }));
  if (res.status === 401) {
    const e: Error & { status401?: boolean } = new Error("LLU 401");
    e.status401 = true;
    throw e;
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Session orchestration
// ---------------------------------------------------------------------------
async function getSession(userId: string): Promise<Session> {
  const hit = l1Get(userId);
  if (hit?.token && hit?.accountIdHash) return hit;

  const row = await loadRow(userId);
  if (!row) {
    const e: Error & { status?: number } = new Error("no credentials for user");
    e.status = 404;
    throw e;
  }

  const region = row.llu_region || "eu";
  const l2Expires = row.cached_token_expires ? Date.parse(row.cached_token_expires) : 0;
  if (row.cached_token && row.cached_account_id_hash && l2Expires - Date.now() > 60_000) {
    const sess: Session = {
      region,
      token: row.cached_token,
      expires: l2Expires,
      accountIdHash: row.cached_account_id_hash,
      patientId: row.cached_patient_id,
    };
    l1Set(userId, sess);
    return sess;
  }

  const password = decrypt(row.llu_password_encrypted);
  const fresh = await lluLogin(region, row.llu_email, password);
  const sess: Session = {
    region: fresh.region,
    token: fresh.token,
    expires: fresh.expires,
    accountIdHash: fresh.accountIdHash,
    patientId: row.cached_patient_id,
  };
  l1Set(userId, sess);
  await saveCacheFields(userId, {
    llu_region: fresh.region,
    cached_token: fresh.token,
    cached_token_expires: new Date(fresh.expires).toISOString(),
    cached_account_id_hash: fresh.accountIdHash,
  });
  return sess;
}

async function callWith401Retry<T>(userId: string, fn: (sess: Session) => Promise<T>): Promise<T> {
  let sess = await getSession(userId);
  try {
    return await fn(sess);
  } catch (e: unknown) {
    const err = e as { status401?: boolean; response?: { status?: number } };
    const is401 = err.status401 || err.response?.status === 401;
    if (!is401) throw e;
    l1Clear(userId);
    await saveCacheFields(userId, { cached_token: null, cached_token_expires: null });
    sess = await getSession(userId);
    return await fn(sess);
  }
}

// ---------------------------------------------------------------------------
// Trend mapping
// ---------------------------------------------------------------------------
const TREND: Record<number, string> = {
  1: "fallingQuickly",
  2: "falling",
  3: "stable",
  4: "rising",
  5: "risingQuickly",
};

export type Reading = {
  value: number | null;
  unit: "mg/dL";
  timestamp: string | null;
  trend: string;
};

function mapMeasurement(m: LluMeasurement | undefined | null): Reading | null {
  if (!m) return null;
  return {
    value: m.ValueInMgPerDl ?? m.Value ?? null,
    unit: "mg/dL",
    timestamp: m.Timestamp || null,
    trend: TREND[m.TrendArrow ?? 3] || "stable",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
// Public wrapper around the internal lluLogin() so the credentials API
// route can verify a user's email/password against LibreLinkUp BEFORE
// it persists them. Throws with the upstream error message ("notAuthenticated"
// / "invalid credentials" / etc.) on failure — the route maps that to a
// 401 so the UI's connect step can show the real cause instead of the
// user finding out later when "Verbindung testen" finally trips it. The
// returned `region` may differ from the input if LLU's regional redirect
// fired during login, so callers should persist that region.
export async function verifyCredentials(
  email: string,
  password: string,
  region: string
): Promise<LluLoginResult> {
  return lluLogin((region || "eu").toLowerCase(), email, password);
}

export async function setCredentials(
  userId: string,
  args: { email?: string; password?: string; region?: string }
): Promise<void> {
  const { email, password, region } = args;
  if (!email || !password) {
    const e: Error & { status?: number } = new Error("email and password required");
    e.status = 400;
    throw e;
  }
  const enc = encrypt(password);
  const reg = (region || "eu").toLowerCase();
  const { error } = await adminClient()
    .from("cgm_credentials")
    .upsert(
      {
        user_id: userId,
        llu_email: email,
        llu_password_encrypted: enc,
        llu_region: reg,
        cached_token: null,
        cached_token_expires: null,
        cached_patient_id: null,
        cached_account_id_hash: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) throw new Error("supabase: " + error.message);
  l1Clear(userId);
}

export async function deleteCredentials(userId: string): Promise<void> {
  const { error } = await adminClient()
    .from("cgm_credentials")
    .delete()
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
  l1Clear(userId);
}

export async function getLatest(userId: string): Promise<{ current: Reading | null }> {
  return callWith401Retry(userId, async (sess) => {
    const data = await lluConnections(sess.region, sess.token, sess.accountIdHash);
    const first = data?.data?.[0];
    if (!first) {
      const e: Error & { upstream?: boolean } = new Error("no patients linked");
      e.upstream = true;
      throw e;
    }
    if (first.patientId && first.patientId !== sess.patientId) {
      l1Set(userId, { patientId: first.patientId });
      saveCacheFields(userId, { cached_patient_id: first.patientId }).catch(() => {});
    }
    return { current: mapMeasurement(first.glucoseMeasurement) };
  });
}

export async function getHistory(
  userId: string
): Promise<{ current: Reading | null; history: Reading[] }> {
  return callWith401Retry(userId, async (sess) => {
    let patientId = sess.patientId;
    if (!patientId) {
      const conn = await lluConnections(sess.region, sess.token, sess.accountIdHash);
      patientId = conn?.data?.[0]?.patientId || null;
      if (!patientId) {
        const e: Error & { upstream?: boolean } = new Error("no patients linked");
        e.upstream = true;
        throw e;
      }
      l1Set(userId, { patientId });
      saveCacheFields(userId, { cached_patient_id: patientId }).catch(() => {});
    }
    const g = await lluGraph(sess.region, sess.token, sess.accountIdHash, patientId);
    const conn = g?.data?.connection;
    const history = (g?.data?.graphData || [])
      .map(mapMeasurement)
      .filter((x): x is Reading => x !== null);
    return {
      current: mapMeasurement(conn?.glucoseMeasurement),
      history,
    };
  });
}
