import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!code || !/^[a-z2-9]{4,12}$/.test(code)) {
    return NextResponse.redirect("https://glev.app", { status: 302 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("short_links")
      .select("url, expires_at")
      .eq("code", code)
      .single();

    if (data && new Date(data.expires_at) > new Date()) {
      return NextResponse.redirect(data.url, { status: 302 });
    }
  } catch {
    // fall through to homepage
  }

  return NextResponse.redirect("https://glev.app", { status: 302 });
}
