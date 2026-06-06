"use client";

import { useState, useRef } from "react";

type ImportResult = {
  ok: boolean;
  imported: number;
  already_existed: number;
  skipped: number;
  errors: { row: number; email: string; reason: string }[];
  total_data_rows: number;
  error?: string;
  headers?: string[];
};

type State = "idle" | "loading" | "done" | "error";

export default function CsvImporter() {
  const [state, setState] = useState<State>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setState("loading");
    setResult(null);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/admin/meta/csv-import", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = (await res.json()) as ImportResult;

      if (!res.ok || !data.ok) {
        setState("error");
        setResult(data);
      } else {
        setState("done");
        setResult(data);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (err) {
      setState("error");
      setResult({ ok: false, imported: 0, already_existed: 0, skipped: 0, errors: [], total_data_rows: 0, error: String(err) });
    }
  }

  return (
    <section style={panelStyle}>
      <h2 style={panelTitle}>📥 CSV-Import (Unterbrechungs-Backfill)</h2>
      <p style={hintStyle}>
        Lade das Kommo-Export-CSV hoch. Erkannte Spalten:{" "}
        <code style={code}>Name, Email, Phone, Stage</code>. Jede Zeile mit gültiger E-Mail
        wird per <code style={code}>provisionMetaLead</code> verarbeitet — idempotent, kein Duplikat.
        Test-Leads (<code style={code}>test@meta.com</code> oder Name enthält{" "}
        <code style={code}>&lt;test lead:</code>) werden übersprungen.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
        <input
          ref={fileRef}
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          disabled={state === "loading"}
          style={fileInputStyle}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          style={{
            ...btnStyle,
            background: state === "loading" ? "#6b7280" : "#0f766e",
            cursor: state === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {state === "loading" ? "⏳ Importiere …" : "CSV importieren →"}
        </button>
      </form>

      {state === "done" && result && (
        <div style={{ ...feedbackBox, background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46", marginTop: 12 }}>
          <strong>✓ Import abgeschlossen</strong>
          <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
            <span>🆕 <strong>{result.imported}</strong> neu provisioniert</span>
            <span>♻️ <strong>{result.already_existed}</strong> bereits vorhanden</span>
            <span>⏭️ <strong>{result.skipped}</strong> übersprungen</span>
            <span>📋 <strong>{result.total_data_rows}</strong> Zeilen gesamt</span>
          </div>
          {result.errors.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#b45309" }}>
                ⚠ {result.errors.length} Fehler — Details
              </summary>
              <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 12 }}>
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Zeile {e.row} — {e.email}: <em>{e.reason}</em>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {state === "error" && result && (
        <div style={{ ...feedbackBox, background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b", marginTop: 12 }}>
          <strong>✗ Fehler:</strong> {result.error ?? "Unbekannter Fehler"}
          {result.headers && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Erkannte Header: {result.headers.join(", ")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  border: "1px solid #99f6e4",
  borderRadius: 10,
  padding: "16px 18px",
  background: "#f0fdfa",
};
const panelTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: "0 0 6px", color: "#0f766e" };
const hintStyle: React.CSSProperties = { fontSize: 12, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.5 };
const code: React.CSSProperties = { fontSize: 11, background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 };
const fileInputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  flex: "1 1 240px",
};
const btnStyle: React.CSSProperties = {
  padding: "8px 16px",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
};
const feedbackBox: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  border: "1px solid",
  fontSize: 13,
  lineHeight: 1.5,
};
