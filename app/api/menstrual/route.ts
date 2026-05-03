import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "../insulin/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id,user_id,created_at,start_date,end_date,flow_intensity,phase_marker,notes";

const FLOW = new Set(["light", "medium", "heavy"]);
const PHASE = new Set(["ovulation", "pms", "other"]);
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
  if (phase && !PHASE.has(phase)) {
    return NextResponse.json({ error: "phase_marker must be 'ovulation', 'pms' or 'other'" }, { status: 400 });
  }
  if (!flow && !phase) {
    return NextResponse.json({ error: "Either flow_intensity or phase_marker must be provided" }, { status: 400 });
  }

  const row = {
    user_id: auth.user.id,
    start_date,
    end_date,
    flow_intensity: flow,
    phase_marker: phase,
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
