// POST /api/pro/register
//
// Server-side user creation for the Pro checkout flow. Called from
// /pro/success after the buyer sets their password.
//
// Uses the Supabase Admin API (service-role key) to create the user
// with email_confirm: true — this skips the "Confirm Your Signup"
// confirmation email entirely. The buyer has already proven ownership
// of the email address by completing Stripe Checkout with it, so a
// second confirmation email is redundant and confusing.
//
// If the user already exists (duplicate submit or returning buyer),
// returns { ok: true, existed: true } so the client can proceed to
// signInWithPassword without an error.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : null;
  const password = typeof body.password === "string" ? body.password : null;

  if (!email || !password) {
    return NextResponse.json({ error: "email_and_password_required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    // "User already registered" — treat as success so the client can
    // proceed to signInWithPassword. The Pro access was already granted
    // by the webhook; we just need a session.
    if (
      error.message?.toLowerCase().includes("already") ||
      error.message?.toLowerCase().includes("duplicate") ||
      (error as { code?: string }).code === "email_exists"
    ) {
      return NextResponse.json({ ok: true, existed: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, existed: false, userId: data.user?.id });
}
