import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  dripBucketWindows,
  type DripCounts,
  type DripScheduleRow,
} from "@/lib/emails/drip-status";
import { isAdminAuthed, loginAction } from "./actions";
import DripDashboard from "./DripDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-Dashboard für die Drip-Mail-Pipeline (Task #162).
 *
 * Zweck: Lucas (und jede:r andere mit dem ADMIN_API_SECRET) soll
 * ohne SQL gegen `email_drip_schedule` sehen können, was läuft —
 * wie viele Tag-7/14/30-Mails morgen rausgehen, welche in den letzten
 * 7 Tagen fehlgeschlagen sind, und ob für eine bestimmte Mail-Adresse
 * tatsächlich die drei Touches eingeplant sind.
 *
 * Datenmodell-Hintergrund:
 *   `email_drip_schedule` (Migration 20260501_add_email_drip_schedule.sql)
 *   trackt KEINEN expliziten Failure-Zustand — der Drip-Cron in
 *   app/api/cron/drip/route.ts lässt fehlgeschlagene Rows mit
 *   `sent_at IS NULL` stehen und probiert beim nächsten 09:00-UTC-Tick
 *   erneut. "Failed" leiten wir daher heuristisch aus "überfällig
 *   > 24 h und immer noch nicht versendet" ab (siehe
 *   lib/emails/drip-status.ts → FAILED_GRACE_HOURS).
 *
 * Auth:
 *   Bearer-Token-Cookie `glev_admin_token` mit `path: "/admin"` —
 *   identisches Muster zu /admin/buyers, der Cookie wird sogar
 *   geteilt (wer dort eingeloggt ist, ist hier auch eingeloggt).
 *
 * Manuelle Aktionen:
 *   "Sofort senden" / "Neu planen" / "Abbrechen" sind als Server
 *   Actions in actions.ts implementiert. Jede Action prüft den
 *   Auth-Cookie selbst und ruft am Ende `revalidatePath` auf.
 *
 * Fetch-Strategie:
 *   - Counter-Karten: 6 parallele HEAD-Count-Queries (`{ count: "exact",
 *     head: true }`), die ALLE Rows in der DB zählen — nicht das
 *     Tabellen-Fenster. Sonst würde ein historisch volläufiges Fenster
 *     (>300 Zeilen) die Zahlen verfälschen ("3 fehlgeschlagen", obwohl
 *     wirklich 30 stuck sind).
 *   - Tabellen-Inhalt:
 *       * Ohne Suche: die letzten LIST_LIMIT (300) Rows nach
 *         `created_at` absteigend — neuere zuerst, weil das die
 *         Default-Ansicht für Triage ist.
 *       * Mit Suche (`?q=...`): server-side `ilike("email", "%q%")`
 *         über die GESAMTE Tabelle, kein In-Memory-Filter. Damit
 *         findet die Suche auch alte versendete Drip-Termine, die
 *         längst aus dem Default-Fenster gefallen sind. Hard-Cap
 *         SEARCH_LIMIT (500) als Schutz gegen versehentliche
 *         Substring-Treffer ("@" matcht alles).
 */

const LIST_LIMIT = 300;
const SEARCH_LIMIT = 500;

interface DripPageData {
  counts: DripCounts;
  rows: DripScheduleRow[];
  truncated: boolean;
  fetchErrors: string[];
}

async function loadDripData(now: Date, query: string): Promise<DripPageData> {
  const sb = getSupabaseAdmin();
  const w = dripBucketWindows(now);

  // 6 parallele Aggregat-Queries. Jede liefert nur einen Count, kein
  // Row-Payload — das skaliert auch bei sechsstelligen Drip-Volumina,
  // weil Postgres die WHERE-Clauses über Indexe (insbesondere den
  // partial index `email_drip_schedule_pending_idx`) ausführt.
  //
  // Wichtig: die Filter müssen 1:1 zu classifyRow() in
  // lib/emails/drip-status.ts passen — sonst widerspricht das Per-
  // Row-Status-Badge in der Tabelle dem Counter darüber.
  const dueTodayP = sb
    .from("email_drip_schedule")
    .select("id", { count: "exact", head: true })
    .is("sent_at", null)
    .gte("scheduled_at", w.failedThresholdIso) // Failed-Grace ausschließen
    .lt("scheduled_at", w.tomorrowStartIso);
  const dueTomorrowP = sb
    .from("email_drip_schedule")
    .select("id", { count: "exact", head: true })
    .is("sent_at", null)
    .gte("scheduled_at", w.tomorrowStartIso)
    .lt("scheduled_at", w.dayAfterTomorrowStartIso);
  const dueThisWeekP = sb
    .from("email_drip_schedule")
    .select("id", { count: "exact", head: true })
    .is("sent_at", null)
    .gte("scheduled_at", w.dayAfterTomorrowStartIso)
    .lt("scheduled_at", w.weekFromNowIso);
  const sentTotalP = sb
    .from("email_drip_schedule")
    .select("id", { count: "exact", head: true })
    .not("sent_at", "is", null);
  const sentLast7P = sb
    .from("email_drip_schedule")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", w.sevenDaysAgoIso);
  const failedP = sb
    .from("email_drip_schedule")
    .select("id", { count: "exact", head: true })
    .is("sent_at", null)
    .lt("scheduled_at", w.failedThresholdIso);

  // Tabellen-Inhalt — getrennter Pfad für Default vs. Suche.
  const trimmedQ = query.trim();
  const listP = trimmedQ
    ? sb
        .from("email_drip_schedule")
        .select("id, email, first_name, tier, email_type, scheduled_at, sent_at, created_at")
        // Suche per ILIKE auf email — Substring, case-insensitive,
        // damit sowohl "alice@example.com" als auch "alice" und
        // "@example.com" zum gewünschten Treffer führen. % am Anfang
        // verhindert Index-Nutzung, ist aber bei der erwarteten
        // Tabellen-Größe vertretbar.
        .ilike("email", `%${trimmedQ}%`)
        .order("scheduled_at", { ascending: false })
        .limit(SEARCH_LIMIT)
    : sb
        .from("email_drip_schedule")
        .select("id, email, first_name, tier, email_type, scheduled_at, sent_at, created_at")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);

  const [
    dueTodayR,
    dueTomorrowR,
    dueThisWeekR,
    sentTotalR,
    sentLast7R,
    failedR,
    listR,
  ] = await Promise.all([
    dueTodayP,
    dueTomorrowP,
    dueThisWeekP,
    sentTotalP,
    sentLast7P,
    failedP,
    listP,
  ]);

  const errs: string[] = [];
  const pushErr = (label: string, err: { message: string } | null) => {
    if (err) errs.push(`${label}: ${err.message}`);
  };
  pushErr("Counts (Heute)", dueTodayR.error);
  pushErr("Counts (Morgen)", dueTomorrowR.error);
  pushErr("Counts (7 Tage)", dueThisWeekR.error);
  pushErr("Counts (versendet gesamt)", sentTotalR.error);
  pushErr("Counts (versendet 7T)", sentLast7R.error);
  pushErr("Counts (failed)", failedR.error);
  pushErr("Liste", listR.error);

  const counts: DripCounts = {
    dueToday: dueTodayR.count ?? 0,
    dueTomorrow: dueTomorrowR.count ?? 0,
    dueThisWeek: dueThisWeekR.count ?? 0,
    sentTotal: sentTotalR.count ?? 0,
    sentLast7Days: sentLast7R.count ?? 0,
    failed: failedR.count ?? 0,
  };
  const rows = (listR.data ?? []) as DripScheduleRow[];
  const limit = trimmedQ ? SEARCH_LIMIT : LIST_LIMIT;
  return { counts, rows, truncated: rows.length === limit, fetchErrors: errs };
}

export default async function AdminDripPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authed = await isAdminAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err =
      errParam === "bad"
        ? "Falsches Token."
        : errParam === "server"
          ? "ADMIN_API_SECRET ist nicht konfiguriert."
          : null;
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev Operator — Drip-Mails</h1>
        <p style={{ marginBottom: 16, color: "#555" }}>
          Internal-only. Bitte das <code>ADMIN_API_SECRET</code> einfügen, um die Drip-
          Pipeline einzusehen.
        </p>
        <form
          action={loginAction}
          style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}
        >
          <input
            type="password"
            name="token"
            autoComplete="off"
            required
            placeholder="ADMIN_API_SECRET"
            style={inputStyle}
          />
          <button type="submit" style={btnStyle}>
            Einloggen
          </button>
          {err ? <span style={{ color: "#c00", fontSize: 14 }}>{err}</span> : null}
        </form>
      </main>
    );
  }

  const qParam = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const query = (qParam ?? "").toString();

  // `now` EINMAL pro Render festnageln und an alles weiterreichen:
  // - die SQL-Counter in loadDripData (Bucket-Grenzen),
  // - die Status-Badges in der Tabelle (per `nowIso` an den Client).
  // Würden wir hier bzw. dort separat `new Date()` rufen, könnten an
  // den Bucket-Grenzen (z. B. exakt um Mitternacht UTC oder beim
  // 24h-Failed-Schwellwert) Counter und Badges ein Row anders
  // klassifizieren als die andere Stelle.
  const now = new Date();
  const { counts, rows, truncated, fetchErrors } = await loadDripData(now, query);

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>
        Glev Operator — Drip-Mails
      </h1>

      {fetchErrors.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          {fetchErrors.map((e, i) => (
            <p key={i} style={errStyle}>
              DB-Fehler — {e}
            </p>
          ))}
        </div>
      ) : null}

      <DripDashboard
        counts={counts}
        rows={rows}
        searchLimit={SEARCH_LIMIT}
        listLimit={LIST_LIMIT}
        truncated={truncated}
        nowIso={now.toISOString()}
        query={query}
      />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1200,
  margin: "0 auto",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const errStyle: React.CSSProperties = {
  color: "#c00",
  fontSize: 13,
  margin: "0 0 8px",
};
