"use client";

// Big mono numeric text input with optional unit suffix and optional
// ± stepper buttons. Drop-in replacement for SnapSlider when the user
// already knows the exact value (insulin units, fingerstick mg/dL,
// exercise duration). Keeps the user's exact typed value — no
// snapping, no clamping while typing. Validation/clamping happens at
// submit time in the parent.
//
// Why `type="text"` + `inputMode="decimal"` instead of `type="number"`:
// HTML5 `<input type="number">` does NOT accept the German decimal
// comma — when a user types "7,5" the browser silently drops the
// comma and the bound state becomes "75" or empty depending on the
// engine. Using `type="text"` with a tolerant pattern lets us accept
// both "7.5" and "7,5" verbatim; the parent normalizes via
// `value.replace(",", ".")` at submit time.

import React, { useId } from "react";
import { hapticSelection } from "@/lib/haptics";

const BORDER = "var(--border)";

interface NumberFieldProps {
  value: string;
  onChange: (v: string) => void;
  /** Hex theme accent for the big read-out. */
  accent: string;
  /** Lower bound used by the ± stepper buttons (text input is unconstrained). */
  min?: number;
  /** Upper bound used by the ± stepper buttons (text input is unconstrained). */
  max?: number;
  /** Step used by the ± stepper buttons. Defaults to 1. */
  step?: number;
  /** Optional unit shown right of the value ("IE", "mg/dL", "min"). */
  unit?: string;
  /** Placeholder when empty — defaults to an em-dash. */
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  /** When true, render − / + stepper buttons that step by `step`. */
  showSteppers?: boolean;
}

export default function NumberField({
  value, onChange, accent, min, max, step = 1, unit,
  placeholder = "—", ariaLabel, id, showSteppers,
}: NumberFieldProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  function applyStep(direction: 1 | -1) {
    const parsed = Number((value ?? "").replace(",", "."));
    const base = Number.isFinite(parsed) ? parsed : (min ?? 0);
    const lo = min ?? -Infinity;
    const hi = max ?? Infinity;
    const next = Math.max(lo, Math.min(hi, base + direction * step));
    // Keep step precision (e.g. 0.5) without floating-point dust.
    const decimals = step < 1 ? Math.min(3, String(step).split(".")[1]?.length ?? 1) : 0;
    const rounded = Number(next.toFixed(decimals));
    hapticSelection();
    onChange(String(rounded));
  }

  const stepperBtn: React.CSSProperties = {
    flex: "0 0 auto",
    width: 40, height: 40,
    borderRadius: 10,
    border: `1px solid ${BORDER}`,
    background: "var(--surface-soft)",
    color: accent,
    fontSize: 22, fontWeight: 800, lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  };

  return (
    <div style={{
      background: "var(--input-bg)",
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: "10px 12px",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      {showSteppers && (
        <button
          type="button"
          onClick={() => applyStep(-1)}
          aria-label={`-${step}`}
          style={stepperBtn}
        >−</button>
      )}
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        // Tolerate both German comma and English dot. Parent normalizes
        // at submit time. Pattern is for the iOS keypad's "Done"
        // semantics + form validation — it is NOT used for live
        // filtering (that would block in-progress typing like "7,").
        pattern="[0-9]*[.,]?[0-9]*"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          // Strip anything that isn't a digit or one decimal separator
          // — preserves the user's typed comma vs dot choice while
          // blocking pasted garbage like "7.5IE".
          const raw = e.target.value;
          const cleaned = raw.replace(/[^0-9.,]/g, "");
          // Collapse multiple separators to the first one only.
          const firstSep = cleaned.search(/[.,]/);
          const normalized = firstSep === -1
            ? cleaned
            : cleaned.slice(0, firstSep + 1) + cleaned.slice(firstSep + 1).replace(/[.,]/g, "");
          onChange(normalized);
        }}
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
          textAlign: showSteppers ? "center" : "left",
        }}
      />
      {unit && (
        <span style={{
          fontSize: 13, fontWeight: 700, color: "var(--text-muted)",
          letterSpacing: "0.02em", textTransform: "uppercase",
        }}>{unit}</span>
      )}
      {showSteppers && (
        <button
          type="button"
          onClick={() => applyStep(1)}
          aria-label={`+${step}`}
          style={stepperBtn}
        >+</button>
      )}
    </div>
  );
}
