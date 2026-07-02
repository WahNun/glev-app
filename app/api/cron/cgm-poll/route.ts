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
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/cgm/supabase";
import * as llu from "@/lib/cgm/llu";
import * as nightscout from "@/lib/cgm/nightscout";
import * as dexcom from "@/lib/cgm/dexcom";
import type { Reading } from "@/lib/cgm/llu";
import { parseLluTs } from "@/lib/time";
import { fillNearbyChecks } from "@/lib/mealTimelineChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-user cap — LLU returns ~144 graphData points (12h @ 5min). Even
// if a future source returns more we don't want a runaway upsert.
const MAX_ROWS_PER_USER = 500;

type PollSource = "llu" | "nightscout" | "dexcom";

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

async function insertMealGlucoseCurve(
  admin: SupabaseClient,
  userId: string,
  rows: SampleRow[],
): Promise<void> {
  const nowMs = Date.now();
  const windowStart = new Date(nowMs - 3 * 60 * 60_000).toISOString();

  const { data: recentMeals } = await admin
    .from("meals")
    .select("id, meal_time, created_at")
    .eq("user_id", userId)
    .gte("meal_time", windowStart);

  if (!recentMeals?.length) return;

  const curveRows: Array<{
    user_id: string;
    meal_id: string;
    measured_at: string;
    t_offset_min: number;
    value_mgdl: number;
    source: string;
  }> = [];

  for (const meal of recentMeals) {
    const mealMs = new Date(meal.meal_time ?? meal.created_at).getTime();
    for (const row of rows) {
      const readingMs = new Date(row.timestamp).getTime();
      const tOffsetMin = Math.round((readingMs - mealMs) / 60_000);
      if (tOffsetMin < 0 || tOffsetMin > 180) continue;
      curveRows.push({
        user_id:      userId,
        meal_id:      meal.id,
        measured_at:  row.timestamp,
        t_offset_min: tOffsetMin,
        value_mgdl:   row.value_mgdl,
        source:       row.source,
      });
    }
  }

  if (!curveRows.length) return;

  await admin
    .from("meal_glucose_curve")
    .upsert(curveRows, { onConflict: "meal_id,measured_at", ignoreDuplicates: true });
}

/** After upserting a fresh batch of CGM readings, check whether any
 *  backfilled rows (timestamp > 10 min old — sensor gap / reconnect)
 *  cover post-meal or post-bolus windows that were missed while the
 *  sensor was offline.  Writes bg_1h / bg_2h and glucose_after_1h / 2h
 *  directly when the column is still NULL and a matching sample exists. */
async function retroactivelyFillSensorGap(
  admin: SupabaseClient,
  userId: string,
  rows: SampleRow[],
): Promise<void> {
  const nowMs = Date.now();
  const BACKFILL_THRESHOLD_MS = 10 * 60_000;
  const MATCH_WINDOW_MS       = 10 * 60_000;
  const MIN                   = 60_000;

  const backfilled = rows.filter(
    r => nowMs - new Date(r.timestamp).getTime() > BACKFILL_THRESHOLD_MS,
  );
  if (backfilled.length === 0) return;

  const backfillTimes = backfilled.map(r => new Date(r.timestamp).getTime());
  const gapMinMs = Math.min(...backfillTimes);
  const gapMaxMs = Math.max(...backfillTimes);

  function pickNear(targetMs: number): { value: number; ts: string } | null {
    let best: { value: number; ts: string; dt: number } | null = null;
    for (const r of rows) {
      const rMs = new Date(r.timestamp).getTime();
      const dt  = Math.abs(rMs - targetMs);
      if (dt > MATCH_WINDOW_MS) continue;
      if (!best || dt < best.dt) best = { value: r.value_mgdl, ts: r.timestamp, dt };
    }
    return best ? { value: best.value, ts: best.ts } : null;
  }

  // Meals whose bg_1h target (+60 min) or bg_2h target (+120 min) falls
  // within the backfilled time range.
  const windowStartIso = new Date(gapMinMs - 130 * MIN).toISOString();
  const windowEndIso   = new Date(gapMaxMs -  50 * MIN).toISOString();

  const { data: meals } = await admin
    .from("meals")
    .select("id, meal_time, created_at, bg_1h, bg_2h")
    .eq("user_id", userId)
    .gte("meal_time", windowStartIso)
    .lte("meal_time", windowEndIso)
    .or("bg_1h.is.null,bg_2h.is.null");

  for (const meal of (meals ?? []) as Record<string, unknown>[]) {
    const mealMs = new Date(((meal.meal_time ?? meal.created_at) as string)).getTime();
    const updates: Record<string, unknown> = {};

    if (meal.bg_1h == null) {
      const hit = pickNear(mealMs + 60 * MIN);
      if (hit) { updates.bg_1h = hit.value; updates.bg_1h_at = hit.ts; }
    }
    if (meal.bg_2h == null) {
      const hit = pickNear(mealMs + 120 * MIN);
      if (hit) { updates.bg_2h = hit.value; updates.bg_2h_at = hit.ts; }
    }

    if (Object.keys(updates).length > 0) {
      await admin.from("meals").update(updates).eq("id", meal.id as string);
    }
  }

  // Bolus logs — glucose_after_1h / glucose_after_2h (no _at columns).
  const { data: boluslogs } = await admin
    .from("insulin_logs")
    .select("id, created_at, glucose_after_1h, glucose_after_2h")
    .eq("user_id", userId)
    .eq("insulin_type", "bolus")
    .gte("created_at", windowStartIso)
    .lte("created_at", windowEndIso)
    .or("glucose_after_1h.is.null,glucose_after_2h.is.null");

  for (const log of (boluslogs ?? []) as Record<string, unknown>[]) {
    const logMs = new Date(log.created_at as string).getTime();
    const updates: Record<string, unknown> = {};

    if (log.glucose_after_1h == null) {
      const hit = pickNear(logMs + 60 * MIN);
      if (hit) updates.glucose_after_1h = hit.value;
    }
    if (log.glucose_after_2h == null) {
      const hit = pickNear(logMs + 120 * MIN);
      if (hit) updates.glucose_after_2h = hit.value;
    }

    if (Object.keys(updates).length > 0) {
      await admin.from("insulin_logs").update(updates).eq("id", log.id as string);
    }
  }
}

/** Injectable dependencies for `pollOne` — lets unit tests swap out
 *  the real network calls and Supabase writes with fakes. */
export interface PollOneDeps {
  getHistory?: (userId: string, minAgo: number) => Promise<{ history: Reading[]; current?: Reading | null }>;
  adminInstance?: import("@supabase/supabase-js").SupabaseClient;
  fillFn?: typeof fillNearbyChecks;
}

function resolveGetHistory(
  source: PollSource
): (userId: string, minAgo: number) => Promise<{ history: Reading[]; current?: Reading | null }> {
  if (source === "nightscout") return nightscout.getHistory;
  if (source === "dexcom")    return dexcom.getHistory;
  return llu.getHistory;
}

export async function pollOne(
  userId: string,
  source: PollSource,
  deps?: PollOneDeps,
): Promise<{ ok: true; inserted: number; source: PollSource } | { ok: false; source: PollSource; error: string }> {
  try {
    const admin = deps?.adminInstance ?? adminClient();
    const fillFn = deps?.fillFn ?? fillNearbyChecks;

    // Determine how far back to fetch by checking the last known cgm_samples row.
    // If the sensor was offline for 2h, minAgo ≈ 120 and adapters extend their
    // fetch window so backfill readings with historical timestamps land in the DB.
    const now = new Date();
    const { data: lastSample } = await admin
      .from("cgm_samples")
      .select("timestamp")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rawMinAgo = lastSample
      ? Math.floor((now.getTime() - new Date(lastSample.timestamp).getTime()) / 60_000)
      : -1;
    const minAgo = rawMinAgo > 0 ? Math.min(rawMinAgo, 360) : 360;

    const getHistoryFn = deps?.getHistory ?? resolveGetHistory(source);
    const out = await getHistoryFn(userId, minAgo);
    const history = out?.history || [];
    // LLU and Dexcom expose a distinct "current" reading (live connection data);
    // Nightscout's current == history[0], so we skip it to avoid duplicate rows.
    const current = (source === "llu" || source === "dexcom") ? out?.current ?? null : null;
    if (history.length === 0 && !current) return { ok: true, inserted: 0, source };

    const rows: SampleRow[] = [];
    // Für LLU zusätzlich den Live-Wert (connection.glucoseMeasurement)
    // mit aufnehmen — der ist ~jede Minute frisch, während graphData nur
    // alle 15 min aktualisiert wird. Duplikate (Live-Wert == Graph-Sample)
    // fängt der UNIQUE-INDEX (user_id, timestamp) via ignoreDuplicates ab.
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

    const { error } = await admin
      .from("cgm_samples")
      .upsert(rows, { onConflict: "user_id,timestamp", ignoreDuplicates: true });
    if (error) {
      return { ok: false, source, error: error.message };
    }
    // Fire-and-forget: try to fill open meal_timeline_checks within
    // ±15 min of each newly stored reading. Same pattern as Apple Health sync.
    for (const row of rows) {
      fillFn(admin, userId, row.value_mgdl, new Date(row.timestamp)).catch(() => {});
    }
    // Fire-and-forget: write full 3h post-meal glucose curve for analytics.
    void insertMealGlucoseCurve(admin, userId, rows).catch(() => {});
    // Fire-and-forget: retroactively fill bg_1h/bg_2h that were NULL due to
    // sensor gap. Only acts on backfilled rows (timestamp > 10 min old).
    void retroactivelyFillSensorGap(admin, userId, rows).catch(() => {});
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
      .select("user_id, llu_email, dexcom_username"),
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
  type CredRow    = { user_id: string; llu_email: string | null; dexcom_username: string | null };

  const profileByUser = new Map<string, ProfileRow>();
  for (const p of (profilesRes.data ?? []) as ProfileRow[]) {
    profileByUser.set(p.user_id, p);
  }
  const lluUsers    = new Set<string>();
  const dexcomUsers = new Set<string>();
  for (const c of (credsRes.data ?? []) as CredRow[]) {
    if (c.llu_email)       lluUsers.add(c.user_id);
    if (c.dexcom_username) dexcomUsers.add(c.user_id);
  }

  // Resolve effective source per user — mirrors lib/cgm/index.ts resolveSource().
  const toPoll: { userId: string; source: PollSource }[] = [];
  const seen = new Set<string>();
  for (const p of profileByUser.values()) {
    seen.add(p.user_id);
    const explicit = p.cgm_source;
    if (explicit === "apple_health") continue;
    if (explicit === "dexcom" && dexcomUsers.has(p.user_id)) {
      toPoll.push({ userId: p.user_id, source: "dexcom" });
      continue;
    }
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
  // Same catch-all for Dexcom users without a profile row.
  for (const uid of dexcomUsers) {
    if (!seen.has(uid)) toPoll.push({ userId: uid, source: "dexcom" });
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
      // Persist so /glev-ops/cgm-errors shows poll failures without log-diving.
      admin.from("cgm_error_logs").insert({
        user_id: userId,
        error_code: "poll_failed",
        error_message: r.error,
        cgm_source: r.source,
        context: { cron: "cgm-poll" },
      }).catch(() => {});
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
