"use client";

import { useRouter, usePathname } from "next/navigation";
import { retryDeadAction } from "./actions";
import type { OutboxCounts, OutboxRow, OutboxStatusFilter } from "./page";

interface Props {
  counts: OutboxCounts;
  rows: OutboxRow[];
  truncated: boolean;
  fetchErrors: string[];
  statusFilter: OutboxStatusFilter;
  canWrite?: boolean;
}

const STATUS_LABELS: Record<OutboxStatusFilter, string> = {
  all: "Alle",
  pending: "Ausstehend",
  sending: "Wird gesendet",
  dead: "Fehlgeschlagen (dead)",
  sent: "Versendet",
};

const STATUS_BADGE_STYLE: Record<string, React.CSSProperties> = {
  pending: { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  sending: { background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" },
  sent: { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  dead: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        ...(STATUS_BADGE_STYLE[status] ?? {}),
      }}
    >
      {STATUS_LABELS[status as OutboxStatusFilter] ?? status}
    </span>
  );
}

function ErrorCell({ error, attempts }: { error: string | null; attempts: number }) {
  if (!error) return <span style={{ color: "#9ca3af" }}>—</span>;
  const short = error.length > 70 ? error.slice(0, 70) + "…" : error;
  return (
    <span
      title={error}
      style={{ fontFamily: "monospace", fontSize: 11, color: "#dc2626" }}
    >
      {short}
      {attempts > 1 ? (
        <span style={{ color: "#6b7280", marginLeft: 4 }}>×{attempts}</span>
      ) : null}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function CounterCard({
  label,
  value,
  accent,
  filterValue,
  currentFilter,
  onClick,
}: {
  label: string;
  value: number;
  accent?: string;
  filterValue: OutboxStatusFilter;
  currentFilter: OutboxStatusFilter;
  onClick: (v: OutboxStatusFilter) => void;
}) {
  const isActive = currentFilter === filterValue;
  return (
    <button
      onClick={() => onClick(isActive ? "all" : filterValue)}
      style={{
        background: isActive ? "#111" : "#fff",
        color: isActive ? "#fff" : "#111",
        border: `1px solid ${isActive ? "#111" : "#e5e7eb"}`,
        borderRadius: 8,
        padding: "16px 20px",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 0.15s",
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: isActive ? "#fff" : (accent ?? "#111"),
          lineHeight: 1,
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.75 }}>{label}</div>
    </button>
  );
}

export default function OutboxDashboard({
  counts,
  rows,
  truncated,
  fetchErrors,
  statusFilter,
  canWrite = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "/glev-ops/outbox";

  function applyFilter(v: OutboxStatusFilter) {
    const url = new URL(pathname, "https://x");
    if (v === "all") {
      url.searchParams.delete("status");
    } else {
      url.searchParams.set("status", v);
    }
    router.push(pathname + (url.search || ""));
  }

  const deadRows = rows.filter((r) => r.status === "dead");
  const hasDeadRows = deadRows.length > 0;

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: 1200,
        margin: "0 auto",
        padding: "32px 24px 80px",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Mail-Outbox</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        Durable Queue — alle Transaktions-Mails, die über den Outbox-Cron laufen.
      </p>

      {fetchErrors.length > 0 && (
        <div
          style={{
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 20,
            fontSize: 13,
            color: "#991b1b",
          }}
        >
          <strong>Fetch-Fehler:</strong>
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {fetchErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {counts.dead > 0 && (
        <div
          style={{
            background: "#fff1f2",
            border: "1px solid #fecdd3",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 20,
            fontSize: 13,
            color: "#be123c",
            fontWeight: 500,
          }}
        >
          ⚠ {counts.dead} tote Mail{counts.dead !== 1 ? "s" : ""} — Empfänger hat{" "}
          {counts.dead !== 1 ? "diese Mails" : "diese Mail"} nie erhalten. Unten Details
          ansehen und ggf. „Erneut senden" klicken.
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 32 }}>
        <CounterCard
          label="Ausstehend"
          value={counts.pending}
          filterValue="pending"
          currentFilter={statusFilter}
          onClick={applyFilter}
        />
        <CounterCard
          label="Wird gesendet"
          value={counts.sending}
          accent="#1e40af"
          filterValue="sending"
          currentFilter={statusFilter}
          onClick={applyFilter}
        />
        <CounterCard
          label="Fehlgeschlagen (dead)"
          value={counts.dead}
          accent="#dc2626"
          filterValue="dead"
          currentFilter={statusFilter}
          onClick={applyFilter}
        />
        <CounterCard
          label="Versendet (gesamt)"
          value={counts.sentTotal}
          accent="#16a34a"
          filterValue="sent"
          currentFilter={statusFilter}
          onClick={applyFilter}
        />
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "16px 20px",
            minWidth: 140,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#16a34a",
              lineHeight: 1,
              marginBottom: 6,
            }}
          >
            {counts.sentLast7Days}
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.75 }}>Versendet (7 Tage)</div>
        </div>
      </div>

      {statusFilter !== "all" && (
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: 20,
              padding: "4px 12px",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Filter: {STATUS_LABELS[statusFilter]}
            <button
              onClick={() => applyFilter("all")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#6b7280",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                fontFamily: "inherit",
              }}
              aria-label="Filter zurücksetzen"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {truncated && (
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          Tabelle zeigt nur die neuesten Zeilen (Limit erreicht). Filter setzen, um gezielter
          zu suchen.
        </p>
      )}

      {rows.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "48px 24px",
            textAlign: "center",
            color: "#6b7280",
            fontSize: 14,
          }}
        >
          {statusFilter === "dead"
            ? "Keine toten Mails — gut so."
            : statusFilter !== "all"
              ? `Keine Zeilen mit Status „${STATUS_LABELS[statusFilter]}".`
              : "Outbox ist leer."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Empfänger</th>
                <th style={thStyle}>Template</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Versuche</th>
                <th style={thStyle}>Letzter Fehler</th>
                <th style={thStyle}>Erstellt</th>
                <th style={thStyle}>Versendet</th>
                {hasDeadRows || statusFilter === "dead" ? (
                  <th style={thStyle}>Aktion</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={row.status === "dead" ? deadRowStyle : rowStyle}>
                  <td style={tdStyle}>
                    <StatusBadge status={row.status} />
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>
                    {row.recipient}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>
                    {row.template}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {row.attempts}
                  </td>
                  <td style={tdStyle}>
                    <ErrorCell error={row.last_error} attempts={row.attempts} />
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                    {fmtDate(row.created_at)}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                    {fmtDate(row.sent_at)}
                  </td>
                  {(hasDeadRows || statusFilter === "dead") ? (
                    <td style={tdStyle}>
                      {row.status === "dead" && canWrite ? (
                        <form action={retryDeadAction}>
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" style={retryBtnStyle}>
                            Erneut senden
                          </button>
                        </form>
                      ) : (
                        <span />
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 600,
  fontSize: 12,
  color: "#374151",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "top",
};

const rowStyle: React.CSSProperties = {};

const deadRowStyle: React.CSSProperties = {
  background: "#fff8f8",
};

const retryBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#fff",
  color: "#111",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
