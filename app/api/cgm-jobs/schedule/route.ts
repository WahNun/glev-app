import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";
// Use the source-agnostic dispatcher so Nightscout / Apple Health users
// also get the immediate "before" reading on schedule. Importing
// directly from `lib/cgm/llu` skipped the dispatcher and silently
// returned no value for non-LLU users.
import { getHistory } from "@/lib/cgm";
import type { Reading } from "@/lib/cgm/llu";
import type { LogType, FetchType } from "@/lib/cgmJobs";
import { parseLluTs } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  logId: string;
  logType: LogType;
  refTimeIso: string;
  durationMinutes?: number;
}

/**
 * Build the list of post-fetches to schedule for a given log type.
 * Returns offsets in milliseconds from refTime.
 */
function offsetsForLogType(t: LogType, durationMinutes?: number): { type: FetchType; ms: number }[] {
  const MIN = 60_000;
  switch (t) {
    case "meal":
      return [
        { type: "bg_1h", ms: 60 * MIN },
        { type: "bg_2h", ms: 120 * MIN },
        // Task #187: dense post-meal curve. Fires once at +180 min and
        // backfills the full 0–180 min sample set + window aggregates
        // (min/max/peak/AUC/hypo) on the meals row in one pass.
        { type: "meal_curve_180", ms: 180 * MIN },
      ];
    case "bolus":
      return [
        { type: "after_1h", ms: 60 * MIN },
        { type: "after_2h", ms: 120 * MIN },
        // Task #194: dense post-bolus curve. Fires once at +180 min
        // and backfills the full 0–180 min sample set + window
        // aggregates (min/max/AUC/hypo) on the insulin_logs row.
        { type: "bolus_curve_180", ms: 180 * MIN },
      ];
    case "basal":
      return [
        { type: "after_12h", ms: 12 * 60 * MIN },
        { type: "after_24h", ms: 24 * 60 * MIN },
      ];
    case "exercise": {
      const d = Math.max(0, Math.min(600, durationMinutes ?? 0));
      return [
        { type: "at_end",        ms: d * MIN },
        { type: "exer_after_1h", ms: (d + 60) * MIN },
        // Task #194: dense post-workout curve. The 0–180 min window
        // starts at workout END (created_at + duration_minutes), so
        // the +3h backfill fires `d + 180` min after the workout
        // start instant.
        { type: "exercise_curve_180", ms: (d + 180) * MIN },
      ];
    }
  }
}

/** Map (log_type, fetch_type) → (table, column) for writeback. */
function targetColumn(logType: LogType, fetchType: FetchType): { table: string; column: string } | null {
  if (logType === "meal") {
    if (fetchType === "before") return { table: "meals", column: "glucose_before" };
    if (fetchType === "bg_1h")  return { table: "meals", column: "bg_1h" };
    if (fetchType === "bg_2h")  return { table: "meals", column: "bg_2h" };
  }
  if (logType === "bolus" || logType === "basal") {
    if (fetchType === "before")     return { table: "insulin_logs", column: "cgm_glucose_at_log" };
    if (fetchType === "after_1h")   return { table: "insulin_logs", column: "glucose_after_1h" };
    if (fetchType === "after_2h")   return { table: "insulin_logs", column: "glucose_after_2h" };
    if (fetchType === "after_12h")  return { table: "insulin_logs", column: "glucose_after_12h" };
    if (fetchType === "after_24h")  return { table: "insulin_logs", column: "glucose_after_24h" };
  }
  if (logType === "exercise") {
    if (fetchType === "before")         return { table: "exercise_logs", column: "cgm_glucose_at_log" };
    if (fetchType === "at_end")         return { table: "exercise_logs", column: "glucose_at_end" };
    if (fetchType === "exer_after_1h")  return { table: "exercise_logs", column: "glucose_after_1h" };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { logId, logType, refTimeIso, durationMinutes } = body || ({} as Body);
  if (!logId || !logType || !refTimeIso) {
    return NextResponse.json({ error: "logId, logType, refTimeIso required" }, { status: 400 });
  }

  const refTime = new Date(refTimeIso);
  if (Number.isNaN(refTime.getTime())) {
    return NextResponse.json({ error: "invalid refTimeIso" }, { status: 400 });
  }

  const admin = adminClient();

  // 1) Pull CGM history ONCE up front. We reuse it for two things:
  //    a) the immediate "before" anchor (existing behaviour) and
  //    b) the new retroactive backfill of any post-fetch job whose
  //       fetch_time already lies in the past — see step 4 below.
  //    A single fetch keeps the route fast and avoids hammering LLU
  //    when the user logs a backdated meal.
  let history: Reading[] = [];
  let currentValue: number | null = null;
  let cgmAvailable = true;
  try {
    const out = await getHistory(user.id);
    history = out?.history || [];
    const cv = out?.current?.value;
    if (typeof cv === "number" && Number.isFinite(cv)) currentValue = cv;
  } catch (e) {
    cgmAvailable = false;
    console.info("[cgm-jobs/schedule] CGM not available:", (e as Error)?.message || e);
  }

  // Source-agnostic "find nearest reading within ±windowMs of targetMs".
  // Mirrors `pickReadingNear` in /api/cgm-jobs/process so backfilled
  // values match what the worker would have written later.
  const HISTORY_WINDOW_MS = 10 * 60_000;
  function nearest(targetMs: number, windowMs = HISTORY_WINDOW_MS): number | null {
    let best: { v: number; dt: number } | null = null;
    for (const h of history) {
      const v = h?.value;
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const tMs = parseLluTs(h.timestamp);
      if (tMs == null) continue;
      const dt = Math.abs(tMs - targetMs);
      if (dt > windowMs) continue;
      if (!best || dt < best.dt) best = { v, dt };
    }
    return best ? best.v : null;
  }

  // 2) Try an immediate "before" fetch. Retroactive logs (refTime more
  //    than ~5 min in the past) take the nearest CGM history reading to
  //    refTime instead of the live "current" value, so a workout logged
  //    after the fact gets a sensible "before" anchor.
  const nowMs = Date.now();
  const refMs = refTime.getTime();
  const RETRO_THRESHOLD_MS = 5 * 60_000;
  let glucoseAtLog: number | null = null;
  if (cgmAvailable) {
    if (nowMs - refMs > RETRO_THRESHOLD_MS) {
      glucoseAtLog = nearest(refMs);
    } else if (currentValue != null) {
      glucoseAtLog = currentValue;
    }
  }

  // 2) If we got a "before" value, write it to the log row when its
  //    target column is currently NULL (don't overwrite a manual entry).
  if (glucoseAtLog != null) {
    const tc = targetColumn(logType, "before");
    if (tc) {
      try {
        const { data: existing } = await admin.from(tc.table).select("*").eq("id", logId).maybeSingle();
        const row = existing as unknown as Record<string, unknown> | null;
        const cur = row ? row[tc.column] : null;
        if (row && (cur == null || cur === "")) {
          await admin.from(tc.table).update({ [tc.column]: glucoseAtLog }).eq("id", logId);
        }
      } catch (e) {
        console.warn("[cgm-jobs/schedule] writeback 'before' failed:", e);
      }
    }
  }

  // 3) Insert the scheduled post-fetch jobs.
  const offsets = offsetsForLogType(logType, durationMinutes);
  const rows = offsets.map(o => ({
    user_id:    user.id,
    log_id:     logId,
    log_type:   logType,
    fetch_type: o.type,
    fetch_time: new Date(refTime.getTime() + o.ms).toISOString(),
    status:     "pending" as const,
  }));

  let insertedJobs: { id: string; fetch_type: FetchType; fetch_time: string }[] = [];
  if (rows.length > 0) {
    const { data: ins, error: insErr } = await admin
      .from("cgm_fetch_jobs")
      .insert(rows)
      .select("id, fetch_type, fetch_time");
    if (insErr) {
      console.error("[cgm-jobs/schedule] insert failed:", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    insertedJobs = (ins ?? []) as typeof insertedJobs;
  }

  // 4) Retroactive backfill for backdated logs. Any job whose fetch_time
  //    is already in the past at insert time would otherwise wait for
  //    the next /api/cgm-jobs/process tick — and for meals would be
  //    killed by MEAL_ABANDON_AFTER_MS=1h on the very next pass if it
  //    didn't immediately resolve. Here we run the same ±10 min history
  //    match the worker uses, write the value to the parent log column
  //    AND mark the job as fetched in one pass. Curve jobs
  //    (meal_curve_180 / bolus_curve_180 / exercise_curve_180) are
  //    skipped — they need the full 0–180 min sample-table upsert which
  //    lives in processCurveJob and runs on the next worker tick.
  //    Non-curve point-value jobs are the ones the UI shows as
  //    "Überfällig" so this fixes the visible bug for backdated meals.
  let backfilled = 0;
  if (cgmAvailable && history.length > 0) {
    for (const job of insertedJobs) {
      const ftMs = new Date(job.fetch_time).getTime();
      if (!Number.isFinite(ftMs) || ftMs > nowMs) continue;            // future-only → worker
      const tc = targetColumn(logType, job.fetch_type);
      if (!tc) continue;                                               // curve / unknown → worker
      const value = nearest(ftMs);
      if (value == null) continue;                                     // no match → worker retries
      const stampIso = new Date(nowMs).toISOString();
      try {
        const { data: rowRaw } = await admin
          .from(tc.table).select("*").eq("id", logId).maybeSingle();
        const row = rowRaw as unknown as Record<string, unknown> | null;
        const cur = row ? row[tc.column] : null;
        if (row && (cur == null || cur === "")) {
          await admin.from(tc.table)
            .update({ [tc.column]: value })
            .eq("id", logId);
        }
        await admin.from("cgm_fetch_jobs")
          .update({
            status: "fetched",
            value_mgdl: value,
            fetched_at: stampIso,
            updated_at: stampIso,
          })
          .eq("id", job.id);
        backfilled += 1;
      } catch (e) {
        console.warn("[cgm-jobs/schedule] backfill writeback failed:", e);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    glucoseAtLog,
    scheduledCount: rows.length,
    backfilledCount: backfilled,
  });
}
