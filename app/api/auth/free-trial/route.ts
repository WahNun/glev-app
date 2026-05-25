/**
 * POST /api/auth/free-trial
 *
 * Called immediately after a free-trial signup (no Stripe).
 * Sets profiles.trial_end_at = NOW() + 7 days for the authenticated user.
 *
 * Auth: Bearer token from supabase.auth.getSession() on the client,
 * or session cookie (web).
 *
 * Fire-and-forget to /api/email/trial-reminder so the welcome email
 * doesn't block the signup redirect.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

async function resolveUser(req: NextRequest) {
  const url  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // 1. Bearer token (native / client-side POST)
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const sb = createClient(url, anon);
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (!error && user) return user;
  }

  // 2. Cookie session (SSR / web)
  const cookieStore = await cookies();
  const all = cookieStore.getAll();
  if (all.length > 0) {
    const sb = createServerClient(url, anon, {
      cookies: {
        getAll: () => all.map((c) => ({ name: c.name, value: c.value })),
        setAll: () => {},
      },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (user) return user;
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getSupabaseAdmin();

    // Set trial_end_at = 7 days from now
    const trialEndAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await admin
      .from("profiles")
      .upsert(
        { user_id: user.id, trial_end_at: trialEndAt },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[free-trial] upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fire-and-forget welcome email (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://glev.app";
    fetch(`${baseUrl}/api/email/trial-reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "there",
        trial_end_at: trialEndAt,
      }),
    }).catch((e) => console.warn("[free-trial] email fire-and-forget failed:", e));

    return NextResponse.json({ ok: true, trial_end_at: trialEndAt });
  } catch (err) {
    console.error("[free-trial] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
