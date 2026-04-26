"use client";

import { useEffect, useId, useState } from "react";
import {
  insertFingerstick,
  fetchLatestFingerstick,
  type FingerstickReading,
} from "@/lib/fingerstick";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.08)";

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatLatestWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const startOfToday     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 3600 * 1000;
  const t = d.getTime();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = pad(d.getHours()), mm = pad(d.getMinutes());
  if (t >= startOfToday)     return `heute ${hh}:${mm}`;
  if (t >= startOfYesterday) return `gestern ${hh}:${mm}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${hh}:${mm}`;
}

export default function FingerstickLogCard() {
  const [value, setValue]       = useState<string>("");
  const [whenLocal, setWhenLocal] = useState<string>(() => toLocalInputValue(new Date()));
  const [note, setNote]         = useState<string>("");
  const [busy, setBusy]         = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [latest, setLatest]     = useState<FingerstickReading | null>(null);

  const valueId = useId();
  const whenId  = useId();
  const noteId  = useId();

  useEffect(() => {
    fetchLatestFingerstick().then(setLatest).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const num = Number(value.replace(",", "."));
    if (!Number.isFinite(num) || num < 20 || num > 600) {
      setFeedback({ kind: "err", msg: "Wert muss zwischen 20 und 600 mg/dL liegen." });
      return;
    }

    let measuredAt: string | undefined;
    if (whenLocal) {
      const d = new Date(whenLocal);
      if (isNaN(d.getTime())) {
        setFeedback({ kind: "err", msg: "Ungültiger Zeitpunkt." });
        return;
      }
      measuredAt = d.toISOString();
    }

    setBusy(true);
    try {
      const saved = await insertFingerstick({
        value_mg_dl: num,
        measured_at: measuredAt,
        notes: note.trim() || null,
      });
      setLatest(saved);
      setValue("");
      setNote("");
      setWhenLocal(toLocalInputValue(new Date()));
      setFeedback({ kind: "ok", msg: "Gespeichert ✓" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Speichern fehlgeschlagen.";
      setFeedback({ kind: "err", msg });
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: "10px 12px",
    color: "#fff",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      borderRadius: 14,
      padding: "14px 14px 12px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div>
        <div style={{
          fontSize:9, fontWeight:700, letterSpacing:"0.1em",
          color:"rgba(255,255,255,0.4)", textTransform:"uppercase",
        }}>Finger-Stick Glukose</div>
        <div style={{
          marginTop: 4,
          fontSize: 13, fontWeight: 600, color: "#fff", lineHeight: 1.3,
        }}>
          Manuelle Messung erfassen
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={valueId} style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.04em" }}>
              Wert
            </label>
            <input
              id={valueId}
              type="number"
              inputMode="decimal"
              min={20}
              max={600}
              step={1}
              placeholder="mg/dL"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              required
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={whenId} style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.04em" }}>
              Zeitpunkt
            </label>
            <input
              id={whenId}
              type="datetime-local"
              value={whenLocal}
              onChange={(e) => setWhenLocal(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor={noteId} style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.04em" }}>
            Notiz (optional)
          </label>
          <input
            id={noteId}
            type="text"
            placeholder='z.B. "vor dem Sport"'
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={inputStyle}
            maxLength={200}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              background: busy ? `${ACCENT}66` : ACCENT,
              color: "#fff",
              fontSize: 12, fontWeight: 700, letterSpacing: "0.02em",
              cursor: busy ? "default" : "pointer",
              transition: "background 120ms ease",
            }}
          >
            {busy ? "Speichern…" : "Speichern"}
          </button>
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: 12, fontWeight: 600,
              color: feedback?.kind === "ok" ? GREEN : PINK,
              minHeight: 16,
            }}
          >
            {feedback?.msg ?? ""}
          </span>
        </div>
      </form>

      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>
        {latest
          ? <>Letzter Wert: <span style={{ color: "#fff", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{Math.round(latest.value_mg_dl)} mg/dL</span> · {formatLatestWhen(latest.measured_at)}</>
          : <>Noch keine manuellen Werte erfasst.</>}
      </div>

      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.4, fontStyle: "italic" }}>
        Unabhängig vom CGM — nur manuell erfasste Werte.
      </div>
    </div>
  );
}
