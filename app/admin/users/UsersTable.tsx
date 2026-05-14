"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { planColor, planLabel, type EffectivePlan } from "@/lib/admin/effectivePlan";

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  /** null = im Profil nie explizit gesetzt (Runtime-Default kommt aus Cookie + Accept-Language). */
  language: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  plan: EffectivePlan;
  manual_plan_override: string | null;
  manual_plan_note: string | null;
  deleted_at: string | null;
  created_by_admin: boolean;
  cgm: "none" | "llu" | "nightscout" | "applehealth" | "junction";
  pro_status: string | null;
  trial_ends_at: string | null;
  /** beta_reservations.status — typisch "fulfilled" wenn bezahlt + freigeschaltet, "pending" während Checkout. */
  beta_status: string | null;
  /** profiles.subscription_status='beta' — alte Beta-Käufer:innen (vor 25.04.2026) hatten kein beta_reservations-Eintrag. */
  legacy_beta: boolean;
  /** ISO 4217 lowercase (eur/usd) — gespeichert auf pro_subscriptions.currency und beta_reservations.currency. null = unbekannt (alte Käufer vor Backfill). */
  currency: string | null;
  /** ISO 3166-1 alpha-2 uppercase (DE/US/AT/…) — Stripe customer billing country. null = unbekannt. */
  country: string | null;
};

type Filter =
  | "all"
  | "free"
  | "beta_buyer"
  | "pro"
  | "pro_trial"
  | "manual"
  | "deleted"
  | "admin";

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "free", label: "Free" },
  { key: "beta_buyer", label: "Beta-Käufer" },
  { key: "pro", label: "Pro" },
  { key: "pro_trial", label: "Pro-Trial" },
  { key: "manual", label: "Manuell" },
  { key: "deleted", label: "Gelöscht" },
  { key: "admin", label: "Admins" },
];

function isBetaBuyer(r: UserRow): boolean {
  // Beta gilt als gekauft sobald die Reservation existiert und nicht
  // explizit storniert/refunded ist. Strikt fulfilled-only wäre zu eng,
  // weil "pending" Käufer:innen während des Checkouts auch interessant
  // sind.
  if (r.beta_status) {
    const s = r.beta_status.toLowerCase();
    if (s !== "refunded" && s !== "cancelled" && s !== "canceled") return true;
  }
  // Alt-Käufer:innen aus dem ersten Stripe-Beta-Produkt (vor dem
  // 25.04.2026-Webhook). Die haben keine beta_reservations-Zeile,
  // sondern nur profiles.subscription_status='beta'.
  if (r.legacy_beta) return true;
  return false;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
function fmtRel(v: string | null | undefined): string {
  if (!v) return "nie";
  const d = new Date(v).getTime();
  if (Number.isNaN(d)) return "—";
  const diffMin = Math.round((Date.now() - d) / 60000);
  if (diffMin < 60) return `vor ${Math.max(1, diffMin)}min`;
  const h = Math.round(diffMin / 60);
  if (h < 48) return `vor ${h}h`;
  const days = Math.round(h / 24);
  if (days < 30) return `vor ${days}d`;
  return fmtDate(v);
}
function cgmLabel(c: UserRow["cgm"]): string {
  if (c === "llu") return "LibreLinkUp";
  if (c === "nightscout") return "Nightscout";
  if (c === "applehealth") return "Apple Health";
  if (c === "junction") return "Junction";
  return "—";
}
function isTrialActive(r: UserRow): boolean {
  if (r.pro_status !== "trialing") return false;
  if (!r.trial_ends_at) return false;
  return new Date(r.trial_ends_at).getTime() > Date.now();
}

export default function UsersTable({
  rows,
  pageSize,
  truncated,
}: {
  rows: UserRow[];
  pageSize: number;
  truncated: boolean;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [currency, setCurrency] = useState<string>(""); // "" = alle
  const [country, setCountry] = useState<string>(""); // "" = alle

  // Currency-Optionen sind eine kleine, geschlossene Menge (eur/usd plus
  // alles andere was Stripe je geschickt hat). Land-Optionen wachsen
  // dynamisch mit den Käufer:innen — wir bauen sie aus den tatsächlich
  // vorhandenen Werten auf, damit der Operator keinen Filter "AT" findet,
  // wenn noch nie ein:e Österreicher:in gekauft hat. Sortierung:
  // alphabetisch (außer "—"-Bucket ans Ende, falls relevant).
  const currencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.currency) set.add(r.currency);
    }
    return Array.from(set).sort();
  }, [rows]);
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.country) set.add(r.country);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "free" && r.plan !== "free") return false;
      if (filter === "beta_buyer" && !isBetaBuyer(r)) return false;
      if (filter === "pro" && r.plan !== "pro") return false;
      if (filter === "pro_trial" && !isTrialActive(r)) return false;
      if (filter === "manual" && !r.manual_plan_override) return false;
      if (filter === "deleted" && !r.deleted_at) return false;
      if (filter === "admin" && r.role !== "admin") return false;
      // Currency/Land: "" = alle, "__none__" = nur Zeilen ohne Wert
      // (nützlich, um Backfill-Lücken zu finden).
      if (currency === "__none__" && r.currency) return false;
      if (currency && currency !== "__none__" && r.currency !== currency) return false;
      if (country === "__none__" && r.country) return false;
      if (country && country !== "__none__" && r.country !== country) return false;
      if (needle) {
        // Freitextsuche deckt bewusst ALLE sichtbaren Felder ab, damit
        // Lucas z.B. "AT" oder "usd" tippen kann statt das Dropdown zu
        // öffnen. Inkl. Rolle, Plan, CGM, Status-Flags, Land, Currency.
        const hay = [
          r.email,
          r.display_name ?? "",
          r.role,
          r.plan,
          r.language ?? "",
          r.currency ?? "",
          r.country ?? "",
          r.cgm,
          r.pro_status ?? "",
          r.beta_status ?? "",
          r.manual_plan_note ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, filter, currency, country]);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${filter === f.key ? "#111" : "#ddd"}`,
              background: filter === f.key ? "#111" : "#fff",
              color: filter === f.key ? "#fff" : "#333",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche: E-Mail, Name, Land (z.B. DE), Currency (z.B. usd)…"
          style={{
            flex: "1 1 320px",
            minWidth: 240,
            padding: "10px 12px",
            border: "1px solid #ccc",
            borderRadius: 6,
            fontSize: 14,
            fontFamily: "inherit",
          }}
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          title="Filter nach Zahlungswährung (Stripe Checkout)"
          style={selectStyle}
        >
          <option value="">Currency: alle</option>
          {currencyOptions.map((c) => (
            <option key={c} value={c}>
              {c.toUpperCase()}
            </option>
          ))}
          <option value="__none__">— ohne —</option>
        </select>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          title="Filter nach Stripe-Billing-Land"
          style={selectStyle}
        >
          <option value="">Land: alle</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__none__">— ohne —</option>
        </select>
      </div>

      <p style={{ fontSize: 13, color: "#555", margin: "0 0 8px" }}>
        {filtered.length} von {rows.length} angezeigt
        {truncated ? ` · Limit ${pageSize} erreicht — ältere User nicht geladen` : ""}
      </p>

      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8f8f8", textAlign: "left" }}>
              <th style={thStyle}>E-Mail</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Plan</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>CGM</th>
              <th
                style={thStyle}
                title="Nur explizit gewählt (Sprachumschalter oder Admin-Anlegen). „—" = nicht gesetzt, Runtime nutzt Cookie + Accept-Language."
              >
                Sprache
              </th>
              <th style={thStyle}>Currency</th>
              <th style={thStyle}>Land</th>
              <th style={thStyle}>Letzter Login</th>
              <th style={thStyle}>Angelegt</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const c = planColor(r.plan);
              const flags: string[] = [];
              if (r.deleted_at) flags.push("Gelöscht");
              if (r.banned_until) flags.push("Gebannt");
              if (r.manual_plan_override) flags.push("Manuell");
              if (r.created_by_admin) flags.push("Admin-angelegt");
              if (r.role === "admin") flags.push("Admin-Rolle");
              if (!r.email_confirmed_at) flags.push("E-Mail unbestätigt");
              if (isTrialActive(r)) flags.push("Pro-Trial");
              if (isBetaBuyer(r)) {
                flags.push(
                  r.beta_status?.toLowerCase() === "pending"
                    ? "Beta (pending)"
                    : r.beta_status
                      ? "Beta-Käufer"
                      : "Beta (Alt-Produkt)",
                );
              }
              return (
                <tr
                  key={r.id}
                  style={{
                    borderTop: "1px solid #eee",
                    opacity: r.deleted_at ? 0.55 : 1,
                  }}
                >
                  <td style={tdStyle}>
                    <Link href={`/admin/users/${r.id}`} style={linkStyle}>
                      {r.email || "—"}
                    </Link>
                  </td>
                  <td style={tdStyle}>{r.display_name ?? "—"}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        background: c.bg,
                        color: c.fg,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontWeight: 600,
                        fontSize: 12,
                      }}
                    >
                      {planLabel(r.plan)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {flags.length === 0 ? (
                      <span style={{ color: "#999" }}>—</span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                        {flags.map((f) => (
                          <span
                            key={f}
                            style={{
                              background: "#f3f4f6",
                              color: "#374151",
                              fontSize: 11,
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {f}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>{cgmLabel(r.cgm)}</td>
                  <td
                    style={tdStyle}
                    title={
                      r.language
                        ? `Im Profil gesetzt: ${r.language}`
                        : "Nicht gesetzt — Runtime nutzt Cookie + Accept-Language-Header"
                    }
                  >
                    {r.language ?? <span style={{ color: "#999" }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    {r.currency ? r.currency.toUpperCase() : <span style={{ color: "#999" }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    {r.country ?? <span style={{ color: "#999" }}>—</span>}
                  </td>
                  <td style={tdStyle} title={r.last_sign_in_at ?? ""}>
                    {fmtRel(r.last_sign_in_at)}
                  </td>
                  <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                  <td style={tdStyle}>
                    <Link href={`/admin/users/${r.id}`} style={openBtnStyle}>
                      Öffnen →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: 32, textAlign: "center", color: "#999" }}>
                  Keine User gefunden.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontWeight: 600,
  fontSize: 12,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  verticalAlign: "top",
};
const linkStyle: React.CSSProperties = {
  color: "#111",
  textDecoration: "underline",
  fontWeight: 600,
};
const openBtnStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#3b4cdc",
  textDecoration: "none",
  fontWeight: 600,
};
const selectStyle: React.CSSProperties = {
  flex: "0 0 auto",
  minWidth: 140,
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
  background: "#fff",
  cursor: "pointer",
};
