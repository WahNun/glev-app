"use client";

import { useState, useEffect, useCallback } from "react";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.08)";

interface GlucoseResponse {
  connected: boolean;
  glucose?: number | null;
  timestamp?: string | null;
  error?: string;
}

/**
 * Junction LibreView connect card. Sits BELOW the existing CgmSettingsCard
 * (LibreLink-Up direct credentials) — both flows are kept in parallel so
 * users can choose. This card uses the Junction Link hosted flow:
 *   • If connected: green dot + "LibreView verbunden" + last reading.
 *   • If not:       blue button "LibreView verbinden" → POST /api/cgm/connect
 *                   → window.location to the returned connect_url.
 *
 * On-mount, we GET /api/cgm/glucose once to determine state. The endpoint
 * never blocks (returns { connected: false } on any error), so the card
 * always settles into a usable state quickly.
 */
export default function JunctionCgmCard() {
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [state, setState] = useState<GlucoseResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const r = await fetch("/api/cgm/glucose", { cache: "no-store" });
      const j = (await r.json()) as GlucoseResponse;
      setState(j);
    } catch (e) {
      setState({ connected: false });
      setErrorMsg(e instanceof Error ? e.message : "Status konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh state on return-from-connect (the redirect lands on
  // /settings?cgm=connected, so we just re-poll once on URL change).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("cgm") === "connected") {
      void refresh();
      // Clean the query string so refreshing the page doesn't re-trigger.
      url.searchParams.delete("cgm");
      window.history.replaceState({}, "", url.toString());
    }
  }, [refresh]);

  async function handleConnect() {
    setConnecting(true);
    setErrorMsg("");
    try {
      const r = await fetch("/api/cgm/connect", { method: "POST" });
      const j = (await r.json()) as { connect_url?: string; error?: string };
      if (!r.ok || !j.connect_url) {
        throw new Error(j.error || `Status ${r.status}`);
      }
      window.location.href = j.connect_url;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Verbinden fehlgeschlagen.");
      setConnecting(false);
    }
  }

  const connected = !!state?.connected;
  const last = state?.glucose;
  const lastWhen = state?.timestamp ? new Date(state.timestamp) : null;

  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>
            LibreView (Junction)
          </span>
          {!loading && connected && (
            <span
              aria-label="verbunden"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: GREEN,
                boxShadow: `0 0 8px ${GREEN}`,
              }}
            />
          )}
        </div>
        {connected && (
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              padding: "4px 10px",
              borderRadius: 99,
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: "rgba(255,255,255,0.55)",
              fontSize: 11,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "…" : "Aktualisieren"}
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 14 }}>
        Verbinde dein LibreView-Konto über Junction. Glev liest dann automatisch
        deinen aktuellen Glukose-Wert in den Engine-Tab.
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Lade Status…</div>
      ) : connected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, color: GREEN, fontWeight: 600 }}>✓ LibreView verbunden</div>
          {typeof last === "number" ? (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
              Letzte Messung: <strong style={{ color: "#fff" }}>{last} mg/dL</strong>
              {lastWhen && (
                <> · {lastWhen.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Noch keine Werte — Junction synchronisiert nach dem ersten Scan.
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={connecting}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: connecting ? "rgba(79,110,247,0.4)" : ACCENT,
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            cursor: connecting ? "wait" : "pointer",
            transition: "background 0.2s",
          }}
        >
          {connecting ? "Verbinde…" : "LibreView verbinden"}
        </button>
      )}

      {errorMsg && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: 8,
            background: `${PINK}15`,
            border: `1px solid ${PINK}40`,
            color: PINK,
            fontSize: 11,
          }}
        >
          {errorMsg}
        </div>
      )}
    </div>
  );
}
