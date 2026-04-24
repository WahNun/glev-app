"use client";

import { useState, useEffect, useCallback } from "react";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.08)";

interface StatusResponse {
  connected: boolean;
  email: string | null;
  region: string | null;
  tokenExpiresAt: string | null;
  lastConnectedAt: string | null;
  sessionHealth: "active" | "expiring_soon" | "expired" | "never_tested";
  lastReading: { value: number; trend: string; timestamp: string } | null;
}

interface LatestResponse {
  current: { value: number | null; unit: string; timestamp: string | null; trend: string } | null;
}

const card: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: "20px 24px",
};
const inp: React.CSSProperties = {
  background: "#0D0D12",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: "10px 14px",
  color: "#fff",
  fontSize: 16,
  outline: "none",
  width: "100%",
};
const label: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.4)",
  display: "block",
  marginBottom: 6,
};

export default function CgmSettingsCard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState("");

  const [showForm, setShowForm] = useState(false);

  const [cgmType, setCgmType] = useState("librelinkup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState<"EU" | "US">("EU");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError("");
    try {
      const res = await fetch("/api/cgm/status", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Fehler ${res.status}`);
      }
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setShowForm(!data.connected);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  function validateEmail(s: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    if (cgmType !== "librelinkup") {
      setFormError("Dieser CGM-Typ ist noch nicht verfügbar.");
      return;
    }
    if (!validateEmail(email)) {
      setFormError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (password.length < 1) {
      setFormError("Passwort darf nicht leer sein.");
      return;
    }
    if (region !== "EU" && region !== "US") {
      setFormError("Region muss EU oder US sein.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/cgm/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, region: region.toLowerCase() }),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Fehler ${res.status}`);
      }
      setFormSuccess(`Verbunden als ${email}`);
      setPassword("");
      await loadStatus();
      setShowForm(false);
      setTimeout(() => setFormSuccess(""), 4000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/cgm/latest", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Fehler ${res.status}`);
      const cur = (body as LatestResponse).current;
      if (!cur || cur.value == null) throw new Error("Keine Werte erhalten");
      setTestResult({ ok: true, msg: `${cur.value} mg/dL · ${cur.trend}` });
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : "Fehler" });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Verbindung zu LibreLinkUp wirklich trennen? Du kannst sie jederzeit neu einrichten.",
      )
    )
      return;
    setDisconnecting(true);
    setStatusError("");
    try {
      const res = await fetch("/api/cgm/credentials", {
        method: "DELETE",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Fehler ${res.status}`);
      }
      setTestResult(null);
      setEmail("");
      setPassword("");
      await loadStatus();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Trennen fehlgeschlagen");
    } finally {
      setDisconnecting(false);
    }
  }

  const connected = status?.connected === true;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* STATUS CARD */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          CGM-Verbindung
        </div>

        {loadingStatus ? (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
            Status wird geladen…
          </div>
        ) : statusError ? (
          <div style={{ fontSize: 13, color: PINK }}>Fehler: {statusError}</div>
        ) : connected ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 99,
                  background: GREEN,
                  boxShadow: `0 0 0 4px ${GREEN}22`,
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Verbunden mit LibreLinkUp
              </div>
            </div>
            {/* Session-Health-Indicator */}
            {(() => {
              const h = status?.sessionHealth;
              if (!h || h === "never_tested") {
                return (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>
                    Noch nie getestet – klicke "Verbindung testen" um den Status zu prüfen.
                  </div>
                );
              }
              const cfg: Record<string, { color: string; label: string }> = {
                active:        { color: GREEN,    label: "Session aktiv" },
                expiring_soon: { color: "#FF9500", label: "Session läuft bald ab – bitte testen" },
                expired:       { color: PINK,     label: "Session abgelaufen – bitte erneut verbinden" },
              };
              const { color, label } = cfg[h] ?? cfg.expired;
              const expiresAt = status?.tokenExpiresAt ? new Date(status.tokenExpiresAt) : null;
              const diffMin = expiresAt ? Math.round((expiresAt.getTime() - Date.now()) / 60_000) : null;
              const suffix =
                h === "active" && diffMin !== null && diffMin > 0
                  ? ` (noch ${diffMin} min)`
                  : h === "expiring_soon" && diffMin !== null && diffMin > 0
                  ? ` (noch ${diffMin} min)`
                  : h === "expired" && diffMin !== null
                  ? ` (vor ${Math.abs(diffMin)} min)`
                  : "";
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color }}>{label}{suffix}</span>
                </div>
              );
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>E-Mail</div>
                <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{status?.email}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Region</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{status?.region}</div>
              </div>
            </div>

            {testResult && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  marginBottom: 14,
                  fontSize: 13,
                  background: testResult.ok ? `${GREEN}10` : `${PINK}10`,
                  border: `1px solid ${testResult.ok ? GREEN : PINK}30`,
                  color: testResult.ok ? GREEN : PINK,
                }}
              >
                {testResult.ok ? "Letzter Wert: " : "Fehler: "}
                {testResult.msg}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                onClick={handleTest}
                disabled={testing}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${ACCENT}40`,
                  cursor: testing ? "wait" : "pointer",
                  background: `${ACCENT}15`,
                  color: ACCENT,
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: testing ? 0.6 : 1,
                }}
              >
                {testing ? "Teste…" : "Verbindung testen"}
              </button>
              <button
                onClick={() => {
                  setShowForm((v) => !v);
                  setFormError("");
                  setFormSuccess("");
                }}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  cursor: "pointer",
                  background: "transparent",
                  color: "rgba(255,255,255,0.7)",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {showForm ? "Abbrechen" : "Zugangsdaten ändern"}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${PINK}40`,
                  cursor: disconnecting ? "wait" : "pointer",
                  background: "transparent",
                  color: PINK,
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: disconnecting ? 0.6 : 1,
                }}
              >
                {disconnecting ? "Trenne…" : "Verbindung trennen"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 99,
                  background: "rgba(255,255,255,0.25)",
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 600 }}>Nicht verbunden</div>
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
              Verbinde dein LibreLinkUp-Konto unten, damit Glev deine Glukosewerte
              automatisch abrufen kann.
            </div>
          </div>
        )}
      </div>

      {/* HELP */}
      <div style={card}>
        <details style={{ cursor: "pointer" }}>
          <summary
            style={{
              fontSize: 13,
              fontWeight: 600,
              listStyle: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.85)",
            }}
          >
            Was ist LibreLinkUp und was brauche ich?
          </summary>
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.6,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <p style={{ margin: 0 }}>
              <strong style={{ color: "rgba(255,255,255,0.8)" }}>LibreLinkUp</strong> ist die
              Follower-App von Abbott. Glev nutzt sie, um deine Glukosewerte
              anzuzeigen.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "rgba(255,255,255,0.8)" }}>Voraussetzung:</strong> Du
              hast die LibreLink-App mit deinem Sensor eingerichtet UND in der
              LibreLink-App eine Verbindung zu einem LibreLinkUp-Konto geteilt
              (Einstellungen → Konten → LibreLinkUp → Follower hinzufügen).
            </p>
            <p style={{ margin: 0 }}>
              In dieses Formular gibst du die <strong style={{ color: "rgba(255,255,255,0.8)" }}>
                E-Mail und das Passwort des LibreLinkUp-Follower-Kontos
              </strong>{" "}
              ein – nicht die deines Haupt-LibreLink-Kontos.
            </p>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Hinweis zur Sicherheit: Das Passwort wird serverseitig mit
              AES-256-GCM verschlüsselt gespeichert.
            </p>
          </div>
        </details>
      </div>

      {/* FORM */}
      {showForm && (
        <form onSubmit={handleSubmit} style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
            {connected ? "Zugangsdaten ändern" : "Zugangsdaten eingeben"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={label} htmlFor="cgm-type">CGM-Typ</label>
              <select
                id="cgm-type"
                value={cgmType}
                onChange={(e) => setCgmType(e.target.value)}
                style={inp}
              >
                <option value="librelinkup">LibreLinkUp</option>
                <option value="dexcom" disabled>Dexcom (coming soon)</option>
                <option value="nightscout" disabled>Nightscout (coming soon)</option>
              </select>
            </div>

            {cgmType === "librelinkup" && (
              <>
                <div>
                  <label style={label} htmlFor="cgm-email">LibreLinkUp E-Mail</label>
                  <input
                    id="cgm-email"
                    style={inp}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="follower@example.com"
                  />
                </div>
                <div>
                  <label style={label} htmlFor="cgm-password">LibreLinkUp Passwort</label>
                  <input
                    id="cgm-password"
                    style={inp}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={label} htmlFor="cgm-region">Region</label>
                  <select
                    id="cgm-region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value as "EU" | "US")}
                    style={inp}
                  >
                    <option value="EU">EU</option>
                    <option value="US">US</option>
                  </select>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting || cgmType !== "librelinkup"}
              style={{
                padding: "12px 18px",
                borderRadius: 12,
                border: "none",
                cursor: submitting ? "wait" : "pointer",
                background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                boxShadow: `0 4px 20px ${ACCENT}40`,
                opacity: submitting || cgmType !== "librelinkup" ? 0.6 : 1,
                marginTop: 4,
              }}
            >
              {submitting ? "Verbinde…" : "Speichern & verbinden"}
            </button>

            {formError && (
              <div style={{ fontSize: 13, color: PINK, marginTop: 4 }}>{formError}</div>
            )}
            {formSuccess && (
              <div style={{ fontSize: 13, color: GREEN, marginTop: 4 }}>{formSuccess}</div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
