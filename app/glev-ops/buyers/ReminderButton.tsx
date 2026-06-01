"use client";

import { useState } from "react";
import type { ReminderResult } from "@/app/api/cron/remind-meta-leads/route";

type State = "idle" | "running" | "done";

export default function ReminderButton() {
  const [state, setState] = useState<State>("idle");
  const [results, setResults] = useState<ReminderResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("running");
    setError(null);
    try {
      const res = await fetch("/api/cron/remind-meta-leads", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { results?: ReminderResult[]; error?: string };
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

  const sent = results.filter((r) => r.sms === "sent").length;

  return (
    <div style={{ marginBottom: 8 }}>
      {state === "idle" && (
        <button
          onClick={run}
          style={{
            padding: "6px 13px",
            background: "#7c3aed",
            color: "white",
            border: "none",
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🔔 Reminder jetzt senden (24h-Leads)
        </button>
      )}
      {state === "running" && <span style={{ fontSize: 12, color: "#666" }}>⏳ Sende Reminder …</span>}
      {error && <span style={{ fontSize: 12, color: "#c00" }}>Fehler: {error}</span>}
      {state === "done" && (
        <div style={{ fontSize: 12, color: sent > 0 ? "#7c3aed" : "#6b7280" }}>
          ✓ {sent} SMS · {results.filter((r) => r.emailSent).length} E-Mails gesendet
          {results.length === 0 && " — keine offenen Leads nach 24h"}
          <button
            onClick={() => { setState("idle"); setResults([]); }}
            style={{ marginLeft: 10, fontSize: 11, background: "none", border: "none", cursor: "pointer", color: "#6b7280", textDecoration: "underline" }}
          >
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
