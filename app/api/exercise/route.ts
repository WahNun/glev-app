import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "../insulin/_helpers";
import {
  COLS,
  parseExerciseType,
  parseIntensity,
  parseDuration,
  parseCgmGlucose,
  parseNotes,
} from "./_validate";
import { findGlucoseAt } from "@/lib/cgm/historicalLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/exercise — caller's exercise_logs, newest first. */
export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = auth.sb
    .from("exercise_logs")
    .select(COLS)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (from) q = q.gte("created_at", from);
  if (to)   q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ logs: [], warning: "exercise_logs table missing — run the migration" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ logs: data || [] });
}

/** POST /api/exercise — body: { exercise_type, duration_minutes, intensity, cgm_glucose_at_log?, started_at?, notes? } */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const exercise_type = parseExerciseType(body.exercise_type);
  if ("error" in exercise_type) return NextResponse.json({ error: exercise_type.error }, { status: 400 });
  const intensity = parseIntensity(body.intensity);
  if ("error" in intensity) return NextResponse.json({ error: intensity.error }, { status: 400 });
  const duration = parseDuration(body.duration_minutes);
  if ("error" in duration) return NextResponse.json({ error: duration.error }, { status: 400 });
  const cgm = parseCgmGlucose(body.cgm_glucose_at_log);
  if ("error" in cgm) return NextResponse.json({ error: cgm.error }, { status: 400 });

  // Optional: retroactive logs pass the actual workout start time so
  // created_at reflects reality instead of the submit moment.
  let started_at: string | undefined;
  if (body.started_at != null && body.started_at !== "") {
    const d = new Date(String(body.started_at));
    if (!isNaN(d.getTime())) started_at = d.toISOString();
  }

  const row: Record<string, unknown> = {
    user_id: auth.user.id,
    exercise_type: exercise_type.value,
    duration_minutes: duration.value,
    intensity: intensity.value,
    cgm_glucose_at_log: cgm.value,
    notes: parseNotes(body.notes),
  };
  if (started_at) row.created_at = started_at;

  const { data, error } = await auth.sb
    .from("exercise_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "exercise_logs table is missing — run the migration in Supabase first" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Server-side BG lookup: if the client didn't supply a live snapshot,
  // find the nearest CGM sample ±15 min around the actual workout start
  // time (started_at when provided, otherwise the DB-assigned created_at).
  // This ensures "BG VORHER" is populated for retroactive logs even when
  // the user logs minutes after the event.
  if (data.cgm_glucose_at_log == null) {
    const lookupTs = started_at ?? data.created_at;
    if (lookupTs) {
      const hit = await findGlucoseAt(auth.user.id, lookupTs);
      if (hit != null) {
        const { data: updated, error: updateErr } = await auth.sb
          .from("exercise_logs")
          .update({ cgm_glucose_at_log: hit.value })
          .eq("id", data.id)
          .select(COLS)
          .single();
        if (!updateErr && updated) {
          return NextResponse.json({ log: updated }, { status: 201 });
        }
      }
    }
  }

  return NextResponse.json({ log: data }, { status: 201 });
}
