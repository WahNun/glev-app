"use client";

import { useState } from "react";

type State = "idle" | "loading" | "success" | "conflict" | "error";

type ResultData = {
  ok?: boolean;
  leadId?: string | null;
  userId?: string;
  crmUrl?: string;
  message?: string;
  error?: string;
};

export default function TestLeadInjector() {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<ResultData | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("loading");
    setResult(null);

    const fd = new FormData(e.currentTarget);
    const email     = String(fd.get("email")      ?? "").trim().toLowerCase();
    const phone     = String(fd.get("phone")      ?? "").trim();
    const firstName = String(fd.get("first_name") ?? "").trim();
    const lastName  = String(fd.get("last_name")  ?? "").trim();

    try {
      const res = await fetch("/api/admin/inject-test-lead", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, firstName, lastName }),
      });
      const data = (await res.json()) as ResultData;

      if (res.status === 409) {
        setState("conflict");
        setResult(data);
      } else if (!res.ok) {
        setState("error");
        setResult(data);
      } else {
        setState("success");
        setResult(data);
        (e.target as HTMLFormElement).reset();
      }
    } catch (err) {
      setState("error");
      setResult({ error: String(err) });
    }
  }

  return (
    <section style={panelStyle}>
      <h2 style={panelTitle}>🧪 Test-Lead Injection</h2>
      <p style={hintStyle}>
        Legt einen synthetischen Lead an — triggert <strong>Welcome-SMS + E-Mail</strong> sofort.
        Kein Meta-Webhook nötig, kein CPL-Drift. Feld wird als{" "}
        <code style={{ fontSize: 11, background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}>is_synthetic_test=true</code>{" "}
        markiert.
      </p>

      <form onSubmit={handleSubmit} style={flexForm}>
        <input
          name="first_name"
          type="text"
          placeholder="Vorname"
          style={inputStyle}
          disabled={state === "loading"}
        />
        <input
          name="last_name"
          type="text"
          placeholder="Nachname"
          style={inputStyle}
          disabled={state === "loading"}
        />
        <input
          name="email"
          type="email"
          required
          placeholder="E-Mail *"
          style={{ ...inputStyle, flex: "1 1 200px" }}
          disabled={state === "loading"}
        />
        <input
          name="phone"
          type="tel"
          placeholder="+4917612345678"
          style={{ ...inputStyle, minWidth: 160 }}
          disabled={state === "loading"}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          style={{
            ...btnStyle,
            background: state === "loading" ? "#6b7280" : "#7c3aed",
            cursor: state === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {state === "loading" ? "⏳ Injiziere …" : "Synthetic Lead anlegen →"}
        </button>
      </form>

      {state === "success" && result && (
        <div style={{ ...feedbackBox, background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46", marginTop: 10 }}>
          <strong>✓ {result.message}</strong>
          {result.leadId && (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              Lead-ID: <code>{result.leadId}</code>
              {" · "}
              <a href={result.crmUrl} style={{ color: "#047857", fontWeight: 600 }}>
                → CRM öffnen
              </a>
            </div>
          )}
          {result.userId && (
            <div style={{ marginTop: 2, fontSize: 12 }}>
              Auth-User-ID:{" "}
              <a
                href={`/glev-ops/users/${result.userId}`}
                style={{ color: "#047857", fontWeight: 600 }}
              >
                {result.userId}
              </a>
            </div>
          )}
        </div>
      )}

      {state === "conflict" && result && (
        <div style={{ ...feedbackBox, background: "#fffbeb", borderColor: "#fcd34d", color: "#92400e", marginTop: 10 }}>
          <strong>⚠ {result.error}</strong>
          {result.leadId && (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              Bestehende Lead-ID: <code>{result.leadId}</code>
            </div>
          )}
        </div>
      )}

      {state === "error" && result && (
        <div style={{ ...feedbackBox, background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b", marginTop: 10 }}>
          <strong>✗ Fehler:</strong> {result.error}
        </div>
      )}
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  border: "1px solid #ddd6fe",
  borderRadius: 10,
  padding: "16px 18px",
  background: "#faf5ff",
};
const panelTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: "0 0 6px", color: "#5b21b6" };
const hintStyle: React.CSSProperties = { fontSize: 12, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.5 };
const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  minWidth: 120,
};
const btnStyle: React.CSSProperties = {
  padding: "8px 16px",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
};
const flexForm: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" };
const feedbackBox: React.CSSProperties = { padding: "10px 14px", borderRadius: 8, border: "1px solid", fontSize: 13 };
