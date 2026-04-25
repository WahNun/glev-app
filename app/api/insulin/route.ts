import { NextRequest, NextResponse } from "next/server";
import { authedClient, isMissingTable, badJson } from "./_helpers";

const COLS = "id, user_id, units, kind, at, note, meal_id, created_at";

const KINDS = new Set(["bolus", "basal", "correction"]);

function clampUnits(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n <= 0 || n > 100) return null;
  return Math.round(n * 2) / 2;
}

function isIso(s: unknown): s is string {
  if (typeof s !== "string" || !s) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = auth.sb
    .from("insulin_entries")
    .select(COLS)
    .eq("user_id", auth.user.id)
    .order("at", { ascending: false })
    .limit(200);

  if (from && isIso(from)) q = q.gte("at", from);
  if (to && isIso(to)) q = q.lte("at", to);

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ entries: [], missingTable: true });
    }
    // eslint-disable-next-line no-console
    console.error("[insulin GET]", error.code, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badJson("invalid json");
  }

  const units = clampUnits(body.units);
  if (units === null) return badJson("units must be a number between 0 and 100");

  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!KINDS.has(kind)) return badJson("kind must be bolus | basal | correction");

  const at = typeof body.at === "string" ? body.at : new Date().toISOString();
  if (!isIso(at)) return badJson("at must be an ISO timestamp");

  const atMs = new Date(at).getTime();
  const now = Date.now();
  if (atMs > now + 60 * 60 * 1000) return badJson("at cannot be more than 1 hour in the future");
  if (atMs < now - 7 * 24 * 60 * 60 * 1000) return badJson("at cannot be more than 7 days in the past");

  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const mealId = typeof body.meal_id === "string" && body.meal_id ? body.meal_id : null;

  const row = {
    user_id: auth.user.id,
    units,
    kind,
    at,
    note,
    meal_id: mealId,
  };

  const { data, error } = await auth.sb
    .from("insulin_entries")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[insulin POST]", error.code, error.message);
    const status = isMissingTable(error) ? 503 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ entry: data });
}
