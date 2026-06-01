"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import CaseStatusCell from "../_components/CaseStatusCell";

export type BetaRow = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  stripe_customer_id?: string | null;
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
  stripe_session_id: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  created_at: string | null;
};

type Props = {
  beta: BetaRow[];
  pro: ProRow[];
  betaTotal: number;
  proTotal: number;
  pageLimit: number;
  page: number;
  q: string;
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

function fmtSessionId(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 16)}…`;
}

function buildUrl(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/glev-ops/buyers?${qs}` : "/glev-ops/buyers";
}

export default function BuyersTables({ beta, pro, betaTotal, proTotal, pageLimit, page, q }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inputValue, setInputValue] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSearching = q.length > 0;
  const betaPages = Math.ceil(betaTotal / pageLimit);
  const proPages = Math.ceil(proTotal / pageLimit);
  const totalPages = Math.max(betaPages, proPages, 1);

  function submit(value: string) {
    startTransition(() => {
      router.push(buildUrl(value.trim(), 1));
    });
  }

  function goPage(p: number) {
    startTransition(() => {
      router.push(buildUrl(q, p));
    });
  }

  function betaHeadingLabel(): string {
    if (isSearching) {
      return `${betaTotal} Treffer für „${q}"`;
    }
    if (betaTotal > pageLimit) {
      const from = (page - 1) * pageLimit + 1;
      const to = Math.min(page * pageLimit, betaTotal);
      return `${from}–${to} von ${betaTotal}`;
    }
    return String(betaTotal);
  }

  function proHeadingLabel(): string {
    if (isSearching) {
      return `${proTotal} Treffer für „${q}"`;
    }
    if (proTotal > pageLimit) {
      const from = (page - 1) * pageLimit + 1;
      const to = Math.min(page * pageLimit, proTotal);
      return `${from}–${to} von ${proTotal}`;
    }
    return String(proTotal);
  }

  return (
    <div style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s" }}>
      <div style={{ marginBottom: 24, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          type="search"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(inputValue);
          }}
          placeholder="Suche nach Name oder Email…"
          aria-label="Käufer suchen"
          style={searchStyle}
        />
        <button
          type="button"
          onClick={() => submit(inputValue)}
          disabled={isPending}
          style={searchBtnStyle}
        >
          Suchen
        </button>
        {isSearching && (
          <button
            type="button"
            onClick={() => {
              setInputValue("");
              submit("");
            }}
            disabled={isPending}
            style={clearBtnStyle}
          >
            ✕ Zurücksetzen
          </button>
        )}
        {isPending && (
          <span style={{ fontSize: 13, color: "#666" }}>Lädt…</span>
        )}
      </div>

      {!isSearching && totalPages > 1 && (
        <div style={paginationBarStyle}>
          <button
            type="button"
            disabled={page <= 1 || isPending}
            onClick={() => goPage(page - 1)}
            style={pageBtnStyle(page <= 1)}
          >
            ← Vorherige
          </button>
          <span style={{ fontSize: 13, color: "#444" }}>
            Seite {page} von {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || isPending}
            onClick={() => goPage(page + 1)}
            style={pageBtnStyle(page >= totalPages)}
          >
            Nächste →
          </button>
        </div>
      )}

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2Style}>
          Beta-Käufer{" "}<span style={{ fontSize: 12, fontWeight: 400, color: "#9ca3af", background: "#f3f4f6", borderRadius: 4, padding: "1px 6px", marginLeft: 4 }}>ehem. Produkt</span>{" "}
          <span style={countStyle}>({betaHeadingLabel()})</span>
        </h2>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Betrag</th>
                <th style={thStyle}>Session-ID</th>
                <th style={thStyle}>Erstellt</th>
                <th style={thStyle}>Fulfilled</th>
                <th style={thStyle}>Fall</th>
              </tr>
            </thead>
            <tbody>
              {beta.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    {isSearching ? "Keine Treffer." : "Keine Reservierungen."}
                  </td>
                </tr>
              ) : (
                beta.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{fmtName(r.full_name)}</td>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={tdStyle}>{r.status ?? "—"}</td>
                    <td style={tdStyle}>{fmtAmount(r.amount_cents, r.currency)}</td>
                    <td style={monoTdStyle} title={r.stripe_session_id ?? undefined}>
                      {fmtSessionId(r.stripe_session_id)}
                    </td>
                    <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                    <td style={tdStyle}>{fmtDate(r.fulfilled_at)}</td>
                    <td style={tdStyle}>
                      <CaseStatusCell rowKey={`beta-${r.id}`} />
                    </td>
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
          <span style={countStyle}>({proHeadingLabel()})</span>
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
                <th style={thStyle}>Session-ID</th>
                <th style={thStyle}>Erstellt</th>
                <th style={thStyle}>Fall</th>
              </tr>
            </thead>
            <tbody>
              {pro.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#888" }}>
                    {isSearching ? "Keine Treffer." : "Keine Pro-Abos."}
                  </td>
                </tr>
              ) : (
                pro.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{fmtName(r.full_name)}</td>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={tdStyle}>{r.status ?? "—"}</td>
                    <td style={tdStyle}>{fmtDate(r.trial_ends_at)}</td>
                    <td style={tdStyle}>{fmtDate(r.current_period_end)}</td>
                    <td style={monoTdStyle} title={r.stripe_session_id ?? undefined}>
                      {fmtSessionId(r.stripe_session_id)}
                    </td>
                    <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                    <td style={tdStyle}>
                      <CaseStatusCell rowKey={`pro-${r.id}`} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {!isSearching && totalPages > 1 && (
        <div style={{ ...paginationBarStyle, marginTop: 16, marginBottom: 0 }}>
          <button
            type="button"
            disabled={page <= 1 || isPending}
            onClick={() => goPage(page - 1)}
            style={pageBtnStyle(page <= 1)}
          >
            ← Vorherige
          </button>
          <span style={{ fontSize: 13, color: "#444" }}>
            Seite {page} von {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || isPending}
            onClick={() => goPage(page + 1)}
            style={pageBtnStyle(page >= totalPages)}
          >
            Nächste →
          </button>
        </div>
      )}
    </div>
  );
}

const h2Style: React.CSSProperties = { fontSize: 16, margin: "0 0 8px" };
const countStyle: React.CSSProperties = { fontWeight: 400, color: "#666", fontSize: 14 };
const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e5e5",
  borderRadius: 6,
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
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
const monoTdStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: 13,
  color: "#444",
};
const searchStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 360,
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};
const searchBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const clearBtnStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "transparent",
  color: "#666",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  cursor: "pointer",
};
const paginationBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 16,
};

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    background: disabled ? "#f0f0f0" : "#111",
    color: disabled ? "#aaa" : "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
  };
}
