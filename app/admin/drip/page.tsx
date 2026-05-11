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

/**
 * Status-Quick-Filter, identisch zu den Counter-Karten oben. Wird als
 * `?status=...`-Param vom Dashboard gesetzt (Klick auf Counter-Karte
 * oder Dropdown-Auswahl). "all" = kein Filter, Tabelle zeigt alles.
 *
 * Übersetzung in WHERE-Clauses passiert in `applyStatusFilter()` —
 * dort 1:1 dieselbe Logik wie classifyRow() in drip-status.ts, damit
 * die gefilterten Zeilen das passende Status-Badge tragen.
 */
export type DripStatusFilter =
  | "all"
  | "pending"
  | "due_today"
  | "due_tomorrow"
  | "due_this_week"
  | "failed"
  | "sent";

const STATUS_VALUES: DripStatusFilter[] = [
  "all",
  "pending",
  "due_today",
  "due_tomorrow",
  "due_this_week",
  "failed",
  "sent",
];

const TIER_VALUES = ["all", "beta", "pro"] as const;
export type TierFilter = (typeof TIER_VALUES)[number];

const TYPE_VALUES = ["all", "day7_insights", "day14_feedback", "day30_trustpilot"] as const;
export type TypeFilter = (typeof TYPE_VALUES)[number];

export interface DripFilters {
  q: string;
  status: DripStatusFilter;
  tier: TierFilter;
  type: TypeFilter;
}

function parseStatus(v: unknown): DripStatusFilter {
  return typeof v === "string" && (STATUS_VALUES as string[]).includes(v)
    ? (v as DripStatusFilter)
    : "all";
}
function parseTier(v: unknown): TierFilter {
  return typeof v === "string" && (TIER_VALUES as readonly string[]).includes(v)
    ? (v as TierFilter)
    : "all";
}
function parseType(v: unknown): TypeFilter {
  return typeof v === "string" && (TYPE_VALUES as readonly string[]).includes(v)
    ? (v as TypeFilter)
    : "all";
}

/** Whether any filter beyond an empty query is active — used by the
 *  page to decide whether to show the "Zurücksetzen alle Filter"-Link. */
function hasActiveFilters(f: DripFilters): boolean {
  return f.q.trim() !== "" || f.status !== "all" || f.tier !== "all" || f.type !== "all";
}

async function loadDripData(now: Date, filters: DripFilters): Promise<DripPageData> {
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

  // Tabellen-Inhalt — Filter werden additiv aufgesetzt. Sobald
  // irgendein Filter aktiv ist, fahren wir das größere SEARCH_LIMIT
  // (500) statt LIST_LIMIT (300), damit eine breite Suche wie
  // "status=pending" nicht künstlich gekappt wird.
  const trimmedQ = filters.q.trim();
  const anyFilter = hasActiveFilters(filters);
  const limit = anyFilter ? SEARCH_LIMIT : LIST_LIMIT;
  // Bei aktivem Filter sortieren wir nach scheduled_at desc (relevant
  // bei Status-Suche), sonst nach created_at desc (Default: neueste
  // angelegte zuerst, wie bisher).
  const orderCol = anyFilter ? "scheduled_at" : "created_at";

  let listQ = sb
    .from("email_drip_schedule")
    .select("id, email, first_name, tier, email_type, scheduled_at, sent_at, created_at");

  if (trimmedQ) {
    // Suche per ILIKE auf email — Substring, case-insensitive,
    // damit sowohl "alice@example.com" als auch "alice" und
    // "@example.com" zum gewünschten Treffer führen.
    listQ = listQ.ilike("email", `%${trimmedQ}%`);
  }
  if (filters.tier !== "all") {
    listQ = listQ.eq("tier", filters.tier);
  }
  if (filters.type !== "all") {
    listQ = listQ.eq("email_type", filters.type);
  }
  // Status: 1:1 dieselben Bucket-Bedingungen wie die Counter oben +
  // wie classifyRow() in drip-status.ts. Sonst widerspricht das
  // Status-Badge der Tabelle dem Filter, mit dem es geladen wurde.
  switch (filters.status) {
    case "pending":
      // Wartend = noch nicht versendet UND nicht failed-grace überschritten.
      // (Inkl. heute fällig + morgen + diese Woche + weiter in der Zukunft.)
      listQ = listQ.is("sent_at", null).gte("scheduled_at", w.failedThresholdIso);
      break;
    case "due_today":
      listQ = listQ
        .is("sent_at", null)
        .gte("scheduled_at", w.failedThresholdIso)
        .lt("scheduled_at", w.tomorrowStartIso);
      break;
    case "due_tomorrow":
      listQ = listQ
        .is("sent_at", null)
        .gte("scheduled_at", w.tomorrowStartIso)
        .lt("scheduled_at", w.dayAfterTomorrowStartIso);
      break;
    case "due_this_week":
      listQ = listQ
        .is("sent_at", null)
        .gte("scheduled_at", w.dayAfterTomorrowStartIso)
        .lt("scheduled_at", w.weekFromNowIso);
      break;
    case "failed":
      listQ = listQ.is("sent_at", null).lt("scheduled_at", w.failedThresholdIso);
      break;
    case "sent":
      listQ = listQ.not("sent_at", "is", null);
      break;
    case "all":
    default:
      break;
  }

  const listP = listQ.order(orderCol, { ascending: false }).limit(limit);

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
  const statusParam = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const tierParam = Array.isArray(sp.tier) ? sp.tier[0] : sp.tier;
  const typeParam = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const filters: DripFilters = {
    q: (qParam ?? "").toString(),
    status: parseStatus(statusParam),
    tier: parseTier(tierParam),
    type: parseType(typeParam),
  };

  // `now` EINMAL pro Render festnageln und an alles weiterreichen:
  // - die SQL-Counter in loadDripData (Bucket-Grenzen),
  // - die Status-Badges in der Tabelle (per `nowIso` an den Client).
  // Würden wir hier bzw. dort separat `new Date()` rufen, könnten an
  // den Bucket-Grenzen (z. B. exakt um Mitternacht UTC oder beim
  // 24h-Failed-Schwellwert) Counter und Badges ein Row anders
  // klassifizieren als die andere Stelle.
  const now = new Date();
  const { counts, rows, truncated, fetchErrors } = await loadDripData(now, filters);

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
        filters={filters}
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
  fontSize: 14,
  margin: "0 0 8px",
};
