/**
 * GET /sms-stop — SMS Opt-Out Landing Page (UWG/TKG compliance)
 *
 * Public route, no auth required.
 * Reads ?t (HMAC token) and ?u (user_id) from the URL.
 * Validates the token → HTTP 400 on invalid, HTTP 200 on success.
 * Updates profiles.sms_opted_out and inserts an audit row into sms_optout_events.
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/sms/unsubscribeToken";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const token  = searchParams.get("t");
  const userId = searchParams.get("u");

  if (!token || !userId) {
    return htmlResponse(errorHtml("Link ungültig — bitte lucas@glev.app schreiben."), 400);
  }

  const valid = verifyUnsubscribeToken(token, userId);
  if (!valid) {
    return htmlResponse(
      errorHtml("Link ungültig oder abgelaufen — bitte lucas@glev.app schreiben."),
      400,
    );
  }

  const sb  = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error: upsertErr } = await sb
    .from("profiles")
    .update({ sms_opted_out: true, sms_opted_out_at: now })
    .eq("user_id", userId);

  if (upsertErr) {
    return htmlResponse(
      errorHtml("Ein Fehler ist aufgetreten — bitte lucas@glev.app schreiben."),
      500,
    );
  }

  const reqHeaders = await headers();
  const ip =
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    reqHeaders.get("x-real-ip") ??
    null;
  const userAgent = reqHeaders.get("user-agent") ?? null;

  const { error: eventErr } = await sb.from("sms_optout_events").insert({
    user_id:     userId,
    opted_out_at: now,
    ip,
    user_agent:  userAgent,
    token_used:  token,
  });

  if (eventErr) {
    return htmlResponse(
      errorHtml("Protokollierungsfehler — bitte lucas@glev.app schreiben."),
      500,
    );
  }

  return htmlResponse(successHtml(), 200);
}

function htmlResponse(html: string, status: number) {
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const COMMON_STYLE = `
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f0f0f;
  color: #f5f5f5;
  text-align: center;
`;

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMS abbestellt · Glev</title></head>
<body><main style="${COMMON_STYLE}">
  <div style="font-size:3rem;margin-bottom:1rem">✅</div>
  <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:0.75rem">Du bist abgemeldet.</h1>
  <p style="color:#a0a0a0;max-width:360px;line-height:1.6">
    Du erhältst keine weiteren Marketing-SMS von Glev.
  </p>
  <p style="color:#a0a0a0;max-width:360px;line-height:1.6;margin-top:0.5rem">
    Falls dies versehentlich passiert ist, schreib uns:
    <a href="mailto:lucas@glev.app" style="color:#4f8ef0">lucas@glev.app</a>
  </p>
</main></body></html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ungültiger Link · Glev</title></head>
<body><main style="${COMMON_STYLE}">
  <div style="font-size:3rem;margin-bottom:1rem">⚠️</div>
  <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:0.75rem">Ungültiger Link</h1>
  <p style="color:#a0a0a0;max-width:360px;line-height:1.6">${message}</p>
</main></body></html>`;
}
