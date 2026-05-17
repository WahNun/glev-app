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

/** POST /api/exercise — body: { exercise_type, duration_minutes, intensity, cgm_glucose_at_log?, notes? } */
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

  const row = {
    user_id: auth.user.id,
    exercise_type: exercise_type.value,
    duration_minutes: duration.value,
    intensity: intensity.value,
    cgm_glucose_at_log: cgm.value,
    notes: parseNotes(body.notes),
  };

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
  return NextResponse.json({ log: data }, { status: 201 });
}
