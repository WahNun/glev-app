export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type AuditRow = {
  ai_source:      string | null;
  ai_model_id:    string | null;
  user_corrected: boolean | null;
  diff_pct_kh:    number | null;
};

type SourceStats = {
  count:               number;
  corrected_count:     number;
  corrected_pct:       number;
  avg_abs_diff_pct_kh: number | null;
};

function buildStats(rows: AuditRow[]): SourceStats {
  const corrected = rows.filter((r) => r.user_corrected === true);
  const withDiff = rows
    .map((r) => (r.diff_pct_kh != null ? Math.abs(r.diff_pct_kh) : null))
    .filter((v): v is number => v !== null);
  return {
    count:               rows.length,
    corrected_count:     corrected.length,
    corrected_pct:       rows.length > 0
      ? Math.round((corrected.length / rows.length) * 1000) / 10
      : 0,
    avg_abs_diff_pct_kh: withDiff.length > 0
      ? Math.round((withDiff.reduce((s, v) => s + v, 0) / withDiff.length) * 10) / 10
      : null,
  };
}

/**
 * GET /api/admin/macros-quality-stats
 *
 * Query params:
 *   from      — ISO date lower bound (inclusive), e.g. 2026-06-01
 *   to        — ISO date upper bound (inclusive), e.g. 2026-06-30
 *   ai_source — optional filter, e.g. openai | pixtral | aggregator
 *
 * Response shape:
 *   { total_meals, by_source: { [source]: SourceStats }, by_model: { [model]: SourceStats } }
 */
export async function GET(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from      = searchParams.get("from");
  const to        = searchParams.get("to");
  const aiSource  = searchParams.get("ai_source");

  const sb = getSupabaseAdmin();
  let q = sb
    .from("meal_estimate_audits")
    .select("ai_source, ai_model_id, user_corrected, diff_pct_kh");

  if (from) q = q.gte("created_at", from);
  if (to)   q = q.lte("created_at", to + "T23:59:59Z");
  if (aiSource) q = q.eq("ai_source", aiSource);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as AuditRow[];

  const sourceMap = new Map<string, AuditRow[]>();
  const modelMap  = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const sk = row.ai_source ?? "unknown";
    const mk = row.ai_model_id ?? "(none)";
    if (!sourceMap.has(sk)) sourceMap.set(sk, []);
    sourceMap.get(sk)!.push(row);
    if (!modelMap.has(mk)) modelMap.set(mk, []);
    modelMap.get(mk)!.push(row);
  }

  const by_source: Record<string, SourceStats> = {};
  for (const [k, v] of sourceMap) by_source[k] = buildStats(v);

  const by_model: Record<string, SourceStats> = {};
  for (const [k, v] of modelMap) by_model[k] = buildStats(v);

  return NextResponse.json({
    total_meals: rows.length,
    by_source,
    by_model,
  });
}
