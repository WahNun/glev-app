/** Reminder-Email für Meta-Leads die nach 24h noch nicht aktiviert haben. */

const ACCENT = "#4F6EF7";

export function metaLeadReminderSubject(
  firstName: string | null,
  subjectOverride?: string | null,
): string {
  if (subjectOverride) return subjectOverride;
  const name = firstName ? `, ${firstName}` : "";
  return `Dein Glev-Test wartet noch${name} 🔔`;
}

export function metaLeadReminderHtml(
  firstName: string | null,
  inviteUrl: string,
  appUrl: string,
  overrides?: { intro?: string | null },
): string {
  const greeting = firstName ? `Hallo ${firstName}` : "Hallo";
  const introText =
    overrides?.intro?.trim() ||
    "du hattest Interesse an Glev – der App die dir hilft, deine Insulindosierung besser einzuschätzen. Dein kostenloser 7-Tage-Test ist noch nicht aktiviert.";
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f11;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f11;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td style="padding-bottom:28px;text-align:center;">
          <span style="font-size:13px;font-weight:700;letter-spacing:0.18em;color:rgba(255,255,255,0.35);">GLEV</span>
        </td></tr>
        <tr><td style="background:#1a1a1f;border-radius:16px;padding:36px 32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.01em;">
            Dein Test wartet noch auf dich
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.6;">
            ${greeting}, ${introText}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="background:#23232a;border-radius:10px;padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.35);letter-spacing:0.08em;">WAS DICH ERWARTET</p>
                <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.55;">
                  ✦ KI analysiert deine Mahlzeiten &amp; Glukosewerte<br>
                  ✦ Personalisierte Einschätzung deiner Insulindosis<br>
                  ✦ Muster erkennen – fundierte Entscheidungen treffen
                </p>
              </td>
            </tr>
          </table>
          <a href="${inviteUrl}"
             style="display:block;text-align:center;padding:14px;background:${ACCENT};
                    border-radius:10px;color:#fff;font-size:15px;font-weight:600;
                    text-decoration:none;letter-spacing:-0.01em;">
            Jetzt 7-Tage-Test starten →
          </a>
          <p style="margin:20px 0 0;font-size:12px;color:rgba(255,255,255,0.3);text-align:center;line-height:1.5;">
            Falls der Button nicht funktioniert, kopiere diesen Link:<br>
            <a href="${inviteUrl}" style="color:rgba(255,255,255,0.4);">${inviteUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.2);line-height:1.6;">
            Glev · <a href="mailto:info@glev.app" style="color:rgba(255,255,255,0.2);">info@glev.app</a>
            · <a href="${appUrl}" style="color:rgba(255,255,255,0.2);">glev.app</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
