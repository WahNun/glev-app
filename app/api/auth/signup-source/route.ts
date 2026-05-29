import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
 * POST /api/auth/signup-source
 *
 * Called from the signup page immediately after supabase.auth.signUp()
 * when a glev_ref cookie is present. Writes signup_source = 'ref:CODE'
 * to the new user's profile and inserts a pending row into referrals.
 *
 * Body: { code: string }
 * Auth: Bearer token from the fresh session OR cookie session.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await resolveUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code || !/^[A-Z0-9]{5,10}$/.test(code)) {
      return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();

    const signupSource = `ref:${code}`;

    const { error: profileErr } = await sb
      .from("profiles")
      .update({ signup_source: signupSource })
      .eq("user_id", user.id);

    if (profileErr) {
      console.error("[signup-source] profile update failed:", profileErr.message);
      return NextResponse.json({ error: "profile_update_failed" }, { status: 500 });
    }

    const referrerProfile = await sb
      .from("profiles")
      .select("user_id")
      .eq("referral_code", code)
      .maybeSingle();

    if (referrerProfile.data?.user_id && referrerProfile.data.user_id !== user.id) {
      await sb.from("referrals").upsert(
        {
          referrer_user_id: referrerProfile.data.user_id,
          referred_user_id: user.id,
          referral_code: code,
          status: "pending",
        },
        { onConflict: "referred_user_id" },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("[signup-source]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
