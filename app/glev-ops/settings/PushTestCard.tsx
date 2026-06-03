"use client";

import { useState } from "react";

export default function PushTestCard() {
  const [email, setEmail] = useState("lucas@wahnon-connect.com");
  const [sandbox, setSandbox] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function send() {
    if (pending) return;
    setPending(true);
    setResult(null);
    try {
      const cookiePair = document.cookie
        .split(";")
        .find((c) => c.trim().startsWith("glev_admin_token="));
      // Use slice(1).join("=") to preserve any "=" padding in Base64 tokens.
      const token = cookiePair
        ? cookiePair.trim().split("=").slice(1).join("=")
        : "";
      const res = await fetch("/api/admin/push-test", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, sandbox }),
      });
      const rawText = await res.text();
      let json: { ok?: boolean; error?: string; platform?: string; [k: string]: unknown } | null = null;
      try { json = JSON.parse(rawText); } catch { /* not JSON */ }

      if (json?.ok) {
        setResult({ ok: true, msg: `✅ Gesendet (${json.platform ?? "?"}, sandbox=${sandbox})` });
      } else if (json) {
        const detail = typeof json.error === "string" ? json.error
          : typeof json.stack === "string" ? json.stack.split("\n")[0]
          : JSON.stringify(json).slice(0, 300);
        setResult({ ok: false, msg: `❌ HTTP ${res.status} — ${detail}` });
      } else {
        // Server returned HTML or non-JSON — show status + first 300 chars so we can debug
        setResult({ ok: false, msg: `❌ HTTP ${res.status} — Server-Antwort kein JSON:\n${rawText.slice(0, 300)}` });
      }
    } catch (e) {
      setResult({ ok: false, msg: `❌ Netzwerkfehler: ${String(e)}` });
    } finally {
      setPending(false);
    }
  }

  return (
    <section style={{ background: "#f0f9ff", border: "1px solid #7dd3fc", borderRadius: 8, padding: 18, marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 6px", color: "#0369a1", fontWeight: 700 }}>
        Push-Benachrichtigung testen
      </h2>
      <p style={{ fontSize: 13, color: "#0369a1", margin: "0 0 14px", lineHeight: 1.5 }}>
        Schickt eine Test-Push an den hinterlegten APNs/FCM-Token des Users.
        Sandbox = false für TestFlight- und App-Store-Builds (Production-Token).
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ fontSize: 13, color: "#0c4a6e" }}>
          E-Mail des Users
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: "block", marginTop: 4, padding: "8px 10px", border: "1px solid #bae6fd", borderRadius: 6, fontSize: 14, width: "100%", maxWidth: 320 }}
          />
        </label>

        <label style={{ fontSize: 13, color: "#0c4a6e", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(e) => setSandbox(e.target.checked)}
          />
          Sandbox (nur für Xcode-Direkt-Builds; TestFlight = unchecked)
        </label>

        <div>
          <button
            onClick={send}
            disabled={pending || !email.trim()}
            style={{
              padding: "10px 16px",
              background: pending ? "#7dd3fc" : "#0284c7",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: pending ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "Sende…" : "Push senden"}
          </button>
        </div>

        {result && (
          <p style={{
            fontSize: 13,
            margin: 0,
            padding: "8px 12px",
            borderRadius: 6,
            background: result.ok ? "#ecfdf5" : "#fef2f2",
            color: result.ok ? "#047857" : "#dc2626",
            border: `1px solid ${result.ok ? "#a7f3d0" : "#fecaca"}`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>
            {result.msg}
          </p>
        )}
      </div>
    </section>
  );
}
