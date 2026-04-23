"use strict";

require("dotenv").config();

const express = require("express");
const { requireAuth } = require("./supabase");
const llu = require("./llu");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

// ---------------------------------------------------------------------------
// Per-request logging — userId, route, duration, status. No payload.
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const dur = Date.now() - start;
    const uid = req.user?.id || "-";
    // eslint-disable-next-line no-console
    console.log(`[cgm] uid=${uid} ${req.method} ${req.path} ${res.statusCode} ${dur}ms`);
  });
  next();
});

// ---------------------------------------------------------------------------
// Public health
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendErr(res, e) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });

  // axios upstream errors
  const code = e?.code;
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
    return res.status(504).json({ error: "upstream timeout" });
  }
  if (e?.response?.status) {
    const s = e.response.status;
    if (s === 401) return res.status(502).json({ error: "LLU rejected credentials" });
    return res.status(502).json({ error: `LLU upstream ${s}` });
  }
  if (e?.upstream) return res.status(502).json({ error: e.message });

  // eslint-disable-next-line no-console
  console.error("[cgm] internal:", e?.message || e);
  return res.status(500).json({ error: "internal" });
}

// ---------------------------------------------------------------------------
// Routes (all JWT-protected)
// ---------------------------------------------------------------------------
app.post("/cgm/credentials", requireAuth, async (req, res) => {
  try {
    const { email, password, region } = req.body || {};
    await llu.setCredentials(req.user.id, { email, password, region });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

app.delete("/cgm/credentials", requireAuth, async (req, res) => {
  try {
    await llu.deleteCredentials(req.user.id);
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

app.get("/cgm/latest", requireAuth, async (req, res) => {
  try {
    const out = await llu.getLatest(req.user.id);
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

app.get("/cgm/history", requireAuth, async (req, res) => {
  try {
    const out = await llu.getHistory(req.user.id);
    res.json(out);
  } catch (e) { sendErr(res, e); }
});

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: "not found" }));

// Last-resort error handler — never crash
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error("[cgm] unhandled:", err?.message || err);
  res.status(500).json({ error: "internal" });
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`[cgm] listening on :${PORT}`);
});

process.on("unhandledRejection", (e) => {
  // eslint-disable-next-line no-console
  console.error("[cgm] unhandledRejection:", e?.message || e);
});
process.on("uncaughtException", (e) => {
  // eslint-disable-next-line no-console
  console.error("[cgm] uncaughtException:", e?.message || e);
});
