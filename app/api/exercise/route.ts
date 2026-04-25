import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "../insulin/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id,user_id,created_at,exercise_type,duration_minutes,intensity,cgm_glucose_at_log,notes";

const VALID_TYPE = new Set(["hypertrophy", "cardio"]);
const VALID_INTENSITY = new Set(["low", "medium", "high"]);

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

  const exercise_type = String(body.exercise_type ?? "").toLowerCase();
  const intensity = String(body.intensity ?? "").toLowerCase();
  const durRaw = Number(body.duration_minutes);
  const cgmRaw = body.cgm_glucose_at_log;
  const notes = body.notes != null ? String(body.notes).trim() : null;

  if (!VALID_TYPE.has(exercise_type)) {
    return NextResponse.json({ error: "exercise_type must be 'hypertrophy' or 'cardio'" }, { status: 400 });
  }
  if (!VALID_INTENSITY.has(intensity)) {
    return NextResponse.json({ error: "intensity must be 'low', 'medium' or 'high'" }, { status: 400 });
  }
  if (!Number.isFinite(durRaw) || !Number.isInteger(durRaw) || durRaw <= 0 || durRaw > 600) {
    return NextResponse.json({ error: "duration_minutes must be an integer 0 < n ≤ 600" }, { status: 400 });
  }

  let cgm: number | null = null;
  if (cgmRaw != null && cgmRaw !== "") {
    const c = Number(cgmRaw);
    if (!Number.isFinite(c) || c < 20 || c > 600) {
      return NextResponse.json({ error: "cgm_glucose_at_log out of range" }, { status: 400 });
    }
    cgm = Math.round(c * 10) / 10;
  }

  const row = {
    user_id: auth.user.id,
    exercise_type,
    duration_minutes: durRaw,
    intensity,
    cgm_glucose_at_log: cgm,
    notes: notes || null,
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
