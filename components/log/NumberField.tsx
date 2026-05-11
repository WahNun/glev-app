"use client";

// Big mono numeric text input with optional unit suffix. Drop-in
// replacement for SnapSlider when the user already knows the exact
// value (insulin units, fingerstick mg/dL, exercise duration). Keeps
// the user's exact typed value — no snapping, no clamping while
// typing. Validation/clamping happens at submit time in the parent.

import React, { useId } from "react";

const BORDER = "var(--border)";

interface NumberFieldProps {
  value: string;
  onChange: (v: string) => void;
  /** Hex theme accent for the big read-out. */
  accent: string;
  /** HTML5 numeric attributes — used for picker UX, not validation. */
  min?: number;
  max?: number;
  step?: number;
  /** Optional unit shown right of the value ("IE", "mg/dL", "min"). */
  unit?: string;
  /** Placeholder when empty — defaults to an em-dash. */
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
}

export default function NumberField({
  value, onChange, accent, min, max, step, unit,
  placeholder = "—", ariaLabel, id,
}: NumberFieldProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  return (
    <div style={{
      background: "var(--input-bg)",
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: "12px 14px",
      display: "flex", alignItems: "baseline", gap: 8,
    }}>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        style={{
          flex: 1, minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: accent,
          fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em",
          fontFamily: "var(--font-mono)",
          padding: 0,
          MozAppearance: "textfield",
        }}
      />
      {unit && (
        <span style={{
          fontSize: 13, fontWeight: 700, color: "var(--text-muted)",
          letterSpacing: "0.02em", textTransform: "uppercase",
        }}>{unit}</span>
      )}
    </div>
  );
}
