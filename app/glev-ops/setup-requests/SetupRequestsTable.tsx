"use client";

import { useState } from "react";
import Link from "next/link";
import type { SetupRequestRow } from "./page";

const STATUS_LABELS: Record<string, string> = {
  open:        "Offen",
  reached_out: "Kontaktiert",
  resolved:    "Gelöst",
  closed:      "Geschlossen",
};

const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  open:        { bg: "#ede9fe", fg: "#5b21b6", border: "#c4b5fd" },
  reached_out: { bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  resolved:    { bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  closed:      { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
};

const STATUS_CYCLE: Record<string, string> = {
  open:        "reached_out",
  reached_out: "resolved",
  resolved:    "closed",
  closed:      "open",
};

function fmtDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export default function SetupRequestsTable({ rows }: { rows: SetupRequestRow[] }) {
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.status])),
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});

  async function cycleStatus(id: string) {
    const current = statuses[id] ?? "open";
    const next = STATUS_CYCLE[current] ?? "open";
    setPending((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/cgm/setup-request/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        setStatuses((s) => ({ ...s, [id]: next }));
      }
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  }

  if (rows.length === 0) {
    return <p style={{ color: "#888", margin: 0 }}>Keine Anfragen vorhanden.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8f8f8", textAlign: "left" }}>
            <th style={th}>Datum</th>
            <th style={th}>User</th>
            <th style={th}>Sensor</th>
            <th style={th}>OS</th>
            <th style={th}>Nightscout</th>
            <th style={th}>Notiz</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = statuses[row.id] ?? row.status;
            const sc = STATUS_COLORS[status] ?? STATUS_COLORS.open;
            const isBusy = pending[row.id];
            return (
              <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                <td style={td}>{fmtDate(row.created_at)}</td>
                <td style={td}>
                  <Link
                    href={`/glev-ops/users/${row.user_id}`}
                    style={{ color: "#3b4cdc", textDecoration: "none", fontSize: 12 }}
                  >
                    {row.user_email ?? row.user_id.slice(0, 8) + "…"}
                  </Link>
                </td>
                <td style={td}>
                  <span style={{ fontWeight: 600 }}>{row.sensor_brand}</span>
                  {row.sensor_model ? (
                    <span style={{ color: "#888", marginLeft: 4 }}>({row.sensor_model})</span>
                  ) : null}
                </td>
                <td style={td}>{row.device_os}</td>
                <td style={td}>{row.nightscout_status}</td>
                <td style={{ ...td, maxWidth: 200, color: "#555", fontStyle: row.note ? "normal" : "italic" }}>
                  {row.note ?? "—"}
                </td>
                <td style={td}>
                  <button
                    onClick={() => { void cycleStatus(row.id); }}
                    disabled={isBusy}
                    title={`Weiter zu: ${STATUS_LABELS[STATUS_CYCLE[status] ?? "open"]}`}
                    style={{
                      background: sc.bg,
                      color: sc.fg,
                      border: `1px solid ${sc.border}`,
                      borderRadius: 999,
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: isBusy ? "wait" : "pointer",
                      opacity: isBusy ? 0.6 : 1,
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isBusy ? "…" : STATUS_LABELS[status] ?? status}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  color: "#555",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "8px 12px",
  verticalAlign: "top",
};
