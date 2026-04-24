import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticate, errResponse } from "../_helpers";
import { encrypt } from "@/lib/cgm/crypto";

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

export async function POST(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    let body: { email?: string; password?: string; region?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const email = body?.email;
    const password = body?.password;
    const region = (body?.region || "eu").toLowerCase();
    if (!email || !password) {
      return NextResponse.json({ error: "email and password required" }, { status: 400 });
    }

    const encryptedPassword = encrypt(password);

    // Service-role client — bypasses RLS. authenticate() already verified user.id.
    const admin = adminClient();
    const { error: upsertError } = await admin
      .from("cgm_credentials")
      .upsert(
        {
          user_id: user.id,
          llu_email: email,
          llu_password_encrypted: encryptedPassword,
          llu_region: region,
          cached_token: null,
          cached_token_expires: null,
          cached_patient_id: null,
          cached_account_id_hash: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) throw new Error("supabase: " + upsertError.message);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { message?: string; stack?: string; name?: string };
    return NextResponse.json(
      {
        error: "internal",
        message: err?.message || String(e),
        stack: err?.stack?.split("\n").slice(0, 5).join(" | "),
        name: err?.name,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    // Service-role client — bypasses RLS for the delete.
    const admin = adminClient();
    const { error: delError } = await admin
      .from("cgm_credentials")
      .delete()
      .eq("user_id", user.id);
    if (delError) throw new Error("supabase: " + delError.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
