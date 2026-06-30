import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../../_helpers";
import { verifyCredentials } from "@/lib/cgm/dexcom";
import { adminClient } from "@/lib/cgm/supabase";
import { decrypt } from "@/lib/cgm/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cgm/dexcom/test
 *
 * Validates Dexcom Share credentials without persisting anything.
 * Returns { ok: true } on success or { error: string } on failure.
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

  try {
    await verifyCredentials(username, password, region);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    let friendly: string;
    if (
      lower.includes("accountpasswordinvalid") ||
      lower.includes("notauthenticated") ||
      lower.includes("invalid credentials")
    ) {
      friendly = "test_invalid_credentials";
    } else if (lower.includes("region") || lower.includes("sessionidnotfound")) {
      friendly = "test_invalid_region";
    } else {
      friendly = msg;
    }
    return NextResponse.json({ error: friendly, upstream: msg }, { status: 401 });
  }
}

/**
 * GET /api/cgm/dexcom/test
 *
 * Tests stored Dexcom credentials without requiring the user to re-enter them.
 */
export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }

  const { data: row, error: dbErr } = await adminClient()
    .from("cgm_credentials")
    .select("dexcom_username, dexcom_password_encrypted, dexcom_region")
    .eq("user_id", user.id)
    .maybeSingle();

  if (dbErr) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  if (!row?.dexcom_username || !row?.dexcom_password_encrypted) {
    return NextResponse.json({ error: "no_credentials" }, { status: 404 });
  }

  let password: string;
  try {
    password = decrypt(row.dexcom_password_encrypted as string);
  } catch {
    return NextResponse.json({ error: "decrypt_failed" }, { status: 500 });
  }

  try {
    await verifyCredentials(
      row.dexcom_username as string,
      password,
      (row.dexcom_region as string | null) ?? "eu"
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    let friendly: string;
    if (
      lower.includes("accountpasswordinvalid") ||
      lower.includes("notauthenticated") ||
      lower.includes("invalid credentials")
    ) {
      friendly = "test_invalid_credentials";
    } else if (lower.includes("region") || lower.includes("sessionidnotfound")) {
      friendly = "test_invalid_region";
    } else {
      friendly = msg;
    }
    return NextResponse.json({ error: friendly, upstream: msg }, { status: 401 });
  }
}
