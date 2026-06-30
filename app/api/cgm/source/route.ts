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

const ALLOWED = new Set(["llu", "nightscout", "apple_health", "dexcom"]);

export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }
  try {
    const client = adminClient();
    const [profileRes, credsRes] = await Promise.all([
      client
        .from("profiles")
        .select("cgm_source, nightscout_url")
        .eq("user_id", user.id)
        .maybeSingle(),
      client
        .from("cgm_credentials")
        .select("llu_email, dexcom_username")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (profileRes.error) throw new Error("supabase: " + profileRes.error.message);
    if (credsRes.error) throw new Error("supabase: " + credsRes.error.message);

    const source = profileRes.data?.cgm_source ?? null;
    const nightscout_url = profileRes.data?.nightscout_url ?? null;
    const llu_email = credsRes.data?.llu_email ?? null;
    const dexcom_username = credsRes.data?.dexcom_username ?? null;

    const llu_connected = source === "llu" && llu_email !== null;
    const nightscout_connected = source === "nightscout" && nightscout_url !== null;
    const dexcom_connected = source === "dexcom" && dexcom_username !== null;
    const apple_health_connected = source === "apple_health";

    return NextResponse.json({
      source,
      dexcom_credentials_present: dexcom_connected,
      llu_connected,
      nightscout_connected,
      dexcom_connected,
      apple_health_connected,
    });
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
      { error: "source must be one of 'llu' | 'nightscout' | 'apple_health' | 'dexcom' or null" },
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
