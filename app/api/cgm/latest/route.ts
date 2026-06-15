import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../_helpers";
import { resolveSource, getHistory } from "@/lib/cgm";
import * as nightscout from "@/lib/cgm/nightscout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cgm/latest
 * Returns the current reading for the CgmFetchButton (Refresh button).
 *
 * For Nightscout users this does a forced live fetch (bypassing the
 * nightscout_readings DB cache) so the Refresh button actually returns
 * data from the Nightscout instance, not a cached row from up to 30 min ago.
 *
 * For LLU, getHistory already hits the LLU API live on every call.
 * For Apple Health the server cannot reach the device directly, so we
 * fall back to the cached series via getHistory.
 *
 * Response shape: { current: { value, unit, timestamp, trend } | null }
 */
export async function GET(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    const source = await resolveSource(user.id);
    if (source === "nightscout") {
      const out = await nightscout.getLatestLive(user.id);
      return NextResponse.json({ current: out.current });
    }
    const out = await getHistory(user.id);
    return NextResponse.json({ current: out.current });
  } catch (e) {
    return errResponse(e);
  }
}
