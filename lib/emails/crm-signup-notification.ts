/**
 * CRM signup notification — sent internally to lucas@glev.app
 * from crm@glev.app whenever someone completes the free-trial signup.
 *
 * Designed to be both human-readable and machine-parseable for CRM import.
 * Each field is rendered as a labelled table row so it can be scraped or
 * copy-pasted into a spreadsheet/CRM without further transformation.
 */

export interface CrmSignupPayload {
  name: string | null;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  uses_cgm: boolean | null;
  sensor_type: string | null;
  user_id: string;
  trial_end_at: string | null;
  signed_up_at: string;
  plan: string;
  source_url?: string | null;
  locale?: string | null;
  user_agent?: string | null;
}

export function crmSignupHtml(p: CrmSignupPayload): string {
  const rows: [string, string][] = [
    ["name",          p.name        ?? "—"],
    ["email",         p.email],
    ["phone",         p.phone       ?? "—"],
    ["date_of_birth", p.date_of_birth ?? "—"],
    ["uses_cgm",      p.uses_cgm === true ? "ja" : p.uses_cgm === false ? "nein" : "—"],
    ["sensor_type",   p.sensor_type ?? "—"],
    ["plan",          p.plan],
    ["trial_end_at",  p.trial_end_at ? new Date(p.trial_end_at).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "—"],
    ["signed_up_at",  new Date(p.signed_up_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour12: false })],
    ["user_id",       p.user_id],
    ["source_url",    p.source_url  ?? "—"],
    ["locale",        p.locale      ?? "—"],
    ["user_agent",    p.user_agent  ?? "—"],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#6b7280;white-space:nowrap;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #f1f5f9;width:160px;">${label}</td>
        <td style="padding:8px 12px;font-size:14px;color:#111827;border-bottom:1px solid #f1f5f9;word-break:break-all;">${escHtml(value)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Neue Anmeldung – Glev Free Trial</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#09090b;padding:20px 28px;">
              <span style="font-size:13px;font-weight:700;color:#22D3A0;letter-spacing:0.12em;text-transform:uppercase;">CRM · Neue Anmeldung</span>
              <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#fff;line-height:1.2;">Free-Trial Signup</p>
            </td>
          </tr>

          <!-- Data table -->
          <tr>
            <td style="padding:4px 0 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${tableRows}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:20px 28px 24px;">
              <a href="https://glev.app/admin/users" style="display:inline-block;background:#09090b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">
                Admin öffnen →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                Automatisch generiert von glev.app · crm@glev.app · Nur für internen Gebrauch
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

export function crmSignupSubject(email: string, name: string | null): string {
  const label = name ? `${name} (${email})` : email;
  return `[CRM] Neue Anmeldung: ${label}`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
