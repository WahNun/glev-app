"use client";

import { useState } from "react";
import { insertInsulinLog } from "@/lib/insulin";
import { insertExerciseLog } from "@/lib/exercise";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const ORANGE = "#FF9500";
const PINK   = "#FF2D78";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.08)";

const inp: React.CSSProperties = {
  background: "#0D0D12",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: "11px 14px",
  color: "#fff",
  fontSize: 14,
  outline: "none",
  width: "100%",
};
const card: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: "20px 24px",
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.4)",
  display: "block",
  marginBottom: 6,
};

/** Pull current CGM reading; null on any failure (network, no LLU, 401). */
async function pullCurrentCgm(): Promise<number | null> {
  try {
    const r = await fetch("/api/cgm/latest", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.current?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Inline Bolus/Basal toggle. */
function Segmented<T extends string>({
  value, options, onChange, accent,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  accent: string;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${options.length},1fr)`,
      gap: 6,
      background: "#0D0D12",
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: 4,
    }}>
      {options.map(opt => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: on ? `${accent}22` : "transparent",
              color: on ? accent : "rgba(255,255,255,0.55)",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function StatusBanner({ status, accent }: { status: Status; accent: string }) {
  if (status.kind === "idle") return null;
  if (status.kind === "submitting") {
    return (
      <div style={{
        marginTop: 14, padding: "10px 14px",
        background: "rgba(255,255,255,0.04)", borderRadius: 10,
        fontSize: 12, color: "rgba(255,255,255,0.55)",
      }}>
        Wird gespeichert…
      </div>
    );
  }
  if (status.kind === "ok") {
    return (
      <div style={{
        marginTop: 14, padding: "12px 14px",
        background: `${accent}14`, border: `1px solid ${accent}33`, borderRadius: 10,
        fontSize: 13, color: accent, fontWeight: 600,
      }}>
        {status.message}
      </div>
    );
  }
  return (
    <div style={{
      marginTop: 14, padding: "12px 14px",
      background: `${PINK}14`, border: `1px solid ${PINK}33`, borderRadius: 10,
      fontSize: 13, color: PINK, fontWeight: 600,
    }}>
      {status.message}
    </div>
  );
}

export function InsulinForm() {
  const [type, setType] = useState<"bolus" | "basal">("bolus");
  const [name, setName] = useState("");
  const [units, setUnits] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const placeholder = type === "bolus" ? "Fiasp" : "Tresiba";
  const u = parseFloat(units);
  const valid = type && name.trim().length > 0 && Number.isFinite(u) && u > 0 && u <= 100;

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    const cgm = await pullCurrentCgm();
    try {
      await insertInsulinLog({
        insulin_type: type,
        insulin_name: name.trim(),
        units: u,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
      });
      setStatus({
        kind: "ok",
        message: cgm != null
          ? `Geloggt — ${u}u ${type === "bolus" ? "Bolus" : "Basal"} (${name.trim()}) bei ${Math.round(cgm)} mg/dL.`
          : `Geloggt — ${u}u ${type === "bolus" ? "Bolus" : "Basal"} (${name.trim()}). Kein CGM-Wert verfügbar.`,
      });
      setUnits("");
      setNotes("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
      setStatus({ kind: "error", message: `Speichern fehlgeschlagen: ${msg}` });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${GREEN}20`, border: `1px solid ${GREEN}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 2v20M2 12h20" />
          </svg>
        </span>
        Insulin loggen
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>Typ</label>
          <Segmented<"bolus" | "basal">
            value={type}
            onChange={setType}
            accent={GREEN}
            options={[
              { value: "bolus", label: "Bolus" },
              { value: "basal", label: "Basal" },
            ]}
          />
        </div>
        <div>
          <label style={labelStyle}>Insulin-Name</label>
          <input
            style={inp}
            placeholder={placeholder}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Einheiten</label>
          <input
            style={inp}
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0.5"
            max="100"
            placeholder="z.B. 6"
            value={units}
            onChange={e => setUnits(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Notiz (optional)</label>
          <input
            style={inp}
            placeholder="z.B. vor Mahlzeit, Korrektur, …"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!valid || status.kind === "submitting"}
        style={{
          marginTop: 18, width: "100%", padding: "13px",
          borderRadius: 12, border: "none",
          background: valid ? GREEN : "rgba(255,255,255,0.05)",
          color: valid ? "#0A0A0E" : "rgba(255,255,255,0.25)",
          fontSize: 14, fontWeight: 800,
          cursor: valid ? "pointer" : "not-allowed",
          transition: "all 0.15s",
        }}
      >
        Log Insulin
      </button>

      <StatusBanner status={status} accent={GREEN} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "rgba(255,255,255,0.03)", borderRadius: 10,
        fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5,
      }}>
        Glev rechnet keine Dosen — du gibst ein, was du gespritzt hast. Der CGM-Wert wird beim Absenden automatisch gezogen.
      </div>
    </div>
  );
}

export function ExerciseForm() {
  const [type, setType] = useState<"hypertrophy" | "cardio">("hypertrophy");
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState<"low" | "medium" | "high">("medium");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const d = parseInt(duration, 10);
  const valid = Number.isFinite(d) && d > 0 && d <= 600;

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    const cgm = await pullCurrentCgm();
    try {
      await insertExerciseLog({
        exercise_type: type,
        duration_minutes: d,
        intensity,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
      });
      const typeLabel = type === "hypertrophy" ? "Hypertrophy" : "Cardio";
      setStatus({
        kind: "ok",
        message: cgm != null
          ? `Geloggt — ${d} min ${typeLabel} (${intensity}) bei ${Math.round(cgm)} mg/dL.`
          : `Geloggt — ${d} min ${typeLabel} (${intensity}). Kein CGM-Wert verfügbar.`,
      });
      setDuration("");
      setNotes("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
      setStatus({ kind: "error", message: `Speichern fehlgeschlagen: ${msg}` });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${ORANGE}20`, border: `1px solid ${ORANGE}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 6.5l11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7" />
          </svg>
        </span>
        Exercise loggen
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>Typ</label>
          <Segmented<"hypertrophy" | "cardio">
            value={type}
            onChange={setType}
            accent={ORANGE}
            options={[
              { value: "hypertrophy", label: "Hypertrophy" },
              { value: "cardio", label: "Cardio" },
            ]}
          />
        </div>
        <div>
          <label style={labelStyle}>Dauer (Minuten)</label>
          <input
            style={inp}
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            max="600"
            placeholder="z.B. 45"
            value={duration}
            onChange={e => setDuration(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Intensität</label>
          <Segmented<"low" | "medium" | "high">
            value={intensity}
            onChange={setIntensity}
            accent={ORANGE}
            options={[
              { value: "low",    label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high",   label: "High" },
            ]}
          />
        </div>
        <div>
          <label style={labelStyle}>Notiz (optional)</label>
          <input
            style={inp}
            placeholder="z.B. Beine, Intervalle, …"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!valid || status.kind === "submitting"}
        style={{
          marginTop: 18, width: "100%", padding: "13px",
          borderRadius: 12, border: "none",
          background: valid ? ORANGE : "rgba(255,255,255,0.05)",
          color: valid ? "#0A0A0E" : "rgba(255,255,255,0.25)",
          fontSize: 14, fontWeight: 800,
          cursor: valid ? "pointer" : "not-allowed",
          transition: "all 0.15s",
        }}
      >
        Log Exercise
      </button>

      <StatusBanner status={status} accent={ORANGE} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "rgba(255,255,255,0.03)", borderRadius: 10,
        fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5,
      }}>
        Der CGM-Wert beim Loggen hilft Glev, Bewegung mit Glukose-Reaktionen zu verknüpfen.
      </div>
    </div>
  );
}

export default function EngineLogTab() {
  return (
    <div>
      <style>{`
        @media (max-width: 720px) {
          .glev-log-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div
        className="glev-log-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}
      >
        <InsulinForm />
        <ExerciseForm />
      </div>

      <div style={{
        marginTop: 20, padding: "14px 18px",
        background: "rgba(255,255,255,0.03)", borderRadius: 12, border: `1px solid ${BORDER}`,
      }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
          <strong style={{ color: "rgba(255,255,255,0.4)" }}>Hinweis:</strong> Insulin- und
          Exercise-Logs sind reine Dokumentation. Glev berechnet keine Dosen und gibt
          keine Empfehlungen zur Insulingabe — das ist Sache deines Diabetes-Teams.
        </div>
      </div>

      {/* keep ACCENT in scope for future tab additions without lint warnings */}
      <span style={{ display: "none", color: ACCENT }} />
    </div>
  );
}
