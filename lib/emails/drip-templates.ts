// Drip-Email-Templates — die drei Onboarding-Mails, die nach der
// Welcome-Mail an Tag 7, 14 und 30 rausgehen. Bewusst nur auf Deutsch
// (siehe Task #160 — Übersetzung ist explizit out of scope).
//
// Jede Funktion liefert {subject, html} und sendet *nicht* selbst —
// der Versand passiert im Cron-Endpoint app/api/cron/drip/route.ts
// über Resend, damit der Render-Code testbar bleibt und nicht von
// der Resend-Konfiguration abhängt.
//
// HTML-Wrapper:
//   Gleiches Glev-Branding wie die Welcome-Mails (dunkler Header,
//   weißer Body, abgerundeter Container) plus ein zusätzlicher
//   Disclaimer-Footer ("Glev ist ein Dokumentations-Tool, kein
//   Medizinprodukt"), den die Welcome-Mails so nicht haben — die
//   Drip-Mails enthalten Feature-Highlights und Aufrufe zur Nutzung,
//   da gehört der Hinweis dazu.

import { Resend } from "resend";

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

/**
 * Lazy Resend-Konstruktion: ein fehlerhafter RESEND_API_KEY würde sonst
 * beim Modul-Loading werfen und damit jeden Cron-Aufruf tot machen,
 * bevor wir überhaupt prüfen können, ob etwas zu versenden ist.
 */
export function getDripResend(): Resend {
  if (_resend) return _resend;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ---- Wrapper --------------------------------------------------------------

/**
 * Gemeinsamer HTML-Wrapper für alle drei Drip-Mails. Erwartet bereits
 * fertig formatiertes Body-HTML (Absätze, evtl. CTA-Button) und packt
 * es in das Glev-Layout inklusive Disclaimer-Footer und Abmelde-Link.
 *
 * `unsubscribeUrl` ist Pflicht — die Drip-Mails dürfen rechtlich
 * (DSGVO/CAN-SPAM) nicht ohne One-Click-Opt-out rausgehen, deshalb
 * gibt es bewusst keinen Default. Wenn das Token-Secret fehlt, wirft
 * `buildUnsubscribeUrl` und die Mail wird gar nicht erst gerendert.
 */
function wrap(title: string, bodyHtml: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <tr>
            <td style="background:#0f172a;padding:32px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Glev</span>
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
                <strong>Hinweis:</strong> Glev ist ein Dokumentations- und Auswertungstool und ersetzt keine ärztliche Beratung.
                Es handelt sich nicht um ein Medizinprodukt. Therapieentscheidungen triffst du gemeinsam mit deinem Behandlungsteam.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 40px 20px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a>
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
                <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Aus dieser Onboarding-Serie abmelden</a>
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

function greeting(firstName: string | null): string {
  return firstName ? `Hallo ${firstName}` : "Hallo";
}

// ---- Tag 7 — Insights-Tab Feature-Highlight -------------------------------

function day7Body(firstName: string | null): string {
  const insightsUrl = `${APP_URL}/insights`;
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
      ${greeting(firstName)} 👋
    </p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      eine Woche Glev liegt hinter dir — und in deinen Daten steckt jetzt schon mehr, als du auf den ersten Blick siehst.
    </p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Wirf einen Blick auf den <strong>Insights-Tab</strong>: Dort findest du Auswertungen zu deiner Time-in-Range, deinen häufigsten Mahlzeiten und den Mustern, die deine Glukosekurve am stärksten beeinflussen. Gerade die ersten Wochen sind spannend, weil du dort sehen kannst, welche Routinen dir zuverlässig gut tun – und welche eher nicht.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin:24px auto 16px;">
      <tr>
        <td style="background:#4F6EF7;border-radius:8px;">
          <a href="${insightsUrl}"
             style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
            Insights ansehen →
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
      Tipp: Je sauberer du Mahlzeiten und Insulindosen loggst, desto aussagekräftiger werden die Insights. Schon ein paar Minuten pro Tag reichen.
    </p>

    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Bis bald,<br />
      <strong>Lucas</strong><br />
      <span style="color:#6b7280;">Glev Team</span>
    </p>
  `;
}

export function day7InsightsEmail(
  firstName: string | null,
  email: string,
): DripRendered {
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, email);
  return {
    from: FROM,
    subject: "Deine erste Woche mit Glev — schau in die Insights",
    html: wrap("Deine erste Woche mit Glev", day7Body(firstName), unsubscribeUrl),
  };
}

// ---- Tag 14 — Persönlicher Feedback-Request -------------------------------

function day14Body(firstName: string | null): string {
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
      ${greeting(firstName)},
    </p>

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
      Danke dir,<br />
      <strong>Lucas</strong><br />
      <span style="color:#6b7280;">Glev</span>
    </p>
  `;
}

export function day14FeedbackEmail(
  firstName: string | null,
  email: string,
): DripRendered {
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, email);
  return {
    from: FROM,
    subject: firstName
      ? `${firstName}, wie läuft Glev für dich?`
      : "Wie läuft Glev für dich?",
    html: wrap("Wie läuft Glev für dich?", day14Body(firstName), unsubscribeUrl),
  };
}

// ---- Tag 30 — Trustpilot-Bewertungsanfrage --------------------------------

function day30Body(firstName: string | null): string {
  const trustpilotUrl = "https://www.trustpilot.com/evaluate/glev.app";
  return `
    <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
      ${greeting(firstName)} 👋
    </p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      du nutzt Glev jetzt seit etwa einem Monat — und falls die App dir den Alltag mit Diabetes ein Stück leichter macht, hätte ich eine kleine Bitte:
    </p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      Würdest du dir zwei Minuten nehmen und Glev auf <strong>Trustpilot</strong> bewerten? Für ein junges Tool wie Glev sind ehrliche Erfahrungsberichte das, was anderen Betroffenen am meisten hilft, eine Entscheidung zu treffen.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin:24px auto 16px;">
      <tr>
        <td style="background:#4F6EF7;border-radius:8px;">
          <a href="${trustpilotUrl}"
             style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
            Glev auf Trustpilot bewerten →
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
      Falls du etwas vermisst oder etwas nicht rund läuft, antworte stattdessen einfach auf diese Mail — dann fixe ich das, bevor es in einer Bewertung landet. ✌️
    </p>

    <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
      Danke dir,<br />
      <strong>Lucas</strong><br />
      <span style="color:#6b7280;">Glev Team</span>
    </p>
  `;
}

export function day30TrustpilotEmail(
  firstName: string | null,
  email: string,
): DripRendered {
  const unsubscribeUrl = buildUnsubscribeUrl(APP_URL, email);
  return {
    from: FROM,
    subject: "Ein Monat Glev — magst du uns bewerten?",
    html: wrap("Ein Monat Glev", day30Body(firstName), unsubscribeUrl),
  };
}

// ---- Renderer-Dispatch ----------------------------------------------------

/**
 * Liefert das gerenderte Mail-Payload für einen Drip-Typ. Genutzt vom
 * Cron-Endpoint, der für jede fällige Row die passende Funktion auswählt.
 */
export function renderDripEmail(
  emailType: DripEmailType,
  firstName: string | null,
  email: string,
): DripRendered {
  switch (emailType) {
    case "day7_insights":
      return day7InsightsEmail(firstName, email);
    case "day14_feedback":
      return day14FeedbackEmail(firstName, email);
    case "day30_trustpilot":
      return day30TrustpilotEmail(firstName, email);
    default: {
      // Compile-time exhaustiveness — fügt jemand einen neuen Drip-Typ
      // zur Union hinzu, ohne hier einen Case zu ergänzen, scheitert
      // der TS-Build hier statt erst zur Laufzeit.
      const _exhaustive: never = emailType;
      throw new Error(`Unknown drip email type: ${String(_exhaustive)}`);
    }
  }
}
