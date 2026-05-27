/**
 * Email-Bestätigungs-Template für Supabase Auth.
 *
 * Diese Datei dient als Quell-Template für den HTML-Code, der in
 * Supabase Dashboard → Authentication → Emails → Templates → "Confirm signup"
 * eingefügt wird.
 *
 * Supabase ersetzt folgende Variablen automatisch:
 *   {{ .ConfirmationURL }} — der vollständige Bestätigungs-Link
 *
 * Deployment-Hinweis:
 *   Supabase Dashboard → Authentication → Emails → Templates → "Confirm signup"
 *   - Subject: Glev – Verify your email / E-Mail bestätigen
 *   - Body: Inhalt von supabaseConfirmHtml() einfügen
 *
 *   SMTP ist bereits konfiguriert (smtp.resend.com, hello@glev.app).
 */

/**
 * Zweisprachiges (EN/DE) Bestätigungs-Email.
 * confirmationUrl entspricht dem Supabase-Platzhalter {{ .ConfirmationURL }}.
 */
export function supabaseConfirmHtml(
  confirmationUrl = "{{ .ConfirmationURL }}",
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Glev – Verify your email</title>
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
                 style="display:inline-block;border:0;width:140px;height:47px;max-width:140px;" />
          </td>
        </tr>

        <!-- English -->
        <tr>
          <td style="padding:36px 40px 28px;">
            <h1 style="margin:0 0 10px;font-size:20px;font-weight:700;color:#fff;line-height:1.3;">
              Verify your email address
            </h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#A1A1AA;">
              Click the button below to confirm your email and activate your account.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#4F6EF7;border-radius:10px;">
                  <a href="${confirmationUrl}"
                     style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                    Verify email →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 40px;">
            <div style="border-top:1px solid rgba(255,255,255,0.06);"></div>
          </td>
        </tr>

        <!-- German -->
        <tr>
          <td style="padding:28px 40px 32px;">
            <h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:#fff;line-height:1.3;">
              E-Mail-Adresse bestätigen
            </h2>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#71717A;">
              Klick auf den Button oben, um deine E-Mail zu bestätigen und dein Konto zu aktivieren.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:18px 40px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0 0 4px;font-size:11px;line-height:1.6;color:#52525B;text-align:center;">
              Didn't sign up for Glev? You can safely ignore this email.
            </p>
            <p style="margin:0;font-size:11px;color:#3F3F46;text-align:center;">
              Glev · <a href="mailto:hello@glev.app" style="color:#3F3F46;">hello@glev.app</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const SUPABASE_CONFIRM_SUBJECT =
  "Glev – Verify your email / E-Mail bestätigen";
