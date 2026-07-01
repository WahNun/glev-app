"use client";

import { useState, useEffect, useCallback } from "react";

export const dynamic = "force-dynamic";

type OptionWithCount = {
  id: string;
  label: string;
  cluster_id: string | null;
  vote_count: number;
};

type Session = {
  id: string;
  question: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  options: OptionWithCount[];
  total_votes: number;
};

const STATUS_COLORS: Record<string, string> = {
  draft:  "#f59e0b",
  active: "#10b981",
  closed: "#6b7280",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 99,
      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
      background: `${STATUS_COLORS[status] ?? "#6b7280"}18`,
      color: STATUS_COLORS[status] ?? "#6b7280",
      border: `1px solid ${STATUS_COLORS[status] ?? "#6b7280"}44`,
    }}>
      {status}
    </span>
  );
}

function PercentBar({ count, total }: { count: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#3b82f6", borderRadius: 99, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 12, color: "#6b7280", minWidth: 36, textAlign: "right" }}>
        {pct}% ({count})
      </span>
    </div>
  );
}

export default function CommunityAdminPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [question, setQuestion] = useState("");
  const [optionInputs, setOptionInputs] = useState(["", ""]);
  const [createStatus, setCreateStatus] = useState<"draft" | "active">("draft");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [actionPending, setActionPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/community/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sessions: Session[] };
      setSessions(data.sessions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = useCallback(async (id: string, status: string) => {
    setActionPending(id);
    try {
      const res = await fetch(`/api/admin/community/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      alert(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionPending(null);
    }
  }, [load]);

  const handleCreate = useCallback(async () => {
    if (!question.trim()) return;
    const opts = optionInputs.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) { setCreateError("Mindestens 2 Optionen nötig."); return; }
    if (opts.length > 4) { setCreateError("Maximal 4 Optionen erlaubt."); return; }

    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/admin/community/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), options: opts, status: createStatus }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setQuestion("");
      setOptionInputs(["", ""]);
      setCreateStatus("draft");
      setShowCreate(false);
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [question, optionInputs, createStatus, load]);

  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <main style={{ fontFamily: "system-ui, -apple-system, sans-serif", padding: 24, maxWidth: 900, margin: "0 auto", color: "#111", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Community Voting</h1>
          <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>Vote-Sessions erstellen, aktivieren und Ergebnisse einsehen.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}
        >
          {showCreate ? "Abbrechen" : "+ Session erstellen"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <section style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 18, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px", color: "#0369a1" }}>Neue Vote-Session</h2>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Frage</label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Was soll als nächstes gebaut werden?"
              maxLength={300}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: "1px solid #ccc", borderRadius: 7, fontSize: 14, fontFamily: "inherit" }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Optionen (2–4)</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {optionInputs.map((v, i) => (
                <div key={i} style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => {
                      const next = [...optionInputs];
                      next[i] = e.target.value;
                      setOptionInputs(next);
                    }}
                    placeholder={`Option ${i + 1}`}
                    maxLength={120}
                    style={{ flex: 1, padding: "8px 12px", border: "1px solid #ccc", borderRadius: 7, fontSize: 14, fontFamily: "inherit" }}
                  />
                  {optionInputs.length > 2 && (
                    <button type="button" onClick={() => setOptionInputs(optionInputs.filter((_, j) => j !== i))} style={{ padding: "0 10px", border: "1px solid #ccc", borderRadius: 7, background: "#f9fafb", cursor: "pointer", fontSize: 16, color: "#6b7280", fontFamily: "inherit" }}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              {optionInputs.length < 4 && (
                <button type="button" onClick={() => setOptionInputs([...optionInputs, ""])} style={{ alignSelf: "flex-start", padding: "5px 12px", border: "1px dashed #93c5fd", borderRadius: 7, background: "transparent", color: "#3b82f6", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  + Option hinzufügen
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Status beim Erstellen:</label>
            {(["draft", "active"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setCreateStatus(s)}
                style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  background: createStatus === s ? "#3b82f6" : "#f3f4f6",
                  color: createStatus === s ? "#fff" : "#374151",
                  border: `1.5px solid ${createStatus === s ? "#3b82f6" : "#d1d5db"}`,
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {createError && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{createError}</div>}

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !question.trim()}
            style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: creating || !question.trim() ? "#d1d5db" : "#3b82f6", color: "#fff", fontWeight: 700, fontSize: 14, cursor: creating || !question.trim() ? "not-allowed" : "pointer", fontFamily: "inherit" }}
          >
            {creating ? "Wird erstellt…" : "Session erstellen"}
          </button>
        </section>
      )}

      {/* Sessions list */}
      {loading && <p style={{ color: "#6b7280" }}>Lädt…</p>}
      {error && <p style={{ color: "#dc2626" }}>Fehler: {error}</p>}

      {!loading && !error && sessions.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af", border: "1px dashed #e5e7eb", borderRadius: 10 }}>
          Noch keine Sessions. Erstelle die erste oben.
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sessions.map((s) => {
            const isSelected = s.id === selectedId;
            return (
              <div key={s.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", userSelect: "none" }}
                  onClick={() => setSelectedId(isSelected ? null : s.id)}
                >
                  <StatusBadge status={s.status} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "#111" }}>{s.question}</span>
                  <span style={{ fontSize: 12, color: "#9ca3af", whiteSpace: "nowrap" }}>
                    {new Date(s.created_at).toLocaleDateString("de-DE")}
                  </span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{s.total_votes} Stimmen</span>
                  <span style={{ color: "#9ca3af", fontSize: 14 }}>{isSelected ? "▲" : "▼"}</span>
                </div>

                {isSelected && (
                  <div style={{ borderTop: "1px solid #e5e7eb", padding: "14px 16px", background: "#f9fafb" }}>
                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                      {s.status !== "active" && (
                        <button
                          type="button"
                          disabled={actionPending === s.id}
                          onClick={() => void updateStatus(s.id, "active")}
                          style={{ padding: "6px 14px", borderRadius: 7, border: "1.5px solid #10b981", background: "#ecfdf5", color: "#065f46", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Aktivieren
                        </button>
                      )}
                      {s.status !== "closed" && (
                        <button
                          type="button"
                          disabled={actionPending === s.id}
                          onClick={() => void updateStatus(s.id, "closed")}
                          style={{ padding: "6px 14px", borderRadius: 7, border: "1.5px solid #d1d5db", background: "#f3f4f6", color: "#374151", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          {actionPending === s.id ? "…" : "Schließen"}
                        </button>
                      )}
                      {s.status !== "draft" && (
                        <button
                          type="button"
                          disabled={actionPending === s.id}
                          onClick={() => void updateStatus(s.id, "draft")}
                          style={{ padding: "6px 14px", borderRadius: 7, border: "1.5px solid #d1d5db", background: "#f3f4f6", color: "#374151", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Draft setzen
                        </button>
                      )}
                    </div>

                    {/* Results */}
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                      Ergebnisse ({s.total_votes} Stimmen)
                    </div>
                    {s.options.length === 0 ? (
                      <p style={{ fontSize: 13, color: "#9ca3af" }}>Keine Optionen vorhanden.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {s.options.map((opt) => (
                          <div key={opt.id}>
                            <div style={{ fontSize: 13, color: "#374151", marginBottom: 3 }}>{opt.label}</div>
                            <PercentBar count={opt.vote_count} total={s.total_votes} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
