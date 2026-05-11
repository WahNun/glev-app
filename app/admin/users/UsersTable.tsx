"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { planColor, planLabel, type EffectivePlan } from "@/lib/admin/effectivePlan";

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  language: string;
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
};

type Filter =
  | "all"
  | "free"
  | "beta"
  | "pro"
  | "trial"
  | "manual"
  | "deleted"
  | "admin";

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "free", label: "Free" },
  { key: "beta", label: "Beta" },
  { key: "pro", label: "Pro" },
  { key: "trial", label: "Trial läuft" },
  { key: "manual", label: "Manuell" },
  { key: "deleted", label: "Gelöscht" },
  { key: "admin", label: "Admins" },
];

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "free" && r.plan !== "free") return false;
      if (filter === "beta" && r.plan !== "beta") return false;
      if (filter === "pro" && r.plan !== "pro") return false;
      if (filter === "trial" && !isTrialActive(r)) return false;
      if (filter === "manual" && !r.manual_plan_override) return false;
      if (filter === "deleted" && !r.deleted_at) return false;
      if (filter === "admin" && r.role !== "admin") return false;
      if (needle) {
        const hay = `${r.email} ${r.display_name ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, filter]);

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

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Suche nach E-Mail oder Name…"
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid #ccc",
          borderRadius: 6,
          fontSize: 14,
          fontFamily: "inherit",
          marginBottom: 12,
        }}
      />

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
              <th style={thStyle}>Sprache</th>
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
              if (isTrialActive(r)) flags.push("Trial");
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
                  <td style={tdStyle}>{r.language}</td>
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
                <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#999" }}>
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
