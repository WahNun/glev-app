/**
 * Apple Health workout ingest endpoint.
 *
 * The iOS shell reads HKWorkout sessions from HealthKit and POSTs
 * them here so the engine's "exercise within 4h" safety hook +
 * Insights workout patterns see Apple-Watch-logged sessions without
 * the user having to re-log them in Glev. Apple does NOT expose
 * HealthKit server-side, so the device push is the only way in.
 *
 * Body shape:
 *   { workouts: Array<{
 *       uuid:        string,   // HKWorkout.uuid → external_id (dedupe key)
 *       workoutType: string,   // @capgo/capacitor-health WorkoutType slug
 *       startDate:   string,   // ISO 8601
 *       endDate:     string,   // ISO 8601, > startDate
 *       avgHeartRate?: number, // optional, bpm
 *       maxHeartRate?: number, // optional, bpm
 *     }> }
 *
 * Response: `{ inserted: number, skipped: number }`
 *
 * Upsert key: (user_id, source, external_id) — re-syncing the same
 * workout is a no-op (matches the unique index added in
 * 20260520_exercise_logs_source_unique.sql). The source column is
 * locked to `apple_health` for this route; manual rows continue to
 * be created via /api/exercise as before.
 *
 * Constraints:
 *   - Batch cap HEALTH_WORKOUTS_MAX_BATCH (the normaliser also
 *     dedupes by uuid within the batch, so a single workout reported
 *     twice in the same payload counts once).
 *   - Rows that fail the per-sample normaliser (bad date window,
 *     missing uuid, etc.) are silently skipped — same shape the
 *     steps endpoint uses so the client can render a unified
 *     "synced N / skipped M" status.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";
import {
  HEALTH_WORKOUTS_MAX_BATCH,
  normaliseHealthWorkout,
  type InboundHealthWorkout,
  type NormalisedHealthWorkoutRow,
} from "@/lib/healthWorkoutsNormalise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "apple_health";

export async function POST(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }

  let body: { workouts?: unknown };
  try {
    body = (await req.json()) as { workouts?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const workouts = Array.isArray(body.workouts) ? body.workouts : null;
  if (!workouts) {
    return NextResponse.json(
      { error: "workouts must be an array" },
      { status: 400 }
    );
  }
  if (workouts.length > HEALTH_WORKOUTS_MAX_BATCH) {
    return NextResponse.json(
      { error: `batch too large (max ${HEALTH_WORKOUTS_MAX_BATCH})` },
      { status: 413 }
    );
  }

  // Normalise + de-dup by uuid within the batch. HealthKit can return
  // the same workout twice when the anchor window overlaps with a
  // previous query; last-write-wins keeps the freshest HR aggregates.
  let skipped = 0;
  const byUuid = new Map<string, NormalisedHealthWorkoutRow>();
  for (const raw of workouts) {
    const n = normaliseHealthWorkout(raw as InboundHealthWorkout);
    if (!n) {
      skipped++;
      continue;
    }
    byUuid.set(n.external_id, n);
  }
  const rows = [...byUuid.values()];
  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped });
  }

  try {
    const sb = adminClient();
    const { error } = await sb
      .from("exercise_logs")
      .upsert(
        rows.map((r) => ({
          ...r,
          user_id: user.id,
          source: SOURCE,
          // created_at = workout start so the existing
          // "newest first / last 4h" queries (which read created_at)
          // continue to work for synced rows without changes.
          created_at: r.started_at,
          cgm_glucose_at_log: null,
        })),
        { onConflict: "user_id,source,external_id", ignoreDuplicates: false }
      );
    if (error) {
      const e: Error & { upstream?: boolean; status?: number } = new Error(
        "supabase: " + error.message
      );
      e.upstream = true;
      e.status = 502;
      throw e;
    }
    return NextResponse.json({ inserted: rows.length, skipped });
  } catch (e) {
    return errResponse(e);
  }
}
