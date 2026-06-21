/**
 * HTML body for the admin-granted gift access email.
 *
 * Sent when an admin manually sets a user's plan to "pro" or "plus"
 * via `setManualPlanAction`. Deliberately has NO billing framing,
 * no upgrade CTAs, no trial language — the user got this for free.
 *
 * @param name      User's name from their profile (optional).
 * @param plan      'pro' | 'plus' — controls plan name in copy.
 * @param expiresAt ISO date string for the access end date, or null for lifetime.
 * @param locale    'de' (default) or 'en'.
 * @param appUrl    Public app origin without trailing slash.
 * @param email     Recipient email — when provided, unsubscribe link added.
 */
import type { EmailLocale } from "@/lib/emails/beta-welcome";
import { escapeHtml } from "@/lib/emails/escape";
import { buildUnsubscribeUrl } from "@/lib/emails/unsubscribeToken";

export function giftAccessHtml(
  name?: string | null,
  plan: "pro" | "plus" = "pro",
  expiresAt?: string | null,
  locale: EmailLocale = "de",
  appUrl?: string | null,
  email?: string | null,
  signupUrl?: string | null,
): string {
  const first = escapeHtml(firstNameFrom(name));
  const baseUrl = (appUrl || "https://glev.app").replace(/\/$/, "");
  const dashUrl = `${baseUrl}/dashboard`;
  const unsubUrl = email ? buildUnsubscribeUrl(baseUrl, email) : null;
  const ctaUrl = signupUrl ?? dashUrl;
  const ctaTextDe = signupUrl ? "Passwort setzen & starten →" : "Zum Dashboard →";
  const ctaTextEn = signupUrl ? "Set password & start →" : "Go to dashboard →";

  if (locale === "en") return giftAccessHtmlEn(first, plan, expiresAt, ctaUrl, unsubUrl, ctaTextEn);
  return giftAccessHtmlDe(first, plan, expiresAt, ctaUrl, unsubUrl, ctaTextDe);
}

function planNameDe(plan: "pro" | "plus"): string {
  return plan === "plus" ? "Glev+" : "Glev Pro";
}

function planNameEn(plan: "pro" | "plus"): string {
  return plan === "plus" ? "Glev+" : "Glev Pro";
}

function durationLabelDe(expiresAt?: string | null): string {
  if (!expiresAt) return "auf unbestimmte Zeit";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "auf unbestimmte Zeit";
  const months = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];
  return `bis zum ${d.getUTCDate()}. ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function durationLabelEn(expiresAt?: string | null): string {
  if (!expiresAt) return "indefinitely";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "indefinitely";
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `until ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function giftAccessHtmlDe(
  first: string | null,
  plan: "pro" | "plus",
  expiresAt: string | null | undefined,
  ctaUrl: string,
  unsubUrl: string | null | undefined,
  ctaText: string,
): string {
  const greeting = first ? `Hallo ${first}` : "Hallo";
  const planName = planNameDe(plan);
  const duration = durationLabelDe(expiresAt);
  const unsubHtml = unsubUrl
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Von diesen E-Mails abmelden</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dein ${planName}-Zugang ist aktiv</title>
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
                Dein <strong>${planName}-Zugang</strong> ist jetzt aktiv —
                <strong>kostenlos ${duration}</strong>. Kein Aufwand deinerseits,
                keine Zahlungsdaten nötig.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Du kannst sofort loslegen: CGM verbinden, erste Mahlzeit loggen,
                und Glev rechnet deine Insulindosis. Wenn du Fragen hast oder
                etwas nicht klappt, antworte einfach auf diese Mail — sie geht
                direkt an mich.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${ctaUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      ${ctaText}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Viel Spaß,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> · Diese E-Mail wurde an dich geschickt, weil dein ${planName}-Zugang freigeschaltet wurde.
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

function giftAccessHtmlEn(
  first: string | null,
  plan: "pro" | "plus",
  expiresAt: string | null | undefined,
  ctaUrl: string,
  unsubUrl: string | null | undefined,
  ctaText: string,
): string {
  const greeting = first ? `Hi ${first}` : "Hi there";
  const planName = planNameEn(plan);
  const duration = durationLabelEn(expiresAt);
  const unsubHtml = unsubUrl
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your ${planName} access is active</title>
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
                Your <strong>${planName} access</strong> is now active —
                <strong>free ${duration}</strong>. No payment details needed,
                nothing required from you.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                You can start right away: connect your CGM, log your first meal,
                and Glev calculates your insulin dose. If you have any questions
                or something isn't working, just reply to this email — it goes
                straight to me.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background:#4F6EF7;border-radius:8px;">
                    <a href="${ctaUrl}"
                       style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
                      ${ctaText}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Have fun,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> · You're receiving this because your ${planName} access was activated.
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

/**
 * Subject line for the gift-access email.
 */
export function giftAccessSubject(
  name?: string | null,
  plan: "pro" | "plus" = "pro",
  expiresAt?: string | null,
  locale: EmailLocale = "de",
): string {
  const first = firstNameFrom(name);
  const planName = locale === "en" ? planNameEn(plan) : planNameDe(plan);

  if (locale === "en") {
    const dur = expiresAt ? durationLabelEn(expiresAt) : "for free";
    return first
      ? `${first}, your ${planName} access is active`
      : `Your ${planName} access is active`;
  }

  const dur = expiresAt ? durationLabelDe(expiresAt) : "kostenlos";
  return first
    ? `${first}, dein ${planName}-Zugang ist aktiv`
    : `Dein ${planName}-Zugang ist aktiv`;
}

function firstNameFrom(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const [first] = trimmed.split(/\s+/);
  return first || null;
}
