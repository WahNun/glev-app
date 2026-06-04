/**
 * HTML body for the free-trial-started confirmation email.
 *
 * ⚠️  UNGENUTZTER STUB — diese Datei wird aktuell nicht über den Outbox-
 * Flow verschickt. Die tatsächliche Trial-Welcome-Email läuft über
 * `lib/emails/trial-welcome.ts` (Outbox-Template "trial-welcome").
 * Dieser Stub kann aktiviert werden, falls ein zweiter Send-Kanal
 * (z. B. ein separater Transaktions-Trigger) benötigt wird.
 *
 * Key framing rules (Compliance — see replit.md):
 *   - No dose recommendations, no clinical instructions
 *   - "7 Tage ausprobieren" framing, not "7 Tage Mitgliedschaft"
 *   - Trial end date shown so the user knows exactly when it expires
 *   - Clear "kein Lock-in, kein Abo ohne Zustimmung" message
 *
 * @param name        User's name/email as collected at signup (optional)
 * @param trialEndsAt ISO timestamp of trial_end_at (NOW() + 7 days)
 * @param appUrl      Public app origin without trailing slash
 * @param locale      'de' (default) or 'en'
 * @param email       Recipient email address. When provided, an unsubscribe
 *                    link is added to the footer. Optional — omitting it
 *                    leaves the footer without the link.
 */
import type { EmailLocale } from '@/lib/emails/beta-welcome';
import { buildUnsubscribeUrl } from '@/lib/emails/unsubscribeToken';

export function trialStartedHtml(
  name?: string | null,
  trialEndsAt?: string | null,
  appUrl?: string | null,
  locale: EmailLocale = 'de',
  email?: string | null,
): string {
  const first = firstNameFrom(name);
  const baseUrl = (appUrl || 'https://glev.app').replace(/\/$/, '');
  const dashboardUrl = `${baseUrl}/dashboard`;
  const unsubUrl = email ? buildUnsubscribeUrl(baseUrl, email) : null;

  if (locale === 'en') return trialStartedHtmlEn(first, dashboardUrl, trialEndsAt, unsubUrl);
  return trialStartedHtmlDe(first, dashboardUrl, trialEndsAt, unsubUrl);
}

export function trialStartedSubject(
  name?: string | null,
  locale: EmailLocale = 'de',
): string {
  const first = firstNameFrom(name);
  if (locale === 'en') {
    return first
      ? `${first}, your 7-day Glev trial has started`
      : 'Your 7-day Glev trial has started';
  }
  return first
    ? `${first}, dein 7-Tage-Trial hat begonnen`
    : 'Dein 7-Tage-Trial hat begonnen';
}

function trialStartedHtmlDe(
  first: string | null,
  dashboardUrl: string,
  trialEndsAt?: string | null,
  unsubUrl?: string | null,
): string {
  const greeting = first ? `Hallo ${first}` : 'Hallo';
  const trialEndDisplay = formatGermanDate(trialEndsAt) ?? 'in 7 Tagen';
  const closingLine = first
    ? `Viel Spaß beim Ausprobieren, ${first} — und meld dich gerne wenn du Fragen hast.`
    : 'Viel Spaß beim Ausprobieren — meld dich gerne wenn du Fragen hast.';
  const unsubHtml = unsubUrl
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Von diesen E-Mails abmelden</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dein Glev-Trial läuft</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#09090b;padding:28px 40px;text-align:center;">
              <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                   width="140" height="47"
                   style="display:inline-block;border:0;outline:none;text-decoration:none;width:140px;height:47px;max-width:140px;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 8px;">
              <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
                ${greeting} 👋
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                dein <strong>7-Tage-Gratis-Trial</strong> ist aktiv.
                Du kannst Glev jetzt vollständig ausprobieren — keine Kreditkarte,
                kein Abo ohne deine Zustimmung.
              </p>

              <!-- Trial end date badge -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;">
                <tr>
                  <td style="background:#f0f4ff;border-radius:8px;border-left:4px solid #4F6EF7;padding:14px 18px;">
                    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
                      Trial läuft bis
                    </p>
                    <p style="margin:4px 0 0;font-size:17px;font-weight:700;color:#0f172a;">
                      ${trialEndDisplay}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Kleines Dankeschön: Wer bis zum <strong>01. Juli 2026</strong> eine Zahlungsmethode hinterlegt, behält den Zugang danach noch eine Weile kostenlos — ganz ohne Bindung.
                Kein Druck, einfach nur eine kleine Bonuszeit für die Early Adopters.
              </p>

              <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#0f172a;">Was du in diesen 7 Tagen ausprobieren kannst:</p>
              <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.8;color:#374151;">
                <li>Mahlzeiten loggen und Makros automatisch erkennen lassen</li>
                <li>CGM verbinden und Glukoseverlauf live sehen</li>
                <li>Glev Engine: datenbasierte Insulindosis-Hinweise auf Basis deiner eigenen Historie</li>
                <li>Insights: TIR, HbA1c-Schätzung, Muster über 14 Tage</li>
              </ul>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${dashboardUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      Glev öffnen →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 32px;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
                Kein Lock-in · kein Abo ohne deine Bestätigung · Trial endet automatisch am ${trialEndDisplay}
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                ${closingLine}<br /><br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev · T1D selbst in der Hand</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> ·
                Diese E-Mail wurde an dich geschickt, weil du dich für einen kostenlosen Glev-Trial registriert hast.
              </p>
              ${unsubHtml}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function trialStartedHtmlEn(
  first: string | null,
  dashboardUrl: string,
  trialEndsAt?: string | null,
  unsubUrl?: string | null,
): string {
  const greeting = first ? `Hi ${first}` : 'Hi there';
  const trialEndDisplay = formatEnglishDate(trialEndsAt) ?? 'in 7 days';
  const closingLine = first
    ? `Enjoy exploring, ${first} — reply anytime if you have questions.`
    : 'Enjoy exploring — reply anytime if you have questions.';
  const unsubHtml = unsubUrl
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Glev trial is live</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#09090b;padding:28px 40px;text-align:center;">
              <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                   width="140" height="47"
                   style="display:inline-block;border:0;outline:none;text-decoration:none;width:140px;height:47px;max-width:140px;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 8px;">
              <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
                ${greeting} 👋
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Your <strong>7-day free trial</strong> is now active.
                Try everything Glev has to offer — no credit card, no subscription without your confirmation.
              </p>

              <!-- Trial end date badge -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;">
                <tr>
                  <td style="background:#f0f4ff;border-radius:8px;border-left:4px solid #4F6EF7;padding:14px 18px;">
                    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
                      Trial ends on
                    </p>
                    <p style="margin:4px 0 0;font-size:17px;font-weight:700;color:#0f172a;">
                      ${trialEndDisplay}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Small thank-you: anyone who adds a payment method by <strong>July 1, 2026</strong> keeps access free for a while longer — no commitment.
                Just a little bonus window for early adopters.
              </p>

              <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#0f172a;">What you can try in these 7 days:</p>
              <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.8;color:#374151;">
                <li>Log meals and let Glev parse macros automatically</li>
                <li>Connect your CGM and see your glucose curve live</li>
                <li>Glev Engine: data-driven insulin dose hints based on your own history</li>
                <li>Insights: TIR, HbA1c estimate, patterns over 14 days</li>
              </ul>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${dashboardUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      Open Glev →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 32px;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
                No lock-in · no subscription without your confirmation · trial ends automatically on ${trialEndDisplay}
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                ${closingLine}<br /><br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev · T1D in your own hands</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> ·
                You received this because you signed up for a free Glev trial.
              </p>
              ${unsubHtml}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function firstNameFrom(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const [first] = trimmed.split(/\s+/);
  return first || null;
}

function formatGermanDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ];
  return `${d.getUTCDate()}. ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatEnglishDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
