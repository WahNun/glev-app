"use client";

import { useState } from "react";
import type { BulkSmsResult } from "@/app/api/admin/bulk-sms/route";
import type { BackfillPhoneResult } from "@/app/api/admin/backfill-phones/route";

type State = "idle" | "confirming" | "backfilling" | "sending" | "done";

export default function BulkSmsButton() {
  const [state, setState] = useState<State>("idle");
  const [backfillResults, setBackfillResults] = useState<BackfillPhoneResult[]>([]);
  const [smsResults, setSmsResults] = useState<BulkSmsResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("backfilling");
    setError(null);

    // Schritt 1: Telefonnummern aus meta_leads → user_metadata backfill
    try {
      const bRes = await fetch("/api/admin/backfill-phones", {
        method: "POST",
        credentials: "include",
      });
      const bData = await bRes.json() as { results?: BackfillPhoneResult[]; error?: string };
      if (!bRes.ok || bData.error) {
        setError(bData.error ?? `Backfill HTTP ${bRes.status}`);
        setState("idle");
        return;
      }
      setBackfillResults(bData.results ?? []);
    } catch (e) {
      setError(String(e));
      setState("idle");
      return;
    }

    // Schritt 2: Bulk-SMS senden
    setState("sending");
    try {
      const sRes = await fetch("/api/admin/bulk-sms", {
        method: "POST",
        credentials: "include",
      });
      const sData = await sRes.json() as { results?: BulkSmsResult[]; error?: string };
      if (!sRes.ok || sData.error) {
        setError(sData.error ?? `SMS HTTP ${sRes.status}`);
        setState("idle");
        return;
      }
      setSmsResults(sData.results ?? []);
      setState("done");
    } catch (e) {
      setError(String(e));
      setState("idle");
    }
  }

  const smsSent    = smsResults.filter((r) => r.status === "sent").length;
  const smsNoPhone = smsResults.filter((r) => r.status === "no_phone").length;
  const smsFailed  = smsResults.filter((r) => r.status === "link_error" || r.status === "sms_error").length;
  const backfilled = backfillResults.filter((r) => r.status === "updated").length;

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
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
            SMS an alle Meta-Leads schicken?
          </p>
          <p style={{ margin: "0 0 12px", color: "#92400e", lineHeight: 1.4 }}>
            Lädt zuerst Telefonnummern aus der meta_leads-Tabelle, dann generiert für jeden Lead mit Nummer einen frischen Invite-Link und schickt eine SMS.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={run}
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

      {state === "backfilling" && (
        <div style={{ fontSize: 13, color: "#666", padding: "8px 0" }}>
          ⏳ Lade Telefonnummern aus meta_leads …
        </div>
      )}

      {state === "sending" && (
        <div style={{ fontSize: 13, color: "#666", padding: "8px 0" }}>
          ⏳ Sende SMS ({backfilled} Nummern geladen) …
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
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            ✓ {smsSent} SMS versendet · {smsNoPhone} ohne Nummer · {smsFailed > 0 ? `${smsFailed} Fehler` : "0 Fehler"}
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280" }}>
            {backfilled} Nummern aus meta_leads geladen
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
              {smsResults.map((r) => (
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
            onClick={() => { setState("idle"); setSmsResults([]); setBackfillResults([]); }}
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
