import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authedClient, isMissingTable } from "../insulin/_helpers";
import {
  SYMPTOM_TYPES,
  SYMPTOM_CATEGORIES,
  validateSeverities,
  type SymptomType,
  type SymptomCategory,
  type SeveritiesMap,
} from "@/lib/symptoms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id,user_id,created_at,occurred_at,symptom_types,severities,cgm_glucose_at_log,category,notes";

const VALID_SYMPTOMS: Set<string> = new Set(SYMPTOM_TYPES);
const VALID_CATEGORIES: Set<string> = new Set(SYMPTOM_CATEGORIES);

export type ParsedSymptomBody = {
  symptom_types: SymptomType[];
  severities: SeveritiesMap;
  occurred_at: string;
  cgm_glucose_at_log: number | null;
  category: SymptomCategory;
  notes: string | null;
};

/**
 * Pure body-parser + validator for `POST /api/symptoms`. Extracted so
 * unit tests can drive the validation contracts in isolation without
 * spinning up the Next runtime or a Supabase client.
 */
export function parseSymptomBody(
  body: Record<string, unknown>,
): { ok: true; row: ParsedSymptomBody } | { ok: false; error: string } {
  const rawTypes = Array.isArray(body.symptom_types) ? body.symptom_types : [];
  const types = rawTypes
    .filter((v): v is string => typeof v === "string")
    .filter((v): v is SymptomType => VALID_SYMPTOMS.has(v));
  const uniqTypes: SymptomType[] = Array.from(new Set(types)) as SymptomType[];
  if (uniqTypes.length === 0) {
    return { ok: false, error: "symptom_types must include at least one valid symptom" };
  }

  const severities = validateSeverities(uniqTypes, body.severities);
  if (!severities) {
    return {
      ok: false,
      error: "severities must be an object {symptom: 1..5} covering every symptom_types entry",
    };
  }

  const occurredRaw = body.occurred_at;
  let occurred_at: string;
  if (occurredRaw == null || occurredRaw === "") {
    occurred_at = new Date().toISOString();
  } else {
    const d = new Date(String(occurredRaw));
    if (isNaN(d.getTime())) {
      return { ok: false, error: "occurred_at must be a valid ISO timestamp" };
    }
    occurred_at = d.toISOString();
  }

  const notes = body.notes != null ? String(body.notes).trim() : null;

  // Optional CGM snapshot. Anything outside 20..600 mg/dL or non-finite
  // is silently dropped to null — the symptom itself is the primary payload.
  let cgmAtLog: number | null = null;
  if (body.cgm_glucose_at_log != null) {
    const n = Number(body.cgm_glucose_at_log);
    if (Number.isFinite(n) && n >= 20 && n <= 600) {
      cgmAtLog = Math.round(n * 10) / 10;
    }
  }

  // Category bucket — defaults to 'general' for older clients.
  let category: SymptomCategory = "general";
  if (body.category != null && body.category !== "") {
    const raw = String(body.category).toLowerCase();
    if (!VALID_CATEGORIES.has(raw)) {
      return {
        ok: false,
        error: `category must be one of: ${Array.from(VALID_CATEGORIES).join(", ")}`,
      };
    }
    category = raw as SymptomCategory;
  }

  return {
    ok: true,
    row: {
      symptom_types: uniqTypes,
      severities,
      occurred_at,
      cgm_glucose_at_log: cgmAtLog,
      category,
      notes: notes || null,
    },
  };
}

/**
 * Core POST handler — takes already-resolved auth + sb so unit tests
 * can drive it without standing up the Next runtime or Supabase.
 */
export async function handleSymptomsPost(
  sb: SupabaseClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const parsed = parseSymptomBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const row = { user_id: userId, ...parsed.row };

  const { data, error } = await sb
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

/** POST /api/symptoms — body: { symptom_types[], severities{token:1..5}, occurred_at?, notes? } */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  return handleSymptomsPost(auth.sb, auth.user.id, body);
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
