// Email click-tracking redirect.
//
// Alle CTA-Links in Drip-Mails gehen durch diesen Endpoint:
//   GET /api/email/click?t={schedule_id}&u={base64url(target_url)}
//
// Was passiert:
//   1. clicked_at in email_drip_schedule setzen (nur beim ersten Klick)
//   2. User zum Ziel weiterleiten (302)
//
// Sicherheit:
//   - target_url wird gegen eine Allowlist geprüft — nur glev.app und
//     bekannte Partner (Trustpilot) werden akzeptiert, alles andere
//     landet auf glev.app (Fallback).
//   - scheduleId wird UUID-validiert, fehlerhafte IDs werden ignoriert.
//
// Kein Auth — der Link kommt aus einer E-Mail, User ist nicht eingeloggt.

import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_URL = "https://glev.app";

const ALLOWED_HOSTS = new Set([
  "glev.app",
  "www.glev.app",
  "trustpilot.com",
  "www.trustpilot.com",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeTarget(encoded: string): string {
  try {
    const url = Buffer.from(encoded, "base64url").toString("utf-8");
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.has(hostname) ? url : FALLBACK_URL;
  } catch {
    return FALLBACK_URL;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const scheduleId = searchParams.get("t") ?? "";
  const encodedUrl = searchParams.get("u") ?? "";

  const targetUrl = encodedUrl ? decodeTarget(encodedUrl) : FALLBACK_URL;

  if (UUID_RE.test(scheduleId)) {
    try {
      const admin = getSupabaseAdmin();
      await admin
        .from("email_drip_schedule")
        .update({ clicked_at: new Date().toISOString() })
        .eq("id", scheduleId)
        .is("clicked_at", null);
    } catch {
      // Niemals die Weiterleitung blockieren — Click-Tracking ist nice-to-have.
    }
  }

  return NextResponse.redirect(targetUrl, { status: 302 });
}
