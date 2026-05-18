/**
 * Apple Health workout history range endpoint.
 *
 * Returns the oldest + newest workout timestamp and the total count
 * for the authenticated user, restricted to rows synced from
 * Apple Health (`exercise_logs.source = 'apple_health'`).
 *
 * Used by the Settings card so power users can see "Workouts:
 * 2022-03-14 → 2026-05-18, 247 Stück" right under the backfill
 * button and tell whether another backfill run is worth it
 * (e.g. after buying a new Watch with deeper on-device history).
 *
 * Response: `{ oldest: string | null, newest: string | null, count: number }`
 * (timestamps are ISO 8601; null when the user has no synced workouts yet)
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "apple_health";

export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }

  try {
    const sb = adminClient();

    // Two cheap index-aided lookups + a count. Doing it as three
    // separate roundtrips beats pulling every row to the server just
    // to find the min/max — `started_at` is what the engine queries
    // for the "exercise within 4h" hook so it's already covered by
    // the existing indexes.
    const [oldestRes, newestRes, countRes] = await Promise.all([
      sb
        .from("exercise_logs")
        .select("started_at")
        .eq("user_id", user.id)
        .eq("source", SOURCE)
        .order("started_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      sb
        .from("exercise_logs")
        .select("started_at")
        .eq("user_id", user.id)
        .eq("source", SOURCE)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("exercise_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("source", SOURCE),
    ]);

    if (oldestRes.error) throw new Error("supabase: " + oldestRes.error.message);
    if (newestRes.error) throw new Error("supabase: " + newestRes.error.message);
    if (countRes.error) throw new Error("supabase: " + countRes.error.message);

    const oldest =
      (oldestRes.data?.started_at as string | undefined) ?? null;
    const newest =
      (newestRes.data?.started_at as string | undefined) ?? null;
    const count = countRes.count ?? 0;

    return NextResponse.json({ oldest, newest, count });
  } catch (e) {
    return errResponse(e);
  }
}
