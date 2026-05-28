import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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

export type ParsedMenstrualBody = {
  start_date: string;
  end_date: string | null;
  flow_intensity: string | null;
  phase_marker: string | null;
  cycle_phase: string | null;
  notes: string | null;
};

/**
 * Pure body-parser + validator for `POST /api/menstrual`. Extracted so
 * unit tests can drive the validation contracts in isolation without
 * spinning up the Next runtime or a Supabase client.
 */
export function parseMenstrualBody(
  body: Record<string, unknown>,
): { ok: true; row: ParsedMenstrualBody } | { ok: false; error: string } {
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
    return { ok: false, error: "start_date must be YYYY-MM-DD" };
  }
  if (end_date && !DATE_RE.test(end_date)) {
    return { ok: false, error: "end_date must be YYYY-MM-DD or null" };
  }
  if (end_date && end_date < start_date) {
    return { ok: false, error: "end_date must be on or after start_date" };
  }
  if (flow && !FLOW.has(flow)) {
    return { ok: false, error: "flow_intensity must be 'light', 'medium' or 'heavy'" };
  }
  // Legacy phase_marker is accepted only for `'ovulation'` going forward —
  // PMS migrated to symptom_logs.category and "Andere" was removed by spec.
  if (phase && !PHASE_LEGACY.has(phase)) {
    return {
      ok: false,
      error: "phase_marker must be 'ovulation' (legacy 'pms'/'other' are no longer accepted — use cycle_phase or symptom_logs.category='pms')",
    };
  }
  if (phase === "pms" || phase === "other") {
    return {
      ok: false,
      error: `phase_marker '${phase}' is no longer supported — use cycle_phase, or log PMS as a symptom_log with category='pms'`,
    };
  }
  if (cyclePhase && !CYCLE_PHASE.has(cyclePhase)) {
    return {
      ok: false,
      error: `cycle_phase must be one of: ${Array.from(CYCLE_PHASE).join(", ")}`,
    };
  }
  if (!flow && !phase && !cyclePhase) {
    return {
      ok: false,
      error: "Either flow_intensity, phase_marker (legacy) or cycle_phase must be provided",
    };
  }

  return {
    ok: true,
    row: {
      start_date,
      end_date,
      flow_intensity: flow,
      phase_marker: phase,
      cycle_phase: cyclePhase,
      notes: notes || null,
    },
  };
}

/**
 * Core POST handler — takes already-resolved auth + sb so unit tests
 * can drive it without standing up the Next runtime or Supabase.
 */
export async function handleMenstrualPost(
  sb: SupabaseClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const parsed = parseMenstrualBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const row = { user_id: userId, ...parsed.row };

  const { data, error } = await sb
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

  return handleMenstrualPost(auth.sb, auth.user.id, body);
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
