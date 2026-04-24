import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticate, errResponse } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) {
    throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Lightweight status read for the Settings page.
 * NEVER selects the encrypted password. NEVER calls LLU upstream — the
 * Settings page would otherwise hammer LLU on every open. Live fetches
 * happen via /api/cgm/latest from the "Verbindung testen" button.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    const admin = adminClient();
    const { data, error: dbErr } = await admin
      .from("cgm_credentials")
      .select("llu_email, llu_region")
      .eq("user_id", user.id)
      .maybeSingle();
    if (dbErr) throw new Error("supabase: " + dbErr.message);
    if (!data) {
      return NextResponse.json({
        connected: false,
        email: null,
        region: null,
        lastReading: null,
      });
    }
    return NextResponse.json({
      connected: true,
      email: data.llu_email,
      region: (data.llu_region || "eu").toUpperCase(),
      lastReading: null,
    });
  } catch (e) {
    return errResponse(e);
  }
}
