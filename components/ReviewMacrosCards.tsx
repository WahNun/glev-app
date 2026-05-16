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

const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

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

  // Slider config for the currently expanded card. Carbs respects the
  // user's carb-unit preference (5 g / 0.5 BE / 0.5 KE); the three
  // protein/fat/fiber sliders are fixed at 0.5 g steps.
  function sliderFor(key: MacroKey) {
    if (key === "carbs") {
      const max = Math.max(10, Math.round(carbUnit.fromGrams(200)));
      const step = carbUnit.unit === "g" ? 5 : carbUnit.step;
      const decimals = carbUnit.unit === "g" ? 0 : 1;
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 4 cards on a single row on desktop / typical phones (393px
          and up easily fits 4 × ~90px). On very narrow widths the
          auto-fit wraps to 2 cols so the rings + labels never get
          squashed below readability. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))",
        gap: 10,
      }}>
        {cards.map(c => {
          const active = open === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => selectCard(c.key)}
              aria-pressed={active}
              aria-label={c.label}
              style={{
                all: "unset",
                cursor: "pointer",
                boxSizing: "border-box",
                background: SURFACE,
                border: `1px solid ${active ? c.color : BORDER}`,
                borderRadius: 14,
                padding: "14px 8px 12px",
                display: "flex",
                justifyContent: "center",
                minWidth: 0,
                transition: "border-color 160ms ease, box-shadow 160ms ease",
                boxShadow: active ? `0 0 0 1px ${c.color}55` : "none",
              }}
            >
              <MacroRing
                label={c.label}
                value={c.value}
                color={c.color}
                unit={c.unit}
              />
            </button>
          );
        })}
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
