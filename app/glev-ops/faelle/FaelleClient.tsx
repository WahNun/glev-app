"use client";

import { useState, useEffect } from "react";
import { loadAllCaseStatuses } from "../_components/CaseStatusCell";
import CaseStatusCell from "../_components/CaseStatusCell";
import DuplicateActions from "../buyers/DuplicateActions";
import DuplicateSignups from "../buyers/DuplicateSignups";
import type { BetaRow, ProRow } from "../buyers/BuyersTables";

/**
 * Client-Komponente für /admin/faelle.
 *
 * Zeigt zwei Kategorien:
 * 1. Mehrfach-Registrierungen (un-dismissed) — direkt via DuplicateSignups
 * 2. Manuell als "Zu bearbeiten" markierte Einträge — aus localStorage
 */

const DUP_DISMISS_KEY = "glev_admin_dismissed_dups";

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function countUndismissedDups(beta: BetaRow[], pro: ProRow[]): number {
  try {
    const dismissed: string[] = JSON.parse(localStorage.getItem(DUP_DISMISS_KEY) ?? "[]");
    const dismissedSet = new Set(dismissed);
    const allEmails = [
      ...beta.map((b) => b.email.trim().toLowerCase()),
      ...pro.map((p) => p.email.trim().toLowerCase()),
    ];
    const counts = new Map<string, number>();
    for (const e of allEmails) counts.set(e, (counts.get(e) ?? 0) + 1);
    return Array.from(counts.entries()).filter(([email, n]) => n >= 2 && !dismissedSet.has(email)).length;
  } catch {
    return 0;
  }
}

export default function FaelleClient({ beta, pro }: { beta: BetaRow[]; pro: ProRow[] }) {
  const [mounted, setMounted] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [undismissedDups, setUndismissedDups] = useState(0);

  useEffect(() => {
    setStatusMap(loadAllCaseStatuses());
    setUndismissedDups(countUndismissedDups(beta, pro));
    setMounted(true);
  }, [beta, pro]);

  if (!mounted) {
    return <p style={mutedStyle}>Lade Fälle…</p>;
  }

  const openBeta = beta.filter((r) => statusMap[`beta-${r.id}`] === "zu_bearbeiten");
  const openPro = pro.filter((r) => statusMap[`pro-${r.id}`] === "zu_bearbeiten");
  const manualTotal = openBeta.length + openPro.length;
  const total = undismissedDups + manualTotal;

  return (
    <div>
      {total === 0 ? (
        <div style={emptyCard}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Keine offenen Fälle</div>
          <div style={mutedStyle}>
            Alle Mehrfach-Registrierungen sind geschlossen und keine Einträge als „Zu bearbeiten" markiert.{" "}
            Gehe zu{" "}
            <a href="/glev-ops/buyers" style={{ color: "#3b4cdc" }}>Käufer</a> um Einträge zu markieren.
          </div>
        </div>
      ) : (
        <p style={{ ...mutedStyle, marginBottom: 20 }}>
          {total} {total === 1 ? "offener Fall" : "offene Fälle"} —{" "}
          {undismissedDups > 0 && `${undismissedDups} Mehrfach-Registrierung${undismissedDups > 1 ? "en" : ""}`}
          {undismissedDups > 0 && manualTotal > 0 && ", "}
          {manualTotal > 0 && `${manualTotal} manuell markiert`}.
        </p>
      )}

      {/* Mehrfach-Registrierungen — direkt via DuplicateSignups (verwaltet eigenes dismissed-state) */}
      {undismissedDups > 0 && (
        <div style={{ marginBottom: 32 }}>
          <DuplicateSignups beta={beta} pro={pro} />
        </div>
      )}

      {/* Manuell markierte Einträge */}
      {openBeta.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={sectionHead}>Beta-Reservierungen ({openBeta.length})</h2>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "#f7f7f7" }}>
                  <th style={th}>Name</th>
                  <th style={th}>Email</th>
                  <th style={th}>Stripe-Status</th>
                  <th style={th}>Betrag</th>
                  <th style={th}>Erstellt</th>
                  <th style={th}>Fall-Status</th>
                </tr>
              </thead>
              <tbody>
                {openBeta.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={td}>{r.full_name ?? "—"}</td>
                    <td style={td}>{r.email}</td>
                    <td style={td}>{r.status ?? "—"}</td>
                    <td style={td}>
                      {r.amount_cents != null
                        ? `${(r.amount_cents / 100).toFixed(2)} ${(r.currency ?? "EUR").toUpperCase()}`
                        : "—"}
                    </td>
                    <td style={td}>{fmtDate(r.created_at)}</td>
                    <td style={td}>
                      <CaseStatusCell rowKey={`beta-${r.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openPro.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={sectionHead}>Pro-Abos ({openPro.length})</h2>
          <div style={tableWrap}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: "#f7f7f7" }}>
                  <th style={th}>Name</th>
                  <th style={th}>Email</th>
                  <th style={th}>Stripe-Status</th>
                  <th style={th}>Trial endet</th>
                  <th style={th}>Erstellt</th>
                  <th style={th}>Stripe-Aktionen</th>
                  <th style={th}>Fall-Status</th>
                </tr>
              </thead>
              <tbody>
                {openPro.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={td}>{r.full_name ?? "—"}</td>
                    <td style={td}>{r.email}</td>
                    <td style={td}>{r.status ?? "—"}</td>
                    <td style={td}>{fmtDate(r.trial_ends_at)}</td>
                    <td style={td}>{fmtDate(r.created_at)}</td>
                    <td style={td}>
                      <DuplicateActions
                        email={r.email}
                        source="pro"
                        subscriptionId={r.stripe_subscription_id ?? null}
                        customerId={r.stripe_customer_id ?? null}
                      />
                    </td>
                    <td style={td}>
                      <CaseStatusCell rowKey={`pro-${r.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

const mutedStyle: React.CSSProperties = { color: "#666", fontSize: 13, margin: 0 };

const emptyCard: React.CSSProperties = {
  textAlign: "center",
  padding: "48px 24px",
  border: "1px solid #bbf7d0",
  borderRadius: 10,
  background: "#f0fdf4",
  color: "#166534",
};

const sectionStyle: React.CSSProperties = { marginBottom: 32 };

const sectionHead: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  margin: "0 0 10px",
  color: "#111",
};

const tableWrap: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e5e5",
  borderRadius: 8,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 600,
  fontSize: 11,
  color: "#555",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 10px",
  verticalAlign: "top",
  whiteSpace: "nowrap",
};
