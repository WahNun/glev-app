import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "../_helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });

  let body: {
    error_code?: string;
    error_message?: string;
    cgm_source?: string;
    app_version?: string;
    platform?: string;
    device_info?: Record<string, unknown>;
    context?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { error_code, error_message, cgm_source, app_version, platform, device_info, context } = body;
  if (!error_code) return NextResponse.json({ error: "error_code required" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { error: insertErr } = await admin.from("cgm_error_logs").insert({
    user_id: user.id,
    error_code,
    error_message: error_message ?? null,
    cgm_source: cgm_source ?? null,
    app_version: app_version ?? null,
    platform: platform ?? null,
    device_info: device_info ?? null,
    context: context ?? null,
  });

  if (insertErr) {
    console.error("[cgm/report-error] insert failed:", insertErr.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
