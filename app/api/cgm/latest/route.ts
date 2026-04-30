import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../_helpers";
import { getHistory } from "@/lib/cgm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cgm/latest
 * Returns the current reading for the CgmFetchButton (Refresh button).
 *
 * Uses the source-agnostic dispatcher (lib/cgm) so Apple Health and
 * Nightscout users get their own freshest reading instead of always
 * hitting LLU. We still call getHistory (not getLatest) because for
 * LLU specifically the graph endpoint is fresher than the connections
 * list — for the other adapters getHistory simply reads the cached
 * series and returns the newest row.
 *
 * Response shape: { current: { value, unit, timestamp, trend } | null }
 */
export async function GET(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    const out = await getHistory(user.id);
    // Return only current so clients expecting { current } still work
    return NextResponse.json({ current: out.current });
  } catch (e) {
    return errResponse(e);
  }
}
