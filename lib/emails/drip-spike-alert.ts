// Admin-internal alert email — sent when at least one drip's 7-day
// opt-out rate has jumped to ≥ 2× its 30-day baseline.
//
// Rendered entirely as inline-styled HTML so it survives any mail client.
// No unsubscribe link needed — this is an operator digest, not a marketing
// email.

import type { AlertableSpike } from "@/lib/emails/drip-stats";
import { DRIP_TYPE_LABEL } from "@/lib/emails/drip-stats";

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_ORIGIN ||
  "https://glev.app"
).replace(/\/$/, "");

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "∞×";
  return `${ratio.toFixed(1)}×`;
}

/**
 * Build the HTML body for the drip-spike alert digest.
 *
 * @param spikes  Non-empty array of alertable spikes from `findAlertableSpikes()`.
 * @param checkedAt  ISO string of the check run timestamp (shown in footer).
 */
export function dripSpikeAlertHtml(
  spikes: ReadonlyArray<AlertableSpike>,
  checkedAt: string,
): string {
  const rows = spikes
    .map((s) => {
      const label = escHtml(DRIP_TYPE_LABEL[s.type] ?? s.type);
      const rate7d = `${(s.rate7d * 100).toFixed(1)}%`;
      const rate30d = s.rate30d > 0 ? `${(s.rate30d * 100).toFixed(1)}%` : "0%";
      const ratio = fmtRatio(s.ratio);
      return `
        <tr>
          <td style="padding:10px 14px;font-size:13px;color:#111827;border-bottom:1px solid #f1f5f9;">${label}</td>
          <td style="padding:10px 14px;font-size:13px;color:#111827;border-bottom:1px solid #f1f5f9;text-align:right;">${s.sent7d}</td>
          <td style="padding:10px 14px;font-size:13px;color:#111827;border-bottom:1px solid #f1f5f9;text-align:right;">${s.unsub7d}</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#dc2626;border-bottom:1px solid #f1f5f9;text-align:right;">${rate7d}</td>
          <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f1f5f9;text-align:right;">${rate30d}</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#dc2626;border-bottom:1px solid #f1f5f9;text-align:right;">${ratio}</td>
        </tr>`;
    })
    .join("");

  const plural = spikes.length === 1 ? "1 Drip-Typ" : `${spikes.length} Drip-Typen`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Drip Opt-out Spike – Glev Admin</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#09090b;padding:20px 28px;">
              <span style="font-size:13px;font-weight:700;color:#f87171;letter-spacing:0.12em;text-transform:uppercase;">Admin Alert · Drip-Stats</span>
              <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#fff;line-height:1.2;">Opt-out-Rate Spike erkannt</p>
              <p style="margin:6px 0 0;font-size:13px;color:#9ca3af;">${plural} mit auffällig hoher Abmeldequote in den letzten 7 Tagen.</p>
            </td>
          </tr>

          <!-- Explanation -->
          <tr>
            <td style="padding:20px 28px 8px;">
              <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">
                Die 7-Tage-Abmelderate ist mindestens <strong>2× so hoch</strong> wie die 30-Tage-Baseline und hat ausreichend Volumen (≥&nbsp;5&nbsp;Sends), um zuverlässig zu sein.
              </p>
            </td>
          </tr>

          <!-- Data table -->
          <tr>
            <td style="padding:8px 28px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Drip-Typ</th>
                    <th style="padding:10px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Sends 7d</th>
                    <th style="padding:10px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Unsubs 7d</th>
                    <th style="padding:10px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Rate 7d</th>
                    <th style="padding:10px 14px;font-size:11px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Baseline 30d</th>
                    <th style="padding:10px 14px;font-size:11px;font-weight:600;color:#dc2626;text-align:right;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Faktor</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 28px 24px;">
              <a href="${APP_URL}/glev-ops/drip-stats" style="display:inline-block;background:#09090b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">
                Drip-Stats öffnen →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                Automatisch generiert von glev.app · Geprüft um ${escHtml(checkedAt)} UTC · Nur für internen Gebrauch
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

export function dripSpikeAlertSubject(spikeCount: number): string {
  const plural = spikeCount === 1 ? "1 Drip-Typ" : `${spikeCount} Drip-Typen`;
  return `[Alert] Drip Opt-out Spike: ${plural} auffällig`;
}

export const DRIP_ALERT_FROM = "Glev Admin <crm@glev.app>";
export const DRIP_ALERT_TO = "lucas@glev.app";
