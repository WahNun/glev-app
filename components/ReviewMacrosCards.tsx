"use client";

// Engine wizard "Makros prüfen" step: four tap-able macro ring cards
// (Carbs, Protein, Fat, Fiber) using the same `MacroRing` visual the
// dashboard's "TODAY'S MACROS" section uses. Tapping a card expands a
// `SnapSlider` underneath the grid (only ever one open at a time) so
// the user can fine-tune the GPT-prefilled value in 0.5 g steps —
// 0.5 BE / 0.5 KE for Carbs when those units are active.

import React, { useState } from "react";
import MacroRing from "@/components/MacroRing";
import SnapSlider from "@/components/log/SnapSlider";
import { TYPE_COLORS } from "@/lib/mealTypes";
import { hapticSelection } from "@/lib/haptics";

type MacroKey = "carbs" | "protein" | "fat" | "fiber";

interface CarbUnitInfo {
  /** "g" | "BE" | "KE" — same shape `useCarbUnit()` returns. */
  unit: string;
  /** Display label ("g KH" / "BE" / "KE"). */
  label: string;
  /** Native step in the chosen unit (e.g. 0.5 for BE/KE). */
  step: number;
  toGrams: (n: number) => number;
  fromGrams: (g: number) => number;
}

interface MacroLabels {
  carbs: string;
  protein: string;
  fat: string;
  fiber: string;
}

interface ReviewMacrosCardsProps {
  /** Carbs value in the user's chosen carb-unit (g / BE / KE).
   *  Empty string when the field hasn't been touched yet. */
  carbs: string;
  protein: string;
  fat: string;
  fiber: string;
  setCarbs: (v: string) => void;
  setProtein: (v: string) => void;
  setFat: (v: string) => void;
  setFiber: (v: string) => void;
  carbUnit: CarbUnitInfo;
  labels: MacroLabels;
}

export default function ReviewMacrosCards({
  carbs, protein, fat, fiber,
  setCarbs, setProtein, setFat, setFiber,
  carbUnit, labels,
}: ReviewMacrosCardsProps) {
  const [open, setOpen] = useState<MacroKey | null>(null);

  function selectCard(next: MacroKey) {
    // Only buzz when the open card actually changes — re-tapping an
    // already-open card is a no-op (matches the task spec: "Tap on a
    // different card while one is open switches the slider").
    setOpen(prev => {
      if (prev === next) return prev;
      hapticSelection();
      return next;
    });
  }

  // Numeric reads — fall back to 0 so the ring never breaks on empty
  // strings. We keep the underlying state as strings so downstream
  // validation can still distinguish "not entered" from "0 g".
  const carbsNum   = Number.isFinite(parseFloat(carbs))   ? parseFloat(carbs)   : 0;
  const proteinNum = Number.isFinite(parseFloat(protein)) ? parseFloat(protein) : 0;
  const fatNum     = Number.isFinite(parseFloat(fat))     ? parseFloat(fat)     : 0;
  const fiberNum   = Number.isFinite(parseFloat(fiber))   ? parseFloat(fiber)   : 0;

  const cards: Array<{
    key: MacroKey;
    label: string;
    value: number;
    color: string;
    unit: string;
  }> = [
    { key: "carbs",   label: labels.carbs,   value: Math.round(carbsNum * 10) / 10, color: TYPE_COLORS.FAST_CARBS,   unit: carbUnit.label },
    { key: "protein", label: labels.protein, value: Math.round(proteinNum),         color: TYPE_COLORS.HIGH_PROTEIN, unit: "g" },
    { key: "fat",     label: labels.fat,     value: Math.round(fatNum),             color: TYPE_COLORS.HIGH_FAT,     unit: "g" },
    { key: "fiber",   label: labels.fiber,   value: Math.round(fiberNum),           color: TYPE_COLORS.BALANCED,     unit: "g" },
  ];

  // Slider config for the currently expanded card. All four rings
  // (carbs / protein / fat / fiber) share the same 0.5 step granularity
  // so the scrubbing feel is identical regardless of which macro the
  // user is correcting. Carbs still respects the unit label (g / BE /
  // KE) and max derives from the user's carb-unit preference.
  function sliderFor(key: MacroKey) {
    if (key === "carbs") {
      // Carbs max: 200 g covers any realistic single meal (giant pizza,
      // big pasta plate). In BE this is 20 BE; in KE 20 KE — both still
      // within plausible bounds for a single bolus decision. Anything
      // larger is almost certainly split across multiple meals.
      // `Math.floor` (not round) so the cap never converts back to
      // more than 200 g in BE-mode (200/12 = 16.67 → floor 16 → 192 g
      // ≤ 200 g, whereas round 17 would yield ~204 g).
      const max = Math.max(10, Math.floor(carbUnit.fromGrams(200) * 2) / 2);
      // Step parity with protein/fat/fiber sliders: 0.5 in every unit
      // mode (was 5 g in g-mode for BE/KE consistency — Lucas wanted
      // the same fine granularity across all four macro rings). For
      // BE/KE this matches the existing `carbUnit.step` (0.5), for g
      // it's a 10× finer scrub than before.
      const step = carbUnit.unit === "g" ? 0.5 : carbUnit.step;
      // Always one decimal so the displayed value matches the slider
      // tick (e.g. "47.5 g" instead of rounding to "48 g" mid-scrub).
      const decimals = 1;
      return {
        value: carbsNum,
        onChange: (n: number) => setCarbs(String(n)),
        min: 0, max, step,
        decimals,
        unit: carbUnit.label,
        accent: TYPE_COLORS.FAST_CARBS,
        ariaLabel: labels.carbs,
      };
    }
    const setter = key === "protein" ? setProtein : key === "fat" ? setFat : setFiber;
    const value  = key === "protein" ? proteinNum : key === "fat" ? fatNum   : fiberNum;
    const accent =
      key === "protein" ? TYPE_COLORS.HIGH_PROTEIN
      : key === "fat"   ? TYPE_COLORS.HIGH_FAT
      :                   TYPE_COLORS.BALANCED;
    const aria =
      key === "protein" ? labels.protein
      : key === "fat"   ? labels.fat
      :                   labels.fiber;
    return {
      value,
      onChange: (n: number) => setter(String(n)),
      min: 0, max: 200, step: 0.5,
      decimals: 1,
      unit: "g",
      accent,
      ariaLabel: aria,
    };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Mirrors the dashboard's "TODAY'S MACROS" row 1:1 — same wrapper
          padding (22px 16px 24px), same 4-column grid with minmax(0, 1fr)
          so all rings render at identical diameter regardless of
          label/value width, same gap:8, and per-cell flex wrapper that
          centers the ring with minWidth:0 (collapses min-content floor).
          See app/(protected)/dashboard/page.tsx ~line 980. */}
      <div style={{
        padding: "8px 24px 4px",
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 8,
      }}>
        {cards.map(c => {
          const active = open === c.key;
          // Strip the unit suffix "(g)" / "(BE)" / "(KE)" from the label —
          // the unit is shown globally below the grid instead.
          const displayLabel = c.label.replace(/\s*\([^)]+\)\s*$/i, "").trim();
          return (
            <div key={c.key} style={{ display: "flex", justifyContent: "center", minWidth: 0, maxWidth: 110 }}>
              <button
                type="button"
                onClick={() => selectCard(c.key)}
                aria-pressed={active}
                aria-label={c.label}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  boxSizing: "border-box",
                  display: "flex",
                  justifyContent: "center",
                  width: "100%",
                  minWidth: 0,
                  padding: "8px 10px 8px",
                  borderRadius: 14,
                  background: active ? `${c.color}22` : "transparent",
                  border: `1px solid ${active ? `${c.color}55` : "transparent"}`,
                  borderBottom: `2px solid ${active ? c.color : "transparent"}`,
                  boxShadow: active ? `0 0 0 1px ${c.color}22, 0 6px 18px -10px ${c.color}66` : "none",
                  transition:
                    "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
                }}
              >
                <MacroRing
                  label={displayLabel}
                  value={c.value}
                  color={c.color}
                  unit={c.unit}
                />
              </button>
            </div>
          );
        })}
      </div>
      {/* Global unit hint — replaces the per-ring "(g)" suffix */}
      <div style={{
        textAlign: "center",
        fontSize: 11,
        color: "var(--text-faint)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        paddingBottom: 4,
      }}>
        Angaben in g
      </div>

      {open && (() => {
        const s = sliderFor(open);
        return (
          <SnapSlider
            value={s.value}
            onChange={s.onChange}
            min={s.min}
            max={s.max}
            step={s.step}
            decimals={s.decimals}
            unit={s.unit}
            accent={s.accent}
            ariaLabel={s.ariaLabel}
          />
        );
      })()}
    </div>
  );
}
