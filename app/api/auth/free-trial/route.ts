/**
 * POST /api/auth/free-trial
 *
 * Setzt trial_end_at = NOW() + 7 Tage auf dem Profil des eingeloggten Users
 * und feuert den E-Mail-Reminder-Stub.
 *
 * Wird unmittelbar nach dem Supabase-signUp auf der /signup-Seite aufgerufen.
 * Auth: Bearer-Token (frisch ausgestellte Session nach signUp).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url  = process.env.SUPABASE_URL  ?? process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  const auth  = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const anonClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes } = await anonClient.auth.getUser(token);
  const user = userRes?.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const trialEndAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const admin = getSupabaseAdmin();

  const { error } = await admin
    .from("profiles")
    .upsert(
      { user_id: user.id, trial_end_at: trialEndAt },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[free-trial] profile upsert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    await fetch(`${appUrl}/api/email/trial-reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, trial_end_at: trialEndAt }),
    });
  } catch {
  }

  return NextResponse.json({ ok: true, trial_end_at: trialEndAt });
}
