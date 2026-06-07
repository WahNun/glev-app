import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAnyAuthed } from "@/lib/adminAuth";
import { loginAction } from "./actions";
import AdminLoginForm from "../_components/AdminLoginForm";
import {
  aggregateDripStats,
  aggregateDailyDripSeries,
  DAILY_SERIES_DEFAULT_DAYS,
  formatRate,
  formatCtr,
  DRIP_TYPE_LABEL,
  type SentRow,
  type UnsubRow,
} from "@/lib/emails/drip-stats";
import { DailySparkClient } from "./DailySparkClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal admin view for the onboarding drip series (Tag 7/14/30).
 *
 * Why this page exists (Task #163):
 *   Task #161 added a footer unsubscribe link and an audit table,
 *   email_drip_unsubscribes. Until now nobody could *see* those rows —
 *   if we accidentally made the Tag-14 mail too pushy and 8% started
 *   opting out, we'd only learn about it the next time someone happened
 *   to query the DB by hand. This page surfaces sent + opt-out counts
 *   per drip type, plus 7-day and 30-day windows so spikes are visible.
 *
 * Auth: same cookie as /admin/buyers (the cookie is scoped to "/glev-ops"),
 * so logging in once gives access to both pages. We import isAdminAuthed
 * directly from the buyers actions module to avoid duplicating the
 * timing-safe-compare helper.
 *
 * Data fetching strategy:
 *   We pull *all* sent rows + *all* unsubscribes into memory and
 *   aggregate in JS rather than issuing per-bucket COUNT queries. The
 *   drip volume here is a small startup's onboarding series (~3 rows
 *   per buyer), not millions. Doing it in memory keeps the SQL trivial
 *   and lets the aggregation logic live in a pure, unit-tested helper
 *   (lib/emails/drip-stats.ts).
 *
 *   Both fetches carry a defensive `LIMIT` cap. If we hit it we surface
 *   a banner so an operator knows the numbers may be undercounting and
 *   can ask an engineer to bump the limit / move to RPC aggregation.
 */

const ROW_LIMIT = 50000;

export default async function AdminDripStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authed = await isAnyAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err = errParam === "bad" ? "Login fehlgeschlagen." : null;
    return <AdminLoginForm action={loginAction} title="Drip-Statistik" error={err} />;
  }
  const sb = getSupabaseAdmin();

  // Two parallel fetches. Filtering `sent_at IS NOT NULL` server-side
  // matches the partial index on email_drip_schedule and keeps the
  // payload focused on "actually sent" mail. The aggregator tolerates
  // null sent_at defensively if the filter ever changes.
  // clicked_at is fetched alongside so the aggregator can compute CTR
  // without a second round-trip.
  const [sentRes, unsubRes] = await Promise.all([
    sb
      .from("email_drip_schedule")
      .select("email, email_type, sent_at, clicked_at")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(ROW_LIMIT),
    sb
      .from("email_drip_unsubscribes")
      .select("email, unsubscribed_at")
      .order("unsubscribed_at", { ascending: false })
      .limit(ROW_LIMIT),
  ]);

  const sentErr = sentRes.error?.message ?? null;
  const unsubErr = unsubRes.error?.message ?? null;
  const sent = (sentRes.data ?? []) as SentRow[];
  const unsubs = (unsubRes.data ?? []) as UnsubRow[];
  const truncated = sent.length === ROW_LIMIT || unsubs.length === ROW_LIMIT;

  const stats = aggregateDripStats(sent, unsubs);
  const series = aggregateDailyDripSeries(sent, unsubs);
  const totalUnsubs = unsubs.length;

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>
        Glev Support — Drip-Statistik
      </h1>

      <p style={{ color: "#555", margin: "0 0 16px", fontSize: 14 }}>
        Zeigt pro Drip-Mail an, wie viele tatsächlich versendet wurden und wie viele
        Empfänger:innen sich danach abgemeldet haben (Footer-Link aus Task #161). Die
        Quote bezieht sich auf Abmeldungen, deren Zeitstempel <em>nach</em> dem Versand
        der jeweiligen Mail liegt.
      </p>

      {sentErr ? <p style={errStyle}>email_drip_schedule DB-Fehler: {sentErr}</p> : null}
      {unsubErr ? <p style={errStyle}>email_drip_unsubscribes DB-Fehler: {unsubErr}</p> : null}
      {truncated ? (
        <p style={warnStyle}>
          Hinweis: Es wurden {ROW_LIMIT.toLocaleString("de-DE")} Zeilen geladen — das
          Limit wurde erreicht. Die Zahlen können älteren Versand untertreiben.
        </p>
      ) : null}

      <section style={{ marginBottom: 24 }}>
        <h2 style={sectionHeadingStyle}>Pro Drip-Mail</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Drip-Mail</th>
                <th style={thNumStyle}>Versendet</th>
                <th style={{...thNumStyle, color: "#1a73e8"}}>Geklickt</th>
                <th style={{...thNumStyle, color: "#1a73e8"}}>CTR</th>
                <th style={thNumStyle}>Abgemeldet</th>
                <th style={thNumStyle}>Abmeld.-Quote</th>
                <th style={thNumStyle}>7T versendet</th>
                <th style={{...thNumStyle, color: "#1a73e8"}}>7T CTR</th>
                <th style={thNumStyle}>30T versendet</th>
                <th style={{...thNumStyle, color: "#1a73e8"}}>30T CTR</th>
                <th style={thChartStyle}>
                  Verlauf ({DAILY_SERIES_DEFAULT_DAYS}T)
                  <SparkLegend />
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.type}>
                  <td style={tdStyle}>{DRIP_TYPE_LABEL[s.type]}</td>
                  <td style={tdNumStyle}>{s.total.sent.toLocaleString("de-DE")}</td>
                  <td style={{...tdNumStyle, color: s.total.clicked > 0 ? "#1a73e8" : "#999"}}>
                    {s.total.clicked.toLocaleString("de-DE")}
                  </td>
                  <td style={{...tdNumStyle, fontWeight: 600, color: s.total.clicked > 0 ? "#1a73e8" : "#999"}}>
                    {formatCtr(s.total.sent, s.total.clicked)}
                  </td>
                  <td style={tdNumStyle}>
                    {s.total.unsubscribed.toLocaleString("de-DE")}
                  </td>
                  <td style={tdNumStyle}>
                    {formatRate(s.total.sent, s.total.unsubscribed)}
                  </td>
                  <td style={tdNumStyle}>{s.last7d.sent.toLocaleString("de-DE")}</td>
                  <td style={{...tdNumStyle, color: s.last7d.clicked > 0 ? "#1a73e8" : "#999"}}>
                    {formatCtr(s.last7d.sent, s.last7d.clicked)}
                  </td>
                  <td style={tdNumStyle}>{s.last30d.sent.toLocaleString("de-DE")}</td>
                  <td style={{...tdNumStyle, color: s.last30d.clicked > 0 ? "#1a73e8" : "#999"}}>
                    {formatCtr(s.last30d.sent, s.last30d.clicked)}
                  </td>
                  <td style={tdChartStyle}>
                    <DailySparkClient
                      buckets={series[s.type]}
                      label={DRIP_TYPE_LABEL[s.type]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={sectionHeadingStyle}>Übersicht</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "#333" }}>
          <li>
            Drip-Mails versendet (gesamt):{" "}
            <strong>{sent.length.toLocaleString("de-DE")}</strong>
          </li>
          <li>
            Eindeutige Abmeldungen in <code>email_drip_unsubscribes</code>:{" "}
            <strong>{totalUnsubs.toLocaleString("de-DE")}</strong>
          </li>
        </ul>
      </section>
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

const warnStyle: React.CSSProperties = {
  color: "#8a6d00",
  background: "#fff8e1",
  border: "1px solid #ffe082",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: 14,
  margin: "0 0 12px",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 16,
  margin: "0 0 8px",
  color: "#111",
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontSize: 14,
  background: "#fff",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "2px solid #222",
  background: "#f5f5f5",
  fontWeight: 600,
};

const thNumStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "right",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #eee",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const thChartStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdChartStyle: React.CSSProperties = {
  ...tdStyle,
  // Vertically center the SVG against the numeric cells in the same row.
  verticalAlign: "middle",
};

/** Small inline legend that tells the operator what the bar colors mean. */
function SparkLegend() {
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 10,
        marginLeft: 10,
        fontWeight: 400,
        color: "#555",
        fontSize: 13,
        verticalAlign: "middle",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            background: "#9aa0a6",
          }}
        />
        Versendet
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            background: "#c0392b",
          }}
        />
        Abgemeldet
      </span>
    </span>
  );
}
