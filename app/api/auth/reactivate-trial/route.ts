// POST /api/auth/reactivate-trial
// Generates a fresh activation link for a Meta-Lead user whose invite link expired.
// Only sends a new link when the trial has not yet been activated (trial_start_at IS NULL).
// No auth required — the generated link is sent TO the email, so only the owner benefits.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  metaLeadInviteHtml,
  metaLeadInviteSubject,
} from "@/lib/emails/meta-lead-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://glev.app").replace(/\/$/, "");
const FROM = "Glev <info@glev.app>";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const locale: "de" | "en" = body.locale === "en" ? "en" : "de";

  const admin = getSupabaseAdmin();

  // Find the user by email.
  const {
    data: { users },
    error: listErr,
  } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    console.error("[reactivate-trial] listUsers failed:", listErr.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const user = users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    // Don't leak user existence — return success silently.
    return NextResponse.json({ sent: true });
  }

  // Check if the trial has already been activated.
  const { data: profile } = await admin
    .from("profiles")
    .select("trial_start_at")
    .eq("user_id", user.id)
    .single();

  if (profile?.trial_start_at) {
    return NextResponse.json({ alreadyActivated: true });
  }

  // Generate a fresh recovery link (same as /api/admin/meta/resend-invite).
  const first =
    (user.user_metadata?.full_name as string | undefined)?.split(/\s+/)[0] ?? null;

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: `${APP_URL}/auth/confirm?lang=${locale}&email=${encodeURIComponent(email)}`,
    },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("[reactivate-trial] generateLink failed:", linkError?.message);
    return NextResponse.json(
      { error: "Could not generate activation link" },
      { status: 502 },
    );
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
  }

  const resend = new Resend(resendKey);
  const { error: sendError } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: metaLeadInviteSubject(first, locale, true),
    html: metaLeadInviteHtml(first, linkData.properties.action_link, locale, APP_URL, email, true),
  });

  if (sendError) {
    console.error("[reactivate-trial] Resend failed:", sendError);
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  console.log(`[reactivate-trial] new activation link sent → ${email} (locale=${locale})`);
  return NextResponse.json({ sent: true });
}
