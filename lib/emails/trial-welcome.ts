/**
 * Bilingual welcome email for free-trial signups (no Stripe).
 * Sent via the outbox immediately after /api/auth/free-trial sets
 * trial_end_at. Mirrors the visual style of pro-welcome.ts.
 */

import type { EmailLocale } from "@/lib/emails/beta-welcome";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://glev.app"
).replace(/\/$/, "");

export function trialWelcomeSubject(
  name: string | null,
  locale: EmailLocale,
): string {
  const first = name?.trim().split(/\s+/)[0] ?? null;
  if (locale === "en") {
    return first
      ? `${first}, your 7-day Glev trial is active`
      : "Your 7-day Glev trial is active";
  }
  return first
    ? `${first}, dein 7-Tage-Zugang bei Glev ist aktiv`
    : "Dein 7-Tage-Zugang bei Glev ist aktiv";
}

function trialWelcomeHtmlDe(
  first: string | null,
  trialEndDisplay: string,
): string {
  const greeting = first ? `Hallo ${first}` : "Hallo";
  const dashboardUrl = `${APP_URL}/dashboard`;
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dein 7-Tage-Zugang ist aktiv</title>
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
              Dein 7-Tage-Zugang ist aktiv.
            </h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#A1A1AA;">
              Du kannst alle Pro-Features ab sofort nutzen — ganz ohne Kreditkarte.
              Dein Testzeitraum endet am <strong style="color:#fff;">${trialEndDisplay}</strong>.
            </p>

            <div style="background:rgba(79,110,247,0.12);border:1px solid rgba(79,110,247,0.3);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Was dich erwartet</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                ${[
                  ["🍽️", "Mahlzeiten loggen per Spracheingabe oder Text"],
                  ["📊", "CGM-Integration (Libre, Nightscout & mehr)"],
                  ["⚡", "KI-Assistent für Insulin-Entscheidungen"],
                  ["💉", "Bolus & IOB Tracking"],
                  ["📈", "Insights: TIR, Muster, Variabilität"],
                ].map(([icon, text]) => `
                <tr>
                  <td style="padding:4px 0;vertical-align:top;width:26px;font-size:15px;">${icon}</td>
                  <td style="padding:4px 0;font-size:14px;color:rgba(255,255,255,0.75);">${text}</td>
                </tr>`).join("")}
              </table>
            </div>

            <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
              <tr><td style="background:#4F6EF7;border-radius:8px;">
                <a href="${dashboardUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">Glev öffnen →</a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:14px;line-height:1.7;color:#71717A;">
              Fragen? Einfach auf diese Mail antworten — ich bin direkt dran.<br />
              <strong style="color:#A1A1AA;">Lucas</strong> · Glev Team
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 40px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#52525B;text-align:center;">
              <strong>Hinweis:</strong> Glev ist ein Dokumentations- und Auswertungstool und ersetzt keine ärztliche Beratung.
              Therapieentscheidungen triffst du gemeinsam mit deinem Behandlungsteam.
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

function trialWelcomeHtmlEn(
  first: string | null,
  trialEndDisplay: string,
): string {
  const greeting = first ? `Hi ${first}` : "Hi there";
  const dashboardUrl = `${APP_URL}/dashboard`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your 7-day trial is active</title>
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
              Your 7-day trial is now active.
            </h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#A1A1AA;">
              All Pro features are yours to explore — no credit card needed.
              Your trial ends on <strong style="color:#fff;">${trialEndDisplay}</strong>.
            </p>

            <div style="background:rgba(79,110,247,0.12);border:1px solid rgba(79,110,247,0.3);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">What's included</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                ${[
                  ["🍽️", "Log meals by voice or text"],
                  ["📊", "CGM integration (Libre, Nightscout & more)"],
                  ["⚡", "AI assistant for insulin decisions"],
                  ["💉", "Bolus & IOB tracking"],
                  ["📈", "Insights: TIR, patterns, variability"],
                ].map(([icon, text]) => `
                <tr>
                  <td style="padding:4px 0;vertical-align:top;width:26px;font-size:15px;">${icon}</td>
                  <td style="padding:4px 0;font-size:14px;color:rgba(255,255,255,0.75);">${text}</td>
                </tr>`).join("")}
              </table>
            </div>

            <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
              <tr><td style="background:#4F6EF7;border-radius:8px;">
                <a href="${dashboardUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">Open Glev →</a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:14px;line-height:1.7;color:#71717A;">
              Questions? Just reply to this email — I'm right here.<br />
              <strong style="color:#A1A1AA;">Lucas</strong> · Glev Team
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 40px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#52525B;text-align:center;">
              <strong>Note:</strong> Glev is a documentation and analytics tool and does not replace medical advice.
              Therapy decisions stay with you and your care team.
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

function formatDateDe(iso: string): string {
  const d = new Date(iso);
  const months = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  return `${d.getUTCDate()}. ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatDateEn(iso: string): string {
  const d = new Date(iso);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function trialWelcomeHtml(
  name: string | null,
  trialEndsAt: string | null,
  _appUrl: string | null,
  locale: EmailLocale,
): string {
  const first = name?.trim().split(/\s+/)[0] ?? null;
  const trialEndDisplay = trialEndsAt
    ? locale === "en" ? formatDateEn(trialEndsAt) : formatDateDe(trialEndsAt)
    : locale === "en" ? "in 7 days" : "in 7 Tagen";
  if (locale === "en") return trialWelcomeHtmlEn(first, trialEndDisplay);
  return trialWelcomeHtmlDe(first, trialEndDisplay);
}
