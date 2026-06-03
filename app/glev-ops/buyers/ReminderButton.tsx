"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReminderResult } from "@/app/api/cron/remind-meta-leads/route";

type State = "idle" | "running" | "done";

export default function ReminderButton({ selectedIds }: { selectedIds?: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [results, setResults] = useState<ReminderResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isFiltered = selectedIds && selectedIds.length > 0;
  const label = isFiltered
    ? `🔔 Reminder an ${selectedIds.length} ausgewählte${selectedIds.length === 1 ? "n Lead" : " Leads"} (24h)`
    : "🔔 Reminder jetzt senden (24h-Leads)";

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function run() {
    setState("running");
    setError(null);
    try {
      const body = isFiltered ? JSON.stringify({ userIds: selectedIds }) : undefined;
      const res = await fetch("/api/cron/remind-meta-leads", {
        method: "POST",
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const data = await res.json() as { results?: ReminderResult[]; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
        setState("idle");
        return;
      }
      const fetched = data.results ?? [];
      setResults(fetched);
      setState("done");

      const sentCount = fetched.filter((r) => r.sms === "sent").length;
      const emailCount = fetched.filter((r) => r.emailSent).length;
      if (fetched.length === 0) {
        setToast("Keine offenen Leads nach 24h");
      } else {
        const parts: string[] = [];
        if (sentCount > 0) parts.push(`${sentCount} SMS`);
        if (emailCount > 0) parts.push(`${emailCount} E-Mail${emailCount === 1 ? "" : "s"}`);
        setToast(parts.length > 0 ? `✓ ${parts.join(" · ")} verschickt` : "Reminder verschickt");
      }

      router.refresh();
    } catch (e) {
      setError(String(e));
      setState("idle");
    }
  }

  const sent = results.filter((r) => r.sms === "sent").length;

  return (
    <>
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
            {label}
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

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: "#1e1b4b",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            animation: "glev-toast-in 0.18s ease",
            pointerEvents: "none",
          }}
        >
          {toast}
          <style>{`
            @keyframes glev-toast-in {
              from { opacity: 0; transform: translateY(10px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
