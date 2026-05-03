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
  // Task #194: same pattern for bolus and exercise curve jobs — the
  // feature shipped after some users already had logs in flight, so
  // we self-heal by enqueueing the +3h backfill jobs for any
  // bolus / exercise log from the last 24h that doesn't have one.
  await backfillBolusCurveJobs(admin, user.id, nowIso);
  await backfillExerciseCurveJobs(admin, user.id, nowIso);
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

    // Task #187 / #194: dense-curve jobs have their own resolution
    // path — fetch the full 0–180 min slice from CGM history, upsert
    // into the matching samples table, and write the derived window
    // aggregates (plus back-fill the legacy point-value slot columns)
    // on the parent log row. Handles meals, bolus, and exercise.
    const curveCfg = curveConfigFor(job.log_type, job.fetch_type);
    if (curveCfg) {
      const r = await processCurveJob(admin, job, history, nowIso, curveCfg);
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
// Task #187 + #194: dense CGM curve jobs.
//
// One generic processor handles three parallel curve flavours:
//   - meal_curve_180     → meal_glucose_samples, anchored on meal_time
//   - bolus_curve_180    → bolus_glucose_samples, anchored on the bolus
//                          log's created_at (injection instant)
//   - exercise_curve_180 → exercise_glucose_samples, anchored on the
//                          workout END (created_at + duration_minutes)
//
// Per pass it slices the CGM history to (anchor, anchor+180min],
// upserts each sample into the matching parallel table (idempotent on
// the `(log-fk, t_offset_min)` UNIQUE), writes the derived window
// aggregates onto the parent log row, and back-fills the LEGACY point
// slot columns (bg_1h/bg_2h for meals, glucose_after_1h/2h for bolus,
// glucose_at_end/after_1h for exercise) so the existing UI / PDF /
// export paths keep working without per-row migrations.
// ---------------------------------------------------------------------------
type AdminClient = ReturnType<typeof adminClient>;

interface CurveSlot {
  /** Legacy point column on the parent log row (e.g. "bg_1h"). */
  valueCol: string;
  /** Optional `_at` column (only meals carry one — insulin_logs and
   *  exercise_logs don't). */
  atCol: string | null;
  /** Target offset from the window anchor in minutes. */
  targetMin: number;
  /** ± tolerance in minutes for picking the nearest sample. */
  toleranceMin: number;
}

interface CurveConfig {
  /** Parent log table — `meals`, `insulin_logs`, `exercise_logs`. */
  logTable: string;
  /** Parallel samples table. */
  samplesTable: string;
  /** Foreign-key column in the samples table back to the log row. */
  sampleFkCol: string;
  /** Conflict target for the idempotent upsert. */
  upsertOnConflict: string;
  /** Resolves the 0-min anchor for a given parent row + job. */
  windowStart: (row: Record<string, unknown>, job: CgmFetchJob) => number;
  /** Legacy point-slot back-fills (each only fired when the column is
   *  currently NULL — manual entries are never overwritten). */
  legacySlots: CurveSlot[];
  /** Extra columns to load from the parent row (always includes id +
   *  user_id). Used to read existing slot values + the anchor column. */
  loadCols: string[];
}

const CURVE_CONFIGS: Partial<Record<LogType, Partial<Record<FetchType, CurveConfig>>>> = {
  meal: {
    meal_curve_180: {
      logTable:        "meals",
      samplesTable:    "meal_glucose_samples",
      sampleFkCol:     "meal_id",
      upsertOnConflict: "meal_id,t_offset_min",
      // Meals anchor on `meal_time` (with created_at as a legacy
      // fallback) so a back-edited meal_time still drives the curve.
      windowStart: (row) => parseDbTs(
        (row.meal_time as string | null) ?? (row.created_at as string),
      ),
      legacySlots: [
        { valueCol: "bg_1h", atCol: "bg_1h_at", targetMin:  60, toleranceMin: 15 },
        { valueCol: "bg_2h", atCol: "bg_2h_at", targetMin: 120, toleranceMin: 15 },
      ],
      loadCols: ["meal_time", "created_at", "bg_1h", "bg_2h", "bg_1h_at", "bg_2h_at"],
    },
  },
  bolus: {
    bolus_curve_180: {
      logTable:        "insulin_logs",
      samplesTable:    "bolus_glucose_samples",
      sampleFkCol:     "log_id",
      upsertOnConflict: "log_id,t_offset_min",
      // Bolus anchors on the injection instant (`created_at`).
      windowStart: (row) => parseDbTs(row.created_at as string),
      legacySlots: [
        { valueCol: "glucose_after_1h", atCol: null, targetMin:  60, toleranceMin: 15 },
        { valueCol: "glucose_after_2h", atCol: null, targetMin: 120, toleranceMin: 15 },
      ],
      loadCols: ["created_at", "glucose_after_1h", "glucose_after_2h"],
    },
  },
  exercise: {
    exercise_curve_180: {
      logTable:        "exercise_logs",
      samplesTable:    "exercise_glucose_samples",
      sampleFkCol:     "log_id",
      upsertOnConflict: "log_id,t_offset_min",
      // Exercise anchors on workout END = created_at + duration_minutes.
      windowStart: (row) => {
        const start = parseDbTs(row.created_at as string);
        const dur = Number(row.duration_minutes ?? 0);
        return start + (Number.isFinite(dur) ? dur : 0) * 60_000;
      },
      legacySlots: [
        { valueCol: "glucose_at_end",   atCol: null, targetMin:  0, toleranceMin: 15 },
        { valueCol: "glucose_after_1h", atCol: null, targetMin: 60, toleranceMin: 15 },
      ],
      loadCols: ["created_at", "duration_minutes", "glucose_at_end", "glucose_after_1h"],
    },
  },
};

function curveConfigFor(logType: LogType, fetchType: FetchType): CurveConfig | null {
  return CURVE_CONFIGS[logType]?.[fetchType] ?? null;
}

// One-time deploy backfill: enqueue curve jobs for the caller's
// recent logs that don't already have one. Cheap idempotent inserts —
// the call is small enough to run on every /process tick and
// self-heal mis-aligned states.
async function backfillCurveJobsGeneric(args: {
  admin: AdminClient;
  userId: string;
  nowIso: string;
  logTable: string;
  logType: LogType;
  fetchType: FetchType;
  /** Columns to load from the log table for anchor computation. */
  selectCols: string;
  /** Optional row-level filter (e.g. only `bolus` rows from insulin_logs).
   *  Typed loosely because the Postgrest builder generics don't survive
   *  being passed through a callback — callsites get full chainable API. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraFilter?: (q: any) => any;
  /** Compute the +180 min fetch_time from a loaded log row. */
  fetchTimeForRow: (row: Record<string, unknown>) => number;
}): Promise<void> {
  const { admin, userId, nowIso, logTable, logType, fetchType, selectCols, extraFilter, fetchTimeForRow } = args;
  const sinceIso = new Date(Date.parse(nowIso) - 24 * 60 * 60 * 1000).toISOString();
  try {
    let q = admin.from(logTable).select(selectCols).eq("user_id", userId).gte("created_at", sinceIso);
    if (extraFilter) q = extraFilter(q);
    const { data: rowsRaw } = await q;
    const rows = (rowsRaw as Record<string, unknown>[] | null) || [];
    if (rows.length === 0) return;

    const ids = rows.map(r => r.id as string);
    const { data: existing } = await admin
      .from("cgm_fetch_jobs")
      .select("log_id")
      .eq("user_id", userId)
      .eq("fetch_type", fetchType)
      .in("log_id", ids);
    const have = new Set((existing as { log_id: string }[] | null || []).map(r => r.log_id));

    const inserts = rows
      .filter(r => !have.has(r.id as string))
      .map(r => ({
        user_id:    userId,
        log_id:     r.id as string,
        log_type:   logType,
        fetch_type: fetchType,
        fetch_time: new Date(fetchTimeForRow(r)).toISOString(),
        status:     "pending" as const,
      }));
    if (inserts.length === 0) return;
    await admin.from("cgm_fetch_jobs").insert(inserts);
  } catch (e) {
    console.warn(`[cgm-jobs/process] backfill ${fetchType} failed:`, (e as Error)?.message || e);
  }
}

async function backfillMealCurveJobs(admin: AdminClient, userId: string, nowIso: string): Promise<void> {
  await backfillCurveJobsGeneric({
    admin, userId, nowIso,
    logTable: "meals", logType: "meal", fetchType: "meal_curve_180",
    selectCols: "id, meal_time, created_at",
    fetchTimeForRow: r => parseDbTs(((r.meal_time as string | null) ?? (r.created_at as string))) + 180 * 60_000,
  });
}

async function backfillBolusCurveJobs(admin: AdminClient, userId: string, nowIso: string): Promise<void> {
  await backfillCurveJobsGeneric({
    admin, userId, nowIso,
    logTable: "insulin_logs", logType: "bolus", fetchType: "bolus_curve_180",
    selectCols: "id, created_at, insulin_type",
    // Basal logs are not scored — only enqueue curves for bolus rows.
    extraFilter: q => q.eq("insulin_type", "bolus"),
    fetchTimeForRow: r => parseDbTs(r.created_at as string) + 180 * 60_000,
  });
}

async function backfillExerciseCurveJobs(admin: AdminClient, userId: string, nowIso: string): Promise<void> {
  await backfillCurveJobsGeneric({
    admin, userId, nowIso,
    logTable: "exercise_logs", logType: "exercise", fetchType: "exercise_curve_180",
    selectCols: "id, created_at, duration_minutes",
    fetchTimeForRow: r => {
      const start = parseDbTs(r.created_at as string);
      const dur = Number(r.duration_minutes ?? 0);
      const end = start + (Number.isFinite(dur) ? dur : 0) * 60_000;
      return end + 180 * 60_000;
    },
  });
}

const CURVE_ABANDON_AFTER_MS = 12 * 60 * 60 * 1000; // 12h

async function processCurveJob(
  admin: AdminClient,
  job: CgmFetchJob,
  history: Reading[],
  nowIso: string,
  cfg: CurveConfig,
): Promise<"fetched" | "skipped" | "failed" | "pending"> {
  const fetchTimeMs = parseDbTs(job.fetch_time);
  const nowMs = Date.parse(nowIso);
  const ageMs = nowMs - fetchTimeMs;
  const overAge = ageMs >= CURVE_ABANDON_AFTER_MS;

  // Load the parent log row so we can resolve the window anchor and
  // know which legacy slot columns still need back-filling.
  const cols = ["id", "user_id", ...cfg.loadCols].join(", ");
  const { data: rowRaw } = await admin
    .from(cfg.logTable)
    .select(cols)
    .eq("id", job.log_id)
    .maybeSingle();
  const row = rowRaw as Record<string, unknown> | null;
  if (!row) {
    await admin.from("cgm_fetch_jobs")
      .update({ status: "skipped", error_msg: `${cfg.logTable} row missing`, updated_at: nowIso })
      .eq("id", job.id);
    return "skipped";
  }
  const anchorMs = cfg.windowStart(row, job);

  // Slice the CGM history to (anchor, anchor + 180min].
  const WINDOW_MS = 180 * 60_000;
  const samples: MealSample[] = [];
  type SampleRow = Record<string, string | number>;
  const sampleRows: SampleRow[] = [];
  for (const r of history) {
    if (!r.timestamp || r.value == null) continue;
    const t = parseLluTs(r.timestamp);
    if (t == null) continue;
    const off = t - anchorMs;
    if (off < 0 || off > WINDOW_MS) continue;
    const tMin = Math.round(off / 60_000);
    samples.push({ t_offset_min: tMin, value_mgdl: r.value });
    sampleRows.push({
      [cfg.sampleFkCol]: row.id as string,
      user_id:           row.user_id as string,
      t_offset_min:      tMin,
      value_mgdl:        r.value,
      source:            (r as Reading & { source?: string }).source || "llu",
      captured_at:       new Date(t).toISOString(),
    });
  }

  if (sampleRows.length === 0) {
    if (overAge) {
      await admin.from("cgm_fetch_jobs")
        .update({ status: "skipped", error_msg: "no CGM samples in 0–180 min window", updated_at: nowIso })
        .eq("id", job.id);
      return "skipped";
    }
    await admin.from("cgm_fetch_jobs")
      .update({ retry_count: job.retry_count + 1, updated_at: nowIso })
      .eq("id", job.id);
    return "pending";
  }

  // Idempotent upsert on (fk-col, t_offset_min).
  const { error: upErr } = await admin
    .from(cfg.samplesTable)
    .upsert(sampleRows, { onConflict: cfg.upsertOnConflict });
  if (upErr) {
    console.warn(`[cgm-jobs/process] ${cfg.samplesTable} upsert failed:`, upErr.message);
    await admin.from("cgm_fetch_jobs")
      .update({ retry_count: job.retry_count + 1, error_msg: upErr.message, updated_at: nowIso })
      .eq("id", job.id);
    return "pending";
  }

  // Compute derived window fields + back-fill legacy point slots from
  // the curve when those columns are still NULL (never overwrite a
  // manual entry).
  const derived = computeDerivedCurveFields(samples);
  const update: Record<string, unknown> = { ...derived };

  for (const slot of cfg.legacySlots) {
    if (row[slot.valueCol] != null && row[slot.valueCol] !== "") continue;
    const s = pickSlotValue(samples, slot.targetMin, slot.toleranceMin);
    if (!s) continue;
    update[slot.valueCol] = s.value_mgdl;
    if (slot.atCol) {
      update[slot.atCol] = new Date(anchorMs + s.t_offset_min * 60_000).toISOString();
    }
  }

  const { error: lErr } = await admin.from(cfg.logTable).update(update).eq("id", row.id as string);
  if (lErr) {
    console.warn(`[cgm-jobs/process] ${cfg.logTable} update failed:`, lErr.message);
    await admin.from("cgm_fetch_jobs")
      .update({ retry_count: job.retry_count + 1, error_msg: lErr.message, updated_at: nowIso })
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
