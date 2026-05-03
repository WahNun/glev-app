/**
 * HTML body for the post-Stripe-checkout welcome email for /pro
 * subscriptions.
 *
 * Pro now grants free immediate access until 1. Juli 2026 — that day the
 * regular €24.90/$24.90 monthly subscription kicks in via the card on
 * file. The copy reflects that "use it now for free, billing starts on X"
 * framing, in either German or English depending on `locale`.
 */
import type { EmailLocale } from '@/lib/emails/beta-welcome';

export function proWelcomeHtml(
  name?: string | null,
  sessionId?: string | null,
  appUrl?: string | null,
  trialEndsAt?: string | null,
  locale: EmailLocale = 'de',
): string {
  const first = firstNameFrom(name);
  const baseUrl = (appUrl || 'https://glev.app').replace(/\/$/, '');
  const resumeUrl = sessionId
    ? `${baseUrl}/pro/success?session_id=${encodeURIComponent(sessionId)}`
    : `${baseUrl}/pro/success`;

  if (locale === 'en') return proWelcomeHtmlEn(first, resumeUrl, trialEndsAt);
  return proWelcomeHtmlDe(first, resumeUrl, trialEndsAt);
}

function proWelcomeHtmlDe(
  first: string | null,
  resumeUrl: string,
  trialEndsAt?: string | null,
): string {
  const greeting = first ? `Hallo ${first}` : 'Hallo';
  const postGreetingOpener = first
    ? `schön, dass du dabei bist, ${first}.`
    : 'schön dass du dabei bist.';
  const ctaCaption = first
    ? `${first}, der Link funktioniert auch, wenn du den ursprünglichen Tab geschlossen hast.`
    : 'Der Link funktioniert auch, wenn du den ursprünglichen Tab geschlossen hast.';
  const trialEndDisplay = formatGermanDate(trialEndsAt) ?? '1. Juli 2026';

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deine Glev-Mitgliedschaft</title>
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
                ${postGreetingOpener} Deine Glev-Pro-Mitgliedschaft ist
                <strong>angelegt</strong> — und du kannst Glev ab sofort
                <strong>komplett kostenlos</strong> nutzen.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Ab dem <strong>${trialEndDisplay}</strong> startet dann deine
                reguläre Mitgliedschaft für <strong>24,90&nbsp;€/Monat</strong>,
                automatisch über die hinterlegte Karte. Bis dahin: keine
                Abbuchung, keine Reminder.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${resumeUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      Registrierung abschließen →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 32px;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
                ${ctaCaption}
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Sobald dein Account steht, geht's direkt los: CGM verbinden,
                erste Mahlzeit loggen, und Glev rechnet deine Insulindosis.
                Wenn etwas hakt oder du ein Feature vermisst, antworte
                einfach direkt auf diese Mail — sie geht an mich persönlich.
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Falls du vor dem ${trialEndDisplay} doch kündigen möchtest,
                einfach kurz hier antworten oder im Stripe-Customer-Portal —
                kein Stress, keine Fragen.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Viel Spaß beim Ausprobieren,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> · Diese E-Mail wurde an dich geschickt, weil du eine Glev-Pro-Mitgliedschaft abgeschlossen hast.
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

function proWelcomeHtmlEn(
  first: string | null,
  resumeUrl: string,
  trialEndsAt?: string | null,
): string {
  const greeting = first ? `Hi ${first}` : 'Hi there';
  const postGreetingOpener = first
    ? `glad you're here, ${first}.`
    : "glad you're here.";
  const ctaCaption = first
    ? `${first}, this link still works even if you closed the original tab.`
    : 'This link still works even if you closed the original tab.';
  const trialEndDisplay = formatEnglishDate(trialEndsAt) ?? 'July 1, 2026';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Glev membership</title>
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
                ${postGreetingOpener} Your Glev Pro membership is
                <strong>set up</strong> — and you can use Glev
                <strong>completely free</strong> starting right now.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                On <strong>${trialEndDisplay}</strong> your regular membership
                kicks in at <strong>$24.90/month</strong>, billed automatically
                to the card on file. Until then: no charges, no reminders.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${resumeUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      Complete registration →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 32px;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
                ${ctaCaption}
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Once your account is set up, you're good to go: connect your
                CGM, log your first meal, and Glev calculates your insulin
                dose. If anything feels off or you're missing a feature, just
                reply to this email — it goes to me personally.
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                If you'd like to cancel before ${trialEndDisplay}, just reply
                here or use the Stripe Customer Portal — no questions asked.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Have fun exploring,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> · You're receiving this email because you started a Glev Pro membership.
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

/**
 * Subject line for the Pro welcome email. When the buyer's first name is
 * known we lead with it so the inbox preview already feels personal;
 * otherwise we fall back to a generic subject.
 */
export function proWelcomeSubject(
  name?: string | null,
  locale: EmailLocale = 'de',
): string {
  const first = firstNameFrom(name);
  if (locale === 'en') {
    return first
      ? `${first}, your Glev membership is set up`
      : 'Your Glev membership is set up';
  }
  return first
    ? `${first}, deine Glev-Mitgliedschaft ist angelegt`
    : 'Deine Glev-Mitgliedschaft ist angelegt';
}

function firstNameFrom(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const [first] = trimmed.split(/\s+/);
  return first || null;
}

/**
 * Format an ISO timestamp as a German "1. Juli 2026"-style date. Returns
 * null on falsy / unparseable input so callers can fall back to a literal.
 */
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

/**
 * Format an ISO timestamp as an English "July 1, 2026"-style date.
 */
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
