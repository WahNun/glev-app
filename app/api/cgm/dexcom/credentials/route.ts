import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../_helpers";
import { adminClient } from "@/lib/cgm/supabase";
import { verifyCredentials, setCredentials, deleteCredentials } from "@/lib/cgm/dexcom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cgm/dexcom/credentials
 *
 * Verifies Dexcom Share credentials, persists them encrypted, and sets
 * profiles.cgm_source = 'dexcom'.
 */
export async function POST(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }

  let body: { username?: string; password?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { username, password, region = "eu" } = body ?? {};
  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password required" },
      { status: 400 }
    );
  }

  // Verify against Dexcom Share before persisting
  let effectiveRegion = region;
  try {
    const result = await verifyCredentials(username, password, region);
    effectiveRegion = result.region;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    let friendly: string;
    if (
      lower.includes("accountpasswordinvalid") ||
      lower.includes("notauthenticated") ||
      lower.includes("invalid credentials")
    ) {
      friendly = "Benutzername oder Passwort falsch. Bitte prüfe deine Dexcom-Zugangsdaten.";
    } else if (lower.includes("region")) {
      friendly = "Falsche Region. Bitte EU oder USA prüfen.";
    } else {
      friendly = `Dexcom-Login fehlgeschlagen: ${msg}`;
    }
    return NextResponse.json({ error: friendly, upstream: msg }, { status: 401 });
  }

  try {
    await setCredentials(user.id, {
      username,
      password,
      region: effectiveRegion,
    });

    // Pin the dispatcher to Dexcom
    const { error: sourceErr } = await adminClient()
      .from("profiles")
      .update({ cgm_source: "dexcom", updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (sourceErr) throw new Error("supabase: " + sourceErr.message);

    return NextResponse.json({ ok: true, region: effectiveRegion });
  } catch (e) {
    return errResponse(e);
  }
}

/**
 * DELETE /api/cgm/dexcom/credentials
 *
 * Clears Dexcom credentials and resets cgm_source to null (dispatcher
 * falls back to LLU auto-detect).
 */
export async function DELETE(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }

  try {
    await deleteCredentials(user.id);

    const { error: sourceErr } = await adminClient()
      .from("profiles")
      .update({ cgm_source: null, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (sourceErr) throw new Error("supabase: " + sourceErr.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
