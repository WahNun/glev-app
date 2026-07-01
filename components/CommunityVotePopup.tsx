"use client";

import { useState, useEffect, useCallback } from "react";
import type { VoteSession } from "@/lib/community/types";

const DISMISSED_KEY = "glev:dismissed_vote_sessions";
const ACCENT = "#4F6EF7";

function getDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveDismissed(sessionId: string) {
  try {
    const existing = getDismissed();
    if (!existing.includes(sessionId)) {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...existing, sessionId]));
    }
  } catch { /* localStorage unavailable */ }
}

type State =
  | { phase: "idle" }
  | { phase: "open"; session: VoteSession }
  | { phase: "submitting"; session: VoteSession; selectedOptionId: string }
  | { phase: "done" };

export default function CommunityVotePopup() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/community/votes/current", { credentials: "include" });
        if (!res.ok || cancelled) return;

        const data = (await res.json()) as {
          session: VoteSession | null;
          has_voted: boolean;
          voting_enabled: boolean;
        };

        if (!data.session || data.has_voted || !data.voting_enabled) return;
        if (getDismissed().includes(data.session.id)) return;

        if (!cancelled) {
          setState({ phase: "open", session: data.session });
        }
      } catch { /* network error — silently skip */ }
    }

    void check();
    return () => { cancelled = true; };
  }, []);

  const dismiss = useCallback((sessionId: string) => {
    saveDismissed(sessionId);
    setState({ phase: "idle" });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (state.phase !== "open" || !selectedOptionId) return;
    const session = state.session;

    setState({ phase: "submitting", session, selectedOptionId });
    setSubmitError("");

    try {
      const res = await fetch(`/api/community/votes/${session.id}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_option_id: selectedOptionId,
          free_text: freeText.trim() || undefined,
        }),
      });

      if (res.status === 409) {
        saveDismissed(session.id);
        setState({ phase: "done" });
        setTimeout(() => setState({ phase: "idle" }), 2000);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      saveDismissed(session.id);
      setState({ phase: "done" });
      setTimeout(() => setState({ phase: "idle" }), 2000);
    } catch (e) {
      setState({ phase: "open", session });
      setSubmitError(e instanceof Error ? e.message : "Fehler beim Absenden");
    }
  }, [state, selectedOptionId, freeText]);

  if (state.phase === "idle") return null;

  const session = state.phase === "open" || state.phase === "submitting" ? state.session : null;
  const submitting = state.phase === "submitting";
  const done = state.phase === "done";

  return (
    <>
      {/* backdrop */}
      <div
        onClick={() => session && dismiss(session.id)}
        style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      />

      {/* sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Community Abstimmung"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
          background: "var(--surface, #fff)",
          borderRadius: "20px 20px 0 0",
          padding: "20px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)",
          maxHeight: "80dvh",
          overflowY: "auto",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
        }}
      >
        {/* drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 99, background: "var(--border, #e5e7eb)", margin: "0 auto 16px" }} />

        {/* close button */}
        {session && !done && (
          <button
            type="button"
            onClick={() => dismiss(session.id)}
            aria-label="Schließen"
            style={{
              position: "absolute", top: 16, right: 16,
              width: 28, height: 28, borderRadius: "50%",
              border: "none", background: "var(--surface-soft, #f3f4f6)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-faint, #9ca3af)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {done ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🙌</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong, #111)" }}>
              Danke für dein Feedback!
            </div>
            <div style={{ fontSize: 14, color: "var(--text-faint, #6b7280)", marginTop: 4 }}>
              Deine Stimme wurde gezählt.
            </div>
          </div>
        ) : session ? (
          <>
            <div style={{ marginBottom: 18 }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                color: ACCENT, marginBottom: 8,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Community-Abstimmung
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong, #111)", margin: 0, lineHeight: 1.3 }}>
                {session.question}
              </h2>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {session.options.map((opt) => {
                const active = selectedOptionId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => setSelectedOptionId(opt.id)}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "13px 16px",
                      borderRadius: 12,
                      border: `1.5px solid ${active ? ACCENT : "var(--border, #e5e7eb)"}`,
                      background: active ? `${ACCENT}12` : "var(--surface-soft, #f9fafb)",
                      color: active ? ACCENT : "var(--text-strong, #111)",
                      fontSize: 14, fontWeight: active ? 600 : 500,
                      cursor: submitting ? "wait" : "pointer",
                      transition: "border-color 120ms, background 120ms, color 120ms",
                      fontFamily: "inherit",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "var(--text-faint, #9ca3af)", display: "block", marginBottom: 4 }}>
                Eigene Idee ergänzen <span style={{ opacity: 0.7 }}>(optional)</span>
              </label>
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                maxLength={200}
                disabled={submitting}
                placeholder="Dein Gedanke in ein paar Worten…"
                rows={2}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 12px", borderRadius: 10,
                  border: "1px solid var(--border, #e5e7eb)",
                  background: "var(--surface, #fff)",
                  color: "var(--text, #111)",
                  fontSize: 14, fontFamily: "inherit",
                  resize: "none", outline: "none",
                }}
              />
              {freeText.length > 180 && (
                <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "right", marginTop: 2 }}>
                  {200 - freeText.length} Zeichen übrig
                </div>
              )}
            </div>

            {submitError && (
              <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 10 }}>{submitError}</div>
            )}

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!selectedOptionId || submitting}
              style={{
                width: "100%", padding: "14px",
                borderRadius: 12, border: "none",
                background: selectedOptionId && !submitting
                  ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`
                  : "var(--border, #e5e7eb)",
                color: selectedOptionId && !submitting ? "#fff" : "var(--text-faint, #9ca3af)",
                fontSize: 15, fontWeight: 700, fontFamily: "inherit",
                cursor: selectedOptionId && !submitting ? "pointer" : "not-allowed",
                transition: "background 200ms",
              }}
            >
              {submitting ? "Wird gesendet…" : "Abstimmen"}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}
