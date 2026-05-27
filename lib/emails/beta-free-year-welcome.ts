/**
 * Welcome email for the "Beta Free Year" program — friends-and-family
 * style 1-year free Beta access granted via /admin/users (no Stripe).
 *
 * Two flavours, picked by whether `signupUrl` is set:
 *   - Existing user (signupUrl=null): CTA → /dashboard, copy says
 *     "Du bist startklar". Same as before.
 *   - Brand-new user (signupUrl=Supabase invite link): CTA → that
 *     invite link, copy says "Account in 30 Sekunden einrichten" and
 *     the recipient lands on /welcome/beta to pick name + password.
 *
 * Same brand styling in both flavours so it feels like part of the
 * Glev family.
 *
 * @param name      Display name (optional). First token used for greeting.
 * @param appUrl    Public app origin without trailing slash. Falls back
 *                  to https://glev.app.
 * @param expiresAt ISO timestamp when access ends. Required — the whole
 *                  point of this template is communicating the end date.
 * @param locale    'de' (default) or 'en'.
 * @param signupUrl Optional Supabase invite/magic link. When set the
 *                  CTA points here instead of /dashboard.
 */
import type { EmailLocale } from "@/lib/emails/beta-welcome";

// Plan-Label (Beta vs. Pro). Standardmäßig Beta, damit alle alten
// Aufrufer ohne Änderung weiterlaufen. „Pro" wird vom neuen
// Diabetologen-/Friends-&-Family-Pro-Pfad gesetzt — selbe Mail-Optik,
// nur das Wort tauscht sich aus, damit nicht ein Pro-User „Beta"
// liest.
export type FreeYearPlanLabel = "beta" | "pro" | "plus";

function planLabel(plan: FreeYearPlanLabel): string {
  return plan === "pro" ? "Pro" : plan === "plus" ? "Plus" : "Smart";
}

export function betaFreeYearWelcomeHtml(
  name: string | null | undefined,
  appUrl: string | null | undefined,
  expiresAt: string,
  locale: EmailLocale = "de",
  signupUrl: string | null = null,
  plan: FreeYearPlanLabel = "beta",
): string {
  const first = firstNameFrom(name);
  const baseUrl = (appUrl || "https://glev.app").replace(/\/$/, "");
  const dashboardUrl = `${baseUrl}/dashboard`;
  const endDate = formatDate(expiresAt, locale);
  const ctaUrl = signupUrl || dashboardUrl;
  const isInvite = Boolean(signupUrl);
  const label = planLabel(plan);

  if (locale === "en") return htmlEn(first, ctaUrl, baseUrl, endDate, isInvite, label);
  return htmlDe(first, ctaUrl, baseUrl, endDate, isInvite, label);
}

export function betaFreeYearWelcomeSubject(
  name: string | null | undefined,
  locale: EmailLocale = "de",
  plan: FreeYearPlanLabel = "beta",
): string {
  const first = firstNameFrom(name);
  const label = planLabel(plan);
  if (locale === "en") {
    return first
      ? `${first}, you've got 1 year of Glev ${label} — on the house`
      : `You've got 1 year of Glev ${label} — on the house`;
  }
  return first
    ? `${first}, du hast 1 Jahr Glev ${label} geschenkt bekommen`
    : `Du hast 1 Jahr Glev ${label} geschenkt bekommen`;
}

function htmlDe(
  first: string | null,
  ctaUrl: string,
  baseUrl: string,
  endDate: string,
  isInvite: boolean,
  label: string,
): string {
  const greeting = first ? `Hallo ${first}` : "Hallo";
  const ctaLabel = isInvite ? "Account einrichten →" : "Zum Dashboard →";
  const explainerLine = isInvite
    ? `Klick auf den Button unten — du landest auf einer kurzen Seite, wo du deinen Namen wählst und ein Passwort setzt. Dauert 30 Sekunden.`
    : `Falls du noch keinen Account hast: registriere dich einfach mit dieser E-Mail-Adresse auf <a href="${baseUrl}" style="color:#5b6cff;">glev.app</a> — wir erkennen dich automatisch und schalten den Zugang frei.`;
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>1 Jahr Glev ${label} geschenkt</title></head>
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
      wir haben dir gerade <strong>1 Jahr Glev ${label}</strong> kostenlos freigeschaltet — komplett ohne Bezahlung, ohne Trial-Pflicht, ohne Haken.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
      Dein ${label}-Zugang läuft bis zum <strong>${endDate}</strong>. Bis dahin hast du vollen Zugriff auf alle ${label}-Funktionen.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
      <a href="${ctaUrl}" style="display:inline-block;background:#5b6cff;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">
        ${ctaLabel}
      </a>
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#64748b;">
      ${explainerLine}
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
  ctaUrl: string,
  baseUrl: string,
  endDate: string,
  isInvite: boolean,
  label: string,
): string {
  const greeting = first ? `Hi ${first}` : "Hi";
  const ctaLabel = isInvite ? "Set up your account →" : "Open dashboard →";
  const explainerLine = isInvite
    ? `Click the button below — you'll land on a short page where you pick your name and a password. Takes 30 seconds.`
    : `No account yet? Sign up with this email address at <a href="${baseUrl}" style="color:#5b6cff;">glev.app</a> — we'll recognize you and unlock access automatically.`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>1 free year of Glev ${label}</title></head>
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
      we just unlocked <strong>1 year of Glev ${label}</strong> for you — free, no trial period, no strings attached.
    </p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
      Your ${label} access is valid until <strong>${endDate}</strong>. Until then, you have full access to every ${label} feature.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
      <a href="${ctaUrl}" style="display:inline-block;background:#5b6cff;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">
        ${ctaLabel}
      </a>
    </td></tr></table>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#64748b;">
      ${explainerLine}
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
