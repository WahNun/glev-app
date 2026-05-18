/**
 * GET /api/health/steps?days=N — recent daily activity rows for the
 * authenticated user, newest first. Used by the Insights "Daily steps"
 * card. Read-only, service-role select (RLS policies on the table
 * permit the same query for the authenticated user — we use admin
 * here so the route stays in lockstep with the engine's helper).
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../cgm/_helpers";
import {
  loadRecentActivityServer,
  summariseActivityContext,
} from "@/lib/dailyActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DAYS = 365;

export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }
  const url = new URL(req.url);
  const daysRaw = url.searchParams.get("days");
  let days = daysRaw ? Number(daysRaw) : 14;
  if (!Number.isFinite(days)) days = 14;
  days = Math.min(MAX_DAYS, Math.max(1, Math.round(days)));

  // Task #183 (code-review fix): "today" must be device-local, not
  // server-local. Stored `date` is YYYY-MM-DD as observed on the
  // iOS device; the server may run in UTC, which can be a calendar
  // day ahead/behind around midnight. The client passes its local
  // today via `?today=YYYY-MM-DD`; we validate it and pass it to
  // `summariseActivityContext`. Falls back to server-local only if
  // the client omits it (older client builds).
  const todayRaw = url.searchParams.get("today");
  const todayParam =
    typeof todayRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayRaw)
      ? todayRaw
      : undefined;

  try {
    const rows = await loadRecentActivityServer(user.id, days);
    const context = summariseActivityContext(rows, todayParam);
    return NextResponse.json({ rows, context });
  } catch (e) {
    return errResponse(e);
  }
}
