// Cron worker — polls every connected LLU / Nightscout user's CGM
// history every */2 min and persists the readings into cgm_samples
// for cross-event use (Insights hypo detection, future Engine trend,
// weekly report, etc.).
//
// Why this exists:
//   The pre-existing /api/cgm-jobs/process worker only writes CGM
//   values AROUND logged events (meal_glucose_samples /
//   bolus_glucose_samples / exercise_glucose_samples). Readings with
//   no nearby event are LOST. Insights' hypo / TBR / variability
//   tiles therefore miss clinical hypos that happen between events —
//   e.g. a 5h morning low without a meal/bolus/exercise nearby. This
//   cron closes that gap by pulling the CGM history for LLU +
//   Nightscout users continuously and storing it. Apple Health users
//   are skipped because their iOS shell already pushes a continuous
//   stream into apple_health_readings.
//
// Schedule expectation: hit this endpoint every 2 min from Vercel cron.
// The handler is idempotent — the (user_id, timestamp) UNIQUE INDEX on
// cgm_samples means repeated polls of the same window = no duplicates.
//
// Auth: Bearer token. Header `Authorization: Bearer <CRON_SECRET>`.
// Same pattern as /api/cron/flush-outbox. We accept GET (Vercel cron
// uses GET) and POST (manual curl testing).
//
// Failure mode: per-user errors (LLU 401, Nightscout 5xx, etc.) are
// logged but DO NOT stop the loop — other users still get polled.
// The route always returns 200 with a per-user breakdown so a stuck
// LLU account never wedges the cron for everybody else.

import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/cgm/supabase";
import * as llu from "@/lib/cgm/llu";
import * as nightscout from "@/lib/cgm/nightscout";
import type { Reading } from "@/lib/cgm/llu";
import { parseLluTs } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-user cap — LLU returns ~144 graphData points (12h @ 5min). Even
// if a future source returns more we don't want a runaway upsert.
const MAX_ROWS_PER_USER = 500;

type PollSource = "llu" | "nightscout";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Source-agnostic shape of one row we'll upsert. */
type SampleRow = {
  user_id: string;
  timestamp: string;       // ISO
  value_mgdl: number;      // rounded integer mg/dL
  source: PollSource;
};

/** Convert a Reading from any adapter to a row. Returns null if the
 *  reading lacks a usable timestamp or value. */
function readingToRow(userId: string, source: PollSource, r: Reading): SampleRow | null {
  const v = r?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const tMs = parseLluTs(r.timestamp);
  if (tMs == null || !Number.isFinite(tMs)) return null;
  return {
    user_id: userId,
    timestamp: new Date(tMs).toISOString(),
    value_mgdl: Math.round(v),
    source,
  };
}

async function pollOne(
  userId: string,
  source: PollSource,
): Promise<{ ok: true; inserted: number; source: PollSource } | { ok: false; source: PollSource; error: string }> {
  try {
    const out = source === "llu"
      ? await llu.getHistory(userId)
      : await nightscout.getHistory(userId);
    const history = out?.history || [];
    const current = source === "llu" ? out?.current ?? null : null;
    if (history.length === 0 && !current) return { ok: true, inserted: 0, source };

    const rows: SampleRow[] = [];
    // Für LLU zusätzlich den Live-Wert (connection.glucoseMeasurement)
    // mit aufnehmen — der ist ~jede Minute frisch, während graphData nur
    // alle 15 min aktualisiert wird. Duplikate (Live-Wert == Graph-Sample)
    // fängt der UNIQUE-Index (user_id, timestamp) via ignoreDuplicates ab.
    // Nightscout liefert current = history[0], dort nichts extra zu tun.
    if (current) {
      const row = readingToRow(userId, source, current);
      if (row) rows.push(row);
    }
    for (const r of history) {
      const row = readingToRow(userId, source, r);
      if (row) rows.push(row);
      if (rows.length >= MAX_ROWS_PER_USER) break;
    }
    if (rows.length === 0) return { ok: true, inserted: 0, source };

    const { error } = await adminClient()
      .from("cgm_samples")
      .upsert(rows, { onConflict: "user_id,timestamp", ignoreDuplicates: true });
    if (error) {
      return { ok: false, source, error: error.message };
    }
    return { ok: true, inserted: rows.length, source };
  } catch (e) {
    return { ok: false, source, error: (e as Error)?.message || String(e) };
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error("[cron/cgm-poll] CRON_SECRET not configured or too short (min 16 chars)");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return unauthorized();

  const admin = adminClient();

  // Two pools to poll:
  //   1. LLU — any user with a cgm_credentials row that has an LLU
  //      email AND whose profiles.cgm_source is NOT 'apple_health' /
  //      'nightscout' (so Apple Health users with stale legacy LLU
  //      creds aren't double-polled).
  //   2. Nightscout — any user with profiles.nightscout_url set AND
  //      cgm_source NOT 'apple_health'.
  //
  // We do the source-determination join in JS rather than SQL so the
  // logic stays parallel to lib/cgm/index.ts resolveSource() — if
  // that rule ever changes (e.g. add a new source), the cron picks
  // it up automatically by extending the same switch.
  const [credsRes, profilesRes] = await Promise.all([
    admin
      .from("cgm_credentials")
      .select("user_id, llu_email"),
    admin
      .from("profiles")
      .select("user_id, cgm_source, nightscout_url"),
  ]);

  if (credsRes.error) {
    console.error("[cron/cgm-poll] failed to read cgm_credentials:", credsRes.error);
    return NextResponse.json({ error: credsRes.error.message }, { status: 500 });
  }
  if (profilesRes.error) {
    console.error("[cron/cgm-poll] failed to read profiles:", profilesRes.error);
    return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
  }

  type ProfileRow = { user_id: string; cgm_source: string | null; nightscout_url: string | null };
  type CredRow    = { user_id: string; llu_email: string | null };

  const profileByUser = new Map<string, ProfileRow>();
  for (const p of (profilesRes.data ?? []) as ProfileRow[]) {
    profileByUser.set(p.user_id, p);
  }
  const lluUsers = new Set<string>();
  for (const c of (credsRes.data ?? []) as CredRow[]) {
    if (c.llu_email) lluUsers.add(c.user_id);
  }

  // Resolve effective source per user — same rule as lib/cgm/index.ts
  // resolveSource(): explicit cgm_source wins, otherwise nightscout_url
  // presence picks Nightscout, otherwise legacy LLU.
  const toPoll: { userId: string; source: PollSource }[] = [];
  const seen = new Set<string>();
  for (const p of profileByUser.values()) {
    seen.add(p.user_id);
    const explicit = p.cgm_source;
    if (explicit === "apple_health") continue;
    if (explicit === "nightscout" && p.nightscout_url) {
      toPoll.push({ userId: p.user_id, source: "nightscout" });
      continue;
    }
    if (explicit === "llu" && lluUsers.has(p.user_id)) {
      toPoll.push({ userId: p.user_id, source: "llu" });
      continue;
    }
    if (!explicit) {
      // Legacy auto-detect: nightscout_url present → Nightscout, else LLU.
      if (p.nightscout_url) {
        toPoll.push({ userId: p.user_id, source: "nightscout" });
      } else if (lluUsers.has(p.user_id)) {
        toPoll.push({ userId: p.user_id, source: "llu" });
      }
    }
  }
  // Users with LLU creds but NO profile row yet (rare — onboarding
  // race) — still poll them as legacy LLU.
  for (const uid of lluUsers) {
    if (!seen.has(uid)) toPoll.push({ userId: uid, source: "llu" });
  }

  if (toPoll.length === 0) {
    console.log(`cgm-poll done in ${Date.now() - start}ms, ${toPoll.length} users`);
    return NextResponse.json({
      ok: true,
      polledUsers: 0,
      okUsers: 0,
      failedUsers: 0,
      totalInserted: 0,
    });
  }

  // Poll users sequentially — Vercel functions have CPU/memory caps
  // and we'd rather take ~30s on 100 users than spawn 100 LLU calls
  // in parallel and trip rate-limiting. If/when the user pool grows
  // past a few hundred we'll batch this with concurrency=10.
  let okUsers = 0;
  let failedUsers = 0;
  let totalInserted = 0;
  const errors: { user: string; source: PollSource; error: string }[] = [];
  for (const { userId, source } of toPoll) {
    const r = await pollOne(userId, source);
    if (r.ok) {
      okUsers += 1;
      totalInserted += r.inserted;
    } else {
      failedUsers += 1;
      errors.push({ user: userId, source: r.source, error: r.error });
    }
  }
  if (errors.length > 0) {
    console.warn("[cron/cgm-poll] per-user failures:", errors);
  }

  console.log(`cgm-poll done in ${Date.now() - start}ms, ${toPoll.length} users`);
  return NextResponse.json({
    ok: true,
    polledUsers: toPoll.length,
    okUsers,
    failedUsers,
    totalInserted,
  });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
