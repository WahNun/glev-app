import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../_helpers";
import { getHistory, getHistoryWithTrace } from "@/lib/cgm";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    let adminSb;
    try { adminSb = getSupabaseAdmin(); } catch { /* no-op */ }
    if (adminSb) {
      const out = await getHistoryWithTrace(user.id, {
        supabase:   adminSb,
        appVersion: process.env.npm_package_version ?? "unknown",
        env:        process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
      return NextResponse.json(out);
    }
    // Fallback: no admin client (local dev without service-role key)
    const out = await getHistory(user.id);
    return NextResponse.json(out);
  } catch (e) {
    return errResponse(e);
  }
}
