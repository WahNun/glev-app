import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getOrCreateReferralCode } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveUser(req: NextRequest) {
  const url  = process.env.SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const sb = createClient(url, anon);
    const { data: { user }, error } = await sb.auth.getUser(auth.slice(7));
    if (!error && user) return user;
  }

  const cookieStore = await cookies();
  const all = cookieStore.getAll();
  if (all.length > 0) {
    const sb = createServerClient(url, anon, {
      cookies: { getAll: () => all.map((c) => ({ name: c.name, value: c.value })), setAll: () => {} },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (user) return user;
  }

  return null;
}

/**
 * GET /api/me/referral
 *
 * Returns the authenticated user's referral code + stats.
 * Generates the code lazily on first call.
 *
 * Response: { code, shareUrl, referredCount, rewardedCount }
 */
export async function GET(req: NextRequest) {
  try {
    const user = await resolveUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const code = await getOrCreateReferralCode(user.id);

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_ORIGIN ||
      "https://glev.app"
    ).replace(/\/$/, "");

    const shareUrl = `${appUrl}/join?ref=${code}`;

    const sb = getSupabaseAdmin();
    const { data: referrals } = await sb
      .from("referrals")
      .select("status")
      .eq("referrer_user_id", user.id);

    const referredCount = referrals?.length ?? 0;
    const rewardedCount = referrals?.filter((r: { status: string }) => r.status === "rewarded").length ?? 0;

    return NextResponse.json({ code, shareUrl, referredCount, rewardedCount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("[api/me/referral]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
