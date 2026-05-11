import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable } from "../insulin/_helpers";
import { INFLUENCE_TYPES, type InfluenceType } from "@/lib/influences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id,user_id,created_at,occurred_at,influence_type,details,amount,cgm_glucose_at_log,notes";

const VALID_TYPES: Set<string> = new Set(INFLUENCE_TYPES);

/** GET /api/influences — caller's influence_logs, newest first. */
export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = auth.sb
    .from("influence_logs")
    .select(COLS)
    .eq("user_id", auth.user.id)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (from) q = q.gte("occurred_at", from);
  if (to)   q = q.lte("occurred_at", to);

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ logs: [], warning: "influence_logs table missing — run the migration" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ logs: data || [] });
}

/** POST /api/influences — body: { influence_type, occurred_at?, details?, amount?, cgm_glucose_at_log?, notes? } */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawType = typeof body.influence_type === "string" ? body.influence_type : "";
  if (!VALID_TYPES.has(rawType)) {
    return NextResponse.json(
      { error: `influence_type must be one of: ${Array.from(VALID_TYPES).join(", ")}` },
      { status: 400 },
    );
  }
  const influence_type = rawType as InfluenceType;

  // occurred_at: optional, defaults to now. When supplied it must parse,
  // and is constrained to [now − 1y, now + 1m] — the future-grace lets a
  // client clock that's a few seconds ahead of the server still submit
  // "Jetzt", while genuinely-future timestamps and prehistoric typos are
  // rejected with 400.
  const ONE_YEAR_MS_API = 365 * 24 * 60 * 60 * 1000;
  const FUTURE_GRACE_MS = 60 * 1000;
  const occurredRaw = body.occurred_at;
  let occurred_at: string;
  if (occurredRaw == null || occurredRaw === "") {
    occurred_at = new Date().toISOString();
  } else {
    const d = new Date(String(occurredRaw));
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "occurred_at must be a valid ISO timestamp" }, { status: 400 });
    }
    const now = Date.now();
    if (d.getTime() > now + FUTURE_GRACE_MS) {
      return NextResponse.json({ error: "occurred_at must not be in the future" }, { status: 400 });
    }
    if (d.getTime() < now - ONE_YEAR_MS_API) {
      return NextResponse.json({ error: "occurred_at must be within the last 1 year" }, { status: 400 });
    }
    occurred_at = d.toISOString();
  }

  const details = body.details != null ? String(body.details).trim() : null;
  const amount  = body.amount  != null ? String(body.amount).trim()  : null;
  const notes   = body.notes   != null ? String(body.notes).trim()   : null;

  // Optional CGM snapshot — same 20..600 mg/dL window enforced in DB.
  // Anything out of range or non-finite is dropped to null rather than
  // rejecting the request, since the influence event itself is the
  // primary payload.
  let cgmAtLog: number | null = null;
  if (body.cgm_glucose_at_log != null) {
    const n = Number(body.cgm_glucose_at_log);
    if (Number.isFinite(n) && n >= 20 && n <= 600) {
      cgmAtLog = Math.round(n * 10) / 10;
    }
  }

  const row = {
    user_id: auth.user.id,
    influence_type,
    occurred_at,
    details: details || null,
    amount: amount || null,
    cgm_glucose_at_log: cgmAtLog,
    notes: notes || null,
  };

  const { data, error } = await auth.sb
    .from("influence_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "influence_logs table is missing — run the migration in Supabase first" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ log: data }, { status: 201 });
}

/** DELETE /api/influences?id=… */
export async function DELETE(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const { error } = await auth.sb
    .from("influence_logs")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
