/**
 * Apple Health (HealthKit) ingest endpoint.
 *
 * The iOS app reads the user's blood-glucose samples from HealthKit
 * (read-only) and POSTs them here so the Vercel-hosted server side has
 * a cache it can read for the engine and post-meal CGM follow-up jobs.
 * Apple does not expose HealthKit to a backend — the device push is the
 * ONLY way to get HK data server-side.
 *
 * Body shape:
 *   { samples: Array<{ uuid: string, startDate: string, value: number,
 *                      unit: 'mg/dL' | 'mmol/L' }> }
 *
 *   - uuid       — HealthKit sample UUID (HKObject.uuid). Used as the
 *                  dedupe key in `apple_health_readings`. The same UUID
 *                  twice is a no-op (UNIQUE INDEX on (user_id, source_uuid)).
 *   - startDate  — ISO timestamp of the sample.
 *   - value      — raw HealthKit value in the user's HK unit.
 *   - unit       — 'mg/dL' or 'mmol/L'. HealthKit's preferred unit for
 *                  blood glucose is locale-dependent (US = mg/dL, most
 *                  others = mmol/L), so the device cannot assume one.
 *                  We normalise to mg/dL on the server (factor 18.0182,
 *                  rounded) so the conversion lives in one place.
 *
 * Response:
 *   { inserted: number, skipped: number }
 *
 *   `inserted` = rows the upsert actually wrote; `skipped` = rows that
 *   already existed (same user_id + source_uuid) OR were rejected by the
 *   sanity bounds (≤ 0 or > 1000 mg/dL).
 *
 * Constraints:
 *   - Batch size capped at MAX_BATCH; larger requests get a 413 so a
 *     misbehaving device can't overwhelm the route.
 *   - Sanity range (0, 1000] mg/dL — physiological hard limits.
 *   - Body must be JSON; missing / wrong-shaped fields → 400 with the
 *     specific reason so the device-side logger can flag it.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../_helpers";
import { adminClient } from "@/lib/cgm/supabase";
import { getSyncStatus } from "@/lib/cgm/appleHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 500;
// HealthKit's per-sample physiological bounds. Anything outside is
// almost certainly a unit-conversion bug or a sensor calibration
// outlier and would corrupt the engine's dose math.
const MIN_MG_DL = 1;
const MAX_MG_DL = 1000;
// 1 mmol/L = 18.0182 mg/dL (standard glucose conversion factor; same
// constant used in app/api/cgm/glucose/route.ts).
const MMOL_TO_MGDL = 18.0182;

interface InboundSample {
  uuid?: unknown;
  startDate?: unknown;
  value?: unknown;
  unit?: unknown;
}

interface NormalisedRow {
  source_uuid: string;
  timestamp: string;
  value_mg_dl: number;
}

function normaliseSample(s: InboundSample): NormalisedRow | null {
  if (!s || typeof s !== "object") return null;
  const uuid = typeof s.uuid === "string" ? s.uuid.trim() : "";
  if (!uuid) return null;

  const startDate = typeof s.startDate === "string" ? s.startDate : "";
  const ts = startDate ? new Date(startDate) : null;
  if (!ts || Number.isNaN(ts.getTime())) return null;

  const raw = typeof s.value === "number" ? s.value : Number(s.value);
  if (!Number.isFinite(raw)) return null;

  const unit = typeof s.unit === "string" ? s.unit : "";
  let mgdl: number;
  if (unit === "mg/dL") mgdl = raw;
  else if (unit === "mmol/L") mgdl = raw * MMOL_TO_MGDL;
  else return null;

  const rounded = Math.round(mgdl);
  if (rounded < MIN_MG_DL || rounded > MAX_MG_DL) return null;

  return {
    source_uuid: uuid,
    timestamp: ts.toISOString(),
    value_mg_dl: rounded,
  };
}

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
  if (samples.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `batch too large (max ${MAX_BATCH})` },
      { status: 413 }
    );
  }

  // Normalise + filter in one pass so the dedup map below operates on
  // already-rounded mg/dL values. Anything that fails validation lands
  // in `skipped` so the device-side caller can surface a count without
  // us having to log per-sample failures here.
  let skipped = 0;
  const rows: NormalisedRow[] = [];
  const seen = new Set<string>();
  for (const raw of samples) {
    const norm = normaliseSample(raw as InboundSample);
    if (!norm) {
      skipped++;
      continue;
    }
    // Defensively dedup within the batch too — HealthKit anchored
    // queries can occasionally surface the same sample twice in a
    // single window and Postgres' ON CONFLICT will only count the
    // first one anyway.
    if (seen.has(norm.source_uuid)) {
      skipped++;
      continue;
    }
    seen.add(norm.source_uuid);
    rows.push(norm);
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped });
  }

  try {
    const sb = adminClient();
    // Upsert with ignoreDuplicates so re-pushed UUIDs do NOT update the
    // existing row (the value never changes for a given HealthKit UUID;
    // an UPDATE would just churn the row's mtime + waste WAL).
    const { data, error } = await sb
      .from("apple_health_readings")
      .upsert(
        rows.map((r) => ({ ...r, user_id: user.id })),
        { onConflict: "user_id,source_uuid", ignoreDuplicates: true }
      )
      .select("id");

    if (error) {
      const e: Error & { upstream?: boolean; status?: number } = new Error(
        "supabase: " + error.message
      );
      e.upstream = true;
      e.status = 502;
      throw e;
    }

    const inserted = Array.isArray(data) ? data.length : 0;
    skipped += rows.length - inserted;
    return NextResponse.json({ inserted, skipped });
  } catch (e) {
    return errResponse(e);
  }
}

/**
 * GET /api/cgm/apple-health/sync
 *
 * Lightweight status probe for the Settings card so it can render
 * "N readings · last sync 3 min ago" without hitting `/api/cgm/latest`
 * (which would route through the dispatcher and force a full readings
 * scan). Returns connected=true iff the user has at least one cached
 * reading; connection state itself is driven by `profiles.cgm_source`
 * which the card already knows.
 */
export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }
  try {
    const status = await getSyncStatus(user.id);
    return NextResponse.json({
      count: status.count,
      lastTimestamp: status.lastTimestamp,
      lastValueMgDl: status.lastValueMgDl,
    });
  } catch (e) {
    return errResponse(e);
  }
}
