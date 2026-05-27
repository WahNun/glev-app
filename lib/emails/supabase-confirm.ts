/**
 * Email-Bestätigungs-Template für Supabase Auth.
 *
 * Diese Datei dient als Quell-Template für den HTML-Code, der in
 * Supabase Dashboard → Authentication → Email Templates → "Confirm signup"
 * eingefügt wird.
 *
 * Supabase ersetzt folgende Variablen automatisch:
 *   {{ .ConfirmationURL }} — der vollständige Bestätigungs-Link
 *   {{ .Email }}           — die E-Mail-Adresse des Users
 *   {{ .SiteURL }}         — die konfigurierte Site URL (https://glev.app)
 *
 * Deployment-Hinweis:
 *   1. Supabase Dashboard → Project Settings → Auth → SMTP Settings
 *      - Enable Custom SMTP: ✓
 *      - Host: smtp.resend.com  Port: 465
 *      - Username: resend
 *      - Password: <RESEND_API_KEY aus Vercel Env>
 *      - Sender name: Glev
 *      - Sender email: info@glev.app
 *
 *   2. Supabase Dashboard → Auth → Email Templates → "Confirm signup"
 *      - Subject: Glev – Bitte bestätige deine E-Mail
 *      - Body: <Inhalt von supabaseConfirmHtml() einfügen>
 */

/**
 * Gibt den HTML-Body des Bestätigungs-Emails zurück.
 * confirmationUrl entspricht dem Supabase-Platzhalter {{ .ConfirmationURL }}.
 */
export function supabaseConfirmHtml(
  confirmationUrl = "{{ .ConfirmationURL }}",
): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Glev – Bitte bestätige deine E-Mail</title>
</head>
<body style="margin:0;padding:0;background:#09090B;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090B;padding:40px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#18181B;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">

        <!-- Logo -->
        <tr>
          <td style="padding:28px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);text-align:center;">
            <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                 width="140" height="47"
                 style="display:inline-block;border:0;text-decoration:none;width:140px;height:47px;max-width:140px;" />
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 32px;">
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#fff;line-height:1.3;">
              Bestätige deine E-Mail-Adresse
            </h1>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#A1A1AA;">
              Fast geschafft! Klick auf den Button um dein Konto zu aktivieren und deinen 7-Tage-Zugang zu starten.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:#4F6EF7;border-radius:10px;">
                  <a href="${confirmationUrl}"
                     style="display:inline-block;padding:15px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                    E-Mail bestätigen →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#52525B;">
              Wenn der Button nicht funktioniert, kopiere diesen Link in deinen Browser:
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#3F3F46;word-break:break-all;">
              <a href="${confirmationUrl}" style="color:#4F6EF7;text-decoration:none;">${confirmationUrl}</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:18px 40px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0 0 4px;font-size:11px;line-height:1.6;color:#52525B;text-align:center;">
              Du hast dich nicht bei Glev registriert? Dann kannst du diese E-Mail ignorieren.
            </p>
            <p style="margin:0;font-size:11px;color:#3F3F46;text-align:center;">
              Glev · <a href="mailto:info@glev.app" style="color:#3F3F46;">info@glev.app</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const SUPABASE_CONFIRM_SUBJECT = "Glev – Bitte bestätige deine E-Mail";
