/**
 * HTML body for the post-Stripe-checkout welcome email for /pro subscriptions.
 *
 * Different from `beta-welcome.ts` in tone: the Pro flow is a card-on-file
 * trial that does not charge until launch day (1. Juli 2026), so the email
 * has to make the "no charge yet" promise unambiguous instead of saying the
 * payment was processed.
 *
 * The CTA "Registrierung abschließen" is the load-bearing piece (same as
 * Beta): when the buyer closes the success-tab before the page finished
 * confirming, this is the only way back. It links to
 * /pro/success?session_id=… so that the page can re-verify the session via
 * /api/verify-payment regardless of how much time has passed since checkout.
 *
 * @param name      Customer name from Stripe (optional). The full name as
 *                  collected by the `full_name` Checkout custom field; the
 *                  template parses the first token for in-body personal
 *                  references and falls back to neutral copy when missing.
 * @param sessionId Stripe Checkout Session ID — must be the live id, never
 *                  the literal `{CHECKOUT_SESSION_ID}` placeholder.
 * @param appUrl    Public app origin without trailing slash. Used to build
 *                  the resume link. Falls back to https://glev.app if missing.
 * @param trialEndsAt ISO date the trial ends (= first charge date). Falls
 *                  back to "1. Juli 2026" — the launch day all Pro trials
 *                  share — if Stripe didn't return one for some reason.
 */
export function proWelcomeHtml(
  name?: string | null,
  sessionId?: string | null,
  appUrl?: string | null,
  trialEndsAt?: string | null,
): string {
  const first = firstNameFrom(name);
  const greeting = first ? `Hallo ${first}` : 'Hallo';
  // First sentence of the post-greeting paragraph. With a known first name
  // we drop in a comma-set address; without one we keep the original
  // generic phrasing so the email stays grammatical for legacy buyers
  // (sessions captured before the `full_name` custom field existed).
  const postGreetingOpener = first
    ? `schön, dass du dabei bist, ${first}.`
    : 'schön dass du dabei bist.';
  // Caption right under the resume CTA — when we know the buyer's name we
  // address them directly, otherwise we keep the generic reassurance.
  const ctaCaption = first
    ? `${first}, der Link funktioniert auch, wenn du den ursprünglichen Tab geschlossen hast.`
    : 'Der Link funktioniert auch, wenn du den ursprünglichen Tab geschlossen hast.';
  const baseUrl = (appUrl || 'https://glev.app').replace(/\/$/, '');
  const resumeUrl = sessionId
    ? `${baseUrl}/pro/success?session_id=${encodeURIComponent(sessionId)}`
    : `${baseUrl}/pro/success`;

  // Display "1. Juli 2026" by default; if Stripe returned a trial_end (ISO),
  // format it in German. This is informational only — the actual charge
  // date is whatever Stripe has on the subscription.
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
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <img src="https://glev.app/glev-wordmark-white.png" alt="Glev"
                   width="140" height="47"
                   style="display:inline-block;border:0;outline:none;text-decoration:none;width:140px;height:47px;max-width:140px;" />
            </td>
          </tr>

          <!-- Body -->
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

              <!-- Primary CTA — Resume / confirm registration -->
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

          <!-- Footer -->
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

/**
 * Subject line for the Pro welcome email. When the buyer's first name is
 * known we lead with it ("Lukas, deine …") so the inbox preview already
 * feels personal; otherwise we fall back to the original generic subject
 * so legacy sessions without a captured name stay grammatical.
 */
export function proWelcomeSubject(name?: string | null): string {
  const first = firstNameFrom(name);
  return first
    ? `${first}, deine Glev-Mitgliedschaft ist angelegt`
    : 'Deine Glev-Mitgliedschaft ist angelegt';
}

/**
 * Extract the buyer's first name from the full name Stripe captured.
 *
 * Stripe's `full_name` custom field is free-form text, so we split on
 * whitespace and take the first token. Returns `null` for missing,
 * empty, or whitespace-only input so callers can branch on a single
 * truthiness check and fall back to neutral copy.
 */
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
