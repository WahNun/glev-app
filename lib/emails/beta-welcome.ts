/**
 * HTML body for the post-Stripe-checkout welcome email.
 *
 * The CTA "Registrierung abschließen" is the load-bearing piece: when the
 * buyer closes the success-tab before setting a password, this is the only
 * way back into the signup flow. It links to /welcome?session_id=… so that
 * the page can re-verify the payment via /api/verify-payment regardless of
 * how much time has passed since checkout.
 *
 * @param name      Customer name from Stripe (optional). The full name as
 *                  collected by the `full_name` Checkout custom field; the
 *                  template parses the first token for in-body personal
 *                  references and falls back to neutral copy when missing.
 * @param sessionId Stripe Checkout Session ID — must be the live id, never
 *                  the literal `{CHECKOUT_SESSION_ID}` placeholder.
 * @param appUrl    Public app origin without trailing slash. Used to build
 *                  the resume link. Falls back to https://glev.app if missing.
 */
export function betaWelcomeHtml(
  name?: string | null,
  sessionId?: string | null,
  appUrl?: string | null,
): string {
  const first = firstNameFrom(name);
  const greeting = first ? `Hallo ${first}` : 'Hallo';
  // Paragraph right after the greeting. With a known first name we work it
  // into the congratulation; without one we keep the original phrasing so
  // legacy buyers (sessions captured before the `full_name` custom field
  // existed) still get a grammatical sentence.
  const congratsLine = first
    ? `herzlichen Glückwunsch, ${first} — du bist jetzt offiziell ein Beta-Tester von Glev!`
    : 'herzlichen Glückwunsch — du bist jetzt offiziell ein Beta-Tester von Glev!';
  // Caption right under the resume CTA — addresses the buyer directly when
  // we know their name, otherwise stays generic.
  const ctaCaption = first
    ? `${first}, der Link funktioniert auch, wenn du den ursprünglichen Tab geschlossen hast.`
    : 'Der Link funktioniert auch, wenn du den ursprünglichen Tab geschlossen hast.';
  const baseUrl = (appUrl || 'https://glev.app').replace(/\/$/, '');
  const resumeUrl = sessionId
    ? `${baseUrl}/welcome?session_id=${encodeURIComponent(sessionId)}`
    : `${baseUrl}/welcome`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Willkommen bei Glev</title>
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
                ${congratsLine}
                Deine Zahlung wurde erfolgreich verarbeitet und dein Beta-Zugang ist
                <strong>aktiviert</strong>.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                <strong>Letzter Schritt:</strong> Bitte schließe deine Registrierung ab,
                indem du auf den Button unten klickst und ein Passwort wählst. Dein
                Account ist erst dann nutzbar.
              </p>

              <!-- Primary CTA — Resume registration -->
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
                Sobald dein Account steht, geht's direkt los: CGM verbinden, erste
                Mahlzeit loggen, und Glev rechnet deine Insulindosis. Dein Feedback
                als einer der ersten Nutzer ist für mich Gold wert — meld dich
                einfach direkt bei mir, wenn etwas nicht stimmt.
              </p>

              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#374151;">
                Bis bald,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>

              <!-- Secondary link — App entry once account is set up -->
              <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;border-top:1px solid #f1f5f9;padding-top:18px;">
                Account bereits eingerichtet?
                <a href="${baseUrl}/login" style="color:#4F6EF7;text-decoration:none;font-weight:600;">Zum Login →</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a> · Diese E-Mail wurde an dich geschickt, weil du dich als Beta-Tester angemeldet hast.
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
 * Subject line for the Beta welcome email. When the buyer's first name is
 * known we slot it into the greeting half so the inbox preview already
 * feels personal; otherwise we fall back to the original generic subject
 * so legacy sessions without a captured name stay grammatical.
 */
export function betaWelcomeSubject(name?: string | null): string {
  const first = firstNameFrom(name);
  return first
    ? `Willkommen bei Glev, ${first} — bitte schließe deine Registrierung ab`
    : 'Willkommen bei Glev — bitte schließe deine Registrierung ab';
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
