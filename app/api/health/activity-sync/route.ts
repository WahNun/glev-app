/**
 * GET  /api/health/activity-sync → { enabled: boolean }
 * PATCH /api/health/activity-sync  body { enabled: boolean } → { enabled: boolean }
 *
 * Reads / writes user_settings.activity_sync_apple_health — the opt-in
 * flag for syncing Steps, Active Energy and Workouts from Apple Health.
 * Decoupled from profiles.cgm_source so LLU / Nightscout users can also
 * enable Activity Sync without switching their glucose source.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../cgm/_helpers";
import { adminClient } from "@/lib/cgm/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }
  try {
    const { data } = await adminClient()
      .from("user_settings")
      .select("activity_sync_apple_health")
      .eq("user_id", user.id)
      .maybeSingle();
    return NextResponse.json({ enabled: data?.activity_sync_apple_health === true });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }
  let body: { enabled?: unknown };
  try {
    body = (await req.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    const { error } = await adminClient()
      .from("user_settings")
      .upsert(
        { user_id: user.id, activity_sync_apple_health: body.enabled },
        { onConflict: "user_id" },
      );
    if (error) throw new Error("supabase: " + error.message);
    return NextResponse.json({ enabled: body.enabled });
  } catch (e) {
    return errResponse(e);
  }
}
