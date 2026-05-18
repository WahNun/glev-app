"use client";

import { useId } from "react";

/**
 * Reusable date+time editor for entry editors. Wraps a native
 * <input type="datetime-local"> with consistent Glev styling (matches
 * the rest of the log forms).
 *
 * Stores values as local-wallclock strings ("YYYY-MM-DDTHH:mm") —
 * the caller converts to/from ISO via the helpers below so the value
 * shown in the input is what the user actually typed, regardless of
 * timezone. Storage in the DB is timestamptz, so on save the caller
 * applies `localToIso()` before sending the PATCH.
 *
 * Use cases:
 * - Meal time edit (existing in MealEditor)
 * - Exercise started_at / ended_at
 * - Symptom occurred_at, Influence occurred_at
 * - Bolus / Basal / Cycle / Fingerstick created_at
 *
 * Validation: the caller should reject future timestamps + values
 * older than a sensible window (e.g. 30 days) at PATCH time.
 */

interface DateTimeFieldProps {
  label: string;
  /** Local-wallclock value formatted "YYYY-MM-DDTHH:mm". */
  value: string;
  onChange: (next: string) => void;
  accent: string;
  /** Optional hint shown under the input — e.g. CGM auto-fill status. */
  hint?: string;
  /** When true, the input is read-only (e.g. Apple-Health-locked rows). */
  disabled?: boolean;
  disabledHint?: string;
  /** Caps the picker. Defaults to "now" so users can't pick the future. */
  max?: string;
  /** Floor for the picker. Defaults to 30 days ago. */
  min?: string;
}

export default function DateTimeField({
  label,
  value,
  onChange,
  accent,
  hint,
  disabled,
  disabledHint,
  max,
  min,
}: DateTimeFieldProps) {
  const id = useId();
  const nowLocal = isoToLocal(new Date().toISOString());
  const defaultMin = isoToLocal(new Date(Date.now() - 30 * 86400000).toISOString());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={id}
        style={{
          fontSize: 13,
          color: "var(--text-dim)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>{label}</span>
        {disabled && disabledHint && (
          <span
            title={disabledHint}
            style={{
              fontSize: 11,
              color: "var(--text-faint)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            (gesperrt)
          </span>
        )}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        min={min ?? defaultMin}
        max={max ?? nowLocal}
        style={{
          background: "var(--input-bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "12px 14px",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-strong)",
          outline: "none",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.01em",
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          width: "100%",
          // iOS Safari renders an empty box without this — give the
          // input a deterministic min-height so the layout doesn't
          // shift between platforms.
          minHeight: 44,
          colorScheme: "dark",
        }}
      />
      {hint && (
        <div
          style={{
            fontSize: 12,
            color: accent,
            letterSpacing: "0.02em",
            lineHeight: 1.4,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/** Convert an ISO timestamp to the local-wallclock string the
 *  `datetime-local` input expects ("YYYY-MM-DDTHH:mm"). Returns empty
 *  string for null/invalid input. */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** Convert a local-wallclock string ("YYYY-MM-DDTHH:mm") back to ISO,
 *  treating the wallclock as the user's current local timezone. */
export function localToIso(local: string): string | null {
  if (!local || !local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
