"use client";

import { useState } from "react";
import type { BulkSmsResult } from "@/app/api/admin/bulk-sms/route";

type State = "idle" | "confirming" | "sending" | "done";

export default function BulkSmsButton() {
  const [state, setState] = useState<State>("idle");
  const [results, setResults] = useState<BulkSmsResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/admin/bulk-sms", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { results?: BulkSmsResult[]; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
        setState("idle");
        return;
      }
      setResults(data.results ?? []);
      setState("done");
    } catch (e) {
      setError(String(e));
      setState("idle");
    }
  }

  const sent    = results.filter((r) => r.status === "sent").length;
  const noPhone = results.filter((r) => r.status === "no_phone").length;
  const failed  = results.filter((r) => r.status === "link_error" || r.status === "sms_error").length;

  return (
    <div style={{ marginBottom: 12 }}>
      {state === "idle" && (
        <button
          onClick={() => setState("confirming")}
          style={{
            padding: "7px 14px",
            background: "#1d4ed8",
            color: "white",
            border: "none",
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          📨 SMS an alle Meta-Leads senden
        </button>
      )}

      {state === "confirming" && (
        <div style={{
          background: "#fffbeb",
          border: "1px solid #fbbf24",
          borderRadius: 8,
          padding: "12px 14px",
          fontSize: 13,
          maxWidth: 480,
        }}>
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
            Wirklich SMS an alle Meta-Leads mit Telefonnummer schicken?
          </p>
          <p style={{ margin: "0 0 12px", color: "#92400e" }}>
            Es wird ein frischer Invite-Link generiert und per Twilio verschickt. Nur Leads mit gespeicherter Telefonnummer erhalten eine SMS.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={send}
              style={{
                padding: "7px 14px",
                background: "#1d4ed8",
                color: "white",
                border: "none",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Ja, senden
            </button>
            <button
              onClick={() => setState("idle")}
              style={{
                padding: "7px 14px",
                background: "#f1f5f9",
                color: "#374151",
                border: "none",
                borderRadius: 7,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {state === "sending" && (
        <div style={{ fontSize: 13, color: "#666", padding: "8px 0" }}>
          ⏳ Sende SMS …
        </div>
      )}

      {error && (
        <div style={{ color: "#c00", fontSize: 13, marginTop: 6 }}>
          Fehler: {error}
        </div>
      )}

      {state === "done" && (
        <div style={{
          background: "#f0fdf4",
          border: "1px solid #86efac",
          borderRadius: 8,
          padding: "12px 14px",
          fontSize: 13,
          maxWidth: 560,
        }}>
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
            ✓ Fertig — {sent} SMS versendet · {noPhone} ohne Nummer · {failed > 0 ? `${failed} Fehler` : "0 Fehler"}
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #dcfce7" }}>
                <th style={{ textAlign: "left", padding: "3px 8px 3px 0", color: "#374151" }}>E-Mail</th>
                <th style={{ textAlign: "left", padding: "3px 8px", color: "#374151" }}>Telefon</th>
                <th style={{ textAlign: "left", padding: "3px 0 3px 8px", color: "#374151" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.userId} style={{ borderBottom: "1px solid #f0fdf4" }}>
                  <td style={{ padding: "3px 8px 3px 0", color: "#374151" }}>{r.email}</td>
                  <td style={{ padding: "3px 8px", color: "#374151" }}>{r.phone ?? "—"}</td>
                  <td style={{ padding: "3px 0 3px 8px" }}>
                    {r.status === "sent"       && <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Gesendet</span>}
                    {r.status === "no_phone"   && <span style={{ color: "#9ca3af" }}>— Keine Nummer</span>}
                    {r.status === "link_error" && <span style={{ color: "#dc2626" }}>✗ Link-Fehler: {r.error}</span>}
                    {r.status === "sms_error"  && <span style={{ color: "#dc2626" }}>✗ SMS-Fehler: {r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => { setState("idle"); setResults([]); }}
            style={{
              marginTop: 10,
              padding: "5px 12px",
              background: "#f1f5f9",
              border: "none",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
              color: "#374151",
            }}
          >
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
