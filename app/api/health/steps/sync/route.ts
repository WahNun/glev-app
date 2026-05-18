/**
 * Apple Health daily steps ingest endpoint (Task #183).
 *
 * The iOS shell reads per-day step counts (and optional
 * active-minutes) from HealthKit and POSTs them here so the engine +
 * Insights page have a server-side cache. Apple does NOT expose
 * HealthKit to a backend, so the device push is the only way in.
 *
 * Body shape:
 *   { samples: Array<{
 *       date: string,           // YYYY-MM-DD, device-local
 *       steps: number,          // non-negative integer
 *       activeMinutes?: number, // optional, 0..1440
 *     }> }
 *
 * Response:
 *   { upserted: number, skipped: number }
 *
 * Upsert key: (user_id, date, source='apple_health'). Re-syncing the
 * same date OVERWRITES — partial morning counts are expected to grow
 * over the day, so unlike the readings endpoint this one does NOT use
 * ignoreDuplicates.
 *
 * Constraints:
 *   - Batch cap MAX_BATCH (a year of days is plenty).
 *   - Range checks mirror the SQL CHECK constraints so we can return
 *     a clean per-row "skipped" count instead of a Postgres error.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";
import {
  HEALTH_STEPS_MAX_BATCH,
  normaliseHealthStepsSample,
  type InboundHealthStepsSample,
  type NormalisedHealthStepsRow,
} from "@/lib/healthStepsNormalise";

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

  let body: { samples?: unknown };
  try {
    body = (await req.json()) as { samples?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const samples = Array.isArray(body.samples) ? body.samples : null;
  if (!samples) {
    return NextResponse.json(
      { error: "samples must be an array" },
      { status: 400 }
    );
  }
  if (samples.length > HEALTH_STEPS_MAX_BATCH) {
    return NextResponse.json(
      { error: `batch too large (max ${HEALTH_STEPS_MAX_BATCH})` },
      { status: 413 }
    );
  }

  // Normalise + de-dup by date within the batch (last-write-wins so a
  // client that sent two snapshots of "today" sends the FRESHER count).
  let skipped = 0;
  const byDate = new Map<string, NormalisedHealthStepsRow>();
  for (const raw of samples) {
    const n = normaliseHealthStepsSample(raw as InboundHealthStepsSample);
    if (!n) {
      skipped++;
      continue;
    }
    byDate.set(n.date, n);
  }
  const rows = [...byDate.values()];
  if (rows.length === 0) {
    return NextResponse.json({ upserted: 0, skipped });
  }

  try {
    const sb = adminClient();
    const nowIso = new Date().toISOString();
    const { error } = await sb
      .from("daily_activity_summary")
      .upsert(
        rows.map((r) => ({
          ...r,
          user_id: user.id,
          source: SOURCE,
          updated_at: nowIso,
        })),
        { onConflict: "user_id,date,source" }
      );
    if (error) {
      const e: Error & { upstream?: boolean; status?: number } = new Error(
        "supabase: " + error.message
      );
      e.upstream = true;
      e.status = 502;
      throw e;
    }
    return NextResponse.json({ upserted: rows.length, skipped });
  } catch (e) {
    return errResponse(e);
  }
}
