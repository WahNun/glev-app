// Cron worker — versendet fällige Drip-Mails aus email_drip_schedule.
//
// Schedule-Erwartung: einmal täglich um 09:00 UTC (siehe vercel.json).
// Der Endpoint ist idempotent: ein zweiter Aufruf direkt danach findet
// die gerade verschickten Rows mit `sent_at IS NOT NULL` und springt
// raus, ohne erneut zu senden.
//
// Auth: Bearer-Token. Header `Authorization: Bearer <CRON_SECRET>`.
// Gleiches Muster wie /api/cron/flush-outbox — selber Secret, weil
// nur Server-zu-Server gesprochen wird und es keinen Grund gibt, zwei
// Secrets zu rotieren.
//
// Antwort: { ok: true, sent: <count>, failed: <count> }.
//
// Smoke-Test (manuell, gegen die laufende Prod- oder Dev-Instanz):
//   1. In Supabase eine Test-Row einfügen, deren scheduled_at in der
//      Vergangenheit liegt:
//        insert into public.email_drip_schedule
//          (email, first_name, tier, email_type, scheduled_at)
//        values
//          ('you@example.com', 'Test', 'beta', 'day7_insights',
//           now() - interval '1 minute');
//   2. Cron einmal mit Bearer-Token aufrufen:
//        curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//          "$APP_URL/api/cron/drip"
//      Erwartet: { ok: true, sent: 1, failed: 0 }
//      Resend-Dashboard zeigt die Mail unter "Logs".
//   3. Zweiten Cron-Aufruf direkt danach machen:
//        curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//          "$APP_URL/api/cron/drip"
//      Erwartet: { ok: true, sent: 0, failed: 0 } — sent_at ist
//      gesetzt und das SELECT findet die Row nicht mehr.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getDripResend,
  renderDripEmail,
  type DripEmailType,
} from "@/lib/emails/drip-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Maximale Anzahl Mails pro Cron-Aufruf. Großzügig (50), weil der
 * Cron nur einmal am Tag läuft und ein Tag mit überdurchschnittlich
 * vielen Käufer:innen sonst über mehrere Tage abgearbeitet würde —
 * was die Drip-Termine (Tag 7/14/30) inhaltlich verschiebt. Bei
 * extrem hohen Volumina müsste der Limit angehoben oder der Cron
 * mehrmals täglich gefeuert werden.
 */
const BATCH_SIZE = 50;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

interface DripRow {
  id: string;
  email: string;
  first_name: string | null;
  email_type: DripEmailType;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    // eslint-disable-next-line no-console
    console.error(
      "[cron/drip] CRON_SECRET not configured or too short (min 16 chars)",
    );
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return unauthorized();
  }

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // 1. Fällige, noch nicht versendete Rows holen, älteste zuerst.
  const { data: due, error: selectErr } = await admin
    .from("email_drip_schedule")
    .select("id, email, first_name, email_type")
    .is("sent_at", null)
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (selectErr) {
    // eslint-disable-next-line no-console
    console.error("[cron/drip] select failed:", selectErr);
    return NextResponse.json(
      { error: `select failed: ${selectErr.message}` },
      { status: 500 },
    );
  }

  if (!due || due.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[cron/drip] no due rows");
    return NextResponse.json({ ok: true, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;
  const resend = getDripResend();

  for (const raw of due as DripRow[]) {
    try {
      const rendered = renderDripEmail(raw.email_type, raw.first_name);
      const { data, error } = await resend.emails.send({
        from: rendered.from,
        to: raw.email,
        subject: rendered.subject,
        html: rendered.html,
      });

      if (error) {
        failed += 1;
        // eslint-disable-next-line no-console
        console.error("[cron/drip] resend error:", {
          id: raw.id,
          to: raw.email,
          type: raw.email_type,
          err: `${error.name ?? "ResendError"}: ${error.message ?? "unknown"}`,
        });
        // sent_at bleibt NULL → der nächste 09:00-UTC-Cron probiert
        // es erneut. Ein verpasster Tag schadet bei Drip-Mails nicht,
        // und exponentielles Backoff ist hier (anders als in der
        // Outbox) Overkill, weil der nächste Versuch ohnehin erst in
        // 24 Stunden kommt.
        continue;
      }

      // Erfolg: sent_at atomar setzen. Die `is("sent_at", null)`-Guard
      // verhindert, dass ein paralleler Cron-Lauf (z. B. manueller
      // Test während der reguläre Cron auch gerade dran ist) die Row
      // ein zweites Mal als "frisch versendet" markiert. Bei Race-
      // Loss werden 0 Rows aktualisiert — wir loggen das, aber es
      // ist kein Fehler, weil Resend die Mail trotzdem akzeptiert
      // hat und die Row bereits `sent_at` aus dem ersten Lauf hat.
      const sentAt = new Date().toISOString();
      const { data: updRows, error: updErr } = await admin
        .from("email_drip_schedule")
        .update({ sent_at: sentAt })
        .eq("id", raw.id)
        .is("sent_at", null)
        .select("id");

      if (updErr) {
        failed += 1;
        // eslint-disable-next-line no-console
        console.error("[cron/drip] mark-sent FAILED — Resend accepted but DB write failed:", {
          id: raw.id,
          to: raw.email,
          messageId: data?.id ?? null,
          err: updErr.message,
        });
        // Achtung: Mail ist raus, DB sagt aber noch NULL. Beim nächsten
        // Cron würde sie nochmal versendet werden = Duplikat. Da der
        // DB-Hiccup nahezu ausgeschlossen sein sollte (gleiche Connection,
        // die das SELECT eben bedient hat), ist das ein vertretbares
        // Risiko gegenüber komplexerem Locking — und für Onboarding-
        // Drips ist ein Duplikat klar besser als ein verschwiegener
        // Sendefehler.
        continue;
      }

      sent += 1;
      // eslint-disable-next-line no-console
      console.log("[cron/drip] sent:", {
        id: raw.id,
        to: raw.email,
        type: raw.email_type,
        messageId: data?.id ?? null,
        raceLoss: !updRows || updRows.length === 0,
      });
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error("[cron/drip] unexpected:", {
        id: raw.id,
        to: raw.email,
        type: raw.email_type,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("[cron/drip] done:", { sent, failed, total: due.length });

  return NextResponse.json({ ok: true, sent, failed });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
