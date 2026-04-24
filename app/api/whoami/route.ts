import { NextRequest, NextResponse } from "next/server";
import { verifyJwt, adminClient } from "@/lib/cgm/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Reuse the same auth helper as /api/cgm/latest. Reads the JWT from the
    // Authorization: Bearer <token> header.
    const { userId, email } = await verifyJwt(req.headers.get("authorization"));

    let hasCgmCredentials = false;
    let credentialsEmail: string | null = null;
    try {
      const { data, error } = await adminClient()
        .from("cgm_credentials")
        .select("llu_email")
        .eq("user_id", userId)
        .maybeSingle();
      if (!error && data) {
        hasCgmCredentials = true;
        credentialsEmail = (data as { llu_email: string | null }).llu_email ?? null;
      }
    } catch {
      // Swallow — diagnostic should still return JWT info.
    }

    return NextResponse.json({
      userId,
      email,
      supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
      hasCgmCredentials,
      credentialsEmail,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 401) {
      return NextResponse.json({ error: err.message || "unauthorized" }, { status: 401 });
    }
    // eslint-disable-next-line no-console
    console.error("[whoami] internal:", err?.message || e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
