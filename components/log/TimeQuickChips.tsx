"use client";

/**
 * Reusable horizontal "time ago" chip row used by all log screens.
 * Originally extracted from `EngineLogTab` ExerciseForm's Started picker
 * (Now / 30m / 1h / 2h / 3h) so the same compact selector can be shared
 * by Bolus, Glukose, Mahlzeit, Übung, Symptom — a consistent look &
 * touch behaviour across the entire log surface.
 *
 * Visuals match the existing Segmented / PillRow controls so the new
 * pattern blends in without reskinning the rest of the form.
 *
 * Provides medium-tap haptic feedback on every selection (no haptic
 * on re-selecting the already-on chip — avoids buzzy double-fires).
 */

import React from "react";
import { hapticSelection } from "@/lib/haptics";

const BORDER = "var(--border)";

export interface TimeQuickChipOption {
  /** Numeric value persisted to state (typically minutes-ago, but free-form). */
  value: number;
  /** Short label rendered inside the chip — keep ≤ 4 chars for mobile fit. */
  label: string;
}

interface TimeQuickChipsProps {
  value: number;
  options: TimeQuickChipOption[];
  onChange: (value: number) => void;
  /** Theme accent (hex like `#4F6EF7`). Inherits ExerciseForm orange convention. */
  accent: string;
  /** Optional aria-label for the radiogroup — defaults to "Time" if absent. */
  ariaLabel?: string;
}

export default function TimeQuickChips({
  value, options, onChange, accent, ariaLabel,
}: TimeQuickChipsProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? "Time"}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        gap: 6,
        background: "var(--input-bg)",
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 4,
      }}
    >
      {options.map(opt => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              if (!on) {
                hapticSelection();
                onChange(opt.value);
              }
            }}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: on ? `${accent}22` : "transparent",
              color: on ? accent : "var(--text-muted)",
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
