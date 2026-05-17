import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "../../insulin/_helpers";
import {
  COLS,
  parseExerciseType,
  parseIntensity,
  parseDuration,
  parseNotes,
} from "../_validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/exercise/[id]
 * Edits a previously logged workout. Only the user-facing fields the
 * editor exposes are accepted: exercise_type, duration_minutes,
 * intensity, notes. All fields are optional, but at least one must be
 * present. CGM-derived columns (cgm_glucose_at_log, glucose_at_end,
 * curve aggregates) are intentionally NOT writeable here — they are
 * the output of the CGM auto-fetch jobs.
 */
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

  // Strict allowlist: any unknown key is rejected up front rather than
  // silently ignored, so a client typo (e.g. `intensity_level` vs
  // `intensity`) fails loudly instead of returning a no-op success.
  const ALLOWED = new Set(["exercise_type", "duration_minutes", "intensity", "notes"]);
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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "at least one of exercise_type, duration_minutes, intensity, notes is required" },
      { status: 400 },
    );
  }

  // Existence + ownership check before update so we return 404 instead
  // of a silent zero-row update.
  const { data: existing, error: readErr } = await auth.sb
    .from("exercise_logs")
    .select("id")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

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
