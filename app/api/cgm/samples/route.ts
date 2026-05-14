// GET /api/cgm/samples?from=<iso>&to=<iso>
//
// Returns continuous CGM samples for the authenticated user across
// both stream tables (cgm_samples + apple_health_readings) via the
// source-agnostic helper in lib/cgm/samples.ts. Used by the Insights
// page to power hypo / TIR / variability tiles with readings between
// logged events (the gap Option B fixes — see
// supabase/migrations/20260514_add_cgm_samples.sql header for the
// design rationale).
//
// Always returns 200 with `{ samples: [] }` on errors so the caller
// can render the page without continuous data instead of failing the
// whole Insights render.

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../_helpers";
import { getCgmSamples } from "@/lib/cgm/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }

  const fromIso = req.nextUrl.searchParams.get("from") ?? "";
  const toIso   = req.nextUrl.searchParams.get("to")   ?? "";
  const fromMs  = Date.parse(fromIso);
  const toMs    = Date.parse(toIso);

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return NextResponse.json({ error: "from/to must be ISO timestamps with to > from" }, { status: 400 });
  }
  // Hard window cap — 60 days. Anything bigger is almost certainly a
  // bug in the caller and would fan out two large queries.
  if (toMs - fromMs > 60 * 24 * 3600 * 1000) {
    return NextResponse.json({ error: "window too large (max 60 days)" }, { status: 400 });
  }

  try {
    const samples = await getCgmSamples(user.id, fromMs, toMs);
    return NextResponse.json({ samples });
  } catch (e) {
    console.error("[api/cgm/samples] read failed:", (e as Error)?.message || e);
    return NextResponse.json({ samples: [] });
  }
}
