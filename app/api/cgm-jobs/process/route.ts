import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";
// Use the source dispatcher (lib/cgm/index) so users connected via Nightscout
// get their post-meal BG follow-ups from Nightscout instead of LLU. The
// dispatcher's return shape is a SUPERSET of the LLU one (adds a `source`
// field) so existing `out.current` / `out.history` usage below is unchanged.
import { getHistory } from "@/lib/cgm";
import type { Reading } from "@/lib/cgm/llu";
import type { LogType, FetchType, CgmFetchJob } from "@/lib/cgmJobs";
import { parseDbTs, parseLluTs } from "@/lib/time";
import { computeDerivedCurveFields, pickSlotValue, type MealSample } from "@/lib/cgm/mealCurve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5 * 60 * 1000;          // 5 min
const MATCH_WINDOW_MS = 10 * 60 * 1000;        // ±10 min around fetch_time
// Meals: short window — a meal +1h job that hasn't matched within an
// hour after expected time is almost certainly missed (the user likely
// has a manual reading instead).
const MEAL_ABANDON_AFTER_MS = 60 * 60 * 1000;  // 1h
// Bolus / Basal: match the LLU history depth (~12h). The user often
// closes the app between meals; we should keep retrying as long as the
// CGM history could plausibly contain the matching reading. Combined
// with age-only finalization (below) this means the +1h / +2h job is
// resolved as soon as the user opens the app within ~12h of the bolus.
const INSULIN_ABANDON_AFTER_MS = 12 * 60 * 60 * 1000; // 12h
// Exercise: workouts can be logged retroactively or the user might
// close the app and return hours later. Within this window we still
// attempt to recover the value from CGM history; beyond it we mark
// the job 'skipped'.
const EXERCISE_ABANDON_AFTER_MS = 3 * 60 * 60 * 1000; // 3h

function targetColumn(logType: LogType, fetchType: FetchType): { table: string; column: string } | null {
  if (logType === "meal") {
    if (fetchType === "bg_1h") return { table: "meals", column: "bg_1h" };
    if (fetchType === "bg_2h") return { table: "meals", column: "bg_2h" };
  }
  if (logType === "bolus" || logType === "basal") {
    if (fetchType === "after_1h")  return { table: "insulin_logs", column: "glucose_after_1h" };
    if (fetchType === "after_2h")  return { table: "insulin_logs", column: "glucose_after_2h" };
    if (fetchType === "after_12h") return { table: "insulin_logs", column: "glucose_after_12h" };
    if (fetchType === "after_24h") return { table: "insulin_logs", column: "glucose_after_24h" };
  }
  if (logType === "exercise") {
    if (fetchType === "at_end")        return { table: "exercise_logs", column: "glucose_at_end" };
    if (fetchType === "exer_after_1h") return { table: "exercise_logs", column: "glucose_after_1h" };
  }
  return null;
}

/** Find the reading whose timestamp is closest to target (within window). */
function pickReadingNear(history: Reading[], targetMs: number, windowMs: number): Reading | null {
  let best: Reading | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const r of history) {
    if (!r.timestamp || r.value == null) continue;
    const t = parseLluTs(r.timestamp);
    if (t == null) continue;
    const d = Math.abs(t - targetMs);
    if (d <= windowMs && d < bestDiff) {
      best = r;
      bestDiff = d;
    }
  }
  return best;
}

/**
 * POST /api/cgm-jobs/process
 * Run through the user's pending jobs whose fetch_time is in the past,
 * try to resolve each via the CGM history, and update both the job row
 * and the corresponding log row's target column.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });

  const admin = adminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Task #187: one-time-on-deploy backfill of `meal_curve_180` jobs.
  // Runs cheaply on every process call (idempotent: only inserts for
  // meals from the last 24h that don't already have a curve job). This
  // backfills meals logged BEFORE the feature shipped without needing
  // a separate cron.
  await backfillMealCurveJobs(admin, user.id, nowIso);
  // Throttle re-attempts: a job that already failed once this pass
  // shouldn't be retried again until RETRY_DELAY_MS has elapsed.
  // We compare against `updated_at` (which is bumped on every retry)
  // — `retry_count = 0` is allowed through immediately so first
  // attempts aren't held back. This lets us keep `fetch_time`
  // immutable as the original target, so the abandon-age check is
  // stable across retries.
  const retryCutoffIso = new Date(nowMs - RETRY_DELAY_MS).toISOString();

  // Pull due pending jobs (cap to 50 per pass to keep latency bounded).
  const { data: jobs, error: qErr } = await admin
    .from("cgm_fetch_jobs")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .lte("fetch_time", nowIso)
    .or(`retry_count.eq.0,updated_at.lte.${retryCutoffIso}`)
    .order("fetch_time", { ascending: true })
    .limit(50);
  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }
  const due = (jobs || []) as CgmFetchJob[];
  if (due.length === 0) {
    return NextResponse.json({ fetched: 0, failed: 0, skipped: 0, pending: 0 });
  }

  // Pull CGM history once. If the user has no CGM connected, mark every
  // due job as 'skipped' (no error).
  let history: Reading[] = [];
  let current: Reading | null = null;
  let cgmAvailable = true;
  try {
    const out = await getHistory(user.id);
    history = out?.history || [];
    current = out?.current || null;
  } catch (e) {
    cgmAvailable = false;
    console.info("[cgm-jobs/process] CGM not available:", (e as Error)?.message || e);
  }

  let fetched = 0, failed = 0, skipped = 0, stillPending = 0;

  for (const job of due) {
    if (!cgmAvailable) {
      await admin.from("cgm_fetch_jobs")
        .update({ status: "skipped", error_msg: "CGM not connected", updated_at: nowIso })
        .eq("id", job.id);
      skipped++;
      continue;
    }

    const fetchTimeMs = parseDbTs(job.fetch_time);
    const ageMs = nowMs - fetchTimeMs;

    // Task #187: meal_curve_180 has its own resolution path — fetch the
    // full 0–180 min slice from CGM history, upsert into
    // `meal_glucose_samples`, and write the derived window aggregates
    // (and back-fill bg_1h/bg_2h from the curve) on the meals row.
    if (job.log_type === "meal" && job.fetch_type === "meal_curve_180") {
      const r = await processMealCurveJob(admin, job, history, nowIso);
      if (r === "fetched") fetched++;
      else if (r === "skipped") skipped++;
      else if (r === "failed") failed++;
      else stillPending++;
      continue;
    }

    // 1) Try historical match first (closest reading within ±10min of fetch_time).
    let value: number | null = null;
    const hit = pickReadingNear(history, fetchTimeMs, MATCH_WINDOW_MS);
    if (hit && typeof hit.value === "number") {
      value = hit.value;
    } else if (ageMs <= MATCH_WINDOW_MS && current?.value != null) {
      // 2) If the job is fresh (within the match window), accept current.
      value = current.value;
    }

    if (value != null) {
      const tc = targetColumn(job.log_type, job.fetch_type);
      if (tc) {
        // Don't overwrite a manually entered value — only fill if NULL.
        try {
          const { data: rowRaw } = await admin.from(tc.table).select("*").eq("id", job.log_id).maybeSingle();
          const row = rowRaw as unknown as Record<string, unknown> | null;
          const cur = row ? row[tc.column] : null;
          if (row && (cur == null || cur === "")) {
            await admin.from(tc.table).update({ [tc.column]: value }).eq("id", job.log_id);
          }
        } catch (e) {
          console.warn("[cgm-jobs/process] writeback failed:", e);
        }
      }
      await admin.from("cgm_fetch_jobs")
        .update({ status: "fetched", value_mgdl: value, fetched_at: nowIso, updated_at: nowIso })
        .eq("id", job.id);
      fetched++;
      continue;
    }

    // No data found. Per-log-type tolerance (see ABANDON constants):
    //   - meal:     1h  (retries OR age — short window matches users'
    //               typical "log meal, check phone within an hour" loop)
    //   - bolus/basal: 12h (age-only — matches LLU history depth so an
    //               app-reopen the same evening still resolves the +1h
    //               and +2h checks; MAX_RETRIES would otherwise
    //               abandon after ~10 ticks, killing this window)
    //   - exercise: 3h  (age-only — workouts can be logged retroactively
    //               or the user might close the app and return hours later)
    //
    // Past the abandon window we mark the job 'skipped' for
    // bolus/basal/exercise (clean outcome, the UI offers a manual
    // override) and 'failed' for meals (preserves existing semantics).
    const isMeal = job.log_type === "meal";
    const isExercise = job.log_type === "exercise";
    const abandonMs =
      isMeal     ? MEAL_ABANDON_AFTER_MS     :
      isExercise ? EXERCISE_ABANDON_AFTER_MS :
                   INSULIN_ABANDON_AFTER_MS;
    const overAge = ageMs >= abandonMs;
    const overRetries = job.retry_count >= MAX_RETRIES;
    // Only meals use the dual cutoff. Insulin/exercise use age-only so
    // the worker keeps trying as long as the CGM history could plausibly
    // contain the matching reading.
    const shouldFinalize = isMeal ? (overRetries || overAge) : overAge;
    if (shouldFinalize) {
      const finalStatus: "failed" | "skipped" = isMeal ? "failed" : "skipped";
      const errMsg = isExercise
        ? "no CGM data within 3h of workout time"
        : isMeal
        ? "no CGM data near fetch_time"
        : "no CGM data within 12h of expected time";
      await admin.from("cgm_fetch_jobs")
        .update({ status: finalStatus, error_msg: errMsg, updated_at: nowIso })
        .eq("id", job.id);
      if (finalStatus === "skipped") skipped++;
      else failed++;
    } else {
      // Bump retry_count + updated_at only — fetch_time stays as the
      // ORIGINAL target so the next pass's `ageMs = nowMs - fetch_time`
      // computation is stable. The throttle in the pickup query above
      // (updated_at <= now - RETRY_DELAY_MS) prevents busy-looping.
      await admin.from("cgm_fetch_jobs")
        .update({ retry_count: job.retry_count + 1, updated_at: nowIso })
        .eq("id", job.id);
      stillPending++;
    }
  }

  return NextResponse.json({ fetched, failed, skipped, pending: stillPending });
}

// ---------------------------------------------------------------------------
// Task #187: process a `meal_curve_180` job.
//
// Slices the CGM history to the 0–180 min window after `meal.meal_time`,
// upserts each sample into `meal_glucose_samples` (idempotent on the
// `(meal_id, t_offset_min)` UNIQUE), and writes the window-level
// aggregates (min/max/peak/AUC/hypo/min_60_180) plus legacy bg_1h/bg_2h
// back to the meals row. Marks the job 'fetched' on success, 'skipped'
// when the meal row is gone or the window is empty after the abandon
// horizon, otherwise leaves the job pending for the next pass.
// ---------------------------------------------------------------------------
type AdminClient = ReturnType<typeof adminClient>;

// One-time deploy backfill: enqueue `meal_curve_180` jobs for the
// caller's meals in the last 24h that don't already have one. Cheap
// idempotent insert — UNIQUE constraint isn't strictly needed because
// we filter on existing jobs first, but the call is small enough to
// run on every /process tick and self-heal mis-aligned states.
async function backfillMealCurveJobs(
  admin: AdminClient,
  userId: string,
  nowIso: string,
): Promise<void> {
  const sinceIso = new Date(Date.parse(nowIso) - 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data: meals } = await admin
      .from("meals")
      .select("id, meal_time, created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso);
    const mealList = (meals as { id: string; meal_time: string | null; created_at: string }[] | null) || [];
    if (mealList.length === 0) return;

    const ids = mealList.map(m => m.id);
    const { data: existing } = await admin
      .from("cgm_fetch_jobs")
      .select("log_id")
      .eq("user_id", userId)
      .eq("fetch_type", "meal_curve_180")
      .in("log_id", ids);
    const have = new Set((existing as { log_id: string }[] | null || []).map(r => r.log_id));

    const rows = mealList
      .filter(m => !have.has(m.id))
      .map(m => {
        const refMs = parseDbTs(m.meal_time ?? m.created_at);
        return {
          user_id:    userId,
          log_id:     m.id,
          log_type:   "meal" as const,
          fetch_type: "meal_curve_180" as const,
          fetch_time: new Date(refMs + 180 * 60_000).toISOString(),
          status:     "pending" as const,
        };
      });
    if (rows.length === 0) return;
    await admin.from("cgm_fetch_jobs").insert(rows);
  } catch (e) {
    console.warn("[cgm-jobs/process] backfill meal_curve_180 failed:", (e as Error)?.message || e);
  }
}

const MEAL_CURVE_ABANDON_AFTER_MS = 12 * 60 * 60 * 1000; // 12h

async function processMealCurveJob(
  admin: AdminClient,
  job: CgmFetchJob,
  history: Reading[],
  nowIso: string,
): Promise<"fetched" | "skipped" | "failed" | "pending"> {
  const fetchTimeMs = parseDbTs(job.fetch_time);
  const nowMs = Date.parse(nowIso);
  const ageMs = nowMs - fetchTimeMs;
  const overAge = ageMs >= MEAL_CURVE_ABANDON_AFTER_MS;

  // Load the meal row to anchor the window on `meal_time` (falls back
  // to created_at if meal_time is absent on legacy rows).
  const { data: mealRowRaw } = await admin
    .from("meals")
    .select("id, user_id, meal_time, created_at, bg_1h, bg_2h, bg_1h_at, bg_2h_at")
    .eq("id", job.log_id)
    .maybeSingle();
  const mealRow = mealRowRaw as {
    id: string; user_id: string; meal_time: string | null; created_at: string;
    bg_1h: number | null; bg_2h: number | null;
    bg_1h_at: string | null; bg_2h_at: string | null;
  } | null;
  if (!mealRow) {
    await admin.from("cgm_fetch_jobs")
      .update({ status: "skipped", error_msg: "meal row missing", updated_at: nowIso })
      .eq("id", job.id);
    return "skipped";
  }
  const mealTimeMs = parseDbTs(mealRow.meal_time ?? mealRow.created_at);

  // Slice the CGM history to (mealTime, mealTime + 180min].
  const WINDOW_MS = 180 * 60_000;
  const samples: MealSample[] = [];
  type SampleRow = { meal_id: string; user_id: string; t_offset_min: number; value_mgdl: number; source: string; captured_at: string };
  const sampleRows: SampleRow[] = [];
  for (const r of history) {
    if (!r.timestamp || r.value == null) continue;
    const t = parseLluTs(r.timestamp);
    if (t == null) continue;
    const off = t - mealTimeMs;
    if (off < 0 || off > WINDOW_MS) continue;
    const tMin = Math.round(off / 60_000);
    samples.push({ t_offset_min: tMin, value_mgdl: r.value });
    sampleRows.push({
      meal_id:      mealRow.id,
      user_id:      mealRow.user_id,
      t_offset_min: tMin,
      value_mgdl:   r.value,
      source:       (r as Reading & { source?: string }).source || "llu",
      captured_at:  new Date(t).toISOString(),
    });
  }

  if (sampleRows.length === 0) {
    if (overAge) {
      await admin.from("cgm_fetch_jobs")
        .update({ status: "skipped", error_msg: "no CGM samples in 0–180 min window", updated_at: nowIso })
        .eq("id", job.id);
      return "skipped";
    }
    // Bump retry; CGM may simply not have refreshed yet.
    await admin.from("cgm_fetch_jobs")
      .update({ retry_count: job.retry_count + 1, updated_at: nowIso })
      .eq("id", job.id);
    return "pending";
  }

  // Idempotent upsert on (meal_id, t_offset_min).
  const { error: upErr } = await admin
    .from("meal_glucose_samples")
    .upsert(sampleRows, { onConflict: "meal_id,t_offset_min" });
  if (upErr) {
    console.warn("[cgm-jobs/process] meal_glucose_samples upsert failed:", upErr.message);
    await admin.from("cgm_fetch_jobs")
      .update({ retry_count: job.retry_count + 1, error_msg: upErr.message, updated_at: nowIso })
      .eq("id", job.id);
    return "pending";
  }

  // Compute derived fields + back-fill legacy bg_1h/bg_2h from samples
  // when those columns are still NULL (don't overwrite manual entries).
  const derived = computeDerivedCurveFields(samples);
  const update: Record<string, unknown> = { ...derived };

  if (mealRow.bg_1h == null) {
    const s60 = pickSlotValue(samples, 60, 15);
    if (s60) {
      update.bg_1h = s60.value_mgdl;
      update.bg_1h_at = new Date(mealTimeMs + s60.t_offset_min * 60_000).toISOString();
    }
  }
  if (mealRow.bg_2h == null) {
    const s120 = pickSlotValue(samples, 120, 15);
    if (s120) {
      update.bg_2h = s120.value_mgdl;
      update.bg_2h_at = new Date(mealTimeMs + s120.t_offset_min * 60_000).toISOString();
    }
  }

  const { error: mErr } = await admin.from("meals").update(update).eq("id", mealRow.id);
  if (mErr) {
    console.warn("[cgm-jobs/process] meals update failed:", mErr.message);
    await admin.from("cgm_fetch_jobs")
      .update({ retry_count: job.retry_count + 1, error_msg: mErr.message, updated_at: nowIso })
      .eq("id", job.id);
    return "pending";
  }

  await admin.from("cgm_fetch_jobs")
    .update({
      status: "fetched",
      value_mgdl: derived.max_bg_180,
      fetched_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", job.id);
  return "fetched";
}
