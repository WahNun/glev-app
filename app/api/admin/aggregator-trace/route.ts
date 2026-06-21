export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { parseFoodText } from "@/lib/nutrition/parseFood";
import { aggregateNutrition } from "@/lib/nutrition/aggregate";
import { AggregatorTrace } from "@/lib/nutrition/aggregator-trace";

/**
 * GET /api/admin/aggregator-trace?term=<food text>
 *
 * Runs a live aggregator pass for the given term and returns the full
 * trace immediately — no DB persist. Use for targeted diagnosis without
 * needing a real user click.
 *
 * Query params:
 *   term   — food description to parse + aggregate (required)
 *   locale — "de" | "en" (default "de")
 */
export async function GET(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const term   = searchParams.get("term");
  const locale: "de" | "en" = searchParams.get("locale") === "en" ? "en" : "de";

  if (!term || !term.trim()) {
    return NextResponse.json({ error: "term is required" }, { status: 400 });
  }

  const t0 = Date.now();

  let parsed;
  try {
    parsed = await parseFoodText(term.trim(), locale);
  } catch (e) {
    return NextResponse.json(
      { error: `parseFoodText failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }

  const trace = new AggregatorTrace();
  let aggregated;
  try {
    aggregated = await aggregateNutrition(parsed.items, { trace });
  } catch (e) {
    return NextResponse.json(
      { error: `aggregateNutrition failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    term:             term.trim(),
    locale,
    total_latency_ms: Date.now() - t0,
    parsed_items:     parsed.items,
    description:      parsed.description,
    aggregated: {
      items:           aggregated.items,
      totals:          aggregated.totals,
      nutritionSource: aggregated.nutritionSource,
    },
    trace: trace.snapshot(),
  });
}
