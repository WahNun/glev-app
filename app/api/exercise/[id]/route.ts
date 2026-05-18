import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "../../insulin/_helpers";
import {
  COLS,
  parseExerciseType,
  parseIntensity,
  parseDuration,
  parseNotes,
} from "../_validate";
import { findGlucoseAt } from "@/lib/cgm/historicalLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/exercise/[id]
 * Edits a previously logged workout. Editable fields:
 *   - exercise_type, duration_minutes, intensity, notes
 *   - started_at, ended_at (manual rows only — apple_health rows
 *     reject time edits because the wallclock is authoritative on
 *     the device)
 *
 * When `started_at` changes for a manual row, `cgm_glucose_at_log`
 * is re-fetched from the CGM history within ±15 min of the new
 * timestamp. If no sample is found in that window, the column is set
 * to NULL so the UI falls back to "manual" / "—".
 *
 * Other CGM-derived columns (glucose_at_end, glucose_after_1h, curve
 * aggregates) are repopulated by the existing auto-fetch worker on
 * its next pass — they are NOT touched here.
 */
const TIME_FIELDS = new Set(["started_at", "ended_at"]);
const ALLOWED = new Set<string>([
  "exercise_type", "duration_minutes", "intensity", "notes",
  ...TIME_FIELDS,
]);

function parseIsoOrNull(raw: unknown, allowNull: boolean): { value: string | null } | { error: string } {
  if (raw === null) {
    if (allowNull) return { value: null };
    return { error: "value must not be null" };
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "value must be an ISO timestamp string" };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { error: "value must parse as a valid ISO timestamp" };
  // No future. Allow a small clock-skew slack of 5 min.
  if (ms > Date.now() + 5 * 60_000) return { error: "value must not be in the future" };
  // Floor: 90 days ago. Anything older is almost certainly a typo
  // and the CGM history won't have data for it anyway.
  if (ms < Date.now() - 90 * 86400_000) return { error: "value too old (max 90 days ago)" };
  return { value: new Date(ms).toISOString() };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const unknown = Object.keys(body).filter(k => !ALLOWED.has(k));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `unknown field(s): ${unknown.join(", ")} — allowed: ${[...ALLOWED].join(", ")}` },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "exercise_type")) {
    const r = parseExerciseType(body.exercise_type);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    patch.exercise_type = r.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "intensity")) {
    const r = parseIntensity(body.intensity);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    patch.intensity = r.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "duration_minutes")) {
    const r = parseDuration(body.duration_minutes);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    patch.duration_minutes = r.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    patch.notes = parseNotes(body.notes);
  }
  if (Object.prototype.hasOwnProperty.call(body, "started_at")) {
    const r = parseIsoOrNull(body.started_at, false);
    if ("error" in r) return NextResponse.json({ error: `started_at: ${r.error}` }, { status: 400 });
    patch.started_at = r.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "ended_at")) {
    const r = parseIsoOrNull(body.ended_at, true);
    if ("error" in r) return NextResponse.json({ error: `ended_at: ${r.error}` }, { status: 400 });
    patch.ended_at = r.value;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "at least one editable field is required" },
      { status: 400 },
    );
  }

  // Existence + ownership + source check. Apple-Health-synced rows
  // are barred from time edits — the watch's wallclock is the source
  // of truth for those workouts.
  const { data: existing, error: readErr } = await auth.sb
    .from("exercise_logs")
    .select("id,source,started_at,ended_at,created_at,duration_minutes")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (existing.source === "apple_health" && (patch.started_at !== undefined || patch.ended_at !== undefined)) {
    return NextResponse.json(
      { error: "started_at / ended_at cannot be edited on Apple-Health-synced workouts" },
      { status: 400 },
    );
  }

  // started_at / ended_at consistency: if both are present after the
  // patch is applied, ended_at must be strictly after started_at.
  const finalStartedAt = patch.started_at !== undefined
    ? (patch.started_at as string | null)
    : (existing.started_at as string | null);
  const finalEndedAt = patch.ended_at !== undefined
    ? (patch.ended_at as string | null)
    : (existing.ended_at as string | null);
  if (finalStartedAt && finalEndedAt && Date.parse(finalEndedAt) <= Date.parse(finalStartedAt)) {
    return NextResponse.json({ error: "ended_at must be after started_at" }, { status: 400 });
  }

  // If the anchor timestamp changed, re-fetch the CGM snapshot for
  // the new wallclock. Anchor = started_at if present, else
  // created_at. We always update cgm_glucose_at_log when started_at
  // is touched so a corrected timestamp doesn't keep a stale value.
  if (patch.started_at !== undefined) {
    const anchorIso = (patch.started_at as string | null) ?? (existing.created_at as string);
    if (anchorIso) {
      const snap = await findGlucoseAt(auth.user.id, anchorIso, 15);
      patch.cgm_glucose_at_log = snap ? snap.value : null;
    }
  }

  const { data, error } = await auth.sb
    .from("exercise_logs")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ log: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { error } = await auth.sb
    .from("exercise_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
