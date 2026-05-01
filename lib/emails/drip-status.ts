// Helpers für das Operator-Dashboard /admin/drip — Statusableitung
// und Counter-Bucketing aus den `email_drip_schedule`-Rohzeilen.
//
// Warum hier (in lib/emails) und nicht inline in der Page?
//   1. Pure Funktionen, die unabhängig vom DB-Client sind — lassen
//      sich in tests/unit ohne Supabase-Mock testen.
//   2. Sowohl die Server-Komponente (für die Counter-Karten) als auch
//      die Client-Tabelle (für das Status-Badge in jeder Zeile) brauchen
//      genau dieselbe Klassifikation. Doppelt implementieren wäre eine
//      perfekte Quelle für "Counter sagt 3 failed, Tabelle zeigt 4".
//
// Wichtig: das Schema in 20260501_add_email_drip_schedule.sql trackt
// keinen expliziten Failure-Zustand — der Drip-Cron lässt fehlgeschlagene
// Rows einfach mit `sent_at IS NULL` stehen und versucht es täglich
// erneut. Wir leiten "failed" daher aus der Heuristik ab: alles, was
// merklich überfällig ist (scheduled_at < now - FAILED_GRACE_HOURS)
// und immer noch nicht versendet, hat höchstwahrscheinlich beim
// letzten Cron-Lauf einen Resend-Fehler gezogen. Diese Heuristik
// reicht für Triage ("welche Rows muss ich anschauen?"), und der
// Operator kann via "jetzt sofort senden" die echte Resend-Antwort
// erzwingen, falls die Ursache extern behoben ist.

export type DripStatus =
  | "sent"
  | "due_today"
  | "due_tomorrow"
  | "due_this_week"
  | "scheduled_later"
  | "failed";

/**
 * Karenzzeit nach `scheduled_at`, bevor eine noch nicht versendete Row
 * als "failed" markiert wird. Großzügig (24h), weil der Drip-Cron nur
 * einmal täglich um 09:00 UTC läuft: eine Row, deren scheduled_at z. B.
 * heute 11:00 UTC ist, hat den heutigen Cron-Tick bereits verpasst und
 * wird erst morgen 09:00 versucht — das ist normal, kein Failure.
 */
export const FAILED_GRACE_HOURS = 24;

export interface DripScheduleRow {
  id: string;
  email: string;
  first_name: string | null;
  tier: string;
  email_type: string;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
}

export interface DripCounts {
  dueToday: number;
  dueTomorrow: number;
  dueThisWeek: number;
  sentTotal: number;
  sentLast7Days: number;
  failed: number;
}

function startOfDayUtc(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

/**
 * Zeit-Grenzen, die sowohl die in-memory Klassifikation (classifyRow /
 * computeDripCounts, für Tests + Per-Row-Badges) als auch die SQL-
 * Filter in der Page-Komponente (für die echten DB-Aggregat-Counts)
 * teilen. Eine einzelne Quelle der Wahrheit, damit "Heute fällig" im
 * Counter (SQL) und im Status-Badge (TS) garantiert dieselbe Zeile
 * bedeuten.
 *
 * Alle Werte als ISO-Strings, weil Supabase-Filter Strings erwarten
 * und wir sonst pro Aufruf `.toISOString()` rufen müssten.
 */
export interface DripBucketWindows {
  nowIso: string;
  todayStartIso: string;
  tomorrowStartIso: string;
  dayAfterTomorrowStartIso: string;
  weekFromNowIso: string;
  sevenDaysAgoIso: string;
  /** scheduled_at vor diesem Zeitpunkt + sent_at IS NULL → "failed". */
  failedThresholdIso: string;
}

export function dripBucketWindows(now: Date): DripBucketWindows {
  const todayStart = startOfDayUtc(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayAfterTomorrowStart = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const failedThreshold = new Date(now.getTime() - FAILED_GRACE_HOURS * 60 * 60 * 1000);
  return {
    nowIso: now.toISOString(),
    todayStartIso: todayStart.toISOString(),
    tomorrowStartIso: tomorrowStart.toISOString(),
    dayAfterTomorrowStartIso: dayAfterTomorrowStart.toISOString(),
    weekFromNowIso: weekFromNow.toISOString(),
    sevenDaysAgoIso: sevenDaysAgo.toISOString(),
    failedThresholdIso: failedThreshold.toISOString(),
  };
}

/**
 * Klassifiziert eine einzelne Row in einen Status-Bucket.
 *
 * Reihenfolge ist wichtig:
 *   1. `sent_at` gesetzt → "sent" (terminal, keine weiteren Buckets).
 *   2. überfällig > FAILED_GRACE_HOURS → "failed" (Triage-Bucket).
 *   3. fällig heute / morgen / diese Woche / später → reine Kalender-
 *      Logik gegen `scheduled_at`. "Diese Woche" meint die nächsten
 *      7 Tage ab now, NICHT die ISO-Kalenderwoche — Operatoren wollen
 *      "was kommt in den nächsten 7 Tagen?", nicht "was steht zwischen
 *      Montag und Sonntag dieser Woche?".
 */
export function classifyRow(row: DripScheduleRow, now: Date): DripStatus {
  if (row.sent_at) return "sent";
  const scheduled = new Date(row.scheduled_at);
  const overdueMs = now.getTime() - scheduled.getTime();
  const graceMs = FAILED_GRACE_HOURS * 60 * 60 * 1000;
  if (overdueMs > graceMs) return "failed";

  const todayStart = startOfDayUtc(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayAfterTomorrowStart = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (scheduled < tomorrowStart) return "due_today";
  if (scheduled < dayAfterTomorrowStart) return "due_tomorrow";
  if (scheduled < weekFromNow) return "due_this_week";
  return "scheduled_later";
}

/**
 * Aggregiert Counts über alle Rows. `sentLast7Days` zählt Rows, deren
 * `sent_at` in den letzten 7 Tagen liegt — getrennt von `sentTotal`,
 * damit der Operator schnell sieht, ob die Pipeline aktuell läuft (vs.
 * "hat irgendwann mal etwas versendet").
 */
export function computeDripCounts(rows: DripScheduleRow[], now: Date): DripCounts {
  const counts: DripCounts = {
    dueToday: 0,
    dueTomorrow: 0,
    dueThisWeek: 0,
    sentTotal: 0,
    sentLast7Days: 0,
    failed: 0,
  };
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const row of rows) {
    if (row.sent_at) {
      counts.sentTotal += 1;
      const sentAt = new Date(row.sent_at);
      if (sentAt >= sevenDaysAgo) counts.sentLast7Days += 1;
      continue;
    }
    const status = classifyRow(row, now);
    if (status === "due_today") counts.dueToday += 1;
    else if (status === "due_tomorrow") counts.dueTomorrow += 1;
    else if (status === "due_this_week") counts.dueThisWeek += 1;
    else if (status === "failed") counts.failed += 1;
    // "scheduled_later" wird absichtlich nicht in einen Counter
    // eingerechnet — die Karten zeigen nur die operativ relevanten
    // Buckets. Spätere Termine sind in der Tabelle sichtbar.
  }
  return counts;
}

/**
 * Menschenlesbares deutsches Label für einen Status — wird im
 * Status-Badge der Tabelle und in den Counter-Überschriften verwendet.
 */
export function statusLabel(status: DripStatus): string {
  switch (status) {
    case "sent":
      return "Versendet";
    case "due_today":
      return "Heute fällig";
    case "due_tomorrow":
      return "Morgen fällig";
    case "due_this_week":
      return "Diese Woche";
    case "scheduled_later":
      return "Später geplant";
    case "failed":
      return "Fehlgeschlagen";
  }
}

/**
 * Hintergrund-/Text-Farben für das Status-Badge. Bewusst inline-
 * Styles statt Tailwind / CSS-Modules, damit die Admin-Page keinen
 * zusätzlichen Build-Overhead hat (gleiches Muster wie BuyersTables).
 */
export function statusColors(status: DripStatus): { bg: string; fg: string } {
  switch (status) {
    case "sent":
      return { bg: "#e6f4ea", fg: "#1e7c3a" };
    case "due_today":
      return { bg: "#fff4e0", fg: "#a85a00" };
    case "due_tomorrow":
      return { bg: "#fff9db", fg: "#8a6d00" };
    case "due_this_week":
      return { bg: "#eef2ff", fg: "#3045a8" };
    case "scheduled_later":
      return { bg: "#f0f0f0", fg: "#555" };
    case "failed":
      return { bg: "#fde7e7", fg: "#a4271c" };
  }
}
