import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "../insulin/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id,user_id,created_at,start_date,end_date,flow_intensity,phase_marker,cycle_phase,notes";

const FLOW = new Set(["light", "medium", "heavy"]);
// Legacy phase_marker enum — kept for reading pre-refactor rows. New
// writes go to cycle_phase below; phase_marker='pms'/'other' is
// rejected on POST.
const PHASE_LEGACY = new Set(["ovulation", "pms", "other"]);
// Standard 4-phase menstrual cycle enum (refactored model).
const CYCLE_PHASE = new Set([
  "follicular",
  "ovulation",
  "luteal",
  "menstruation",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/menstrual — caller's menstrual_logs, newest first. */
export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = auth.sb
    .from("menstrual_logs")
    .select(COLS)
    .eq("user_id", auth.user.id)
    .order("start_date", { ascending: false })
    .limit(200);

  if (from) q = q.gte("start_date", from);
  if (to)   q = q.lte("start_date", to);

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ logs: [], warning: "menstrual_logs table missing — run the migration" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ logs: data || [] });
}

/** POST /api/menstrual — body: { start_date, end_date?, flow_intensity?, phase_marker?, notes? } */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const start_date = String(body.start_date ?? "");
  const end_date = body.end_date != null && body.end_date !== "" ? String(body.end_date) : null;
  const flow = body.flow_intensity != null && body.flow_intensity !== ""
    ? String(body.flow_intensity).toLowerCase() : null;
  const phase = body.phase_marker != null && body.phase_marker !== ""
    ? String(body.phase_marker).toLowerCase() : null;
  const cyclePhase = body.cycle_phase != null && body.cycle_phase !== ""
    ? String(body.cycle_phase).toLowerCase() : null;
  const notes = body.notes != null ? String(body.notes).trim() : null;

  if (!DATE_RE.test(start_date)) {
    return NextResponse.json({ error: "start_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (end_date && !DATE_RE.test(end_date)) {
    return NextResponse.json({ error: "end_date must be YYYY-MM-DD or null" }, { status: 400 });
  }
  if (end_date && end_date < start_date) {
    return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 });
  }
  if (flow && !FLOW.has(flow)) {
    return NextResponse.json({ error: "flow_intensity must be 'light', 'medium' or 'heavy'" }, { status: 400 });
  }
  // Legacy phase_marker is accepted only for `'ovulation'` going forward —
  // PMS migrated to symptom_logs.category and "Andere" was removed by spec.
  // The shape check still recognises the legacy 'pms'/'other' tokens so we
  // can reject them with a more specific 400 message below (instead of an
  // opaque "unknown enum value" reply).
  if (phase && !PHASE_LEGACY.has(phase)) {
    return NextResponse.json(
      { error: "phase_marker must be 'ovulation' (legacy 'pms'/'other' are no longer accepted — use cycle_phase or symptom_logs.category='pms')" },
      { status: 400 },
    );
  }
  if (phase === "pms" || phase === "other") {
    return NextResponse.json(
      { error: `phase_marker '${phase}' is no longer supported — use cycle_phase, or log PMS as a symptom_log with category='pms'` },
      { status: 400 },
    );
  }
  if (cyclePhase && !CYCLE_PHASE.has(cyclePhase)) {
    return NextResponse.json(
      { error: `cycle_phase must be one of: ${Array.from(CYCLE_PHASE).join(", ")}` },
      { status: 400 },
    );
  }
  if (!flow && !phase && !cyclePhase) {
    return NextResponse.json(
      { error: "Either flow_intensity, phase_marker (legacy) or cycle_phase must be provided" },
      { status: 400 },
    );
  }

  const row = {
    user_id: auth.user.id,
    start_date,
    end_date,
    flow_intensity: flow,
    phase_marker: phase,
    cycle_phase: cyclePhase,
    notes: notes || null,
  };

  const { data, error } = await auth.sb
    .from("menstrual_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "menstrual_logs table is missing — run the migration in Supabase first" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ log: data }, { status: 201 });
}

/** DELETE /api/menstrual?id=… — RLS still scopes to caller. */
export async function DELETE(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const { error } = await auth.sb
    .from("menstrual_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
