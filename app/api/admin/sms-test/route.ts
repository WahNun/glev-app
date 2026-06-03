import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const authed = await isAdminAuthed();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone, message, userId } = await req.json() as {
    phone?: string;
    message?: string;
    userId?: string;
  };

  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone.trim())) {
    return NextResponse.json({ error: "Ungültige Telefonnummer (Format: +4917612345678)" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Opt-out guard — resolve the user by userId (preferred) or by matching
  // phone number in user_metadata so that opted-out users are never sent to.
  let resolvedUserId: string | null = userId ?? null;

  if (!resolvedUserId) {
    // Try to find a user whose user_metadata.phone matches the given number
    const { data: authData } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const matchedUser = (authData?.users ?? []).find(
      (u) => (u.user_metadata?.phone as string | undefined) === phone.trim(),
    );
    if (matchedUser) resolvedUserId = matchedUser.id;
  }

  if (resolvedUserId) {
    const { data: profileRow } = await sb
      .from("profiles")
      .select("sms_opted_out")
      .eq("user_id", resolvedUserId)
      .single();
    if (profileRow?.sms_opted_out) {
      // eslint-disable-next-line no-console
      console.log("[sms] skipped: user opted out", resolvedUserId);
      return NextResponse.json({ ok: false, skipped: true, reason: "opted_out" });
    }
  }

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    return NextResponse.json({ error: "Twilio nicht konfiguriert (TWILIO_* Env-Vars fehlen)" }, { status: 503 });
  }

  const body = message?.trim()
    ? message.trim()
    : `[TEST] Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: https://glev.app/auth/confirm?token=TEST\n\nAlternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.`;

  const formData = new URLSearchParams({ From: from, To: phone.trim(), Body: body });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    },
  );

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    return NextResponse.json(
      { error: `Twilio Fehler ${res.status}: ${data.message ?? JSON.stringify(data)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    sid: data.sid,
    status: data.status,
    to: data.to,
    numSegments: data.num_segments,
  });
}
