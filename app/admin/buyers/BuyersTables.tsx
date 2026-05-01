"use client";

import { useMemo, useState } from "react";

export type BetaRow = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string | null;
  fulfilled_at: string | null;
};

export type ProRow = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string | null;
};

type Props = {
  beta: BetaRow[];
  pro: ProRow[];
  pageLimit: number;
  betaTruncated: boolean;
  proTruncated: boolean;
};

function fmtName(n: string | null | undefined): string {
  const s = (n ?? "").trim();
  return s.length > 0 ? s : "—";
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function fmtAmount(cents: number | null | undefined, ccy: string | null | undefined): string {
  if (cents == null) return "—";
  const c = (ccy ?? "eur").toUpperCase();
  return `${(cents / 100).toFixed(2)} ${c}`;
}

function matches(row: { email: string; full_name: string | null }, needle: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  if (row.email.toLowerCase().includes(n)) return true;
  const name = (row.full_name ?? "").toLowerCase();
  if (name.includes(n)) return true;
  return false;
}

export default function BuyersTables({ beta, pro, pageLimit, betaTruncated, proTruncated }: Props) {
  const [q, setQ] = useState("");
  const needle = q.trim();

  const filteredBeta = useMemo(() => beta.filter((r) => matches(r, needle)), [beta, needle]);
  const filteredPro = useMemo(() => pro.filter((r) => matches(r, needle)), [pro, needle]);

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche nach Name oder Email…"
          aria-label="Käufer suchen"
          style={searchStyle}
        />
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2Style}>
          Beta-Reservierungen{" "}
          <span style={countStyle}>
            ({filteredBeta.length}
            {needle ? ` von ${beta.length}` : ""}
            {!needle && betaTruncated ? `+ neueste ${pageLimit}` : ""})
          </span>
        </h2>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Betrag</th>
                <th style={thStyle}>Erstellt</th>
                <th style={thStyle}>Fulfilled</th>
              </tr>
            </thead>
            <tbody>
              {filteredBeta.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    {needle ? "Keine Treffer." : "Keine Reservierungen."}
                  </td>
                </tr>
              ) : (
                filteredBeta.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{fmtName(r.full_name)}</td>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={tdStyle}>{r.status ?? "—"}</td>
                    <td style={tdStyle}>{fmtAmount(r.amount_cents, r.currency)}</td>
                    <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                    <td style={tdStyle}>{fmtDate(r.fulfilled_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={h2Style}>
          Pro-Abos{" "}
          <span style={countStyle}>
            ({filteredPro.length}
            {needle ? ` von ${pro.length}` : ""}
            {!needle && proTruncated ? `+ neueste ${pageLimit}` : ""})
          </span>
        </h2>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Trial endet</th>
                <th style={thStyle}>Period endet</th>
                <th style={thStyle}>Erstellt</th>
              </tr>
            </thead>
            <tbody>
              {filteredPro.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    {needle ? "Keine Treffer." : "Keine Pro-Abos."}
                  </td>
                </tr>
              ) : (
                filteredPro.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{fmtName(r.full_name)}</td>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={tdStyle}>{r.status ?? "—"}</td>
                    <td style={tdStyle}>{fmtDate(r.trial_ends_at)}</td>
                    <td style={tdStyle}>{fmtDate(r.current_period_end)}</td>
                    <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                  </tr>
                ))
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
};

const searchStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};
