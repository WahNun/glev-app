"use strict";

const { createClient } = require("@supabase/supabase-js");

let _admin = null;

function admin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/**
 * Verify a Supabase JWT and return the user object, or null.
 * Uses the anon key client so RLS rules apply on the user side.
 */
async function verifyJwt(token) {
  if (!token) return null;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set");

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/**
 * Express middleware: requires a valid Bearer token.
 * On success, attaches req.user = { id, email, ... }.
 */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return res.status(401).json({ error: "missing bearer token" });
    const user = await verifyJwt(m[1]);
    if (!user) return res.status(401).json({ error: "invalid token" });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "auth failed" });
  }
}

module.exports = { admin, verifyJwt, requireAuth };
