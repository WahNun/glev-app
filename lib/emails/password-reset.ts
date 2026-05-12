/**
 * Bilingual password-reset email (admin-triggered Recovery flow).
 *
 * Sent from the admin user-detail page when Lucas clicks
 * "Passwort-Reset-Mail senden". The CTA link is the action_link from
 * Supabase's `auth.admin.generateLink({type: 'recovery'})` — clicking
 * it lands the user on /auth/confirm where they can choose a new
 * password. The current password remains valid until the user actually
 * sets a new one (Supabase default behaviour).
 *
 * Mirrors the structure of beta-welcome.ts so the visual identity
 * (header, button colour, footer) stays consistent with the rest of
 * Glev's transactional mail.
 *
 * @param name      Optional display name for the personalised greeting.
 * @param resetUrl  The Supabase action_link. MUST be the live link, not
 *                  a placeholder. Without it the email body has no CTA.
 * @param appUrl    Public app origin without trailing slash. Falls back
 *                  to https://glev.app if missing.
 * @param locale    'de' (default) or 'en' — chooses the language. Driven
 *                  by `profiles.language`.
 */
import type { EmailLocale } from './beta-welcome';

export function passwordResetHtml(
  name?: string | null,
  resetUrl?: string | null,
  appUrl?: string | null,
  locale: EmailLocale = 'de',
): string {
  const first = firstNameFrom(name);
  const baseUrl = (appUrl || 'https://glev.app').replace(/\/$/, '');
  const link = resetUrl || `${baseUrl}/login`;

  if (locale === 'en') return passwordResetHtmlEn(first, link, baseUrl);
  return passwordResetHtmlDe(first, link, baseUrl);
}

function passwordResetHtmlDe(
  first: string | null,
  resetUrl: string,
  baseUrl: string,
): string {
  const greeting = first ? `Hallo ${first}` : 'Hallo';
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Passwort zur&uuml;cksetzen &middot; Glev</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:#09090b;padding:28px 40px;text-align:center;">
              <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                   width="140" height="47"
                   style="display:inline-block;border:0;outline:none;text-decoration:none;width:140px;height:47px;max-width:140px;" />
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
                ${greeting} 👋
              </p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                wir haben dir auf Wunsch (oder durch das Glev-Support-Team) einen Link
                geschickt, mit dem du ein neues Passwort f&uuml;r deinen Glev-Account
                setzen kannst.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                <strong>Klick auf den Button unten</strong>, um direkt ein neues Passwort
                zu w&auml;hlen. Dein bisheriges Passwort bleibt g&uuml;ltig, bis du das
                neue setzt.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${resetUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      Neues Passwort setzen →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 32px;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
                Der Link ist aus Sicherheitsgr&uuml;nden zeitlich begrenzt g&uuml;ltig.
                Falls er abgelaufen ist, melde dich kurz, dann schicke ich dir einen neuen.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#6b7280;">
                Du hast diese Mail nicht angefordert? Dann ignoriere sie einfach &mdash;
                ohne Klick auf den Button passiert nichts und dein bisheriges Passwort
                bleibt unver&auml;ndert.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Viele Gr&uuml;&szlig;e,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;border-top:1px solid #f1f5f9;padding-top:18px;">
                Probleme mit dem Login?
                <a href="mailto:hello@glev.app" style="color:#4F6EF7;text-decoration:none;font-weight:600;">Schreib mir →</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev &middot; <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> &middot;
                <a href="${baseUrl}/login" style="color:#9ca3af;">Login</a>
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

function passwordResetHtmlEn(
  first: string | null,
  resetUrl: string,
  baseUrl: string,
): string {
  const greeting = first ? `Hi ${first}` : 'Hi there';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password &middot; Glev</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:#09090b;padding:28px 40px;text-align:center;">
              <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                   width="140" height="47"
                   style="display:inline-block;border:0;outline:none;text-decoration:none;width:140px;height:47px;max-width:140px;" />
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
                ${greeting} 👋
              </p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                we&rsquo;re sending you a secure link so you can set a new password
                for your Glev account &mdash; either because you asked, or because
                Glev support set this up for you.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                <strong>Click the button below</strong> to choose a new password.
                Your current password stays valid until you actually set the new one.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${resetUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      Set a new password →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 32px;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
                For security, the link expires after a short time. If it&rsquo;s
                already expired, just reply and I&rsquo;ll send you a fresh one.
              </p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#6b7280;">
                Didn&rsquo;t request this? You can safely ignore the email &mdash;
                without clicking the button nothing changes and your current
                password stays in place.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                All the best,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;border-top:1px solid #f1f5f9;padding-top:18px;">
                Trouble signing in?
                <a href="mailto:hello@glev.app" style="color:#4F6EF7;text-decoration:none;font-weight:600;">Email me →</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev &middot; <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> &middot;
                <a href="${baseUrl}/login" style="color:#9ca3af;">Sign in</a>
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

export function passwordResetSubject(
  name?: string | null,
  locale: EmailLocale = 'de',
): string {
  const first = firstNameFrom(name);
  if (locale === 'en') {
    return first
      ? `${first}, reset your Glev password`
      : 'Reset your Glev password';
  }
  return first
    ? `${first}, setze dein Glev-Passwort zur\u00fcck`
    : 'Setze dein Glev-Passwort zur\u00fcck';
}

function firstNameFrom(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const [first] = trimmed.split(/\s+/);
  return first || null;
}
