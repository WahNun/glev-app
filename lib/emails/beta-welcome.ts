export function betaWelcomeHtml(name?: string | null): string {
  const greeting = name ? `Hallo ${name}` : 'Hallo';

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
            <td style="background:#0f172a;padding:32px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Glev</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
                ${greeting} 👋
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                herzlichen Glückwunsch — du bist jetzt offiziell ein Beta-Tester von Glev!
                Deine erste Zahlung von <strong>€23,50</strong>
                (€19 einmalige Setup-Gebühr + €4,50 für deinen ersten Monat)
                wurde erfolgreich verarbeitet und dein Zugang ist <strong>sofort aktiv</strong>.
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Ab Tag 30 läuft dein Abo automatisch weiter für nur
                <strong>€4,50 pro Monat</strong>. Du musst dafür nichts weiter tun,
                keine Kreditkarte erneut eingeben — alles läuft im Hintergrund.
                Kündigen kannst du jederzeit über deinen Account-Bereich.
              </p>

              <p style="margin:0 0 32px;font-size:15px;line-height:1.7;color:#374151;">
                Ich freue mich wirklich, dass du dabei bist. Dein Feedback als einer der
                ersten Nutzer ist für mich Gold wert — meld dich einfach direkt bei mir,
                wenn du Fragen hast oder etwas nicht stimmt.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;">
                    <a href="https://app.glev.app"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.2px;">
                      App öffnen →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
                Bis bald,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · info@glev.app · Diese E-Mail wurde an dich geschickt, weil du dich als Beta-Tester angemeldet hast.
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
