"use client";

import React from "react";
import type { Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS, getEvalColor, getEvalLabel } from "@/lib/mealTypes";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const BORDER = "rgba(255,255,255,0.08)";

export default function MealEntryLightExpand({
  meal,
  onViewFull,
  viewFullLabel = "View full entry →",
}: {
  meal: Meal;
  onViewFull: () => void;
  viewFullLabel?: string;
}) {
  const protein = meal.protein_grams
    ?? (Array.isArray(meal.parsed_json) ? meal.parsed_json.reduce((s, f) => s + (f.protein || 0), 0) : 0);
  const fat = meal.fat_grams
    ?? (Array.isArray(meal.parsed_json) ? meal.parsed_json.reduce((s, f) => s + (f.fat || 0), 0) : 0);
  const carbs  = meal.carbs_grams ?? 0;
  const before = meal.glucose_before ?? null;
  const after  = meal.glucose_after  ?? null;
  const delta  = before != null && after != null ? after - before : null;

  const beforeColor = before != null
    ? (before > 140 ? ORANGE : before < 80 ? PINK : GREEN)
    : "rgba(255,255,255,0.5)";
  const afterColor = after != null
    ? (after > 180 || after < 70 ? PINK : GREEN)
    : "rgba(255,255,255,0.4)";
  const deltaColor = delta != null
    ? (delta > 30 ? PINK : delta > 0 ? ORANGE : GREEN)
    : "rgba(255,255,255,0.35)";

  const date = new Date(meal.meal_time ?? meal.created_at);
  const fullTimestamp = date.toLocaleString("en", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  const ev       = meal.evaluation;
  const evColor  = getEvalColor(ev);
  const evLabel  = getEvalLabel(ev);
  const catColor = meal.meal_type ? (TYPE_COLORS[meal.meal_type] || ACCENT) : null;
  const catLabel = meal.meal_type ? (TYPE_LABELS[meal.meal_type] || meal.meal_type) : null;

  const PendingAfter = (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, color:"rgba(255,255,255,0.5)" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      Pending
    </span>
  );

  const Stat = ({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) => (
    <div style={{ display:"flex", flexDirection:"column", minWidth:70, gap:3 }}>
      <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:700, color: color || "rgba(255,255,255,0.85)", fontFamily:"var(--font-mono)" }}>{value}</span>
    </div>
  );

  // BG After: if no `after` value and the meal is recent (< 2h), show "Pending"
  // otherwise show "—". This is a conservative placeholder until the scheduled
  // CGM-fetch system populates the field.
  const ageMs = Date.now() - new Date(meal.created_at).getTime();
  const ageHours = ageMs / 3_600_000;
  const afterValue: React.ReactNode = after != null
    ? `${after} mg/dL`
    : (ageHours < 2 ? PendingAfter : "—");

  return (
    <div style={{ padding:"12px 16px 14px", display:"flex", flexDirection:"column", gap:14 }}>
      {/* GLUCOSE */}
      <div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>Glucose</div>
        <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
          <Stat label="BG Before" value={before != null ? `${before} mg/dL` : "—"} color={beforeColor}/>
          <Stat label="BG After"  value={afterValue} color={after != null ? afterColor : undefined}/>
          <Stat label="Delta"     value={delta != null ? `${delta > 0 ? "+" : ""}${delta} mg/dL` : "—"} color={deltaColor}/>
        </div>
      </div>

      {/* KEY DETAILS */}
      <div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>Key Details</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {meal.input_text && (
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.5 }}>{meal.input_text}</div>
          )}
          <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
            <Stat label="Carbs"   value={`${carbs}g`}   color={ORANGE}/>
            <Stat label="Protein" value={`${protein}g`} color="#3B82F6"/>
            <Stat label="Fat"     value={`${fat}g`}     color="#A855F7"/>
            {meal.insulin_units != null && (
              <Stat label="Insulin" value={`${meal.insulin_units}u`} color={ACCENT}/>
            )}
          </div>
          {(ev || catLabel) && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              {ev && (
                <span style={{ padding:"4px 10px", borderRadius:99, fontSize:10, fontWeight:700, background:`${evColor}22`, color:evColor, border:`1px solid ${evColor}40`, letterSpacing:"0.05em", textTransform:"uppercase" }}>{evLabel}</span>
              )}
              {catLabel && catColor && (
                <span style={{ padding:"4px 10px", borderRadius:99, fontSize:10, fontWeight:700, background:`${catColor}22`, color:catColor, border:`1px solid ${catColor}40`, letterSpacing:"0.05em", textTransform:"uppercase" }}>{catLabel}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* TIMESTAMP + LINK */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
        <span style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontFamily:"var(--font-mono)" }}>{fullTimestamp}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onViewFull(); }}
          style={{ background:"transparent", border:"none", color:ACCENT, fontSize:12, fontWeight:600, cursor:"pointer", padding:"4px 0", letterSpacing:"-0.01em" }}
        >
          {viewFullLabel}
        </button>
      </div>
    </div>
  );
}
