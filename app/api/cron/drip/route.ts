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

// ---- Re-Engagement Auto-Scheduler -----------------------------------------
//
// Läuft einmal pro Cron-Aufruf (vor der eigentlichen Send-Queue).
// Sucht Trial-User, die seit ≥48h nicht mehr aktiv waren, und planted
// eine re_engagement-Row in email_drip_schedule — falls noch keine
// existiert. Der normale Send-Loop verschickt sie dann im selben Lauf.
//
// Bedingungen:
//   - profiles.trial_end_at IS NOT NULL (Trial-User)
//   - profiles.trial_end_at > NOW() (Trial noch aktiv)
//   - profiles.last_seen_at < NOW() - 48h ODER last_seen_at IS NULL
//   - Kein existierender re_engagement-Eintrag für diese E-Mail-Adresse

async function scheduleReEngagementBatch(
  admin: ReturnType<typeof getSupabaseAdmin>,
): Promise<number> {
  const now = new Date();
  const fortyEightHoursAgo = new Date(
    now.getTime() - 48 * 60 * 60 * 1000,
  ).toISOString();

  const { data: inactiveProfiles, error: profileErr } = await admin
    .from("profiles")
    .select("user_id, language")
    .not("trial_end_at", "is", null)
    .gt("trial_end_at", now.toISOString())
    .or(`last_seen_at.is.null,last_seen_at.lt.${fortyEightHoursAgo}`);

  if (profileErr || !inactiveProfiles || inactiveProfiles.length === 0) {
    return 0;
  }

  // Auth-User-Daten holen (E-Mail + Name)
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userMap = new Map(
    (authData?.users ?? []).map((u) => [u.id, u]),
  );

  let scheduled = 0;
  for (const profile of inactiveProfiles) {
    const user = userMap.get(profile.user_id as string);
    if (!user?.email) continue;

    // Bereits geplant?
    const { data: existing } = await admin
      .from("email_drip_schedule")
      .select("id")
      .eq("email", user.email)
      .eq("email_type", "re_engagement")
      .maybeSingle();

    if (existing) continue;

    const firstName =
      (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
      null;
    const locale = (profile.language as string) === "en" ? "en" : "de";

    const { error: insertErr } = await admin
      .from("email_drip_schedule")
      .insert({
        email: user.email,
        first_name: firstName,
        tier: "free_trial",
        email_type: "re_engagement",
        scheduled_at: now.toISOString(),
        locale,
      });

    if (!insertErr) scheduled++;
  }

  return scheduled;
}

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

/**
 * Maximale Zeichenlänge für `last_error` in der DB. Resend-Fehlertexte
 * sind kurz, aber wir kürzen sicherheitshalber ab, damit kein
 * überlanges Stacktrace die Spalte sprengt.
 */
const MAX_ERROR_LENGTH = 500;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

interface DripRow {
  id: string;
  email: string;
  first_name: string | null;
  email_type: DripEmailType;
  locale: "de" | "en" | null;
  attempt_count: number;
}

/** Kürzt einen Fehlertext auf MAX_ERROR_LENGTH Zeichen. */
function truncateError(msg: string): string {
  return msg.length > MAX_ERROR_LENGTH ? msg.slice(0, MAX_ERROR_LENGTH - 1) + "…" : msg;
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

  // 0. Re-Engagement: inaktive Trial-User erkennen und planen.
  const reEngagementScheduled = await scheduleReEngagementBatch(admin);
  if (reEngagementScheduled > 0) {
    // eslint-disable-next-line no-console
    console.log("[cron/drip] re-engagement scheduled:", { count: reEngagementScheduled });
  }

  // 1. Fällige, noch nicht versendete Rows holen, älteste zuerst.
  //    Wir holen auch last_error IS NOT NULL Rows (stuck/failed) —
  //    der Cron versucht sie täglich erneut. Wenn Resend den Grund
  //    (z. B. ungültige Domain) extern behebt, soll der nächste Lauf
  //    die Mail trotzdem losschicken.
  const { data: due, error: selectErr } = await admin
    .from("email_drip_schedule")
    .select("id, email, first_name, email_type, locale, attempt_count")
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

  // 2. Abgemeldete Adressen aus dem Batch herausfiltern. Wir holen
  //    gezielt nur die Unsubscribes für die Adressen, die in diesem
  //    Batch vorkommen — das hält die Query klein, auch wenn die
  //    Unsubscribe-Tabelle irgendwann tausend Einträge hat.
  const batchEmails = Array.from(new Set((due as DripRow[]).map((r) => r.email)));
  const { data: unsubs, error: unsubErr } = await admin
    .from("email_drip_unsubscribes")
    .select("email")
    .in("email", batchEmails);

  if (unsubErr) {
    // eslint-disable-next-line no-console
    console.error("[cron/drip] unsubscribes lookup failed:", unsubErr);
    return NextResponse.json(
      { error: `unsubscribes lookup failed: ${unsubErr.message}` },
      { status: 500 },
    );
  }

  const unsubscribed = new Set((unsubs ?? []).map((u) => u.email as string));

  // Abgemeldete Schedule-Rows räumen wir gleich mit auf: einmal als
  // "sent" markieren, dann übergeht das nächste SELECT sie automatisch.
  // Ohne diesen Schritt würde der Cron sie jeden Tag erneut aus der DB
  // holen, nur um sie wieder zu überspringen — verschwendete Round-Trips.
  const skippedIds = (due as DripRow[])
    .filter((r) => unsubscribed.has(r.email))
    .map((r) => r.id);

  let skipped = 0;
  if (skippedIds.length > 0) {
    const { error: skipErr } = await admin
      .from("email_drip_schedule")
      .update({ sent_at: new Date().toISOString() })
      .in("id", skippedIds)
      .is("sent_at", null);
    if (skipErr) {
      // eslint-disable-next-line no-console
      console.error("[cron/drip] skip-mark failed (will retry tomorrow):", skipErr);
    } else {
      skipped = skippedIds.length;
      // eslint-disable-next-line no-console
      console.log("[cron/drip] skipped unsubscribed:", { count: skipped });
    }
  }

  const sendable = (due as DripRow[]).filter((r) => !unsubscribed.has(r.email));

  let sent = 0;
  let failed = 0;
  const resend = getDripResend();

  for (const raw of sendable) {
    const attemptAt = new Date().toISOString();
    try {
      // Locale defaults to 'de' for rows scheduled before the column
      // existed (NULL in DB) — those buyers were on the EUR/German flow
      // by definition, so the German renderer is the correct fallback.
      const locale = raw.locale === "en" ? "en" : "de";
      const rendered = renderDripEmail(
        raw.email_type,
        raw.first_name,
        raw.email,
        locale,
        raw.id,
      );
      const { data, error } = await resend.emails.send({
        from: rendered.from,
        to: raw.email,
        subject: rendered.subject,
        html: rendered.html,
      });

      if (error) {
        failed += 1;
        const errText = truncateError(
          `${error.name ?? "ResendError"}: ${error.message ?? "unknown"}`,
        );
        // eslint-disable-next-line no-console
        console.error("[cron/drip] resend error:", {
          id: raw.id,
          to: raw.email,
          type: raw.email_type,
          err: errText,
        });
        // Fehler in DB persistieren — Dashboard kann jetzt den echten
        // Grund anzeigen, ohne dass Lucas die Logs durchsuchen muss.
        await admin
          .from("email_drip_schedule")
          .update({
            last_attempt_at: attemptAt,
            last_error: errText,
            attempt_count: (raw.attempt_count ?? 0) + 1,
          })
          .eq("id", raw.id)
          .is("sent_at", null);
        continue;
      }

      // Erfolg: sent_at setzen und last_error aufräumen (falls ein
      // vorheriger Versuch gescheitert war). Die `is("sent_at", null)`-
      // Guard verhindert Race-Loss-Doppel-Markierungen.
      const sentAt = new Date().toISOString();
      const { data: updRows, error: updErr } = await admin
        .from("email_drip_schedule")
        .update({ sent_at: sentAt, last_error: null, last_attempt_at: attemptAt })
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
      const errText = truncateError(
        err instanceof Error ? err.message : String(err),
      );
      // eslint-disable-next-line no-console
      console.error("[cron/drip] unexpected:", {
        id: raw.id,
        to: raw.email,
        type: raw.email_type,
        err: errText,
      });
      // Auch unerwartete Exceptions in DB schreiben.
      await admin
        .from("email_drip_schedule")
        .update({
          last_attempt_at: attemptAt,
          last_error: truncateError(`Unexpected: ${errText}`),
          attempt_count: (raw.attempt_count ?? 0) + 1,
        })
        .eq("id", raw.id)
        .is("sent_at", null);
    }
  }

  // eslint-disable-next-line no-console
  console.log("[cron/drip] done:", { sent, failed, skipped, total: due.length });

  return NextResponse.json({ ok: true, sent, failed, skipped });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
