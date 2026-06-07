"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";

type FeedbackRow = {
  id: string;
  created_at: string;
  user_email: string | null;
  source: string;
  category: string;
  severity: string;
  what_noticed: string;
  where_noticed: string | null;
  what_broken: string | null;
  what_wished: string | null;
  free_text: string;
  ai_summary: string | null;
  platform: string | null;
  app_version: string | null;
  screen_context: string | null;
  status: string;
  admin_notes: string | null;
  triaged_at: string | null;
  resolved_at: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  new: "#ef4444",
  triaged: "#f59e0b",
  in_progress: "#3b82f6",
  resolved: "#10b981",
  wont_fix: "#6b7280",
  duplicate: "#8b5cf6",
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: "🐛 Bug",
  feature_request: "✨ Feature",
  complaint: "😤 Beschwerde",
  praise: "🙏 Lob",
  question: "❓ Frage",
  other: "💬 Sonstiges",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "#6b7280",
  medium: "#f59e0b",
  high: "#ef4444",
  critical: "#7f1d1d",
};

const STATUS_OPTIONS = ["new", "triaged", "in_progress", "resolved", "wont_fix", "duplicate"];

export default function FeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FeedbackRow | null>(null);
  const [notesInput, setNotesInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (filterStatus) params.set("status", filterStatus);
    if (filterCategory) params.set("category", filterCategory);
    if (filterSeverity) params.set("severity", filterSeverity);
    if (filterPlatform) params.set("platform", filterPlatform);
    if (filterDateFrom) params.set("date_from", filterDateFrom);
    if (filterDateTo) params.set("date_to", filterDateTo);

    const res = await fetch(`/api/admin/feedback?${params}`);
    if (res.status === 401) { setAuthed(false); setLoading(false); return; }
    setAuthed(true);
    const json = await res.json() as { rows: FeedbackRow[]; total: number };
    setRows(json.rows);
    setTotal(json.total);
    setLoading(false);
  }, [page, filterStatus, filterCategory, filterSeverity, filterPlatform, filterDateFrom, filterDateTo]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = (row: FeedbackRow) => {
    setSelected(row);
    setNotesInput(row.admin_notes ?? "");
  };

  const patchRow = async (id: string, patch: Record<string, unknown>) => {
    setSaving(true);
    await fetch("/api/admin/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    setSaving(false);
    await load();
    if (selected?.id === id) {
      setSelected((prev) => prev ? { ...prev, ...patch } as FeedbackRow : null);
    }
  };

  const PAGE_SIZE = 50;

  if (authed === false) {
    return (
      <div style={{ padding: 40, fontFamily: "monospace" }}>
        <h2>Nicht autorisiert</h2>
        <a href="/glev-ops/login">Zum Admin-Login →</a>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", fontSize: 13 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>User-Feedback</h1>

      {/* Filter Bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
          style={selectStyle}>
          <option value="">Alle Status</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(0); }}
          style={selectStyle}>
          <option value="">Alle Kategorien</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterSeverity} onChange={(e) => { setFilterSeverity(e.target.value); setPage(0); }}
          style={selectStyle}>
          <option value="">Alle Severity</option>
          {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterPlatform} onChange={(e) => { setFilterPlatform(e.target.value); setPage(0); }}
          style={selectStyle}>
          <option value="">Alle Plattformen</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
          <option value="web">Web</option>
        </select>
        <input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(0); }}
          placeholder="Von" style={selectStyle} />
        <input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(0); }}
          placeholder="Bis" style={selectStyle} />
        <button onClick={() => {
          setFilterStatus(""); setFilterCategory(""); setFilterSeverity("");
          setFilterPlatform(""); setFilterDateFrom(""); setFilterDateTo(""); setPage(0);
        }} style={{ ...selectStyle, cursor: "pointer", background: "#f3f4f6" }}>
          Zurücksetzen
        </button>
      </div>

      {/* Stats */}
      <div style={{ marginBottom: 12, color: "#6b7280" }}>
        {total} Einträge total · Seite {page + 1} von {Math.max(1, Math.ceil(total / PAGE_SIZE))}
      </div>

      {loading ? <div style={{ color: "#9ca3af" }}>Lade…</div> : (
        <>
          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={th}>Datum</th>
                  <th style={th}>User</th>
                  <th style={th}>Kategorie</th>
                  <th style={th}>Severity</th>
                  <th style={th}>Summary</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#9ca3af" }}>
                    Keine Einträge gefunden.
                  </td></tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id}
                    onClick={() => openDetail(row)}
                    style={{
                      borderBottom: "1px solid #f3f4f6",
                      cursor: "pointer",
                      background: selected?.id === row.id ? "#eff6ff" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (selected?.id !== row.id) (e.currentTarget as HTMLTableRowElement).style.background = "#f9fafb"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = selected?.id === row.id ? "#eff6ff" : "transparent"; }}
                  >
                    <td style={td}>{new Date(row.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={td}>{row.user_email ? row.user_email.replace(/(.{3}).*(@.*)/, "$1…$2") : "–"}</td>
                    <td style={td}>{CATEGORY_LABELS[row.category] ?? row.category}</td>
                    <td style={td}>
                      <span style={{ color: SEVERITY_COLORS[row.severity] ?? "#374151", fontWeight: 600 }}>
                        {row.severity}
                      </span>
                    </td>
                    <td style={{ ...td, maxWidth: 300 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.ai_summary ?? row.what_noticed}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: (STATUS_COLORS[row.status] ?? "#6b7280") + "22",
                        color: STATUS_COLORS[row.status] ?? "#6b7280",
                      }}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={btnStyle}>← Zurück</button>
            <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)} style={btnStyle}>Weiter →</button>
          </div>
        </>
      )}

      {/* Detail Sheet (slide-in from right) */}
      {selected && (
        <div style={{
          position: "fixed", top: 0, right: 0, width: 480, height: "100dvh",
          background: "#fff", boxShadow: "-4px 0 20px rgba(0,0,0,0.12)",
          overflowY: "auto", padding: 24, zIndex: 100,
        }}>
          <button onClick={() => setSelected(null)} style={{ ...btnStyle, marginBottom: 16 }}>✕ Schließen</button>

          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            {CATEGORY_LABELS[selected.category] ?? selected.category} — {selected.severity.toUpperCase()}
          </h2>
          <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 16 }}>
            {new Date(selected.created_at).toLocaleString("de-DE")} · {selected.user_email ?? selected.user_email ?? "Unbekannt"} · {selected.platform ?? "–"} {selected.app_version ? `v${selected.app_version}` : ""}
          </div>

          <Section label="Was beobachtet">{selected.what_noticed}</Section>
          {selected.where_noticed && <Section label="Wo">{selected.where_noticed}</Section>}
          {selected.what_broken && <Section label="Was kaputt">{selected.what_broken}</Section>}
          {selected.what_wished && <Section label="Wunsch">{selected.what_wished}</Section>}
          {selected.ai_summary && <Section label="AI-Summary">{selected.ai_summary}</Section>}
          <Section label="Originaltext">
            <span style={{ fontStyle: "italic", color: "#6b7280" }}>{selected.free_text}</span>
          </Section>

          {/* Status Dropdown */}
          <div style={{ marginTop: 20 }}>
            <label style={{ fontWeight: 600, fontSize: 12, color: "#374151" }}>Status</label>
            <select
              value={selected.status}
              onChange={(e) => { void patchRow(selected.id, { status: e.target.value }); setSelected((prev) => prev ? { ...prev, status: e.target.value } : null); }}
              style={{ ...selectStyle, display: "block", marginTop: 4, width: "100%" }}
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Admin Notes */}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontWeight: 600, fontSize: 12, color: "#374151" }}>Admin-Notizen</label>
            <textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              rows={4}
              style={{ ...selectStyle, display: "block", marginTop: 4, width: "100%", resize: "vertical" }}
            />
            <button
              disabled={saving || notesInput === selected.admin_notes}
              onClick={() => { void patchRow(selected.id, { admin_notes: notesInput }); }}
              style={{ ...btnStyle, marginTop: 8, background: "#4F6EF7", color: "#fff" }}
            >
              {saving ? "Speichert…" : "Notizen speichern"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#111827" }}>{children}</div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  fontSize: 12,
  background: "#fff",
  color: "#374151",
};

const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  background: "#f9fafb",
  color: "#374151",
};

const th: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 600,
  color: "#6b7280",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  color: "#111827",
  verticalAlign: "top",
};
