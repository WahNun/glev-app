import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";
import { getHistory } from "@/lib/cgm/llu";
import type { LogType, FetchType } from "@/lib/cgmJobs";

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

  // 1) Try an immediate "before" fetch from the CGM. If the user has no
  //    CGM connected or the upstream errors out, we just skip — the post
  //    jobs are still scheduled.
  //
  //    Retroactive logs (refTime more than ~5 min in the past) take the
  //    nearest CGM history reading to refTime instead of the live
  //    "current" value, so a workout logged after the fact gets a
  //    sensible "before" anchor.
  let glucoseAtLog: number | null = null;
  const nowMs = Date.now();
  const refMs = refTime.getTime();
  const RETRO_THRESHOLD_MS = 5 * 60_000;
  const HISTORY_WINDOW_MS  = 10 * 60_000;
  try {
    const out = await getHistory(user.id);
    if (nowMs - refMs > RETRO_THRESHOLD_MS) {
      // Retroactive — match nearest history point within ±10min of refTime.
      const hist = out?.history || [];
      let best: { value: number; dt: number } | null = null;
      for (const h of hist) {
        const v = (h as { value?: unknown })?.value;
        const tRaw = (h as { timestamp?: unknown; time?: unknown })?.timestamp
                  ?? (h as { time?: unknown })?.time;
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const tMs = typeof tRaw === "number" ? tRaw : Date.parse(String(tRaw));
        if (!Number.isFinite(tMs)) continue;
        const dt = Math.abs(tMs - refMs);
        if (dt > HISTORY_WINDOW_MS) continue;
        if (!best || dt < best.dt) best = { value: v, dt };
      }
      if (best) glucoseAtLog = best.value;
    } else {
      const v = out?.current?.value;
      if (typeof v === "number" && Number.isFinite(v)) glucoseAtLog = v;
    }
  } catch (e) {
    // Upstream failure (no creds, network, etc.) — silent skip.
    console.info("[cgm-jobs/schedule] no CGM 'before' value:", (e as Error)?.message || e);
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

  if (rows.length > 0) {
    const { error: insErr } = await admin.from("cgm_fetch_jobs").insert(rows);
    if (insErr) {
      console.error("[cgm-jobs/schedule] insert failed:", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    glucoseAtLog,
    scheduledCount: rows.length,
  });
}
