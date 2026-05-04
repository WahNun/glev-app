import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "../insulin/_helpers";
import { SYMPTOM_TYPES, type SymptomType } from "@/lib/symptoms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id,user_id,created_at,occurred_at,symptom_types,severity,cgm_glucose_at_log,notes";

const VALID_SYMPTOMS: Set<string> = new Set(SYMPTOM_TYPES);

/** GET /api/symptoms — caller's symptom_logs, newest first. */
export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = auth.sb
    .from("symptom_logs")
    .select(COLS)
    .eq("user_id", auth.user.id)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (from) q = q.gte("occurred_at", from);
  if (to)   q = q.lte("occurred_at", to);

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ logs: [], warning: "symptom_logs table missing — run the migration" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ logs: data || [] });
}

/** POST /api/symptoms — body: { symptom_types[], severity, occurred_at?, notes? } */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawTypes = Array.isArray(body.symptom_types) ? body.symptom_types : [];
  const types = rawTypes
    .filter((v): v is string => typeof v === "string")
    .filter((v): v is SymptomType => VALID_SYMPTOMS.has(v));
  // Dedupe in case the client double-tapped a chip.
  const uniqTypes: SymptomType[] = Array.from(new Set(types)) as SymptomType[];
  if (uniqTypes.length === 0) {
    return NextResponse.json({ error: "symptom_types must include at least one valid symptom" }, { status: 400 });
  }

  const sev = Math.round(Number(body.severity));
  if (!Number.isFinite(sev) || sev < 1 || sev > 5) {
    return NextResponse.json({ error: "severity must be an integer 1..5" }, { status: 400 });
  }

  const occurredRaw = body.occurred_at;
  let occurred_at: string;
  if (occurredRaw == null || occurredRaw === "") {
    occurred_at = new Date().toISOString();
  } else {
    const d = new Date(String(occurredRaw));
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "occurred_at must be a valid ISO timestamp" }, { status: 400 });
    }
    occurred_at = d.toISOString();
  }

  const notes = body.notes != null ? String(body.notes).trim() : null;

  // Optional CGM snapshot captured by the caller. Numeric(5,1) in DB
  // with a 20..600 mg/dL CHECK — anything outside that window or
  // non-finite is dropped to null rather than rejecting the request,
  // since the symptom itself is the primary payload.
  let cgmAtLog: number | null = null;
  if (body.cgm_glucose_at_log != null) {
    const n = Number(body.cgm_glucose_at_log);
    if (Number.isFinite(n) && n >= 20 && n <= 600) {
      cgmAtLog = Math.round(n * 10) / 10;
    }
  }

  const row = {
    user_id: auth.user.id,
    symptom_types: uniqTypes,
    severity: sev,
    occurred_at,
    cgm_glucose_at_log: cgmAtLog,
    notes: notes || null,
  };

  const { data, error } = await auth.sb
    .from("symptom_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "symptom_logs table is missing — run the migration in Supabase first" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ log: data }, { status: 201 });
}

/** DELETE /api/symptoms?id=… */
export async function DELETE(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const { error } = await auth.sb
    .from("symptom_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
