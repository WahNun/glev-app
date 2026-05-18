"use client";

import { hapticSelection } from "@/lib/haptics";

/**
 * 2-N option segmented control (radio-like). Used as an iOS-friendly
 * replacement for a SnapSlider when there are only 2-4 discrete stops
 * (e.g. low/medium/high intensity).
 *
 * Why: a native `<input type="range">` with very few stops has a
 * well-known iOS WKWebView issue where the thumb snaps to where the
 * finger TOUCHES (rather than letting you grab and drag), making it
 * easy to "miss" the intended stop. User-report 2026-05-18 ("System
 * springt zurück wenn ich die Intensität ändern möchte").
 *
 * Each option fires `hapticSelection` (light tick) on change.
 */

interface SegmentedChoiceOption<V extends string> {
  value: V;
  label: string;
}

interface SegmentedChoiceProps<V extends string> {
  value: V;
  options: SegmentedChoiceOption<V>[];
  onChange: (v: V) => void;
  /** Active-segment background colour (hex). */
  accent: string;
  ariaLabel?: string;
}

export default function SegmentedChoice<V extends string>({
  value,
  options,
  onChange,
  accent,
  ariaLabel,
}: SegmentedChoiceProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        gap: 4,
        background: "var(--input-bg)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 4,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (!active) {
                hapticSelection();
                onChange(opt.value);
              }
            }}
            style={{
              padding: "11px 10px",
              borderRadius: 9,
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
              background: active ? accent : "transparent",
              color: active ? "#fff" : "var(--text-body)",
              transition: "background 120ms ease, color 120ms ease",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
              touchAction: "manipulation",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
