"use client";

import { useEffect, useMemo, useState } from "react";
import type { InsulinEntry, InsulinKind } from "@/lib/insulin";

const ACCENT = "#4F6EF7";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.08)";
const PINK = "#FF2D78";
const ORANGE = "#FF9500";

const KIND_OPTIONS: ReadonlyArray<{ value: InsulinKind; label: string; hint: string }> = [
  { value: "bolus", label: "Bolus", hint: "Mahlzeiten-Insulin (kurzwirksam)" },
  { value: "correction", label: "Korrektur", hint: "Bolus zwischen Mahlzeiten" },
  { value: "basal", label: "Basal", hint: "Langwirksames Insulin" },
];

function toDatetimeLocal(d: Date): string {
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDtToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function InsulinEntryModal({
  open,
  onClose,
  onCreated,
  defaultKind = "bolus",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (entry: InsulinEntry) => void;
  defaultKind?: InsulinKind;
}) {
  const nowDt = useMemo(() => toDatetimeLocal(new Date()), [open]);
  const [units, setUnits] = useState("");
  const [kind, setKind] = useState<InsulinKind>(defaultKind);
  const [at, setAt] = useState(nowDt);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUnits("");
      setKind(defaultKind);
      setAt(toDatetimeLocal(new Date()));
      setNote("");
      setErr(null);
      setBusy(false);
    }
  }, [open, defaultKind]);

  if (!open) return null;

  const unitsNum = (() => {
    const n = parseFloat(units.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  })();
  const validUnits = Number.isFinite(unitsNum) && unitsNum > 0 && unitsNum <= 100;

  function bumpUnits(delta: number) {
    const next = Math.max(0, Math.min(100, (Number.isFinite(unitsNum) ? unitsNum : 0) + delta));
    setUnits(String(Math.round(next * 2) / 2));
  }

  async function submit() {
    setErr(null);
    if (!validUnits) {
      setErr("Einheiten zwischen 0,5 und 100");
      return;
    }
    const iso = localDtToIso(at);
    if (!iso) {
      setErr("Ungültige Zeit");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/insulin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units: Math.round(unitsNum * 2) / 2,
          kind,
          at: iso,
          note: note.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const m = typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
        throw new Error(m);
      }
      const entry = (json as { entry?: InsulinEntry }).entry;
      if (!entry) throw new Error("Antwort ohne entry");
      onCreated(entry);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 18,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          color: "#fff",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Insulin eintragen</h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.55)",
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            background: "rgba(255,149,0,0.08)",
            border: `1px solid rgba(255,149,0,0.25)`,
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12,
            color: ORANGE,
            lineHeight: 1.5,
          }}
        >
          Glev rechnet keine Dosen — du gibst ein, was du gespritzt hast.
        </div>

        <Field label="Typ">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {KIND_OPTIONS.map((k) => {
              const active = k.value === kind;
              return (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  style={{
                    padding: "10px 6px",
                    borderRadius: 10,
                    border: `1px solid ${active ? ACCENT : BORDER}`,
                    background: active ? `${ACCENT}1a` : "transparent",
                    color: active ? "#fff" : "rgba(255,255,255,0.75)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            {KIND_OPTIONS.find((k) => k.value === kind)?.hint}
          </div>
        </Field>

        <Field label="Einheiten">
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <Stepper onClick={() => bumpUnits(-0.5)} disabled={busy}>−</Stepper>
            <input
              inputMode="decimal"
              value={units}
              onChange={(e) => setUnits(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="0,0"
              style={{
                flex: 1,
                background: "#0A0A0F",
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                padding: "12px 14px",
                color: "#fff",
                fontSize: 18,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                textAlign: "center",
                fontWeight: 600,
              }}
            />
            <Stepper onClick={() => bumpUnits(+0.5)} disabled={busy}>+</Stepper>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            Schritte 0,5 IE · max. 100 IE
          </div>
        </Field>

        <Field label="Zeit">
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            style={{
              background: "#0A0A0F",
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "10px 12px",
              color: "#fff",
              fontSize: 15,
              width: "100%",
              colorScheme: "dark",
            }}
          />
        </Field>

        <Field label="Notiz (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="z. B. Snack, Korrektur nach Sport"
            style={{
              background: "#0A0A0F",
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "10px 12px",
              color: "#fff",
              fontSize: 14,
              width: "100%",
            }}
          />
        </Field>

        {err && (
          <div
            style={{
              fontSize: 13,
              color: PINK,
              background: "rgba(255,45,120,0.1)",
              border: `1px solid rgba(255,45,120,0.3)`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: "#fff",
              cursor: busy ? "default" : "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={busy || !validUnits}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              border: "none",
              background: validUnits ? ACCENT : "rgba(79,110,247,0.4)",
              color: "#fff",
              cursor: busy || !validUnits ? "default" : "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {busy ? "Speichert…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Stepper({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 48,
        background: "#0A0A0F",
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        color: "#fff",
        fontSize: 22,
        cursor: disabled ? "default" : "pointer",
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}
