"use client";

import { useMemo, useState } from "react";

import {
  classifyRow,
  statusColors,
  statusLabel,
  type DripCounts,
  type DripScheduleRow,
  type DripStatus,
} from "@/lib/emails/drip-status";
import { sendNowAction, cancelAction, rescheduleAction } from "./actions";

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
   * Aktueller Suchbegriff aus `?q=...`. Wird als Default-Value für das
   * Suchfeld verwendet, damit die URL nach Submit das Feld korrekt
   * vorbefüllt zurückzeigt.
   */
  query: string;
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

function StatusBadge({ status }: { status: DripStatus }) {
  const c = statusColors(status);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
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
}: {
  label: string;
  value: number;
  tone: "default" | "warn" | "ok" | "bad";
}) {
  const toneColor =
    tone === "warn" ? "#a85a00" : tone === "ok" ? "#1e7c3a" : tone === "bad" ? "#a4271c" : "#111";
  return (
    <div
      style={{
        flex: "1 1 140px",
        minWidth: 140,
        padding: "12px 14px",
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: toneColor }}>{value}</div>
    </div>
  );
}

export default function DripDashboard({
  counts,
  rows,
  searchLimit,
  listLimit,
  truncated,
  nowIso,
  query,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  return (
    <>
      <section style={{ marginBottom: 24 }}>
        <h2 style={h2Style}>Status-Übersicht</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <CountCard label="Heute fällig" value={counts.dueToday} tone="warn" />
          <CountCard label="Morgen fällig" value={counts.dueTomorrow} tone="default" />
          <CountCard label="Nächste 7 Tage" value={counts.dueThisWeek} tone="default" />
          <CountCard label="Versendet (7 Tage)" value={counts.sentLast7Days} tone="ok" />
          <CountCard label="Versendet (gesamt)" value={counts.sentTotal} tone="default" />
          <CountCard label="Fehlgeschlagen" value={counts.failed} tone="bad" />
        </div>
        <p style={{ color: "#777", fontSize: 12, margin: "8px 0 0" }}>
          Counter zählen über die gesamte Tabelle, nicht nur die unten gezeigte
          Liste. „Fehlgeschlagen" = noch nicht versendet und mehr als 24 h überfällig
          — der Drip-Cron läuft täglich um 09:00 UTC und probiert es bei jedem Lauf
          erneut.
        </p>
      </section>

      <section style={{ marginBottom: 16 }}>
        {/*
          Suchformular als GET an /admin/drip?q=… — Server-Komponente liest
          den Param und fragt die DB mit ILIKE über die GESAMTE Tabelle ab,
          nicht nur das Default-Fenster. Damit findet die Suche auch alte
          versendete Drip-Termine, die längst aus den letzten 300 Rows raus
          sind. "x"-Button setzt den Param zurück auf leer.
        */}
        <form
          method="get"
          action="/admin/drip"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Suche nach Email-Adresse…"
            aria-label="Drip-Termine suchen"
            style={searchStyle}
          />
          <button type="submit" style={smallBtnStyle}>
            Suchen
          </button>
          {query ? (
            <a href="/admin/drip" style={{ fontSize: 13, color: "#3045a8", textDecoration: "underline" }}>
              Zurücksetzen
            </a>
          ) : null}
        </form>
      </section>

      <section>
        <h2 style={h2Style}>
          Drip-Termine{" "}
          <span style={countStyle}>
            ({rows.length}
            {!query && truncated ? ` — neueste ${listLimit} angezeigt` : ""}
            {query && truncated ? ` — gekappt bei ${searchLimit}` : ""}
            {query ? ` für "${query}"` : ""})
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
                <th style={thStyle}>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    {query ? "Keine Treffer." : "Keine Drip-Termine."}
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
                      <td style={tdStyle}>
                        {!canAct ? (
                          <span style={{ color: "#888", fontSize: 12 }}>—</span>
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
                            <form action={sendNowAction}>
                              <input type="hidden" name="id" value={r.id} />
                              <button
                                type="submit"
                                style={smallBtnStyle}
                                title="Mail jetzt sofort über Resend senden"
                              >
                                Sofort senden
                              </button>
                            </form>
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
  fontSize: 13,
};

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e5e5",
  borderRadius: 6,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
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
  flex: "1 1 320px",
  maxWidth: 420,
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};

const smallBtnStyle: React.CSSProperties = {
  padding: "6px 10px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const inlineInputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "inherit",
};
