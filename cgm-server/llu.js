"use strict";

const axios = require("axios");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const { admin } = require("./supabase");
const { encrypt, decrypt } = require("./crypto");

// ---------------------------------------------------------------------------
// HTTP client — single instance, keep-alive, 3s timeout, one retry
// ---------------------------------------------------------------------------
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const http_ = axios.create({
  timeout: 3000,
  httpAgent,
  httpsAgent,
  headers: {
    "Content-Type": "application/json",
    "product": "llu.android",
    "version": "4.16.0",
    "Accept-Encoding": "gzip",
  },
});

async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    const transient =
      e.code === "ECONNABORTED" ||
      e.code === "ECONNRESET" ||
      e.code === "ETIMEDOUT" ||
      (!e.response && !!e.request);
    if (!transient) throw e;
    return await fn();
  }
}

function baseUrl(region) {
  const r = (region || "eu").toLowerCase();
  return `https://api-${r}.libreview.io`;
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

// ---------------------------------------------------------------------------
// L1 in-memory cache: userId -> { token, expires (ms), patientId, accountIdHash, region }
// ---------------------------------------------------------------------------
const L1 = new Map();

function l1Get(userId) {
  const e = L1.get(userId);
  if (!e) return null;
  if (e.expires && e.expires - Date.now() < 60_000) return null; // 60s skew
  return e;
}

function l1Set(userId, patch) {
  const cur = L1.get(userId) || {};
  L1.set(userId, { ...cur, ...patch });
}

function l1Clear(userId) {
  L1.delete(userId);
}

// ---------------------------------------------------------------------------
// Supabase row IO
// ---------------------------------------------------------------------------
async function loadRow(userId) {
  const { data, error } = await admin()
    .from("cgm_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("supabase: " + error.message);
  return data;
}

async function saveCacheFields(userId, fields) {
  const { error } = await admin()
    .from("cgm_credentials")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
}

// ---------------------------------------------------------------------------
// LLU calls
// ---------------------------------------------------------------------------
async function lluLogin(region, email, password) {
  const url = `${baseUrl(region)}/llu/auth/login`;
  const res = await withRetry(() => http_.post(url, { email, password }));
  const body = res.data;

  // Region redirect
  if (body?.data?.redirect === true && body?.data?.region) {
    return lluLogin(body.data.region, email, password);
  }

  // Terms-of-use step
  if (body?.data?.step?.type === "tou") {
    const tou = await withRetry(() =>
      http_.post(`${baseUrl(region)}/auth/continue/tou`, {}, {
        headers: { Authorization: `Bearer ${body.data.authTicket?.token}` },
      })
    );
    return finishLogin(region, tou.data);
  }

  return finishLogin(region, body);
}

function finishLogin(region, body) {
  const ticket = body?.data?.authTicket;
  const user = body?.data?.user;
  if (!ticket?.token || !user?.id) {
    const status = body?.status;
    const msg = body?.error?.message || "LLU login failed";
    const err = new Error(`${msg}${status ? ` (status=${status})` : ""}`);
    err.upstream = true;
    throw err;
  }
  // ticket.expires is unix seconds
  const expiresMs = (ticket.expires ? Number(ticket.expires) * 1000 : Date.now() + 50 * 60_000);
  return {
    region,
    token: ticket.token,
    expires: expiresMs,
    accountIdHash: sha256Hex(user.id),
  };
}

function authedHeaders(token, accountIdHash) {
  return {
    Authorization: `Bearer ${token}`,
    "Account-Id": accountIdHash,
  };
}

async function lluConnections(region, token, accountIdHash) {
  const url = `${baseUrl(region)}/llu/connections`;
  const res = await withRetry(() =>
    http_.get(url, { headers: authedHeaders(token, accountIdHash) })
  );
  return res.data;
}

async function lluGraph(region, token, accountIdHash, patientId) {
  const url = `${baseUrl(region)}/llu/connections/${patientId}/graph`;
  const res = await withRetry(() =>
    http_.get(url, { headers: authedHeaders(token, accountIdHash) })
  );
  return res.data;
}

// ---------------------------------------------------------------------------
// Session orchestration: ensure we have a valid token + accountIdHash
// ---------------------------------------------------------------------------
async function getSession(userId) {
  // L1 hit
  const hit = l1Get(userId);
  if (hit?.token && hit?.accountIdHash) return hit;

  // Load row
  const row = await loadRow(userId);
  if (!row) {
    const e = new Error("no credentials for user");
    e.status = 404;
    throw e;
  }

  const region = row.llu_region || "eu";

  // L2 cache
  const l2Expires = row.cached_token_expires ? Date.parse(row.cached_token_expires) : 0;
  if (row.cached_token && row.cached_account_id_hash && l2Expires - Date.now() > 60_000) {
    const sess = {
      region,
      token: row.cached_token,
      expires: l2Expires,
      accountIdHash: row.cached_account_id_hash,
      patientId: row.cached_patient_id || null,
    };
    l1Set(userId, sess);
    return sess;
  }

  // Re-login
  const password = decrypt(row.llu_password_encrypted);
  const fresh = await lluLogin(region, row.llu_email, password);
  const sess = {
    region: fresh.region,
    token: fresh.token,
    expires: fresh.expires,
    accountIdHash: fresh.accountIdHash,
    patientId: row.cached_patient_id || null,
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

async function callWith401Retry(userId, fn) {
  let sess = await getSession(userId);
  try {
    return await fn(sess);
  } catch (e) {
    const status = e?.response?.status;
    if (status !== 401) throw e;
    // Invalidate and retry once
    l1Clear(userId);
    await saveCacheFields(userId, {
      cached_token: null,
      cached_token_expires: null,
    });
    sess = await getSession(userId);
    return await fn(sess);
  }
}

// ---------------------------------------------------------------------------
// Trend mapping
// ---------------------------------------------------------------------------
const TREND = {
  1: "fallingQuickly",
  2: "falling",
  3: "stable",
  4: "rising",
  5: "risingQuickly",
};

function mapMeasurement(m) {
  if (!m) return null;
  return {
    value: m.ValueInMgPerDl ?? m.Value ?? null,
    unit: "mg/dL",
    timestamp: m.Timestamp || null,
    trend: TREND[m.TrendArrow] || "stable",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function setCredentials(userId, { email, password, region }) {
  if (!email || !password) {
    const e = new Error("email and password required");
    e.status = 400;
    throw e;
  }
  const enc = encrypt(password);
  const reg = (region || "eu").toLowerCase();
  const { error } = await admin()
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

async function deleteCredentials(userId) {
  const { error } = await admin()
    .from("cgm_credentials")
    .delete()
    .eq("user_id", userId);
  if (error) throw new Error("supabase: " + error.message);
  l1Clear(userId);
}

async function getLatest(userId) {
  return callWith401Retry(userId, async (sess) => {
    const data = await lluConnections(sess.region, sess.token, sess.accountIdHash);
    const first = data?.data?.[0];
    if (!first) {
      const e = new Error("no patients linked");
      e.upstream = true;
      throw e;
    }
    // Cache patientId
    if (first.patientId && first.patientId !== sess.patientId) {
      l1Set(userId, { patientId: first.patientId });
      saveCacheFields(userId, { cached_patient_id: first.patientId }).catch(() => {});
    }
    const cur = mapMeasurement(first.glucoseMeasurement);
    return { current: cur };
  });
}

async function getHistory(userId) {
  return callWith401Retry(userId, async (sess) => {
    let patientId = sess.patientId;
    if (!patientId) {
      const conn = await lluConnections(sess.region, sess.token, sess.accountIdHash);
      patientId = conn?.data?.[0]?.patientId;
      if (!patientId) {
        const e = new Error("no patients linked");
        e.upstream = true;
        throw e;
      }
      l1Set(userId, { patientId });
      saveCacheFields(userId, { cached_patient_id: patientId }).catch(() => {});
    }
    const g = await lluGraph(sess.region, sess.token, sess.accountIdHash, patientId);
    const conn = g?.data?.connection;
    const history = (g?.data?.graphData || []).map(mapMeasurement).filter(Boolean);
    return {
      current: mapMeasurement(conn?.glucoseMeasurement),
      history,
    };
  });
}

module.exports = {
  setCredentials,
  deleteCredentials,
  getLatest,
  getHistory,
  _internal: { l1Clear, sha256Hex },
};
