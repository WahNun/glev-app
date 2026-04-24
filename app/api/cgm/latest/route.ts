import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../_helpers";
import { getHistory } from "@/lib/cgm/llu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cgm/latest
 * Returns the current reading for the CgmFetchButton (Refresh button).
 *
 * Uses getHistory (graph endpoint) instead of getLatest (connections list)
 * because the connections list can return a stale glucoseMeasurement,
 * while the graph endpoint always returns the freshest sensor value.
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
