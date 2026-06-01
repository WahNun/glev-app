"use client";

import { useState } from "react";

const DEFAULT_MESSAGE =
  "[TEST] Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test hier: https://glev.app/auth/confirm?token=TEST";

type Result = {
  ok: boolean;
  sid?: string;
  status?: string;
  to?: string;
  numSegments?: string;
  error?: string;
};

export default function SmsTestPage() {
  const [phone, setPhone] = useState("+49");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const charCount = (useCustom ? message : DEFAULT_MESSAGE).length;
  const segments = Math.ceil(charCount / 153);

  async function send() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sms-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          message: useCustom ? message : undefined,
        }),
      });
      const data = await res.json() as Result;
      setResult(data);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 20, margin: "0 0 6px", fontWeight: 700 }}>SMS Test</h1>
      <p style={{ fontSize: 13, color: "#666", margin: "0 0 28px" }}>
        Sendet eine echte Twilio-SMS an eine beliebige Nummer — ohne Meta-Lead-Formular.
      </p>

      <section style={cardStyle}>
        <h2 style={h2}>Empfänger</h2>
        <label style={labelStyle}>
          Telefonnummer (E.164-Format)
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+4917612345678"
            style={inputStyle}
          />
          <span style={{ fontSize: 11, color: "#888" }}>
            Beginnt mit + und Ländervorwahl — z.B. +49 für Deutschland
          </span>
        </label>
      </section>

      <section style={cardStyle}>
        <h2 style={h2}>Nachricht</h2>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={useCustom}
            onChange={(e) => setUseCustom(e.target.checked)}
          />
          Eigenen Text schreiben (statt Standard-Template)
        </label>

        {useCustom ? (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
          />
        ) : (
          <div style={previewStyle}>{DEFAULT_MESSAGE}</div>
        )}

        <div style={{ marginTop: 8, fontSize: 12, color: segments > 1 ? "#b45309" : "#666" }}>
          {charCount} Zeichen · {segments} {segments === 1 ? "Segment" : "Segmente"}{" "}
          {segments > 1 && "· wird als 2 SMS abgerechnet"}
        </div>
      </section>

      <button
        type="button"
        onClick={send}
        disabled={loading || !phone.startsWith("+")}
        style={btnStyle(loading || !phone.startsWith("+"))}
      >
        {loading ? "Sende…" : "📨 Test-SMS senden"}
      </button>

      {result && (
        <section style={{ ...cardStyle, marginTop: 20, borderColor: result.ok ? "#bbf7d0" : "#fecaca", background: result.ok ? "#f0fdf4" : "#fff1f2" }}>
          {result.ok ? (
            <>
              <p style={{ color: "#166534", fontWeight: 600, fontSize: 14, margin: "0 0 8px" }}>
                ✓ SMS verschickt
              </p>
              <table style={{ fontSize: 13, borderCollapse: "collapse" }}>
                <tbody>
                  {[
                    ["Twilio SID", result.sid],
                    ["Status", result.status],
                    ["An", result.to],
                    ["Segmente", result.numSegments],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ color: "#555", paddingRight: 16, paddingBottom: 4, whiteSpace: "nowrap" }}>{k}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace", color: "#111" }}>{v ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p style={{ color: "#991b1b", fontSize: 13, margin: 0 }}>
              ✗ {result.error ?? "Unbekannter Fehler"}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 600,
  margin: "0 auto",
  color: "#111",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "18px 20px",
  marginBottom: 16,
  background: "#fff",
};

const h2: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "0 0 12px",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const previewStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "10px 12px",
  fontSize: 13,
  color: "#374151",
  fontFamily: "ui-monospace, monospace",
  wordBreak: "break-all",
  lineHeight: 1.5,
};

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "11px 22px",
    background: disabled ? "#d1d5db" : "#111",
    color: disabled ? "#9ca3af" : "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
  };
}
