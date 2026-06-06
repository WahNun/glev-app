// POST /api/admin/meta/resend-invite
// Schickt einem bestehenden Meta-Lead eine gebrandete Einladungs-Email
// mit Supabase Recovery-Link (Passwort-Setup).
//
// Auth: Bearer ADMIN_API_SECRET
// Body: { email: string, name?: string, locale?: "de" | "en" }

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
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const name = typeof body.name === "string" ? body.name.trim() || null : null;
  const locale: "de" | "en" = body.locale === "en" ? "en" : "de";
  const first = name?.split(/\s+/)[0] ?? null;

  const admin = getSupabaseAdmin();

  // Generate a recovery link so the user can set their password.
  // Works for both brand-new invites and re-invites of existing users.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${APP_URL}/auth/confirm` },
  });

  if (linkError || !linkData?.properties?.action_link) {
    // eslint-disable-next-line no-console
    console.error("[resend-invite] generateLink failed:", linkError?.message);
    return NextResponse.json(
      { error: linkError?.message ?? "Could not generate invite link" },
      { status: 502 },
    );
  }

  const setupUrl = linkData.properties.action_link;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  const resend = new Resend(resendKey);
  const { error: sendError } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: metaLeadInviteSubject(first, locale),
    html: metaLeadInviteHtml(first, setupUrl, locale, APP_URL, email),
  });

  if (sendError) {
    // eslint-disable-next-line no-console
    console.error("[resend-invite] Resend send failed:", sendError);
    return NextResponse.json({ error: String(sendError) }, { status: 502 });
  }

  // eslint-disable-next-line no-console
  console.log(`[resend-invite] branded invite sent → ${email} (locale=${locale})`);

  return NextResponse.json({ success: true, email, locale });
}
