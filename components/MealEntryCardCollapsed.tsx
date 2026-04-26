"use client";

import React from "react";
import type { Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_SHORT, TYPE_LABELS } from "@/lib/mealTypes";
import { chipForMeal } from "@/lib/engine/chipState";
import { parseDbDate } from "@/lib/time";

const ACCENT = "#4F6EF7";
const ORANGE = "#FF9500";
const BORDER = "rgba(255,255,255,0.08)";

export default function MealEntryCardCollapsed({
  meal,
  onClick,
  showEval = true,
}: {
  meal: Meal;
  onClick?: () => void;
  showEval?: boolean;
}) {
  const ts = meal.meal_time ?? meal.created_at;
  const d = parseDbDate(ts);
  const dateStr = d.toLocaleDateString("en", { month: "short", day: "numeric" });
  const timeStr = d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });

  const catColor = meal.meal_type ? TYPE_COLORS[meal.meal_type] || "rgba(255,255,255,0.5)" : null;
  const catLabel = meal.meal_type ? TYPE_LABELS[meal.meal_type] || meal.meal_type : null;
  const catShort = meal.meal_type ? TYPE_SHORT[meal.meal_type] || meal.meal_type.slice(0, 2) : null;

  // 3-state chip: pending=gray / provisional=purple / final=outcome color.
  // Replaces direct getEvalColor(meal.evaluation) so the list never shows a
  // misleading orange "UNDER DOSE" pill while no post-meal reading exists.
  const chip = chipForMeal(meal);

  return (
    <div
      className={showEval ? "glev-mec glev-mec--with-eval" : "glev-mec"}
      onClick={onClick}
      style={{
        padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
        alignItems: "center",
      }}
    >
      <style>{`
        .glev-mec-cell-label{ font-size:9px; color:rgba(255,255,255,0.35); letter-spacing:0.08em; font-weight:600; margin-bottom:3px; text-transform:uppercase; }
        /* Default (desktop / >= 720px): 4 equal cols + fixed-width eval pill on the right.
           Fixed eval column ensures the 4 data columns line up vertically across all rows
           regardless of pill text width (GOOD vs UNDER DOSE vs OVER DOSE). */
        .glev-mec { display:grid; gap:14px; grid-template-columns: 1fr 1fr 1fr 1fr; }
        .glev-mec.glev-mec--with-eval { grid-template-columns: 1fr 1fr 1fr 1fr 140px; }
        .glev-mec-eval{ justify-self:end; }
        /* Tablet/mobile (< 720px): hide eval pill and keep 4 evenly distributed columns */
        @media (max-width: 720px) {
          .glev-mec, .glev-mec.glev-mec--with-eval { grid-template-columns: 1fr 1fr 1fr 1fr !important; gap: 10px; }
          .glev-mec-eval{ display:none !important; }
        }
        /* Tight phones: keep 4 columns but reduce gap */
        @media (max-width: 380px) {
          .glev-mec, .glev-mec.glev-mec--with-eval { gap: 8px; }
        }
      `}</style>

      {/* Col 1: Date + Time */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">When</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-mono)" }}>
          {dateStr}
          <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 400, marginLeft: 6 }}>{timeStr}</span>
        </div>
      </div>

      {/* Col 2: Classification */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">Type</div>
        {catColor && catShort ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: catColor, opacity: 0.85, flexShrink: 0 }} />
            <span title={catLabel || ""} style={{ fontSize: 12, fontWeight: 700, color: catColor, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {catShort}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>—</span>
        )}
      </div>

      {/* Col 3: Carbs */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">Carbs</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: meal.carbs_grams ? ORANGE : "rgba(255,255,255,0.3)", letterSpacing: "-0.01em", fontFamily: "var(--font-mono)" }}>
          {meal.carbs_grams != null ? meal.carbs_grams : "—"}
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, marginLeft: 2 }}>g</span>
        </div>
      </div>

      {/* Col 4: Insulin */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">Insulin</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: meal.insulin_units ? ACCENT : "rgba(255,255,255,0.3)", letterSpacing: "-0.01em", fontFamily: "var(--font-mono)" }}>
          {meal.insulin_units != null ? meal.insulin_units : "—"}
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, marginLeft: 2 }}>u</span>
        </div>
      </div>

      {/* Col 5: Outcome chip (hidden on tiny screens). Drives off lifecycle
          state — pending shows neutral grey, provisional shows muted purple,
          only final entries display the colored outcome label. */}
      {showEval && (
        <span
          className="glev-mec-eval"
          title={chip.body}
          style={{
            padding: "5px 10px",
            borderRadius: 99,
            fontSize: 10,
            fontWeight: 700,
            background: `${chip.color}18`,
            color: chip.color,
            border: `1px solid ${chip.color}30`,
            whiteSpace: "nowrap",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {chip.label}
        </span>
      )}
    </div>
  );
}
