export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/admin/engine-traces
 *
 * Query params:
 *   type    — filter by trace_type: bolus_calc | icr_lookup | cgm_fetch | voice_intent | photo_analysis
 *   error   — "NOT NULL" to return only traces with errors
 *   user_id — filter by user UUID
 *   from    — ISO date lower bound, e.g. 2026-06-01
 *   to      — ISO date upper bound, e.g. 2026-06-30
 *   limit   — max rows (default 50, max 200)
 *
 * Response: array of engine_traces rows, newest first.
 */
export async function GET(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit  = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50") || 50, 1), 200);
  const type   = searchParams.get("type");
  const error  = searchParams.get("error");
  const userId = searchParams.get("user_id");
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");

  const sb = getSupabaseAdmin();
  let q = sb
    .from("engine_traces")
    .select("id, user_id, trace_type, input, output, steps, total_latency_ms, error, app_version, env, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (type)   q = q.eq("trace_type", type);
  if (userId) q = q.eq("user_id", userId);
  if (from)   q = q.gte("created_at", from);
  if (to)     q = q.lte("created_at", to + "T23:59:59Z");
  if (error === "NOT NULL") q = q.not("error", "is", null);

  const { data, error: dbErr } = await q;
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
