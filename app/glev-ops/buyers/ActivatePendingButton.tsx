"use client";

import { useState } from "react";
import type { PendingTrialResult } from "@/app/api/admin/activate-pending-trials/route";

type State = "idle" | "running" | "done";

export default function ActivatePendingButton() {
  const [state, setState] = useState<State>("idle");
  const [results, setResults] = useState<PendingTrialResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("running");
    setError(null);
    try {
      const res = await fetch("/api/admin/activate-pending-trials", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { results?: PendingTrialResult[]; error?: string };
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

  const activated = results.filter((r) => r.status === "activated").length;
  const skipped   = results.filter((r) => r.status === "skipped").length;

  return (
    <div style={{ marginBottom: 8 }}>
      {state === "idle" && (
        <button
          onClick={run}
          style={{
            padding: "6px 13px",
            background: "#f59e0b",
            color: "white",
            border: "none",
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ⚡ Ausstehende Trials aktivieren
        </button>
      )}

      {state === "running" && (
        <span style={{ fontSize: 12, color: "#666" }}>⏳ Aktiviere …</span>
      )}

      {error && (
        <span style={{ fontSize: 12, color: "#c00" }}>Fehler: {error}</span>
      )}

      {state === "done" && (
        <div style={{ fontSize: 12, color: activated > 0 ? "#16a34a" : "#6b7280" }}>
          ✓ {activated} aktiviert · {skipped} übersprungen (noch nicht eingeloggt)
          {activated > 0 && (
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 16 }}>
              {results.filter((r) => r.status === "activated").map((r) => (
                <li key={r.userId}>{r.email}</li>
              ))}
            </ul>
          )}
          <button
            onClick={() => { setState("idle"); setResults([]); }}
            style={{ marginTop: 6, fontSize: 11, background: "none", border: "none", cursor: "pointer", color: "#6b7280", textDecoration: "underline" }}
          >
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
