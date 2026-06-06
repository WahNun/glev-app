/**
 * Kündigungsbestätigungs-E-Mail für Glev-Pro- und Glev+-Abonnements.
 *
 * Wird ausgelöst durch `customer.subscription.deleted` im jeweiligen
 * Stripe-Webhook. Tone: warm, klar, kein Drama — Lucas persönlich.
 *
 * @param name         Vollständiger Name des/der Käufer:in (optional).
 * @param plan         'pro' | 'plus' — steuert Produktname und Preisangabe.
 * @param locale       'de' | 'en' — aus Währung abgeleitet (EUR→de, USD→en).
 * @param accessEndsAt ISO-Datum, bis wann der Zugang noch besteht (optional).
 * @param appUrl       Basis-URL (default https://glev.app).
 * @param email        Empfänger-E-Mail für den Abmelde-Link (optional).
 */

import type { EmailLocale } from "@/lib/emails/beta-welcome";
import { buildUnsubscribeUrl } from "@/lib/emails/unsubscribeToken";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://glev.app"
).replace(/\/$/, "");

export function subscriptionCancelledHtml(
  name?: string | null,
  plan: "pro" | "plus" = "pro",
  locale: EmailLocale = "de",
  accessEndsAt?: string | null,
  appUrl?: string | null,
  email?: string | null,
): string {
  const first = firstNameFrom(name);
  const baseUrl = (appUrl || APP_URL).replace(/\/$/, "");
  const unsubUrl = email ? buildUnsubscribeUrl(baseUrl, email) : null;

  if (locale === "en") {
    return cancelledHtmlEn(first, plan, accessEndsAt, baseUrl, unsubUrl);
  }
  return cancelledHtmlDe(first, plan, accessEndsAt, baseUrl, unsubUrl);
}

export function subscriptionCancelledSubject(
  name?: string | null,
  plan: "pro" | "plus" = "pro",
  locale: EmailLocale = "de",
): string {
  const first = firstNameFrom(name);
  const planLabel = plan === "plus" ? "Glev+" : "Glev Pro";

  if (locale === "en") {
    return first
      ? `${first}, your ${planLabel} membership has been cancelled`
      : `Your ${planLabel} membership has been cancelled`;
  }
  return first
    ? `${first}, deine ${planLabel}-Mitgliedschaft wurde gekündigt`
    : `Deine ${planLabel}-Mitgliedschaft wurde gekündigt`;
}

function cancelledHtmlDe(
  first: string | null,
  plan: "pro" | "plus",
  accessEndsAt: string | null | undefined,
  baseUrl: string,
  unsubUrl: string | null,
): string {
  const greeting = first ? `Hallo ${first}` : "Hallo";
  const planLabel = plan === "plus" ? "Glev+" : "Glev Pro";
  const planNote =
    plan === "plus"
      ? "deine <strong>Glev+-Mitgliedschaft</strong> (€&nbsp;29/Monat mit Lifetime-Lock)"
      : "deine <strong>Glev-Pro-Mitgliedschaft</strong> (€&nbsp;14,90/Monat)";

  const accessLine = accessEndsAt
    ? `Dein Zugang läuft noch bis zum <strong>${formatGermanDate(accessEndsAt)}</strong> weiter — danach wechselt das Konto automatisch auf den kostenlosen Plan.`
    : "Dein Konto wechselt jetzt auf den kostenlosen Plan.";

  const unsubHtml = unsubUrl
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Von diesen E-Mails abmelden</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kündigung bestätigt</title>
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
                ${greeting}
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                wir haben die Kündigung von ${planNote} bestätigt.
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                ${accessLine}
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Deine Daten — Mahlzeiten, CGM-Verläufe, Einstellungen — bleiben
                im Konto gespeichert. Wenn du irgendwann zurückkommst, machst
                du einfach da weiter, wo du aufgehört hast.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Falls die Kündigung ein Versehen war oder du Fragen hast,
                antworte einfach auf diese Mail — ich bin direkt dran.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background:#f1f5f9;border-radius:8px;">
                    <a href="${baseUrl}/dashboard"
                       style="display:inline-block;padding:14px 32px;color:#374151;font-size:15px;font-weight:600;text-decoration:none;">
                      Zu Glev →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Danke, dass du dabei warst,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> · Diese E-Mail bestätigt die Kündigung deiner ${planLabel}-Mitgliedschaft.
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

function cancelledHtmlEn(
  first: string | null,
  plan: "pro" | "plus",
  accessEndsAt: string | null | undefined,
  baseUrl: string,
  unsubUrl: string | null,
): string {
  const greeting = first ? `Hi ${first}` : "Hi there";
  const planLabel = plan === "plus" ? "Glev+" : "Glev Pro";
  const planNote =
    plan === "plus"
      ? "your <strong>Glev+ membership</strong> ($29/month, lifetime-locked price)"
      : "your <strong>Glev Pro membership</strong> ($14.90/month)";

  const accessLine = accessEndsAt
    ? `Your access continues until <strong>${formatEnglishDate(accessEndsAt)}</strong> — after that, your account will switch to the free plan automatically.`
    : "Your account will now switch to the free plan.";

  const unsubHtml = unsubUrl
    ? `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;"><a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from these emails</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cancellation confirmed</title>
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
                ${greeting}
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                we've confirmed the cancellation of ${planNote}.
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                ${accessLine}
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Your data — meals, CGM history, settings — stays in your
                account. If you come back, you pick up right where you left off.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                If this was a mistake or you have any questions, just reply
                to this email — it comes straight to me.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background:#f1f5f9;border-radius:8px;">
                    <a href="${baseUrl}/dashboard"
                       style="display:inline-block;padding:14px 32px;color:#374151;font-size:15px;font-weight:600;text-decoration:none;">
                      Back to Glev →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Thanks for being here,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> · This email confirms the cancellation of your ${planLabel} membership.
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

function formatGermanDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];
  return `${d.getUTCDate()}. ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatEnglishDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
