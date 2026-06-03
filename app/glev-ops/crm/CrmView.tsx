"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { planColor, planLabel, type EffectivePlan } from "@/lib/admin/effectivePlan";
import CaseStatusCell from "../_components/CaseStatusCell";
import BulkSmsButton from "../buyers/BulkSmsButton";
import ReminderButton from "../buyers/ReminderButton";
import { softDeleteAction } from "../users/actions";

function exportCsv(
  rows: Record<string, string | number | boolean | null | undefined>[],
  columns: { key: string; header: string }[],
  filename: string,
): void {
  const BOM = "\uFEFF";
  const escape = (v: string | number | boolean | null | undefined): string => {
    const s = v == null ? "" : String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escape(row[c.key])).join(","))
    .join("\n");
  const blob = new Blob([BOM + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type CrmUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  language: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  plan: EffectivePlan;
  manual_plan_override: string | null;
  manual_plan_note: string | null;
  gift_label: string | null;
  deleted_at: string | null;
  created_by_admin: boolean;
  cgm: "none" | "llu" | "nightscout" | "applehealth" | "junction";
  pro_status: string | null;
  trial_ends_at: string | null;
  profile_trial_end_at: string | null;
  profile_trial_start_at: string | null;
  signup_source: string | null;
  beta_status: string | null;
  legacy_beta: boolean;
  currency: string | null;
  country: string | null;
  phone: string | null;
  onboarding_completed_at: string | null;
  sms_clicked: boolean;
  email_clicked: boolean;
  reminder_sent_at: string | null;
};

export type CrmBetaRow = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  created_at: string | null;
  fulfilled_at: string | null;
  user_id?: string;
};

export type CrmProRow = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_session_id: string | null;
  created_at: string | null;
  user_id?: string;
};

type Tab = "alle" | "trial" | "beta" | "pro";

type UserFilter =
  | "all"
  | "free"
  | "beta_buyer"
  | "pro"
  | "pro_trial"
  | "manual"
  | "gifted"
  | "deleted"
  | "admin";

const USER_FILTERS: ReadonlyArray<{ key: UserFilter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "free", label: "Free" },
  { key: "beta_buyer", label: "Smart-Käufer" },
  { key: "pro", label: "Pro" },
  { key: "pro_trial", label: "Pro-Trial" },
  { key: "manual", label: "Manuell" },
  { key: "gifted", label: "🎁 Geschenkt" },
  { key: "deleted", label: "Gelöscht" },
  { key: "admin", label: "Admins" },
];

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
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
function fmtShortDe(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}
function fmtSessionId(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 16)}…`;
}
function fmtAmount(cents: number | null | undefined, ccy: string | null | undefined): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2)} ${(ccy ?? "EUR").toUpperCase()}`;
}
function cgmLabel(c: CrmUserRow["cgm"]): string {
  if (c === "llu") return "LibreLinkUp";
  if (c === "nightscout") return "Nightscout";
  if (c === "applehealth") return "Apple Health";
  if (c === "junction") return "Junction";
  return "—";
}
function isBetaBuyer(r: CrmUserRow): boolean {
  if (r.beta_status) {
    const s = r.beta_status.toLowerCase();
    if (s !== "refunded" && s !== "cancelled" && s !== "canceled") return true;
  }
  if (r.legacy_beta) return true;
  return false;
}
function isTrialActive(r: CrmUserRow): boolean {
  const now = Date.now();
  if (r.pro_status === "trialing" && r.trial_ends_at && new Date(r.trial_ends_at).getTime() > now) return true;
  if (r.profile_trial_end_at && new Date(r.profile_trial_end_at).getTime() > now) return true;
  return false;
}
function trialLabel(r: CrmUserRow): string {
  const now = Date.now();
  if (r.pro_status === "trialing" && r.trial_ends_at && new Date(r.trial_ends_at).getTime() > now) {
    const suffix = fmtShortDe(r.trial_ends_at);
    return suffix ? `Pro-Trial · bis ${suffix}` : "Pro-Trial";
  }
  if (r.profile_trial_end_at && new Date(r.profile_trial_end_at).getTime() > now) {
    return "7 Tage Trial";
  }
  return planLabel(r.plan);
}

export default function CrmView({
  users,
  beta,
  pro,
  pageSize,
}: {
  users: CrmUserRow[];
  beta: CrmBetaRow[];
  pro: CrmProRow[];
  pageSize: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const rawTab = sp.get("tab") ?? "alle";
  const tab: Tab = ["alle", "trial", "beta", "pro"].includes(rawTab) ? (rawTab as Tab) : "alle";

  function setTab(t: Tab) {
    const params = new URLSearchParams(sp.toString());
    params.set("tab", t);
    router.replace(`/glev-ops/crm?${params.toString()}`);
  }

  const trialUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.signup_source === "meta_lead" ||
          u.profile_trial_end_at != null ||
          u.profile_trial_start_at != null,
      ),
    [users],
  );

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "alle", label: "Alle Nutzer", count: users.length },
    { key: "trial", label: "Trial / Meta Leads", count: trialUsers.length },
    { key: "beta", label: "Beta-Käufer (veraltet)", count: beta.length },
    { key: "pro", label: "Pro-Abos", count: pro.length },
  ];

  return (
    <div>
      <div style={tabBarStyle}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={tab === t.key ? tabActiveStyle : tabStyle}
          >
            {t.label}
            <span style={tab === t.key ? countActivePill : countPill}>{t.count}</span>
          </button>
        ))}
      </div>

      <div style={{ paddingTop: 24 }}>
        {tab === "alle" && <AlleTab users={users} pageSize={pageSize} />}
        {tab === "trial" && <TrialTab users={trialUsers} />}
        {tab === "beta" && <BetaTab rows={beta} />}
        {tab === "pro" && <ProTab rows={pro} />}
      </div>
    </div>
  );
}

function AlleTab({ users, pageSize }: { users: CrmUserRow[]; pageSize: number }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [currency, setCurrency] = useState("");
  const [country, setCountry] = useState("");

  const currencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of users) if (r.currency) set.add(r.currency);
    return Array.from(set).sort();
  }, [users]);
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of users) if (r.country) set.add(r.country);
    return Array.from(set).sort();
  }, [users]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((r) => {
      if (filter === "free" && r.plan !== "free") return false;
      if (filter === "beta_buyer" && !isBetaBuyer(r)) return false;
      if (filter === "pro" && r.plan !== "pro") return false;
      if (filter === "pro_trial" && !isTrialActive(r)) return false;
      if (filter === "manual" && !r.manual_plan_override) return false;
      if (filter === "gifted" && !r.gift_label) return false;
      if (filter === "deleted" && !r.deleted_at) return false;
      if (filter === "admin" && r.role !== "admin") return false;
      if (currency === "__none__" && r.currency) return false;
      if (currency && currency !== "__none__" && r.currency !== currency) return false;
      if (country === "__none__" && r.country) return false;
      if (country && country !== "__none__" && r.country !== country) return false;
      if (needle) {
        const hay = [r.email, r.display_name ?? "", r.role, r.plan, r.language ?? "", r.currency ?? "", r.country ?? "", r.cgm, r.pro_status ?? "", r.beta_status ?? "", r.manual_plan_note ?? "", r.gift_label ?? ""].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [users, q, filter, currency, country]);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {USER_FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} style={f.key === filter ? filterChipActive : filterChip}>
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche: E-Mail, Name, Land, Currency…" style={{ flex: "1 1 320px", minWidth: 240, ...inputBase }} />
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={selectBase}>
          <option value="">Currency: alle</option>
          {currencyOptions.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          <option value="__none__">— ohne —</option>
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} style={selectBase}>
          <option value="">Land: alle</option>
          {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="__none__">— ohne —</option>
        </select>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
          {filtered.length} von {users.length} angezeigt{users.length >= pageSize ? ` · Limit ${pageSize}` : ""}
        </p>
        <button
          type="button"
          style={csvBtn}
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            exportCsv(
              filtered.map((r) => ({
                email: r.email,
                name: r.display_name ?? "",
                plan: r.plan,
                status: [
                  r.deleted_at ? "Gelöscht" : null,
                  r.banned_until ? "Gebannt" : null,
                  r.manual_plan_override ? "Manuell" : null,
                  r.created_by_admin ? "Admin-angelegt" : null,
                  r.role === "admin" ? "Admin-Rolle" : null,
                  !r.email_confirmed_at ? "Unbestätigt" : null,
                  isTrialActive(r) ? "Trial aktiv" : null,
                  r.signup_source === "meta_lead" ? "Meta Lead" : null,
                  isBetaBuyer(r) ? "Beta" : null,
                ].filter(Boolean).join("; "),
                cgm: cgmLabel(r.cgm),
                language: r.language ?? "",
                currency: r.currency ?? "",
                country: r.country ?? "",
                last_sign_in_at: r.last_sign_in_at ?? "",
                created_at: r.created_at,
              })),
              [
                { key: "email", header: "E-Mail" },
                { key: "name", header: "Name" },
                { key: "plan", header: "Plan" },
                { key: "status", header: "Status" },
                { key: "cgm", header: "CGM" },
                { key: "language", header: "Sprache" },
                { key: "currency", header: "Currency" },
                { key: "country", header: "Land" },
                { key: "last_sign_in_at", header: "Letzter Login" },
                { key: "created_at", header: "Angelegt" },
              ],
              `crm-alle-${today}.csv`,
            );
          }}
        >
          ↓ CSV exportieren
        </button>
      </div>
      <div style={tableWrap}>
        <table style={tableBase}>
          <thead>
            <tr style={{ background: "#f8f8f8" }}>
              <Th>E-Mail</Th>
              <Th>Name</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th>CGM</Th>
              <Th>Sprache</Th>
              <Th>Currency</Th>
              <Th>Land</Th>
              <Th>Letzter Login</Th>
              <Th>Angelegt</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const trialActive = isTrialActive(r);
              const c = trialActive ? { bg: "#fef9c322", fg: "#92400e" } : planColor(r.plan);
              const flags: string[] = [];
              if (r.deleted_at) flags.push("Gelöscht");
              if (r.banned_until) flags.push("Gebannt");
              if (r.manual_plan_override) flags.push("Manuell");
              if (r.created_by_admin) flags.push("Admin-angelegt");
              if (r.role === "admin") flags.push("Admin-Rolle");
              if (!r.email_confirmed_at) flags.push("Unbestätigt");
              if (trialActive) flags.push("Trial aktiv");
              if (r.signup_source === "meta_lead") {
                const now = Date.now();
                const end = r.profile_trial_end_at ? new Date(r.profile_trial_end_at).getTime() : null;
                if (!r.profile_trial_start_at) flags.push("Meta Lead · Nicht aktiviert");
                else if (end && end < now) flags.push("Meta Lead · Trial abgelaufen");
                else flags.push("Meta Lead · Trial aktiv");
              }
              if (isBetaBuyer(r)) {
                flags.push(
                  r.beta_status?.toLowerCase() === "pending"
                    ? "Beta – veraltet (ausstehend)"
                    : r.beta_status
                      ? "Beta – veraltet"
                      : "Beta – veraltet (Legacy)",
                );
              }
              return (
                <tr key={r.id} style={{ borderTop: "1px solid #eee", opacity: r.deleted_at ? 0.55 : 1 }}>
                  <Td>
                    <Link href={`/glev-ops/users/${r.id}`} style={emailLink}>{r.email || "—"}</Link>
                  </Td>
                  <Td>{r.display_name ?? "—"}</Td>
                  <Td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                      <span style={{ background: c.bg, color: c.fg, padding: "2px 8px", borderRadius: 999, fontWeight: 600, fontSize: 12 }}>{trialLabel(r)}</span>
                      {r.gift_label ? <span style={giftBadge}>🎁 {r.gift_label}</span> : null}
                    </span>
                  </Td>
                  <Td>
                    {flags.length === 0 ? <span style={{ color: "#999" }}>—</span> : (
                      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                        {flags.map((f) => <span key={f} style={flagBadge}>{f}</span>)}
                      </span>
                    )}
                  </Td>
                  <Td>{cgmLabel(r.cgm)}</Td>
                  <Td>{r.language ?? <span style={{ color: "#999" }}>—</span>}</Td>
                  <Td>{r.currency ? r.currency.toUpperCase() : <span style={{ color: "#999" }}>—</span>}</Td>
                  <Td>{r.country ?? <span style={{ color: "#999" }}>—</span>}</Td>
                  <Td title={r.last_sign_in_at ?? ""}>{fmtRel(r.last_sign_in_at)}</Td>
                  <Td>{fmtDate(r.created_at)}</Td>
                  <Td>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Link href={`/glev-ops/users/${r.id}`} style={openBtn}>Öffnen →</Link>
                      <Link href={`/glev-ops/buyers/${r.id}`} style={{ fontSize: 14, color: "#6b7280", textDecoration: "none" }} title="Metadaten bearbeiten">✏</Link>
                    </span>
                  </Td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 32, textAlign: "center", color: "#999" }}>Keine Nutzer gefunden.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ContextMenuState = { x: number; y: number; userId: string; email: string } | null;

function TrialTab({ users }: { users: CrmUserRow[] }) {
  const [q, setQ] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const now = new Date();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) =>
      [u.email, u.display_name ?? "", u.phone ?? "", u.signup_source ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [users, q]);

  const filteredIds = useMemo(() => filtered.map((u) => u.id), [filtered]);

  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selection.has(id));
  const someSelected = filteredIds.some((id) => selection.has(id));
  const indeterminate = someSelected && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  useEffect(() => {
    if (!contextMenu) return;
    function close() { setContextMenu(null); }
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  function toggleAll() {
    if (allSelected) {
      setSelection((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelection((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleOne(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleContextMenu(e: React.MouseEvent, userId: string, email: string) {
    e.preventDefault();
    if (!selection.has(userId)) {
      setSelection((prev) => new Set(prev).add(userId));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, userId, email });
  }

  async function handleDelete(userId: string, email: string) {
    setContextMenu(null);
    const ok = window.confirm(`Lead „${email}" soft-löschen?\n\nDer Account wird gesperrt und als gelöscht markiert. Dies kann rückgängig gemacht werden.`);
    if (!ok) return;
    setDeleting(userId);
    try {
      const fd = new FormData();
      fd.set("userId", userId);
      fd.set("confirmEmail", email);
      await softDeleteAction(fd);
    } finally {
      setDeleting(null);
      setSelection((prev) => { const next = new Set(prev); next.delete(userId); return next; });
    }
  }

  const selectedIds = Array.from(selection);
  const selectionCount = selectedIds.length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <BulkSmsButton selectedIds={selectionCount > 0 ? selectedIds : undefined} />
        <ReminderButton selectedIds={selectionCount > 0 ? selectedIds : undefined} />
      </div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Suche: E-Mail, Name, Telefon…"
        style={{ ...inputBase, minWidth: 260, marginBottom: 12, display: "block" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
          {filtered.length} Einträge
          {selectionCount > 0 && (
            <span style={{ marginLeft: 10, background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
              {selectionCount} ausgewählt
              <button
                type="button"
                onClick={() => setSelection(new Set())}
                style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 11, padding: 0 }}
              >
                ✕
              </button>
            </span>
          )}
        </p>
        <button
          type="button"
          style={csvBtn}
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            exportCsv(
              filtered.map((u) => {
                const end = u.profile_trial_end_at ? new Date(u.profile_trial_end_at) : null;
                const started = u.profile_trial_start_at ? new Date(u.profile_trial_start_at) : null;
                const expired = end ? end < now : false;
                const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / 86400000) : null;
                const status = !started ? "Wartet" : expired ? "Abgelaufen" : "Aktiv";
                return {
                  email: u.email,
                  name: u.display_name ?? "",
                  phone: u.phone ?? "",
                  source: u.signup_source ?? "Direkt",
                  trial_start: u.profile_trial_start_at ?? "",
                  trial_end: u.profile_trial_end_at ?? "",
                  days_left: daysLeft != null ? String(daysLeft) : "",
                  status,
                  reminder: u.reminder_sent_at ?? "",
                  onboarding: u.onboarding_completed_at ? "Abgeschlossen" : u.profile_trial_start_at ? "Ausstehend" : "",
                  link_clicks: [u.sms_clicked ? "SMS" : null, u.email_clicked ? "Email" : null].filter(Boolean).join("; "),
                  created_at: u.created_at,
                };
              }),
              [
                { key: "email", header: "E-Mail" },
                { key: "name", header: "Name" },
                { key: "phone", header: "Telefon" },
                { key: "source", header: "Quelle" },
                { key: "trial_start", header: "Trial gestartet" },
                { key: "trial_end", header: "Trial endet" },
                { key: "days_left", header: "Tage übrig" },
                { key: "status", header: "Status" },
                { key: "reminder", header: "Reminder" },
                { key: "onboarding", header: "Onboarding" },
                { key: "link_clicks", header: "Link-Klicks" },
                { key: "created_at", header: "Angelegt" },
              ],
              `crm-trial-${today}.csv`,
            );
          }}
        >
          ↓ CSV exportieren
        </button>
      </div>
      <div style={tableWrap}>
        <table style={tableBase}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={{ padding: "10px 8px 10px 12px", width: 32 }}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  style={{ cursor: "pointer" }}
                  title="Alle auswählen"
                />
              </th>
              <Th>E-Mail</Th>
              <Th>Name</Th>
              <Th>Telefon</Th>
              <Th>Quelle</Th>
              <Th>Trial gestartet</Th>
              <Th>Trial endet</Th>
              <Th>Tage übrig</Th>
              <Th>Status</Th>
              <Th>Link-Klicks</Th>
              <Th>Reminder</Th>
              <Th>Onboarding</Th>
              <Th>Angelegt</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const end = u.profile_trial_end_at ? new Date(u.profile_trial_end_at) : null;
              const started = u.profile_trial_start_at ? new Date(u.profile_trial_start_at) : null;
              const expired = end ? end < now : false;
              const notYetActivated = !started;
              const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / 86400000) : null;
              const isSelected = selection.has(u.id);
              return (
                <tr
                  key={u.id}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    background: isSelected ? "#eff6ff" : undefined,
                    opacity: deleting === u.id ? 0.4 : 1,
                    transition: "background 0.1s",
                  }}
                  onContextMenu={(e) => handleContextMenu(e, u.id, u.email)}
                >
                  <td style={{ padding: "8px 8px 8px 12px", verticalAlign: "middle" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(u.id)}
                      style={{ cursor: "pointer" }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <Td>
                    <Link href={`/glev-ops/users/${u.id}`} style={emailLink}>{u.email}</Link>
                  </Td>
                  <Td>{u.display_name ?? "—"}</Td>
                  <Td>{u.phone ?? "—"}</Td>
                  <Td>
                    {u.signup_source === "meta_lead"
                      ? <span style={badgeMeta}>Meta Lead</span>
                      : <span style={badgeDefault}>{u.signup_source ?? "Direkt"}</span>}
                  </Td>
                  <Td>
                    {started ? fmtDateTime(u.profile_trial_start_at) : <span style={badgePending}>Nicht aktiviert</span>}
                  </Td>
                  <Td>{end ? fmtDateTime(u.profile_trial_end_at) : "—"}</Td>
                  <Td>
                    {notYetActivated ? <span style={badgePending}>—</span>
                      : expired ? <span style={badgeExpired}>0 Tage</span>
                      : daysLeft !== null
                        ? <span style={daysLeft <= 2 ? badgeExpired : daysLeft <= 4 ? badgeWarn : badgeActive}>{daysLeft} {daysLeft === 1 ? "Tag" : "Tage"}</span>
                        : "—"}
                  </Td>
                  <Td>
                    {notYetActivated ? <span style={badgePending}>Wartet</span>
                      : expired ? <span style={badgeExpired}>Abgelaufen</span>
                      : <span style={badgeActive}>Aktiv</span>}
                  </Td>
                  <Td>
                    {(u.sms_clicked || u.email_clicked) ? (
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {u.sms_clicked && <span style={badgeClicked} title="SMS-Link geklickt">📱 SMS</span>}
                        {u.email_clicked && <span style={badgeClicked} title="E-Mail-Link geklickt">📧 Email</span>}
                      </span>
                    ) : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>}
                  </Td>
                  <Td>
                    {u.reminder_sent_at
                      ? <span style={badgeClicked} title={u.reminder_sent_at}>🔔 {fmtDate(u.reminder_sent_at)}</span>
                      : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>}
                  </Td>
                  <Td>
                    {u.onboarding_completed_at
                      ? <span style={badgeActive}>✓ Abgeschlossen</span>
                      : u.profile_trial_start_at
                        ? <span style={badgePending}>Ausstehend</span>
                        : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>}
                  </Td>
                  <Td>{fmtDate(u.created_at)}</Td>
                  <Td>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Link href={`/glev-ops/users/${u.id}`} style={openBtn}>Öffnen →</Link>
                      <Link href={`/glev-ops/buyers/${u.id}`} style={{ fontSize: 14, color: "#6b7280", textDecoration: "none" }} title="Bearbeiten">✏</Link>
                    </span>
                  </Td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={14} style={{ padding: 32, textAlign: "center", color: "#999" }}>Keine Trial-Nutzer.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
            minWidth: 200,
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            style={ctxMenuItem}
            onClick={() => {
              setContextMenu(null);
            }}
          >
            📨 SMS senden
          </button>
          <button
            type="button"
            style={ctxMenuItem}
            onClick={() => {
              setContextMenu(null);
            }}
          >
            🔔 Reminder senden
          </button>
          <div style={{ height: 1, background: "#f3f4f6", margin: "2px 0" }} />
          <button
            type="button"
            style={{ ...ctxMenuItem, color: "#dc2626" }}
            onClick={() => handleDelete(contextMenu.userId, contextMenu.email)}
          >
            🗑 Löschen
          </button>
        </div>
      )}
    </div>
  );
}

function BetaTab({ rows }: { rows: CrmBetaRow[] }) {
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const sp = useSearchParams();
  const rawPage = parseInt(sp.get("bpage") ?? "1", 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const PAGE = 100;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => [r.email, r.full_name ?? ""].join(" ").toLowerCase().includes(needle));
  }, [rows, q]);

  const totalPages = Math.ceil(filtered.length / PAGE) || 1;
  const paged = filtered.slice((page - 1) * PAGE, page * PAGE);

  function goPage(p: number) {
    startTransition(() => {
      const params = new URLSearchParams(sp.toString());
      params.set("bpage", String(p));
      router.replace(`/glev-ops/crm?${params.toString()}`);
    });
  }

  return (
    <div style={{ opacity: isPending ? 0.6 : 1 }}>
      <input type="text" value={q} onChange={(e) => { setQ(e.target.value); }} placeholder="Suche: Name, E-Mail…" style={{ ...inputBase, minWidth: 260, marginBottom: 12, display: "block" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>{filtered.length} Einträge</p>
        <button
          type="button"
          style={csvBtn}
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            exportCsv(
              filtered.map((r) => ({
                name: r.full_name ?? "",
                email: r.email,
                status: r.status ?? "",
                amount: fmtAmount(r.amount_cents, r.currency),
                session_id: r.stripe_session_id ?? "",
                created_at: r.created_at ?? "",
                fulfilled_at: r.fulfilled_at ?? "",
              })),
              [
                { key: "name", header: "Name" },
                { key: "email", header: "E-Mail" },
                { key: "status", header: "Status" },
                { key: "amount", header: "Betrag" },
                { key: "session_id", header: "Session-ID" },
                { key: "created_at", header: "Erstellt" },
                { key: "fulfilled_at", header: "Fulfilled" },
              ],
              `crm-beta-${today}.csv`,
            );
          }}
        >
          ↓ CSV exportieren
        </button>
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onGo={goPage} />}
      <div style={tableWrap}>
        <table style={tableBase}>
          <thead>
            <tr style={{ background: "#f8f8f8" }}>
              <Th>{"Name"}</Th><Th>{"E-Mail"}</Th><Th>{"Status"}</Th><Th>{"Betrag"}</Th><Th>{"Session-ID"}</Th><Th>{"Erstellt"}</Th><Th>{"Fulfilled"}</Th><Th>{"Fall"}</Th><Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#999" }}>Keine Einträge.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                <Td>{r.full_name ?? "—"}</Td>
                <Td>
                  <Link href={r.user_id ? `/glev-ops/users/${r.user_id}` : `/glev-ops/users?q=${encodeURIComponent(r.email)}`} style={emailLink}>{r.email}</Link>
                </Td>
                <Td>{r.status ?? "—"}</Td>
                <Td>{fmtAmount(r.amount_cents, r.currency)}</Td>
                <Td mono title={r.stripe_session_id ?? undefined}>{fmtSessionId(r.stripe_session_id)}</Td>
                <Td>{fmtDateTime(r.created_at)}</Td>
                <Td>{fmtDateTime(r.fulfilled_at)}</Td>
                <Td><CaseStatusCell rowKey={`beta-${r.id}`} /></Td>
                <Td>
                  <Link href={r.user_id ? `/glev-ops/users/${r.user_id}` : `/glev-ops/users?q=${encodeURIComponent(r.email)}`} style={openBtn}>Öffnen →</Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onGo={goPage} style={{ marginTop: 12 }} />}
    </div>
  );
}

function ProTab({ rows }: { rows: CrmProRow[] }) {
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const sp = useSearchParams();
  const rawPage = parseInt(sp.get("ppage") ?? "1", 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const PAGE = 100;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => [r.email, r.full_name ?? ""].join(" ").toLowerCase().includes(needle));
  }, [rows, q]);

  const totalPages = Math.ceil(filtered.length / PAGE) || 1;
  const paged = filtered.slice((page - 1) * PAGE, page * PAGE);

  function goPage(p: number) {
    startTransition(() => {
      const params = new URLSearchParams(sp.toString());
      params.set("ppage", String(p));
      router.replace(`/glev-ops/crm?${params.toString()}`);
    });
  }

  return (
    <div style={{ opacity: isPending ? 0.6 : 1 }}>
      <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche: Name, E-Mail…" style={{ ...inputBase, minWidth: 260, marginBottom: 12, display: "block" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>{filtered.length} Einträge</p>
        <button
          type="button"
          style={csvBtn}
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            exportCsv(
              filtered.map((r) => ({
                name: r.full_name ?? "",
                email: r.email,
                status: r.status ?? "",
                trial_ends_at: r.trial_ends_at ?? "",
                current_period_end: r.current_period_end ?? "",
                session_id: r.stripe_session_id ?? "",
                created_at: r.created_at ?? "",
              })),
              [
                { key: "name", header: "Name" },
                { key: "email", header: "E-Mail" },
                { key: "status", header: "Status" },
                { key: "trial_ends_at", header: "Trial endet" },
                { key: "current_period_end", header: "Period endet" },
                { key: "session_id", header: "Session-ID" },
                { key: "created_at", header: "Erstellt" },
              ],
              `crm-pro-${today}.csv`,
            );
          }}
        >
          ↓ CSV exportieren
        </button>
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onGo={goPage} />}
      <div style={tableWrap}>
        <table style={tableBase}>
          <thead>
            <tr style={{ background: "#f8f8f8" }}>
              <Th>{"Name"}</Th><Th>{"E-Mail"}</Th><Th>{"Status"}</Th><Th>{"Trial endet"}</Th><Th>{"Period endet"}</Th><Th>{"Session-ID"}</Th><Th>{"Erstellt"}</Th><Th>{"Fall"}</Th><Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#999" }}>Keine Einträge.</td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                <Td>{r.full_name ?? "—"}</Td>
                <Td>
                  <Link href={r.user_id ? `/glev-ops/users/${r.user_id}` : `/glev-ops/users?q=${encodeURIComponent(r.email)}`} style={emailLink}>{r.email}</Link>
                </Td>
                <Td>{r.status ?? "—"}</Td>
                <Td>{fmtDateTime(r.trial_ends_at)}</Td>
                <Td>{fmtDateTime(r.current_period_end)}</Td>
                <Td mono title={r.stripe_session_id ?? undefined}>{fmtSessionId(r.stripe_session_id)}</Td>
                <Td>{fmtDateTime(r.created_at)}</Td>
                <Td><CaseStatusCell rowKey={`pro-${r.id}`} /></Td>
                <Td>
                  <Link href={r.user_id ? `/glev-ops/users/${r.user_id}` : `/glev-ops/users?q=${encodeURIComponent(r.email)}`} style={openBtn}>Öffnen →</Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && <Pagination page={page} total={totalPages} onGo={goPage} style={{ marginTop: 12 }} />}
    </div>
  );
}

function Pagination({ page, total, onGo, style }: { page: number; total: number; onGo: (p: number) => void; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, ...style }}>
      <button type="button" disabled={page <= 1} onClick={() => onGo(page - 1)} style={pageBtnStyle(page <= 1)}>← Vorherige</button>
      <span style={{ fontSize: 13, color: "#444" }}>Seite {page} von {total}</span>
      <button type="button" disabled={page >= total} onClick={() => onGo(page + 1)} style={pageBtnStyle(page >= total)}>Nächste →</button>
    </div>
  );
}

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return { padding: "7px 14px", background: disabled ? "#f0f0f0" : "#111", color: disabled ? "#aaa" : "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? "default" : "pointer" };
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#6b7280", textAlign: "left", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: 0.4 }}>{children}</th>;
}
function Td({ children, mono, title }: { children: React.ReactNode; mono?: boolean; title?: string }) {
  return <td title={title} style={{ padding: "8px 12px", fontSize: 13, color: "#111", verticalAlign: "middle", whiteSpace: "nowrap", fontFamily: mono ? "ui-monospace, monospace" : undefined }}>{children}</td>;
}

const tabBarStyle: React.CSSProperties = { display: "flex", gap: 2, borderBottom: "2px solid #e5e7eb", marginBottom: 0 };
const tabStyle: React.CSSProperties = { padding: "10px 16px", background: "transparent", border: "none", borderBottom: "2px solid transparent", marginBottom: -2, fontSize: 14, fontWeight: 500, color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit", whiteSpace: "nowrap" };
const tabActiveStyle: React.CSSProperties = { ...tabStyle, color: "#111", borderBottom: "2px solid #111", fontWeight: 700 };
const countPill: React.CSSProperties = { background: "#f3f4f6", color: "#6b7280", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: 600 };
const countActivePill: React.CSSProperties = { ...countPill, background: "#111", color: "#fff" };
const tableWrap: React.CSSProperties = { overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 };
const tableBase: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const inputBase: React.CSSProperties = { padding: "9px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, fontFamily: "inherit" };
const selectBase: React.CSSProperties = { ...inputBase, minWidth: 140, background: "#fff", cursor: "pointer" };
const filterChip: React.CSSProperties = { padding: "6px 12px", borderRadius: 999, border: "1px solid #ddd", background: "#fff", color: "#333", fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const filterChipActive: React.CSSProperties = { ...filterChip, background: "#111", color: "#fff", border: "1px solid #111" };
const emailLink: React.CSSProperties = { color: "#1d4ed8", textDecoration: "none", fontWeight: 500, fontSize: 13 };
const openBtn: React.CSSProperties = { fontSize: 12, color: "#3b4cdc", textDecoration: "none", fontWeight: 600 };
const giftBadge: React.CSSProperties = { background: "#fef9c3", color: "#92400e", border: "1px solid #fde68a", padding: "2px 6px", borderRadius: 4, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" };
const flagBadge: React.CSSProperties = { background: "#f3f4f6", color: "#374151", fontSize: 11, padding: "2px 6px", borderRadius: 4 };
const badgeMeta: React.CSSProperties = { background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 };
const badgeDefault: React.CSSProperties = { background: "#f3f4f6", color: "#6b7280", borderRadius: 4, padding: "2px 7px", fontSize: 11 };
const badgeClicked: React.CSSProperties = { background: "#ecfdf5", color: "#059669", border: "1px solid #a7f3d0", borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const badgeActive: React.CSSProperties = { background: "#dcfce7", color: "#166534", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 };
const badgeExpired: React.CSSProperties = { background: "#fef2f2", color: "#991b1b", borderRadius: 4, padding: "2px 7px", fontSize: 11 };
const badgePending: React.CSSProperties = { background: "#fefce8", color: "#854d0e", borderRadius: 4, padding: "2px 7px", fontSize: 11 };
const badgeWarn: React.CSSProperties = { background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 };
const ctxMenuItem: React.CSSProperties = { display: "block", width: "100%", padding: "10px 14px", background: "none", border: "none", textAlign: "left", fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: "#111" };
const csvBtn: React.CSSProperties = { padding: "6px 14px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151", fontFamily: "inherit", whiteSpace: "nowrap" };
