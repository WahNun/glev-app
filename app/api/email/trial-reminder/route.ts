/**
 * POST /api/email/trial-reminder
 *
 * Renders and (optionally) sends the free-trial welcome email.
 *
 * Payload: { email: string, name: string, trial_end_at: string }
 *
 * Resend block is commented out — activate by:
 *   1. Set RESEND_API_KEY in Vercel Project Settings → Environment Variables
 *   2. Uncomment the 10 lines marked "RESEND:"
 *   3. Redeploy (env vars are frozen at build time)
 *
 * The endpoint is called fire-and-forget from /api/auth/free-trial,
 * so failures here do NOT break the signup flow.
 */
import { NextRequest, NextResponse } from "next/server";

function trialStartedHtml(name: string, trialEndAt: string): string {
  const endDate = new Date(trialEndAt).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dein kostenloser Glev-Zugang</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0F;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#12121A;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.03em;">Glev</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="font-size:24px;font-weight:700;margin:0 0 16px;color:#fff;line-height:1.3;">
                Hey ${name}, willkommen bei Glev 👋
              </h1>
              <p style="font-size:16px;line-height:1.6;color:rgba(255,255,255,0.7);margin:0 0 24px;">
                Dein kostenloser Zugang ist aktiv. Du kannst alle Features
                7 Tage lang uneingeschränkt nutzen — ganz ohne Kreditkarte.
              </p>

              <!-- Trial badge -->
              <div style="background:rgba(79,110,247,0.12);border:1px solid rgba(79,110,247,0.3);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Dein Testzeitraum endet am</p>
                <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#4F6EF7;">${endDate}</p>
              </div>

              <!-- Feature list -->
              <p style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.5);margin:0 0 12px;text-transform:uppercase;letter-spacing:0.06em;">Was dich erwartet</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${[
                  ["🍽️", "Mahlzeiten loggen per Spracheingabe"],
                  ["📊", "CGM-Integration (Libre, Nightscout)"],
                  ["⚡", "KI-Assistent für dein Diabetes-Management"],
                  ["💉", "Bolus & IOB Tracking"],
                  ["📄", "Arztbericht als PDF"],
                ].map(([icon, text]) => `
                <tr>
                  <td style="padding:6px 0;vertical-align:top;width:28px;font-size:16px;">${icon}</td>
                  <td style="padding:6px 0;font-size:15px;color:rgba(255,255,255,0.8);">${text}</td>
                </tr>`).join("")}
              </table>

              <!-- CTA -->
              <div style="margin-top:32px;">
                <a
                  href="https://glev.app"
                  style="display:inline-block;background:#4F6EF7;color:#fff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:10px;"
                >
                  Glev öffnen →
                </a>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;line-height:1.5;">
                Glev · <a href="https://glev.app/datenschutz" style="color:rgba(255,255,255,0.3);">Datenschutz</a> · <a href="https://glev.app/impressum" style="color:rgba(255,255,255,0.3);">Impressum</a><br/>
                Kein spezifischer Dosierungshinweis. Alle Angaben sind Orientierungspunkte.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      trial_end_at?: string;
    };

    const { email, name = "there", trial_end_at } = body;

    if (!email || !trial_end_at) {
      return NextResponse.json({ error: "email and trial_end_at required" }, { status: 400 });
    }

    const html = trialStartedHtml(name, trial_end_at);

    // Smoke-test: log the render so we can verify it's working before Resend is live
    console.log("[trial-reminder] email rendered for", email, "trial ends:", trial_end_at);

    // RESEND: Uncomment the block below after RESEND_API_KEY is set in Vercel
    /*
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Glev <hallo@glev.app>",
      to: email,
      subject: "Dein 7-Tage-Zugang ist aktiv 🎉",
      html,
    });
    */

    return NextResponse.json({ ok: true, rendered: html.length });
  } catch (err) {
    console.error("[trial-reminder] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET for admin preview: /api/email/trial-reminder?email=test@test.com&name=Lucas&trial_end_at=2026-06-01
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name") ?? "Lucas";
  const trial_end_at = searchParams.get("trial_end_at") ?? new Date(Date.now() + 7 * 86400000).toISOString();
  const html = trialStartedHtml(name, trial_end_at);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
