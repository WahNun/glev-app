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
 * NEVER calls LLU upstream — the Settings page would otherwise hammer LLU on every open.
 * Live fetches happen via /api/cgm/latest from the "Verbindung testen" button.
 *
 * Returns:
 *   connected          — true if a row in cgm_credentials exists
 *   email              — masked LLU email
 *   region             — EU | US
 *   tokenExpiresAt     — ISO timestamp from cached_token_expires (null if never connected)
 *   lastConnectedAt    — ISO timestamp from updated_at (null if never set)
 *   sessionHealth      — "active" | "expiring_soon" | "expired" | "never_tested"
 *   lastReading        — always null (no LLU call)
 */
export async function GET(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    const admin = adminClient();
    const { data, error: dbErr } = await admin
      .from("cgm_credentials")
      .select("llu_email, llu_region, cached_token_expires, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (dbErr) throw new Error("supabase: " + dbErr.message);
    if (!data) {
      return NextResponse.json({
        connected: false,
        email: null,
        region: null,
        tokenExpiresAt: null,
        lastConnectedAt: null,
        sessionHealth: "never_tested",
        lastReading: null,
      });
    }

    // Derive session health from cached_token_expires
    const tokenExpiresAt = data.cached_token_expires ?? null;
    let sessionHealth: "active" | "expiring_soon" | "expired" | "never_tested";
    if (!tokenExpiresAt) {
      sessionHealth = "never_tested";
    } else {
      const expiresMs = new Date(tokenExpiresAt).getTime();
      const nowMs = Date.now();
      const diffMin = (expiresMs - nowMs) / 60_000;
      if (diffMin <= 0) {
        sessionHealth = "expired";
      } else if (diffMin <= 15) {
        sessionHealth = "expiring_soon";
      } else {
        sessionHealth = "active";
      }
    }

    return NextResponse.json({
      connected: true,
      email: data.llu_email,
      region: (data.llu_region || "eu").toUpperCase(),
      tokenExpiresAt,
      lastConnectedAt: data.updated_at ?? null,
      sessionHealth,
      lastReading: null,
    });
  } catch (e) {
    return errResponse(e);
  }
}
