/**
 * Welcome email for the "Beta Free Year" program — friends-and-family
 * style 1-year free Beta access granted via /admin/users (no Stripe).
 *
 * Differences vs. beta-welcome.ts:
 *   - No "complete checkout" CTA (the user is already a registered
 *     account — admin granted access on top).
 *   - States the explicit access end date so expectations are clear.
 *   - Same brand styling so it feels like part of the Glev family.
 *
 * @param name      Display name (optional). First token used for greeting.
 * @param appUrl    Public app origin without trailing slash. Falls back
 *                  to https://glev.app.
 * @param expiresAt ISO timestamp when access ends. Required — the whole
 *                  point of this template is communicating the end date.
 * @param locale    'de' (default) or 'en'.
 */
import type { EmailLocale } from "@/lib/emails/beta-welcome";

export function betaFreeYearWelcomeHtml(
  name: string | null | undefined,
  appUrl: string | null | undefined,
  expiresAt: string,
  locale: EmailLocale = "de",
): string {
  const first = firstNameFrom(name);
  const baseUrl = (appUrl || "https://glev.app").replace(/\/$/, "");
  const dashboardUrl = `${baseUrl}/dashboard`;
  const endDate = formatDate(expiresAt, locale);

  if (locale === "en") return htmlEn(first, dashboardUrl, baseUrl, endDate);
  return htmlDe(first, dashboardUrl, baseUrl, endDate);
}

export function betaFreeYearWelcomeSubject(
  name: string | null | undefined,
  locale: EmailLocale = "de",
): string {
  const first = firstNameFrom(name);
  if (locale === "en") {
    return first
      ? `${first}, you've got 1 year of Glev Beta — on the house`
      : "You've got 1 year of Glev Beta — on the house";
  }
  return first
    ? `${first}, du hast 1 Jahr Glev Beta geschenkt bekommen`
    : "Du hast 1 Jahr Glev Beta geschenkt bekommen";
}

function htmlDe(
  first: string | null,
  dashboardUrl: string,
  baseUrl: string,
  endDate: string,
): string {
  const greeting = first ? `Hallo ${first}` : "Hallo";
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>1 Jahr Glev Beta geschenkt</title></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <tr><td style="background:#09090b;padding:28px 40px;text-align:center;">
    <img src="https://glev.app/glev-wordmark-white.png" alt="Glev" width="140" height="47" style="display:inline-block;border:0;width:140px;height:47px;"/>
  </td></tr>
  <tr><td style="padding:40px 40px 32px;">
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting} 👋</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
      wir haben dir gerade <strong>1 Jahr Glev Beta</strong> kostenlos freigeschaltet — komplett ohne Bezahlung, ohne Trial-Pflicht, ohne Haken.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
      Dein Beta-Zugang läuft bis zum <strong>${endDate}</strong>. Bis dahin hast du vollen Zugriff auf alle Beta-Funktionen.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
      <a href="${dashboardUrl}" style="display:inline-block;background:#5b6cff;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">
        Zum Dashboard →
      </a>
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#64748b;">
      Falls du noch keinen Account hast: registriere dich einfach mit dieser E-Mail-Adresse auf <a href="${baseUrl}" style="color:#5b6cff;">glev.app</a> — wir erkennen dich automatisch und schalten den Zugang frei.
    </p>
    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#64748b;">
      Bei Fragen einfach auf diese Mail antworten — wir lesen jede einzelne.
    </p>
    <p style="margin:16px 0 0;font-size:14px;color:#64748b;">— Lucas, Gründer von Glev</p>
  </td></tr>
  <tr><td style="padding:20px 40px;background:#fafafa;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;">
    Glev · T1D Insulin-Entscheidungssystem · <a href="${baseUrl}" style="color:#94a3b8;">glev.app</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function htmlEn(
  first: string | null,
  dashboardUrl: string,
  baseUrl: string,
  endDate: string,
): string {
  const greeting = first ? `Hi ${first}` : "Hi";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>1 free year of Glev Beta</title></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <tr><td style="background:#09090b;padding:28px 40px;text-align:center;">
    <img src="https://glev.app/glev-wordmark-white.png" alt="Glev" width="140" height="47" style="display:inline-block;border:0;width:140px;height:47px;"/>
  </td></tr>
  <tr><td style="padding:40px 40px 32px;">
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting} 👋</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
      we just unlocked <strong>1 year of Glev Beta</strong> for you — free, no trial period, no strings attached.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
      Your Beta access is valid until <strong>${endDate}</strong>. Until then, you have full access to every Beta feature.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
      <a href="${dashboardUrl}" style="display:inline-block;background:#5b6cff;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">
        Open dashboard →
      </a>
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#64748b;">
      No account yet? Sign up with this email address at <a href="${baseUrl}" style="color:#5b6cff;">glev.app</a> — we'll recognize you and unlock access automatically.
    </p>
    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#64748b;">
      Any questions? Just reply to this email — we read every single one.
    </p>
    <p style="margin:16px 0 0;font-size:14px;color:#64748b;">— Lucas, founder of Glev</p>
  </td></tr>
  <tr><td style="padding:20px 40px;background:#fafafa;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;">
    Glev · T1D insulin decision support · <a href="${baseUrl}" style="color:#94a3b8;">glev.app</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function firstNameFrom(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const [first] = trimmed.split(/\s+/);
  return first || null;
}

function formatDate(iso: string, locale: EmailLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (locale === "en") {
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return d.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
