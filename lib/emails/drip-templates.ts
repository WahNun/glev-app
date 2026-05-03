// Drip-Email-Templates — die drei Onboarding-Mails, die nach der
// Welcome-Mail an Tag 7, 14 und 30 rausgehen. Jede Funktion liefert
// {subject, html} und sendet *nicht* selbst — der Versand passiert im
// Cron-Endpoint app/api/cron/drip/route.ts über Resend.
//
// Sprachen: 'de' (Default) und 'en'. Welche Sprache rausgeht entscheidet
// der Beta/Pro-Webhook anhand von `session.locale` und schreibt sie auf
// die Schedule-Row (`email_drip_schedule.locale`); der Cron liest das
// Feld und gibt es hier rein.

import { Resend } from "resend";

import type { EmailLocale } from "@/lib/emails/beta-welcome";
import { buildUnsubscribeUrl } from "@/lib/emails/unsubscribeToken";

export type DripEmailType =
  | "day7_insights"
  | "day14_feedback"
  | "day30_trustpilot";

export interface DripRendered {
  from: string;
  subject: string;
  html: string;
}

const FROM = "Glev <info@glev.app>";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_ORIGIN ||
  "https://glev.app"
).replace(/\/$/, "");

// ---- Resend client (lazy, gleiches Pattern wie outbox.ts) -----------------

let _resend: Resend | null = null;

export function getDripResend(): Resend {
  if (_resend) return _resend;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ---- Wrapper --------------------------------------------------------------

const UNSUB_LABEL: Record<EmailLocale, string> = {
  de: "Aus dieser Onboarding-Serie abmelden",
  en: "Unsubscribe from this onboarding series",
};

const DISCLAIMER: Record<EmailLocale, string> = {
  de:
    "<strong>Hinweis:</strong> Glev ist ein Dokumentations- und Auswertungstool und ersetzt keine ärztliche Beratung. " +
    "Es handelt sich nicht um ein Medizinprodukt. Therapieentscheidungen triffst du gemeinsam mit deinem Behandlungsteam.",
  en:
    "<strong>Note:</strong> Glev is a documentation and analytics tool and does not replace medical advice. " +
    "It is not a medical device. Therapy decisions stay with you and your care team.",
};

function wrap(
  title: string,
  bodyHtml: string,
  unsubscribeUrl: string,
  locale: EmailLocale,
): string {
  const lang = locale === "en" ? "en" : "de";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                   width="140" height="47"
                   style="display:inline-block;border:0;outline:none;text-decoration:none;width:140px;height:47px;max-width:140px;" />
            </td>
          </tr>

          <tr>
            <td style="padding:40px 40px 32px;">
              ${bodyHtml}
            </td>
          </tr>

          <tr>
            <td style="padding:18px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:11px;line-height:1.6;color:#9ca3af;text-align:center;">
                ${DISCLAIMER[locale]}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 40px 20px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a>
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
                <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">${UNSUB_LABEL[locale]}</a>
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

function greeting(firstName: string | null, locale: EmailLocale): string {
  if (locale === "en") return firstName ? `Hi ${firstName}` : "Hi there";
  return firstName ? `Hallo ${firstName}` : "Hallo";
}

// ---- Tag 7 — Insights-Tab Feature-Highlight -------------------------------

function day7BodyDe(firstName: string | null): string {
  const insightsUrl = `${APP_URL}/insights`;
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting(firstName, "de")} 👋</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      eine Woche Glev liegt hinter dir — und in deinen Daten steckt jetzt schon mehr, als du auf den ersten Blick siehst.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Wirf einen Blick auf den <strong>Insights-Tab</strong>: Dort findest du Auswertungen zu deiner Time-in-Range, deinen häufigsten Mahlzeiten und den Mustern, die deine Glukosekurve am stärksten beeinflussen. Gerade die ersten Wochen sind spannend, weil du dort sehen kannst, welche Routinen dir zuverlässig gut tun – und welche eher nicht.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px auto 16px;">
      <tr><td style="background:#4F6EF7;border-radius:8px;">
        <a href="${insightsUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">Insights ansehen →</a>
      </td></tr>
    </table>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      Tipp: Je sauberer du Mahlzeiten und Insulindosen loggst, desto aussagekräftiger werden die Insights. Schon ein paar Minuten pro Tag reichen.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Bis bald,<br /><strong>Lucas</strong><br /><span style="color:#6b7280;">Glev Team</span>
    </p>
  `;
}

function day7BodyEn(firstName: string | null): string {
  const insightsUrl = `${APP_URL}/insights`;
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting(firstName, "en")} 👋</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      one week with Glev down — and there's already more in your data than meets the eye.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Take a look at the <strong>Insights tab</strong>: you'll find your time-in-range, your most logged meals, and the patterns that move your glucose curve the most. The first few weeks are especially interesting because you can see which routines consistently work for you — and which don't.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px auto 16px;">
      <tr><td style="background:#4F6EF7;border-radius:8px;">
        <a href="${insightsUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">View your insights →</a>
      </td></tr>
    </table>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      Tip: the cleaner you log meals and insulin doses, the sharper the insights get. A few minutes a day is plenty.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Talk soon,<br /><strong>Lucas</strong><br /><span style="color:#6b7280;">Glev Team</span>
    </p>
  `;
}

export function day7InsightsEmail(
  firstName: string | null,
  email: string,
  locale: EmailLocale = "de",
): DripRendered {
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, email);
  const subject =
    locale === "en"
      ? "Your first week with Glev — check the Insights"
      : "Deine erste Woche mit Glev — schau in die Insights";
  const title = locale === "en" ? "Your first week with Glev" : "Deine erste Woche mit Glev";
  const body = locale === "en" ? day7BodyEn(firstName) : day7BodyDe(firstName);
  return { from: FROM, subject, html: wrap(title, body, unsubscribeUrl, locale) };
}

// ---- Tag 14 — Persönlicher Feedback-Request -------------------------------

function day14BodyDe(firstName: string | null): string {
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting(firstName, "de")},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      ich bin Lucas, der Entwickler hinter Glev — und du nutzt die App jetzt seit zwei Wochen. Genau der Zeitpunkt, an dem dein Feedback für mich am wertvollsten ist.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Ich freue mich riesig, wenn du dir kurz die Zeit nimmst und mir auf diese Mail antwortest:
    </p>
    <ul style="margin:0 0 20px 22px;padding:0;font-size:15px;line-height:1.8;color:#374151;">
      <li>Was läuft für dich richtig gut?</li>
      <li>Wo hakt es noch oder fehlt dir etwas?</li>
      <li>Was würde dich dazu bringen, Glev jeden Tag zu nutzen?</li>
    </ul>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
      Auch ein einzelner Satz hilft mir schon — jede Antwort landet direkt bei mir und fließt in die nächsten Updates ein. Glev wird durch die Rückmeldungen der ersten Nutzer:innen zu dem, was es heute ist, und ich nehme jeden Hinweis ernst.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      Antworte einfach direkt auf diese Mail – sie geht an mich persönlich.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Danke dir,<br /><strong>Lucas</strong><br /><span style="color:#6b7280;">Glev</span>
    </p>
  `;
}

function day14BodyEn(firstName: string | null): string {
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting(firstName, "en")},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      I'm Lucas, the developer behind Glev — and you've been using the app for two weeks now. This is exactly when your feedback is most valuable to me.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      I'd really appreciate it if you took a minute to reply to this email and tell me:
    </p>
    <ul style="margin:0 0 20px 22px;padding:0;font-size:15px;line-height:1.8;color:#374151;">
      <li>What's working really well for you?</li>
      <li>Where is it still rough or missing something?</li>
      <li>What would make you want to use Glev every single day?</li>
    </ul>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
      Even a single sentence helps — every reply lands with me directly and feeds into the next updates. Glev is what it is today thanks to feedback from early users, and I take every note seriously.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      Just reply to this email — it goes to me personally.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Thanks,<br /><strong>Lucas</strong><br /><span style="color:#6b7280;">Glev</span>
    </p>
  `;
}

export function day14FeedbackEmail(
  firstName: string | null,
  email: string,
  locale: EmailLocale = "de",
): DripRendered {
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, email);
  const subject =
    locale === "en"
      ? firstName
        ? `${firstName}, how is Glev working for you?`
        : "How is Glev working for you?"
      : firstName
        ? `${firstName}, wie läuft Glev für dich?`
        : "Wie läuft Glev für dich?";
  const title = locale === "en" ? "How is Glev working for you?" : "Wie läuft Glev für dich?";
  const body = locale === "en" ? day14BodyEn(firstName) : day14BodyDe(firstName);
  return { from: FROM, subject, html: wrap(title, body, unsubscribeUrl, locale) };
}

// ---- Tag 30 — Trustpilot-Bewertungsanfrage --------------------------------

function day30BodyDe(firstName: string | null): string {
  const trustpilotUrl = "https://www.trustpilot.com/evaluate/glev.app";
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting(firstName, "de")} 👋</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      du nutzt Glev jetzt seit etwa einem Monat — und falls die App dir den Alltag mit Diabetes ein Stück leichter macht, hätte ich eine kleine Bitte:
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Würdest du dir zwei Minuten nehmen und Glev auf <strong>Trustpilot</strong> bewerten? Für ein junges Tool wie Glev sind ehrliche Erfahrungsberichte das, was anderen Betroffenen am meisten hilft, eine Entscheidung zu treffen.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px auto 16px;">
      <tr><td style="background:#4F6EF7;border-radius:8px;">
        <a href="${trustpilotUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">Glev auf Trustpilot bewerten →</a>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
      Falls du etwas vermisst oder etwas nicht rund läuft, antworte stattdessen einfach auf diese Mail — dann fixe ich das, bevor es in einer Bewertung landet. ✌️
    </p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Danke dir,<br /><strong>Lucas</strong><br /><span style="color:#6b7280;">Glev Team</span>
    </p>
  `;
}

function day30BodyEn(firstName: string | null): string {
  const trustpilotUrl = "https://www.trustpilot.com/evaluate/glev.app";
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">${greeting(firstName, "en")} 👋</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      you've been using Glev for about a month now — and if the app makes daily life with diabetes a bit easier for you, I have a small ask:
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Would you take two minutes to review Glev on <strong>Trustpilot</strong>? For a young tool like Glev, honest experience reports help others with diabetes more than anything else when deciding whether to try it.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px auto 16px;">
      <tr><td style="background:#4F6EF7;border-radius:8px;">
        <a href="${trustpilotUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">Review Glev on Trustpilot →</a>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
      If something is missing or not quite right, reply to this email instead — I'll fix it before it ends up in a review. ✌️
    </p>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Thanks,<br /><strong>Lucas</strong><br /><span style="color:#6b7280;">Glev Team</span>
    </p>
  `;
}

export function day30TrustpilotEmail(
  firstName: string | null,
  email: string,
  locale: EmailLocale = "de",
): DripRendered {
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, email);
  const subject =
    locale === "en"
      ? "One month of Glev — would you review us?"
      : "Ein Monat Glev — magst du uns bewerten?";
  const title = locale === "en" ? "One month of Glev" : "Ein Monat Glev";
  const body = locale === "en" ? day30BodyEn(firstName) : day30BodyDe(firstName);
  return { from: FROM, subject, html: wrap(title, body, unsubscribeUrl, locale) };
}

// ---- Renderer-Dispatch ----------------------------------------------------

export function renderDripEmail(
  emailType: DripEmailType,
  firstName: string | null,
  email: string,
  locale: EmailLocale = "de",
): DripRendered {
  switch (emailType) {
    case "day7_insights":
      return day7InsightsEmail(firstName, email, locale);
    case "day14_feedback":
      return day14FeedbackEmail(firstName, email, locale);
    case "day30_trustpilot":
      return day30TrustpilotEmail(firstName, email, locale);
    default: {
      const _exhaustive: never = emailType;
      throw new Error(`Unknown drip email type: ${String(_exhaustive)}`);
    }
  }
}
