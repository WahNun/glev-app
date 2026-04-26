"use client";

import { useEffect, useRef, useState } from "react";
import { insertFingerstick, type FingerstickReading } from "@/lib/fingerstick";

const ACCENT  = "#4F6EF7";
const PINK    = "#FF2D78";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.08)";

/**
 * Tiny inline modal for logging a manual fingerstick (capillary blood)
 * glucose reading. Designed to sit on top of the dashboard / engine and
 * be a 2-tap interaction:
 *
 *   1. Open dialog (caller's button)
 *   2. Type value
 *   3. Save
 *
 * Defaults to "now" — no datetime picker per product spec. After a
 * successful save the parent receives the new reading via `onSaved`
 * so it can refresh its readings array (RollingChart, current value).
 */
export default function FingerstickQuickInput({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (r: FingerstickReading) => void;
}) {
  const [value, setValue]   = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const inputRef            = useRef<HTMLInputElement>(null);

  // Reset + autofocus on open. Important: clearing on close stops a
  // stale value from flashing if the user re-opens immediately.
  useEffect(() => {
    if (!open) return;
    setValue("");
    setErr(null);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Close on Escape — same pattern as ManualEntryModal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    setErr(null);
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n < 20 || n > 600) {
      setErr("Bitte 20–600 mg/dL eingeben.");
      return;
    }
    setSaving(true);
    try {
      const r = await insertFingerstick({ value_mg_dl: n });
      onSaved(r);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 360,
          background: `linear-gradient(135deg, ${ACCENT}10, ${SURFACE})`,
          border: `1px solid ${ACCENT}30`,
          borderRadius: 16, padding: "18px 18px 16px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              color: ACCENT, textTransform: "uppercase",
            }}>
              Fingerstick
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginTop: 2 }}>
              Manueller Glucose-Wert
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "rgba(255,255,255,0.5)", fontSize: 18, padding: 4,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Big numeric input */}
        <div>
          <label style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
            display: "block", marginBottom: 6,
          }}>
            mg/dL
          </label>
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={20}
            max={600}
            step={1}
            placeholder="z.B. 124"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "14px 16px",
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              color: "#fff",
              fontSize: 28, fontWeight: 700,
              fontFamily: "var(--font-mono)",
              letterSpacing: "-0.02em",
              textAlign: "center",
              outline: "none",
            }}
          />
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 6, textAlign: "center" }}>
            Wird mit aktueller Zeit gespeichert. Überschreibt CGM-Wert für 5 Minuten.
          </div>
        </div>

        {err && (
          <div style={{
            padding: "10px 12px", borderRadius: 10,
            background: `${PINK}15`, border: `1px solid ${PINK}40`,
            color: PINK, fontSize: 12,
          }}>
            {err}
          </div>
        )}

        {/* Save / Cancel */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: "12px", borderRadius: 12,
              border: `1px solid ${BORDER}`, background: "transparent",
              color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !value}
            style={{
              flex: 2, padding: "12px", borderRadius: 12, border: "none",
              background: saving || !value
                ? `${ACCENT}40`
                : `linear-gradient(135deg, ${ACCENT}, #3B5BE0)`,
              color: "#fff", fontSize: 14, fontWeight: 700,
              cursor: saving || !value ? "not-allowed" : "pointer",
              boxShadow: !saving && value ? `0 4px 18px ${ACCENT}40` : "none",
            }}
          >
            {saving ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
