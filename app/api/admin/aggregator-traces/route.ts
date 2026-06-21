export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/admin/aggregator-traces
 *
 * Query params:
 *   limit   — max rows (default 50, max 200)
 *   from    — ISO date lower bound, e.g. 2026-06-01
 *   to      — ISO date upper bound, e.g. 2026-06-30
 *   source  — filter by final_nutrition_source, e.g. estimated | open_food_facts | usda
 *   user_id — filter by user
 *
 * Response: array of aggregator_traces rows, newest first.
 */
export async function GET(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit   = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50") || 50, 1), 200);
  const from    = searchParams.get("from");
  const to      = searchParams.get("to");
  const source  = searchParams.get("source");
  const userId  = searchParams.get("user_id");

  const sb = getSupabaseAdmin();
  let q = sb
    .from("aggregator_traces")
    .select("id, user_id, input_text, parsed_food, lookups, final_nutrition_source, final_macros, total_latency_ms, aggregator_version, env, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (from)   q = q.gte("created_at", from);
  if (to)     q = q.lte("created_at", to + "T23:59:59Z");
  if (source) q = q.eq("final_nutrition_source", source);
  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
