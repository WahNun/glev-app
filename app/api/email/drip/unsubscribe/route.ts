// One-Click-Abmeldung aus der Onboarding-Drip-Serie.
//
// Aufruf:   GET /api/email/drip/unsubscribe?email=<addr>&token=<hmac>
// Antwort:  HTML-Bestätigungsseite (200) bzw. HTML-Fehlerseite
//           (400 bei kaputtem/fehlendem Token).
//
// Was passiert beim Klick:
//   1. HMAC-Token gegen die Mail-Adresse prüfen (timing-safe).
//   2. Adresse in `email_drip_unsubscribes` upserten — die Tabelle ist
//      die globale Sperrliste, an der sich der Cron und der Scheduler
//      orientieren.
//   3. Offene (noch nicht versendete) Schedule-Rows der Adresse als
//      "sent" markieren, damit der Cron sie nicht mehr aufgreift.
//   4. Erfolgsseite ausliefern.
//
// Bewusst ein GET-Endpoint, kein POST: Mail-Clients (insbesondere
// iOS Mail und Outlook) öffnen den Link beim Klick als GET, und
// Link-Preview-Crawler dürfen ihn ebenfalls aufrufen, ohne dass
// das eine Abmeldung triggert — die Operation ist idempotent
// (`upsert` und `update ... is sent_at null`), wiederholte Klicks
// schaden also nicht.
//
// Nicht implementiert:
//   - List-Unsubscribe-Header (One-Click per RFC 8058) — die Drip-Mails
//     sind kommerziell, aber kein Bulk-Newsletter; ein sichtbarer
//     Link im Footer ist für die DSGVO-Konformität ausreichend.
//   - "Bist du sicher?"-Zwischenseite — Drip-Empfänger:innen, die den
//     Footer-Link bewusst klicken, wollen sich abmelden, nicht
//     bestätigen müssen.

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyUnsubscribeToken } from "@/lib/emails/unsubscribeToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function htmlPage(title: string, bodyHtml: string, status = 200): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:64px 16px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Glev</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 32px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:14px 40px 22px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · <a href="mailto:hello@glev.app" style="color:#9ca3af;">hello@glev.app</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Verhindert, dass Prefetch / Browser-Cache die Bestätigungsseite
      // an einen anderen Tab/Nutzer:in ausliefert.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function errorPage(message: string): NextResponse {
  return htmlPage(
    "Abmelde-Link ungültig",
    `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;">Dieser Abmelde-Link ist nicht gültig</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#374151;">
        ${message}
      </p>
      <p style="margin:0;font-size:14px;line-height:1.7;color:#6b7280;">
        Wenn du dich aus der Onboarding-Serie abmelden möchtest, antworte
        einfach auf eine der Drip-Mails — dann tragen wir dich manuell aus.
      </p>
    `,
    400,
  );
}

function successPage(email: string): NextResponse {
  return htmlPage(
    "Abmeldung bestätigt",
    `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;">Du bist abgemeldet ✓</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#374151;">
        Wir senden keine weiteren Onboarding-Mails an
        <strong>${email}</strong>.
      </p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#374151;">
        Wichtige Service-Mails (Kaufbestätigung, Passwort-Reset und
        ähnliche transaktionale Nachrichten) bekommst du weiterhin —
        diese Abmeldung betrifft ausschließlich die Onboarding-Serie an
        Tag 7, 14 und 30.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.7;color:#6b7280;">
        War das ein Versehen? Schreib uns kurz an
        <a href="mailto:hello@glev.app" style="color:#4F6EF7;">hello@glev.app</a>,
        dann reaktivieren wir dich.
      </p>
    `,
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawEmail = (searchParams.get("email") ?? "").trim();
  const token = (searchParams.get("token") ?? "").trim();

  if (!rawEmail || !token) {
    return errorPage("Der Link ist unvollständig — Adresse oder Signatur fehlen.");
  }

  // Sehr lockere Plausibilitäts-Prüfung, primär gegen Müll-Inputs.
  // Die echte Autorität liegt im HMAC-Vergleich darunter.
  if (rawEmail.length > 320 || !rawEmail.includes("@")) {
    return errorPage("Die Adresse im Link sieht nicht wie eine Mail-Adresse aus.");
  }

  const email = rawEmail.toLowerCase();

  if (!verifyUnsubscribeToken(email, token)) {
    return errorPage("Die Signatur passt nicht zur Adresse.");
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[email/drip/unsubscribe] supabase init failed:", err);
    return htmlPage(
      "Vorübergehender Fehler",
      `<p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">Bitte versuche es in ein paar Minuten erneut.</p>`,
      500,
    );
  }

  // 1. Globale Sperrliste — idempotent. Doppelte Klicks führen nicht
  //    zu einem Fehler; das ursprüngliche `unsubscribed_at` bleibt
  //    erhalten (ignoreDuplicates), damit der Audit-Zeitstempel
  //    stabil ist.
  const { error: upsertErr } = await admin
    .from("email_drip_unsubscribes")
    .upsert(
      [{ email, source: "link" }],
      { onConflict: "email", ignoreDuplicates: true },
    );

  if (upsertErr) {
    // eslint-disable-next-line no-console
    console.error("[email/drip/unsubscribe] upsert failed:", {
      email,
      message: upsertErr.message,
    });
    return htmlPage(
      "Vorübergehender Fehler",
      `<p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
        Wir konnten deine Abmeldung gerade nicht speichern. Bitte versuche es
        in ein paar Minuten erneut.
      </p>`,
      500,
    );
  }

  // 2. Offene Schedule-Rows als "sent" markieren — beim nächsten Cron
  //    übergeht sie das partial-indexierte SELECT (sent_at IS NULL)
  //    automatisch. Wir tolerieren Fehler hier still: die globale
  //    Sperrliste oben sorgt ohnehin dafür, dass nichts rausgeht;
  //    diese zweite Aktion spart nur DB-Round-Trips im Cron.
  const { error: skipErr } = await admin
    .from("email_drip_schedule")
    .update({ sent_at: new Date().toISOString() })
    .eq("email", email)
    .is("sent_at", null);

  if (skipErr) {
    // eslint-disable-next-line no-console
    console.warn("[email/drip/unsubscribe] could not mark schedule rows as skipped:", {
      email,
      message: skipErr.message,
    });
  }

  // eslint-disable-next-line no-console
  console.log("[email/drip/unsubscribe] success:", { email });

  return successPage(email);
}
