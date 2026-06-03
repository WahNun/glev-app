/**
 * POST /api/admin/sms-relink
 *
 * Sends a fresh SMS opt-out link (signed with the current SMS_UNSUB_SECRET)
 * to the given user and logs the event to sms_optout_events with
 * event_type = 'relink'.
 *
 * Use case: after a secret rotation the user's old SMS history contains a
 * stale opt-out URL. This lets ops re-send a valid link without a code change.
 *
 * Auth: glev_ops_token session cookie OR Bearer ADMIN_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { generateUnsubscribeToken } from "@/lib/sms/unsubscribeToken";
import crypto from "crypto";

export const runtime = "nodejs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://glev.app").replace(/\/$/, "");

function isAdminAuthedFromRequest(req: NextRequest): boolean {
  const secret = process.env.ADMIN_API_SECRET ?? "";
  if (!secret || secret.length < 16) return false;

  const tok = req.cookies.get("glev_ops_token")?.value ?? "";
  if (tok) {
    const expected = crypto
      .createHmac("sha256", secret)
      .update("glev-ops-session-v2")
      .digest("hex");
    const aBuf = Buffer.from(tok);
    const bBuf = Buffer.from(expected);
    if (aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf)) {
      return true;
    }
  }

  const bearer = req.headers.get("authorization") ?? "";
  if (bearer.startsWith("Bearer ")) {
    const provided = bearer.slice(7);
    const aBuf = Buffer.from(provided);
    const bBuf = Buffer.from(secret);
    if (aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf)) {
      return true;
    }
  }

  return false;
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthedFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as { userId?: string };
  const { userId } = body;

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId erforderlich" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  const { data: authData, error: authErr } = await sb.auth.admin.getUserById(userId);
  if (authErr || !authData?.user) {
    return NextResponse.json(
      { error: `User nicht gefunden: ${authErr?.message ?? "unbekannt"}` },
      { status: 404 },
    );
  }

  const phone =
    (authData.user.phone ?? "") ||
    ((authData.user.user_metadata?.phone as string | undefined) ?? "");

  if (!phone) {
    return NextResponse.json(
      { error: "Dieser User hat keine Telefonnummer in user_metadata.phone." },
      { status: 400 },
    );
  }

  const { data: profileRow } = await sb
    .from("profiles")
    .select("sms_opted_out")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileRow?.sms_opted_out) {
    return NextResponse.json(
      { error: "User hat SMS bereits abbestellt — kein Re-Link sinnvoll." },
      { status: 409 },
    );
  }

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    return NextResponse.json(
      { error: "Twilio nicht konfiguriert (TWILIO_* Env-Vars fehlen)." },
      { status: 503 },
    );
  }

  let unsub: string;
  try {
    const unsub_token = generateUnsubscribeToken(userId);
    unsub = `${APP_URL}/sms-stop?t=${unsub_token}&u=${encodeURIComponent(userId)}`;
  } catch (e) {
    return NextResponse.json(
      { error: `Token-Generierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` },
      { status: 503 },
    );
  }

  const smsBody =
    `Dein Abmelde-Link für Glev-SMS (frisch signiert): ${unsub}\n` +
    `Antworte mit STOP um keine weiteren SMS zu erhalten.`;

  const formData = new URLSearchParams({
    From: from,
    To:   phone,
    Body: smsBody,
  });

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    },
  );

  const twilioData = await twilioRes.json() as Record<string, unknown>;

  if (!twilioRes.ok) {
    return NextResponse.json(
      {
        error: `Twilio Fehler ${twilioRes.status}: ${twilioData.message ?? JSON.stringify(twilioData)}`,
      },
      { status: 502 },
    );
  }

  const unsub_token_used = generateUnsubscribeToken(userId);
  await sb.from("sms_optout_events").insert({
    user_id:    userId,
    event_type: "relink",
    token_used: unsub_token_used,
    ip:         null,
    user_agent: "admin/sms-relink",
  });

  return NextResponse.json({
    ok:          true,
    to:          twilioData.to ?? phone,
    sid:         twilioData.sid,
    numSegments: twilioData.num_segments,
  });
}
