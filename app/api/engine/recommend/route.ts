export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recommendDoseWithTrace } from "@/lib/engine/recommendation";
import type { AdaptiveICR } from "@/lib/engine/adaptiveICR";

/**
 * POST /api/engine/recommend
 *
 * Server-side bolus recommendation with engine_traces persistence.
 * The engine page currently computes doses client-side for instant feedback;
 * this endpoint provides the same calculation server-side so every bolus
 * recommendation can be traced and audited.
 *
 * Body:
 *   carbs        — grams of carbohydrates
 *   current_bg   — current blood glucose in mg/dL (null = unknown)
 *   target_bg    — target BG in mg/dL (optional, uses engine default)
 *   adaptive_icr — AdaptiveICR object from computeAdaptiveICR
 *   correction_factor — CF in mg/dL per unit (optional)
 *   time_of_day  — "morning" | "afternoon" | "evening" (optional)
 *   iob          — insulin on board in units (optional, for trace only)
 *   manual_offset — manual dose offset applied by user (optional, trace only)
 *
 * Response: RecommendOutput + trace_id implicit (trace is fire-and-forget).
 */
export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const carbs = Number(body.carbs ?? 0);
  if (!Number.isFinite(carbs) || carbs < 0) {
    return NextResponse.json({ error: "carbs must be a non-negative number" }, { status: 400 });
  }

  const adaptiveICR = body.adaptive_icr as AdaptiveICR | null;
  if (!adaptiveICR || typeof adaptiveICR !== "object") {
    return NextResponse.json({ error: "adaptive_icr is required" }, { status: 400 });
  }

  const currentBG =
    body.current_bg != null && Number.isFinite(Number(body.current_bg))
      ? Number(body.current_bg)
      : null;

  const targetBG =
    body.target_bg != null && Number.isFinite(Number(body.target_bg))
      ? Number(body.target_bg)
      : undefined;

  const correctionFactor =
    body.correction_factor != null && Number.isFinite(Number(body.correction_factor))
      ? Number(body.correction_factor)
      : undefined;

  const timeOfDay =
    body.time_of_day === "morning" || body.time_of_day === "afternoon" || body.time_of_day === "evening"
      ? body.time_of_day
      : undefined;

  const iob =
    body.iob != null && Number.isFinite(Number(body.iob)) ? Number(body.iob) : null;

  const manualOffset =
    body.manual_offset != null && Number.isFinite(Number(body.manual_offset))
      ? Number(body.manual_offset)
      : null;

  let adminSb;
  try { adminSb = getSupabaseAdmin(); } catch { /* no-op */ }

  if (!adminSb) {
    // Fallback when admin client is unavailable (local dev without service-role key):
    // compute recommendation without trace
    const { recommendDose } = await import("@/lib/engine/recommendation");
    const result = recommendDose({
      carbs, currentBG, targetBG, adaptiveICR, correctionFactor, timeOfDay,
    });
    return NextResponse.json(result);
  }

  const result = await recommendDoseWithTrace(
    { carbs, currentBG, targetBG, adaptiveICR, correctionFactor, timeOfDay },
    {
      user_id:       auth.user.id,
      supabase:      adminSb,
      app_version:   process.env.npm_package_version ?? "unknown",
      env:           process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      iob,
      manual_offset: manualOffset,
    },
  );

  return NextResponse.json(result);
}
