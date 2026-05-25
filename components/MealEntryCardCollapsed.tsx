"use client";

import React from "react";
import type { Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_SHORT, chipLabelsFrom } from "@/lib/mealTypes";
import { chipForMeal } from "@/lib/engine/chipState";
import { renderEngineMessage, renderEngineMessages } from "@/lib/engineMessages";
import { parseDbDate } from "@/lib/time";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import { useTimeFormat } from "@/hooks/useTimeFormat";
import { useGlucoseUnit } from "@/hooks/useGlucoseUnit";
import { useTranslations, useLocale } from "next-intl";

const ACCENT = "#4F6EF7";
const ORANGE = "#FF9500";
const BORDER = "var(--border)";

export default function MealEntryCardCollapsed({
  meal,
  onClick,
  showEval = true,
}: {
  meal: Meal;
  onClick?: () => void;
  showEval?: boolean;
}) {
  // Carb-unit display follows the user's profile preference (g/BE/KE).
  // The DB column stays in grams; only the rendered value swaps.
  const carbUnit = useCarbUnit();
  const glucose = useGlucoseUnit();
  const tEngine = useTranslations("engine");
  const tx = useTranslations("entriesExpand");
  const tChips = useTranslations("chips");
  const chipLabels = chipLabelsFrom(tChips);
  const locale = useLocale();
  // Per-user time format pref (auto → 24h for DE, AM/PM for EN; can be
  // overridden in Settings → Zeitformat). One hook call shared by every
  // row via the module cache in `useTimeFormat`.
  const { format: fmtTime } = useTimeFormat();
  const ts = meal.meal_time ?? meal.created_at;
  const d = parseDbDate(ts);
  const dateStr = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const timeStr = fmtTime(d);

  const catColor = meal.meal_type ? TYPE_COLORS[meal.meal_type] || "var(--text-dim)" : null;
  const catLabel = meal.meal_type ? chipLabels.typeLabel(meal.meal_type) : null;
  const catShort = meal.meal_type ? TYPE_SHORT[meal.meal_type] || meal.meal_type.slice(0, 2) : null;

  // Post-meal BG badge: best available post-meal reading (2h preferred).
  // Falls back through all stored variants so older rows without the new
  // glucose_* columns still show a value when bg_2h/bg_1h is present.
  const postBgMgdl: number | null =
    meal.bg_2h ?? meal.glucose_2h ?? meal.bg_1h ?? meal.glucose_1h ?? null;
  const postBgLabel: "2h" | "1h" | null =
    (meal.bg_2h != null || meal.glucose_2h != null) ? "2h" :
    (meal.bg_1h != null || meal.glucose_1h != null) ? "1h" : null;

  // Color-code by post-meal BG value (mg/dL internally):
  //   <70   = hypo  → purple
  //   70–180 = in-range → green
  //   180–250 = slightly high → amber
  //   >250  = high → red
  const postBgColor: string | null = postBgMgdl == null ? null :
    postBgMgdl < 70  ? "#7C3AED" :
    postBgMgdl <= 180 ? "#22D3A0" :
    postBgMgdl <= 250 ? "#F59E0B" :
    "#EF4444";

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
        // start-aligned because the When column is now two lines (date over
        // time); centering would make the cell labels (WHEN/TYPE/CARBS/
        // INSULIN) sit on different baselines per row.
        alignItems: "start",
      }}
    >
      <style>{`
        .glev-mec-cell-label{ font-size:9px; color:var(--text-faint); letter-spacing:0.08em; font-weight:600; margin-bottom:3px; text-transform:uppercase; }
        /* Default (desktop / >= 720px): 4 equal cols + fixed-width eval pill on the right. */
        .glev-mec { display:grid; gap:14px; grid-template-columns: 1fr 1fr 1fr 1fr; position:relative; }
        .glev-mec.glev-mec--with-eval { grid-template-columns: 1fr 1fr 1fr 1fr 140px; }
        .glev-mec-eval{ justify-self:end; }
        /* Mobile (< 720px): keep 4-column grid, float eval pill top-right as absolute badge */
        @media (max-width: 720px) {
          .glev-mec, .glev-mec.glev-mec--with-eval { grid-template-columns: 1fr 1fr 1fr 1fr !important; gap: 10px; }
          .glev-mec-eval{
            position: absolute;
            top: 0;
            right: 0;
            font-size: 10px !important;
            padding: 3px 8px !important;
          }
        }
        /* Tight phones: keep 4 columns but reduce gap */
        @media (max-width: 380px) {
          .glev-mec, .glev-mec.glev-mec--with-eval { gap: 8px; }
        }
      `}</style>

      {/* Col 1: Date stacked above Time. Side-by-side caused truncation
          ("Apr 26 6...") in narrow viewports because both strings competed
          for one wrappable line. Stacking gives each its own row so the
          date can never be cut off. */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">{tx("row_when")}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {dateStr}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-dim)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
          {timeStr}
        </div>
      </div>

      {/* Col 2: Classification */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">{tx("row_type")}</div>
        {catColor && catShort ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: catColor, opacity: 0.85, flexShrink: 0 }} />
            <span title={catLabel || ""} style={{ fontSize: 13, fontWeight: 700, color: catColor, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {catShort}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: "var(--text-ghost)" }}>—</span>
        )}
      </div>

      {/* Col 3: Carbs */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">{tx("row_carbs")}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: meal.carbs_grams ? ORANGE : "var(--text-faint)", letterSpacing: "-0.01em", fontFamily: "var(--font-mono)" }}>
          {/* Use the centralized display() helper — keeps formatting
              rules (rounding, label spacing) in one place rather than
              hand-stitching numeric + label here. The dimmed weight on
              the trailing unit is sacrificed for consistency. */}
          {meal.carbs_grams != null ? carbUnit.display(meal.carbs_grams) : "—"}
        </div>
      </div>

      {/* Col 4: Insulin. Aus User-Sicht ist "noch nicht eingetragen" (null)
          identisch zum Outcome "0u gegeben" — beide bedeuten "kein Bolus
          zu dieser Mahlzeit". Daher hier einheitlich als 0 darstellen,
          statt zwei verschiedene Flags ("—" vs "0") für dasselbe Outcome
          zu zeigen. Farbe bleibt für 0/null gedimmt. */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">{tx("row_insulin")}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: meal.insulin_units ? ACCENT : "var(--text-faint)", letterSpacing: "-0.01em", fontFamily: "var(--font-mono)" }}>
          {meal.insulin_units ?? 0}
          <span style={{ fontSize: 12, color: "var(--text-faint)", fontWeight: 500, marginLeft: 2 }}>u</span>
        </div>
      </div>

      {/* Col 5: Outcome chip + Post-Meal BG badge (hidden on tiny screens).
          Chip drives off lifecycle state — pending=grey, provisional=purple,
          final=outcome color. Badge shows the actual post-meal BG value with
          in-range / slightly-high / high color coding when data is present. */}
      {showEval && (
        <div
          className="glev-mec-eval"
          style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}
        >
          <span
            title={renderEngineMessages(tEngine, chip.body)}
            style={{
              padding: "5px 10px",
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 700,
              background: `${chip.color}18`,
              color: chip.color,
              border: `1px solid ${chip.color}30`,
              whiteSpace: "nowrap",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {chip.finalOutcome ? chipLabels.evalLabel(chip.finalOutcome) : renderEngineMessage(tEngine, chip.label)}
          </span>

          {/* Post-Meal BG badge — only when data is present */}
          {postBgMgdl != null && postBgColor != null && (
            <span
              title={`Post-Meal BG (${postBgLabel})`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700,
                background: `${postBgColor}15`,
                color: postBgColor,
                border: `1px solid ${postBgColor}30`,
                whiteSpace: "nowrap",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.7, letterSpacing: "0.06em" }}>
                {postBgLabel}
              </span>
              {glucose.displayCompact(postBgMgdl)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
