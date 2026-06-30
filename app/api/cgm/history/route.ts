import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../_helpers";
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
    const err = e as { status?: number; code?: string; response?: { status?: number }; upstream?: boolean; message?: string };
    let error_code = "internal";
    let httpStatus = 500;
    if (err?.status === 404) { error_code = "no_credentials"; httpStatus = 404; }
    else if (err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT") { error_code = "timeout"; httpStatus = 504; }
    else if (err?.response?.status === 401) { error_code = "login_failed"; httpStatus = 502; }
    else if (err?.response?.status) { error_code = "network_error"; httpStatus = 502; }
    else if (err?.upstream) { error_code = "network_error"; httpStatus = 502; }
    const msg = err?.message || "error";
    return NextResponse.json({ error: msg, error_code }, { status: httpStatus });
  }
}
