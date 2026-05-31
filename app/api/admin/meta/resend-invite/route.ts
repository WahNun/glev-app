// POST /api/admin/meta/resend-invite
// Schickt einem bestehenden Meta-Lead eine gebrandete Einladungs-Email
// mit Supabase Recovery-Link (Passwort-Setup).
//
// Auth: Bearer ADMIN_API_SECRET
// Body: { email: string, name?: string, locale?: "de" | "en" }

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://glev.app").replace(/\/$/, "");
const FROM = "Glev <info@glev.app>";

function buildHtml(first: string | null, setupUrl: string, locale: "de" | "en"): string {
  const de = locale !== "en";
  const greeting = first ? (de ? `Hallo ${first}` : `Hi ${first}`) : (de ? "Hallo" : "Hi there");

  const headline = de
    ? "Dein Glev-Zugang wartet auf dich."
    : "Your Glev access is waiting for you.";

  const body = de
    ? `Du hast dich über unser Lead-Formular registriert — super! Klick auf den Button, um dein Passwort einzurichten und direkt loszulegen. Du bekommst <strong style="color:#fff;">7 Tage alle Pro-Features kostenlos</strong>.`
    : `You signed up via our lead form — awesome! Click the button below to set your password and get started. You get <strong style="color:#fff;">7 days of all Pro features for free</strong>.`;

  const cta = de ? "Zugang einrichten →" : "Set up your access →";
  const ctaHint = de
    ? "Der Link ist 24 Stunden gültig."
    : "This link is valid for 24 hours.";
  const signoff = de
    ? `Fragen? Einfach auf diese Mail antworten — ich bin direkt dran.<br /><strong style="color:#A1A1AA;">Lucas</strong> · Glev Team`
    : `Questions? Just reply to this email — I'm right there.<br /><strong style="color:#A1A1AA;">Lucas</strong> · Glev Team`;
  const disclaimer = de
    ? `<strong>Hinweis:</strong> Glev ist ein Dokumentations- und Auswertungstool und ersetzt keine ärztliche Beratung. Therapieentscheidungen triffst du gemeinsam mit deinem Behandlungsteam.`
    : `<strong>Note:</strong> Glev is a documentation and analysis tool and does not replace medical advice. Treatment decisions should be made together with your care team.`;

  return `<!DOCTYPE html>
<html lang="${de ? "de" : "en"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${headline}</title>
</head>
<body style="margin:0;padding:0;background:#09090B;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090B;padding:40px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#18181B;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
        <tr>
          <td style="padding:28px 40px 20px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:center;">
            <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                 width="140" height="47"
                 style="display:inline-block;border:0;text-decoration:none;width:140px;height:47px;max-width:140px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#fff;">${greeting} 👋</p>
            <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#fff;line-height:1.3;">
              ${headline}
            </h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#A1A1AA;">
              ${body}
            </p>

            <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
              <tr><td style="background:#4F6EF7;border-radius:8px;">
                <a href="${setupUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">${cta}</a>
              </td></tr>
            </table>

            <p style="margin:0 0 24px;font-size:12px;color:#52525B;">${ctaHint}</p>

            <p style="margin:0;font-size:14px;line-height:1.7;color:#71717A;">
              ${signoff}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 40px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#52525B;text-align:center;">
              ${disclaimer}
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#52525B;text-align:center;">
              Glev · <a href="mailto:info@glev.app" style="color:#52525B;">info@glev.app</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildSubject(first: string | null, locale: "de" | "en"): string {
  if (locale === "en") {
    return first ? `${first}, set up your Glev access` : "Set up your Glev access";
  }
  return first ? `${first}, richte deinen Glev-Zugang ein` : "Richte deinen Glev-Zugang ein";
}

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
    subject: buildSubject(first, locale),
    html: buildHtml(first, setupUrl, locale),
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
