import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authedClient, isMissingTable } from "./_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id,user_id,created_at,insulin_type,insulin_name,units,cgm_glucose_at_log,notes,related_entry_id";

const VALID_TYPE = new Set(["bolus", "basal"]);

export type ParsedInsulinPostBody = {
  insulin_type: "bolus" | "basal";
  insulin_name: string;
  units: number;
  cgm_glucose_at_log: number | null;
  notes: string | null;
  related_entry_id: string | null;
};

/**
 * Pure body-parser + validator for `POST /api/insulin`. Extracted so
 * we can unit-test the three Task #305 contracts in isolation:
 *   • `related_entry_id` present → forwarded to the insert row.
 *   • `related_entry_id` absent  → row stays null (un-linked bolus,
 *     unchanged legacy behaviour).
 *   • `related_entry_id` malformed shape → clean 400 error string.
 * Ownership / existence of the meal id is enforced by the FK + RLS
 * on `insulin_logs.related_entry_id` at the DB layer (same as the
 * existing PATCH endpoint), so a stray id surfaces as an insert
 * error instead of an orphan reference.
 */
export function parseInsulinPostBody(
  body: Record<string, unknown>,
): { ok: true; row: ParsedInsulinPostBody } | { ok: false; error: string } {
  const insulin_type_raw = String(body.insulin_type ?? "").toLowerCase();
  const insulin_name = String(body.insulin_name ?? "").trim();
  const unitsRaw = Number(body.units);
  const cgmRaw = body.cgm_glucose_at_log;
  const notes = body.notes != null ? String(body.notes).trim() : null;

  if (!VALID_TYPE.has(insulin_type_raw)) {
    return { ok: false, error: "insulin_type must be 'bolus' or 'basal'" };
  }
  const insulin_type = insulin_type_raw as "bolus" | "basal";
  if (!insulin_name) {
    return { ok: false, error: "insulin_name is required" };
  }
  if (!Number.isFinite(unitsRaw) || unitsRaw <= 0 || unitsRaw > 100) {
    return { ok: false, error: "units must be a number 0 < n ≤ 100" };
  }

  let cgm: number | null = null;
  if (cgmRaw != null && cgmRaw !== "") {
    const c = Number(cgmRaw);
    if (!Number.isFinite(c) || c < 20 || c > 600) {
      return { ok: false, error: "cgm_glucose_at_log out of range" };
    }
    cgm = Math.round(c * 10) / 10;
  }

  // Same shape rules as the PATCH endpoint (`app/api/insulin/[id]/route.ts`):
  // explicit null unlinks; non-empty trimmed string is the meal id;
  // anything else (including empty string, numbers, objects) is a 400.
  // Omitting the field entirely keeps the legacy default of "unlinked".
  let relatedEntryId: string | null = null;
  if (Object.prototype.hasOwnProperty.call(body, "related_entry_id")) {
    const raw = body.related_entry_id;
    if (raw === null) {
      relatedEntryId = null;
    } else if (typeof raw === "string" && raw.trim().length > 0) {
      relatedEntryId = raw.trim();
    } else {
      return { ok: false, error: "related_entry_id must be a string id or null" };
    }
  }

  return {
    ok: true,
    row: {
      insulin_type,
      insulin_name,
      units: Math.round(unitsRaw * 100) / 100,
      cgm_glucose_at_log: cgm,
      notes: notes || null,
      // basal entries always clear the link — the column has no
      // meaning there and the engine ICR pairing skips basals.
      related_entry_id: insulin_type === "bolus" ? relatedEntryId : null,
    },
  };
}

/**
 * GET /api/insulin
 * Returns the caller's insulin_logs ordered most-recent first.
 * Optional query params: ?from=ISO&to=ISO
 */
export async function GET(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let q = auth.sb
    .from("insulin_logs")
    .select(COLS)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (from) q = q.gte("created_at", from);
  if (to)   q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ logs: [], warning: "insulin_logs table missing — run the migration" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ logs: data || [] });
}

/**
 * Core POST handler — takes already-resolved auth + sb so unit tests
 * can drive it without standing up the Next runtime or Supabase.
 */
export async function handleInsulinPost(
  sb: SupabaseClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const parsed = parseInsulinPostBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const row = { user_id: userId, ...parsed.row };

  const { data, error } = await sb
    .from("insulin_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "insulin_logs table is missing — run the migration in Supabase first" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ log: data }, { status: 201 });
}

/**
 * POST /api/insulin
 * Body: { insulin_type, insulin_name, units, cgm_glucose_at_log?, notes?, related_entry_id? }
 */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  return handleInsulinPost(auth.sb, auth.user.id, body);
}
