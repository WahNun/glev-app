"use client";

import { useMemo, useState, useTransition } from "react";

import {
  classifyRow,
  statusColors,
  statusLabel,
  type DripCounts,
  type DripScheduleRow,
  type DripStatus,
} from "@/lib/emails/drip-status";
import { sendNowAction, cancelAction, rescheduleAction } from "./actions";
import type {
  DripFilters,
  DripStatusFilter,
  TierFilter,
  TypeFilter,
} from "./page";

export type DripRow = DripScheduleRow;

type Props = {
  counts: DripCounts;
  rows: DripRow[];
  searchLimit: number;
  listLimit: number;
  truncated: boolean;
  /**
   * Wir erstellen `now` einmal in der Server-Komponente und reichen es
   * als ISO-String runger. Damit ist die Status-Klassifikation pro
   * Render deterministisch und stimmt zwischen den SQL-Counter-Karten
   * und der Tabellen-Spalte überein.
   */
  nowIso: string;
  /**
   * Aktive Filter aus der URL (?q, ?status, ?tier, ?type). Werden als
   * Default-Values für die Form-Felder benutzt und geben den
   * "Zurücksetzen"-Link Bescheid, wann er sichtbar sein soll.
   */
  filters: DripFilters;
};

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function fmtTier(t: string | null | undefined): string {
  if (t === "beta") return "Beta";
  if (t === "pro") return "Pro";
  if (t === "plus") return "Plus";
  return t ?? "—";
}

function fmtType(t: string): string {
  switch (t) {
    case "day7_insights":
      return "Tag 7 — Insights";
    case "day14_feedback":
      return "Tag 14 — Feedback";
    case "day30_trustpilot":
      return "Tag 30 — Trustpilot";
    default:
      return t;
  }
}

/** Kürzt den Fehlertext für die Tabellenzelle auf maximal CELL_MAX Zeichen. */
const CELL_MAX = 60;

function ErrorCell({ error, attemptCount }: { error: string | null; attemptCount: number }) {
  if (!error) return <span style={{ color: "#bbb", fontSize: 13 }}>—</span>;
  const truncated = error.length > CELL_MAX;
  const display = truncated ? error.slice(0, CELL_MAX - 1) + "…" : error;
  return (
    <span
      title={error}
      style={{
        display: "inline-block",
        maxWidth: 260,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
        color: "#a4271c",
        fontSize: 12,
        cursor: truncated ? "help" : "default",
        fontFamily: "monospace",
      }}
    >
      {display}
      {attemptCount > 1 && (
        <span
          style={{
            marginLeft: 6,
            fontSize: 11,
            color: "#888",
            fontFamily: "system-ui, sans-serif",
          }}
          title={`${attemptCount} Versuche insgesamt`}
        >
          ×{attemptCount}
        </span>
      )}
    </span>
  );
}

const STATUS_LABEL: Record<DripStatusFilter, string> = {
  all: "Alle Status",
  pending: "Wartend (alle offenen)",
  due_today: "Heute fällig",
  due_tomorrow: "Morgen fällig",
  due_this_week: "Nächste 7 Tage",
  failed: "Fehlgeschlagen",
  sent: "Versendet",
};

const TIER_LABEL: Record<TierFilter, string> = {
  all: "Alle Tiers",
  beta: "Beta",
  pro: "Pro",
  plus: "Plus",
};

const TYPE_LABEL: Record<TypeFilter, string> = {
  all: "Alle Typen",
  day7_insights: "Tag 7 — Insights",
  day14_feedback: "Tag 14 — Feedback",
  day30_trustpilot: "Tag 30 — Trustpilot",
};

/**
 * Browser-`datetime-local` Input erwartet "YYYY-MM-DDTHH:mm" in
 * Lokalzeit. Wir initialisieren das Feld mit dem aktuellen
 * `scheduled_at` (UTC-ISO aus der DB), umgerechnet in Lokalzeit-Slice,
 * damit der Operator nicht jedes Mal von vorn tippen muss.
 */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Build a filtered admin-drip URL preserving any non-overridden filters.
 *  Used by the clickable counter cards as quick "show me only failed"
 *  shortcuts — clicking sets just `status=`, leaves the email search and
 *  other filters intact. */
function buildHref(current: DripFilters, override: Partial<DripFilters>): string {
  const merged: DripFilters = { ...current, ...override };
  const params = new URLSearchParams();
  if (merged.q.trim()) params.set("q", merged.q.trim());
  if (merged.status !== "all") params.set("status", merged.status);
  if (merged.tier !== "all") params.set("tier", merged.tier);
  if (merged.type !== "all") params.set("type", merged.type);
  const qs = params.toString();
  return qs ? `/admin/drip?${qs}` : "/admin/drip";
}

function StatusBadge({ status }: { status: DripStatus }) {
  const c = statusColors(status);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
        whiteSpace: "nowrap",
      }}
    >
      {statusLabel(status)}
    </span>
  );
}

function CountCard({
  label,
  value,
  tone,
  href,
  active,
}: {
  label: string;
  value: number;
  tone: "default" | "warn" | "ok" | "bad";
  href: string;
  active: boolean;
}) {
  const toneColor =
    tone === "warn" ? "#a85a00" : tone === "ok" ? "#1e7c3a" : tone === "bad" ? "#a4271c" : "#111";
  return (
    <a
      href={href}
      style={{
        flex: "1 1 140px",
        minWidth: 140,
        padding: "12px 14px",
        border: active ? `2px solid ${toneColor}` : "1px solid #e5e5e5",
        borderRadius: 8,
        background: active ? "#f7f7f7" : "#fff",
        color: "inherit",
        textDecoration: "none",
        cursor: "pointer",
        display: "block",
      }}
      title={active ? "Filter aktiv — klick zum Entfernen" : "Klick zum Filtern"}
    >
      <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: toneColor }}>{value}</div>
    </a>
  );
}

export default function DripDashboard({
  counts,
  rows,
  searchLimit,
  listLimit,
  truncated,
  nowIso,
  filters,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  // Bestätigungs-Dialog für „Sofort senden". Wir wollen verhindern,
  // dass der Operator versehentlich eine echte Drip-Mail rausjagt —
  // einmal raus, kein Undo. Der Send-Button öffnet den Dialog,
  // erst „Ja, senden" feuert die Server-Action via useTransition.
  // `pendingId` lockt während der Action läuft den Button derselben
  // Zeile, damit kein Doppelklick zwei Mails verschickt.
  const [confirmRow, setConfirmRow] = useState<DripRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleConfirmSend(): void {
    const row = confirmRow;
    if (!row || pendingId) return;
    setPendingId(row.id);
    setConfirmRow(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", row.id);
        await sendNowAction(fd);
      } finally {
        setPendingId(null);
      }
    });
  }
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const anyFilter =
    filters.q.trim() !== "" ||
    filters.status !== "all" ||
    filters.tier !== "all" ||
    filters.type !== "all";

  // Counter-Karten als Quick-Filter-Shortcuts. Klick auf eine Karte
  // toggelt den passenden Status-Filter — nochmaliger Klick auf eine
  // bereits aktive Karte entfernt den Filter wieder (active → "all").
  const cardHref = (target: DripStatusFilter): string =>
    buildHref(filters, { status: filters.status === target ? "all" : target });

  return (
    <>
      <section style={{ marginBottom: 24 }}>
        <h2 style={h2Style}>Status-Übersicht</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <CountCard label="Heute fällig" value={counts.dueToday} tone="warn"
            href={cardHref("due_today")} active={filters.status === "due_today"} />
          <CountCard label="Morgen fällig" value={counts.dueTomorrow} tone="default"
            href={cardHref("due_tomorrow")} active={filters.status === "due_tomorrow"} />
          <CountCard label="Nächste 7 Tage" value={counts.dueThisWeek} tone="default"
            href={cardHref("due_this_week")} active={filters.status === "due_this_week"} />
          <CountCard label="Versendet (7 Tage)" value={counts.sentLast7Days} tone="ok"
            href={cardHref("sent")} active={filters.status === "sent"} />
          <CountCard label="Versendet (gesamt)" value={counts.sentTotal} tone="default"
            href={cardHref("sent")} active={filters.status === "sent"} />
          <CountCard label="Fehlgeschlagen" value={counts.failed} tone="bad"
            href={cardHref("failed")} active={filters.status === "failed"} />
        </div>
        <p style={{ color: "#777", fontSize: 13, margin: "8px 0 0" }}>
          Counter zählen über die gesamte Tabelle, nicht nur die unten gezeigte
          Liste. „Fehlgeschlagen" = Resend hat beim letzten Versuch einen Fehler
          zurückgegeben — der genaue Fehlertext steht in der Tabellenspalte „Letzter Fehler".
          Klick auf eine Karte filtert die Tabelle entsprechend.
        </p>
      </section>

      <section style={{ marginBottom: 16 }}>
        {/*
          Filter-Form als GET an /admin/drip?q=…&status=…&tier=…&type=… —
          Server-Komponente liest die Params und baut die DB-Query mit
          additiven WHERE-Clauses zusammen. Sobald irgendein Filter aktiv
          ist, fahren wir mit dem größeren SEARCH_LIMIT statt LIST_LIMIT.
          Reset löscht alle Filter.
        */}
        <form
          method="get"
          action="/admin/drip"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Suche nach Email-Adresse…"
            aria-label="Drip-Termine suchen"
            style={searchStyle}
          />
          <select name="status" defaultValue={filters.status} style={selectStyle} aria-label="Status">
            {(Object.keys(STATUS_LABEL) as DripStatusFilter[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <select name="tier" defaultValue={filters.tier} style={selectStyle} aria-label="Tier">
            {(Object.keys(TIER_LABEL) as TierFilter[]).map((t) => (
              <option key={t} value={t}>{TIER_LABEL[t]}</option>
            ))}
          </select>
          <select name="type" defaultValue={filters.type} style={selectStyle} aria-label="Mail-Typ">
            {(Object.keys(TYPE_LABEL) as TypeFilter[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
          <button type="submit" style={smallBtnStyle}>
            Filtern
          </button>
          {anyFilter ? (
            <a href="/admin/drip" style={{ fontSize: 14, color: "#3045a8", textDecoration: "underline" }}>
              Alle Filter zurücksetzen
            </a>
          ) : null}
        </form>
      </section>

      <section>
        <h2 style={h2Style}>
          Drip-Termine{" "}
          <span style={countStyle}>
            ({rows.length}
            {!anyFilter && truncated ? ` — neueste ${listLimit} angezeigt` : ""}
            {anyFilter && truncated ? ` — gekappt bei ${searchLimit}` : ""}
            {anyFilter ? ` mit aktiven Filtern` : ""})
          </span>
        </h2>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Tier</th>
                <th style={thStyle}>Typ</th>
                <th style={thStyle}>Geplant</th>
                <th style={thStyle}>Versendet</th>
                <th style={{ ...thStyle, minWidth: 160 }}>
                  Letzter Fehler
                  <span
                    title="Resend-Fehlertext des letzten fehlgeschlagenen Versuchs. Hover für vollständigen Text. ×N = Anzahl Versuche."
                    style={{ marginLeft: 4, cursor: "help", color: "#888", fontWeight: 400 }}
                  >
                    ⓘ
                  </span>
                </th>
                <th style={thStyle}>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    {anyFilter ? "Keine Treffer." : "Keine Drip-Termine."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const status = classifyRow(r, now);
                  const editing = editingId === r.id;
                  const canAct = !r.sent_at;
                  return (
                    <tr key={r.id}>
                      <td style={tdStyle}>
                        <StatusBadge status={status} />
                      </td>
                      <td style={tdStyle}>{r.email}</td>
                      <td style={tdStyle}>{fmtTier(r.tier)}</td>
                      <td style={tdStyle}>{fmtType(r.email_type)}</td>
                      <td style={tdStyle}>{fmtDate(r.scheduled_at)}</td>
                      <td style={tdStyle}>{fmtDate(r.sent_at)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "normal", maxWidth: 280 }}>
                        <ErrorCell error={r.last_error} attemptCount={r.attempt_count} />
                      </td>
                      <td style={tdStyle}>
                        {!canAct ? (
                          <span style={{ color: "#888", fontSize: 13 }}>—</span>
                        ) : editing ? (
                          <form
                            action={async (fd) => {
                              // datetime-local liefert "YYYY-MM-DDTHH:mm" OHNE
                              // Zeitzone — Browser interpretiert das als
                              // Lokalzeit. Würden wir das so direkt an die
                              // Server-Action schicken, würde `new Date(raw)`
                              // dort als UTC interpretieren (Server ist UTC),
                              // was eine Verschiebung um den lokalen Offset
                              // verursacht (Operator tippt 14:00 → DB hat
                              // 14:00 UTC, also 16:00 in CEST). Wir
                              // konvertieren hier im Browser zu echtem UTC-
                              // ISO und reichen DAS an die Action weiter.
                              const local = String(fd.get("scheduled_at_local") ?? "");
                              if (local) {
                                const utc = new Date(local);
                                if (!Number.isNaN(utc.getTime())) {
                                  fd.set("scheduled_at_iso", utc.toISOString());
                                }
                              }
                              await rescheduleAction(fd);
                              setEditingId(null);
                            }}
                            style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
                          >
                            <input type="hidden" name="id" value={r.id} />
                            <input
                              type="datetime-local"
                              name="scheduled_at_local"
                              defaultValue={toLocalInputValue(r.scheduled_at)}
                              required
                              style={inlineInputStyle}
                            />
                            <button type="submit" style={smallBtnStyle}>
                              Speichern
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              style={{ ...smallBtnStyle, background: "#888" }}
                            >
                              Abbrechen
                            </button>
                          </form>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => setConfirmRow(r)}
                              disabled={pendingId === r.id || confirmRow?.id === r.id}
                              style={{
                                ...smallBtnStyle,
                                opacity: pendingId === r.id || confirmRow?.id === r.id ? 0.6 : 1,
                                cursor: pendingId === r.id || confirmRow?.id === r.id ? "not-allowed" : "pointer",
                              }}
                              title="Mail jetzt sofort über Resend senden"
                            >
                              {pendingId === r.id ? "Sende…" : "Sofort senden"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(r.id)}
                              style={{ ...smallBtnStyle, background: "#3045a8" }}
                            >
                              Neu planen
                            </button>
                            <form action={cancelAction}>
                              <input type="hidden" name="id" value={r.id} />
                              <button
                                type="submit"
                                style={{ ...smallBtnStyle, background: "#a4271c" }}
                                title="Termin endgültig löschen"
                              >
                                Abbrechen
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bestätigungs-Dialog für „Sofort senden". Inline, damit wir
          keine zusätzliche Modal-Library für eine einzige Stelle
          ziehen. Klick auf den Backdrop ODER „Abbrechen" schließt
          ohne Aktion. „Ja, senden" feuert die Server-Action — der
          Button-Lock auf Row-Ebene verhindert Doppelklicks während
          der Action läuft. */}
      {confirmRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="drip-confirm-title"
          onClick={() => setConfirmRow(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              color: "#111",
              borderRadius: 10,
              padding: "22px 24px",
              maxWidth: 440,
              width: "100%",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            }}
          >
            <h3
              id="drip-confirm-title"
              style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700 }}
            >
              E-Mail wirklich senden?
            </h3>
            <p style={{ margin: "0 0 6px", fontSize: 14, lineHeight: 1.5 }}>
              <strong>{fmtType(confirmRow.email_type)}</strong> an{" "}
              <strong>{confirmRow.email}</strong> ({fmtTier(confirmRow.tier)}).
            </p>
            {confirmRow.last_error && (
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "#a4271c", lineHeight: 1.5, fontFamily: "monospace", wordBreak: "break-all" }}>
                Letzter Fehler: {confirmRow.last_error}
              </p>
            )}
            <p style={{ margin: "0 0 18px", fontSize: 13, color: "#666", lineHeight: 1.5 }}>
              Die Mail geht sofort über Resend raus und kann nicht mehr zurückgeholt werden.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setConfirmRow(null)}
                style={{ ...smallBtnStyle, background: "#888" }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirmSend}
                autoFocus
                style={{ ...smallBtnStyle, background: "#0a7a3b" }}
              >
                Ja, senden
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const h2Style: React.CSSProperties = {
  fontSize: 16,
  margin: "0 0 8px",
};

const countStyle: React.CSSProperties = {
  fontWeight: 400,
  color: "#666",
  fontSize: 14,
};

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e5e5",
  borderRadius: 6,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  background: "#f7f7f7",
  borderBottom: "1px solid #e5e5e5",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

const searchStyle: React.CSSProperties = {
  flex: "1 1 240px",
  maxWidth: 320,
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};

const selectStyle: React.CSSProperties = {
  padding: "9px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
  background: "#fff",
  color: "#111",
};

const smallBtnStyle: React.CSSProperties = {
  padding: "6px 10px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const inlineInputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: 13,
  fontFamily: "inherit",
};
