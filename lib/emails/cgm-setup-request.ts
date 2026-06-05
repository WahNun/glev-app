/**
 * Internal email sent to lucas@glev.app when a user submits a CGM
 * setup-support request. Rendered as a simple table — easy to scan
 * and copy into a spreadsheet or CRM.
 */

export interface CgmSetupRequestPayload {
  userEmail: string;
  userId: string;
  sensorBrand: string;
  sensorModel: string | null;
  deviceOs: string;
  nightscoutStatus: string;
  note: string | null;
  submittedAt: string;
  requestId: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function cgmSetupRequestHtml(p: CgmSetupRequestPayload): string {
  const rows: [string, string][] = [
    ["user_email",        p.userEmail],
    ["user_id",           p.userId],
    ["sensor_brand",      p.sensorBrand],
    ["sensor_model",      p.sensorModel ?? "—"],
    ["device_os",         p.deviceOs],
    ["nightscout_status", p.nightscoutStatus],
    ["note",              p.note ?? "—"],
    ["submitted_at",      new Date(p.submittedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour12: false })],
    ["request_id",        p.requestId],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#6b7280;white-space:nowrap;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #f1f5f9;width:180px;">${esc(label)}</td>
        <td style="padding:8px 12px;font-size:14px;color:#111827;border-bottom:1px solid #f1f5f9;word-break:break-all;">${esc(value)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>CGM Setup-Anfrage – Glev</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;max-width:100%;">
          <tr>
            <td style="background:#4F6EF7;padding:20px 24px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">🔧 Neue CGM Setup-Anfrage</p>
              <p style="margin:4px 0 0;color:#c7d2fe;font-size:13px;">Ein User möchte Hilfe beim CGM-Setup.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${tableRows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;">
              <a href="https://glev.app/glev-ops/users/${esc(p.userId)}"
                 style="display:inline-block;padding:10px 20px;background:#4F6EF7;color:#ffffff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
                User-Detail öffnen →
              </a>
              &nbsp;
              <a href="https://glev.app/glev-ops/setup-requests"
                 style="display:inline-block;padding:10px 20px;background:#f1f5f9;color:#374151;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
                Alle Anfragen →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function cgmSetupRequestText(p: CgmSetupRequestPayload): string {
  return [
    "Neue CGM Setup-Anfrage",
    "=======================",
    `User:      ${p.userEmail}`,
    `Sensor:    ${p.sensorBrand}${p.sensorModel ? ` (${p.sensorModel})` : ""}`,
    `OS:        ${p.deviceOs}`,
    `Nightscout: ${p.nightscoutStatus}`,
    `Notiz:     ${p.note ?? "—"}`,
    `Datum:     ${new Date(p.submittedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour12: false })}`,
    ``,
    `Admin: https://glev.app/glev-ops/users/${p.userId}`,
    `Anfragen: https://glev.app/glev-ops/setup-requests`,
  ].join("\n");
}
