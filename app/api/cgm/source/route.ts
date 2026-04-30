/**
 * CGM source preference endpoint.
 *
 * Read or update `profiles.cgm_source` — the explicit per-user
 * preference for which CGM adapter the dispatcher (lib/cgm/index.ts)
 * should route to. Values: 'llu' | 'nightscout' | 'apple_health'.
 *
 * Why a dedicated endpoint:
 *   - LLU and Nightscout each have their own credential-set route
 *     (POST /api/cgm/credentials, POST /api/cgm/nightscout/sync) so
 *     the dispatcher can infer source from URL-presence.
 *   - Apple Health has NO credentials in `profiles` — readings are
 *     pushed by the device into `apple_health_readings`. The user's
 *     intent to use Apple Health therefore can't be inferred from
 *     anything in `profiles`; it must be set explicitly. This route
 *     is the only writer for that signal.
 *
 * Surface:
 *   GET   → { source: 'llu' | 'nightscout' | 'apple_health' | null }
 *   PATCH → body { source: 'llu' | 'nightscout' | 'apple_health' | null }
 *           Setting null clears the explicit pin; the dispatcher then
 *           falls back to the legacy URL-presence rule.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../_helpers";
import { adminClient } from "@/lib/cgm/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["llu", "nightscout", "apple_health"]);

export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }
  try {
    const { data, error } = await adminClient()
      .from("profiles")
      .select("cgm_source")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error("supabase: " + error.message);
    return NextResponse.json({ source: data?.cgm_source ?? null });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }
  let body: { source?: unknown };
  try {
    body = (await req.json()) as { source?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  let next: string | null;
  if (body.source === null) {
    next = null;
  } else if (typeof body.source === "string" && ALLOWED.has(body.source)) {
    next = body.source;
  } else {
    return NextResponse.json(
      { error: "source must be one of 'llu' | 'nightscout' | 'apple_health' or null" },
      { status: 400 }
    );
  }
  try {
    const { error } = await adminClient()
      .from("profiles")
      .update({ cgm_source: next, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (error) throw new Error("supabase: " + error.message);
    return NextResponse.json({ source: next });
  } catch (e) {
    return errResponse(e);
  }
}
