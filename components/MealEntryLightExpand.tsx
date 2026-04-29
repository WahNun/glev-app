"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { updateMeal, type Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { chipForMeal } from "@/lib/engine/chipState";
import { parseDbDate, parseDbTs } from "@/lib/time";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const BORDER = "rgba(255,255,255,0.08)";

export default function MealEntryLightExpand({
  meal,
  locale = "de-DE",
  onViewFull,
  viewFullLabel,
  onUpdated,
}: {
  meal: Meal;
  /** BCP-47 locale for the timestamp footer. Pass `localeToBcp47(useLocale())`
   *  from the call site so the format follows the active UI language. */
  locale?: string;
  onViewFull: () => void;
  /** Optional override; defaults to the localized "view full entry" string. */
  viewFullLabel?: string;
  onUpdated?: (m: Meal) => void;
}) {
  const td = useTranslations("dashboard");
  const tm = useTranslations("mealEdit");

  // Meal-type select options live in the edit form. Derived inline rather
  // than module-level so they re-evaluate on locale switch (the cookie
  // reload already remounts, but this stays correct under any future
  // hot-swap mechanism too).
  const MEAL_TYPES: Array<{ value: string; label: string }> = [
    { value: "FAST_CARBS",   label: tm("type_fast_carbs")   },
    { value: "HIGH_PROTEIN", label: tm("type_high_protein") },
    { value: "HIGH_FAT",     label: tm("type_high_fat")     },
    { value: "BALANCED",     label: tm("type_balanced")     },
  ];

  const protein = meal.protein_grams
    ?? (Array.isArray(meal.parsed_json) ? meal.parsed_json.reduce((s, f) => s + (f.protein || 0), 0) : 0);
  const fat = meal.fat_grams
    ?? (Array.isArray(meal.parsed_json) ? meal.parsed_json.reduce((s, f) => s + (f.fat || 0), 0) : 0);
  const carbs  = meal.carbs_grams ?? 0;
  const before = meal.glucose_before ?? null;
  // BG AFTER cascades through the same priority as the Verlauf/entries view
  // so the auto-fetched CGM values (bg_2h / bg_1h) populate the Recent card
  // without the user having to manually log a post-meal glucose. Prefer 2h
  // (more authoritative) over 1h over the legacy glucose_after column.
  const after: number | null =
    meal.bg_2h ?? meal.bg_1h ?? meal.glucose_after ?? null;
  const afterTag: "1H" | "2H" | null =
    meal.bg_2h != null ? "2H" : meal.bg_1h != null ? "1H" : null;
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

  const date = parseDbDate(meal.meal_time ?? meal.created_at);
  const fullTimestamp = date.toLocaleString(locale, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  // Lifecycle-driven chip — pending=gray / provisional=purple / final=outcome
  const chip = chipForMeal(meal);
  const catColor = meal.meal_type ? (TYPE_COLORS[meal.meal_type] || ACCENT) : null;
  const catLabel = meal.meal_type ? (TYPE_LABELS[meal.meal_type] || meal.meal_type) : null;

  // ─── Edit mode ────────────────────────────────────────────────────────────
  // Inline editing allows users to fix a typo (wrong carbs / wrong insulin)
  // or backfill a 1h/2h glucose reading without leaving the list. On save
  // we call lib/meals.updateMeal which recomputes meal_type + evaluation
  // from the new values and returns the updated row.
  const editable = onUpdated != null;
  const [isEditing, setIsEditing] = useState(false);
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Edit form state — strings so empty input -> empty string (not 0)
  const [eCarbs,    setECarbs]    = useState<string>(String(meal.carbs_grams    ?? ""));
  const [eProtein,  setEProtein]  = useState<string>(String(meal.protein_grams  ?? ""));
  const [eFat,      setEFat]      = useState<string>(String(meal.fat_grams      ?? ""));
  const [eFiber,    setEFiber]    = useState<string>(String(meal.fiber_grams    ?? ""));
  const [eInsulin,  setEInsulin]  = useState<string>(String(meal.insulin_units  ?? ""));
  const [eBgBefore, setEBgBefore] = useState<string>(String(meal.glucose_before ?? ""));
  const [eBg1h,     setEBg1h]     = useState<string>(String(meal.bg_1h          ?? ""));
  const [eBg2h,     setEBg2h]     = useState<string>(String(meal.bg_2h          ?? ""));
  const [eType,     setEType]     = useState<string>(meal.meal_type ?? "BALANCED");

  function startEdit() {
    // Re-seed from the current row so a stale optimistic update can't bleed in.
    setECarbs(String(meal.carbs_grams    ?? ""));
    setEProtein(String(meal.protein_grams  ?? ""));
    setEFat(String(meal.fat_grams      ?? ""));
    setEFiber(String(meal.fiber_grams    ?? ""));
    setEInsulin(String(meal.insulin_units  ?? ""));
    setEBgBefore(String(meal.glucose_before ?? ""));
    setEBg1h(String(meal.bg_1h ?? ""));
    setEBg2h(String(meal.bg_2h ?? ""));
    setEType(meal.meal_type ?? "BALANCED");
    setErr(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setErr(null);
  }

  // Parse a string field -> number | null. Empty string returns
  // `clearOnEmpty ? null : undefined` so the caller can distinguish
  // "user cleared the field" (write null) from "field unchanged".
  function parseNum(raw: string, clearOnEmpty: boolean): number | null | undefined {
    const t = raw.trim();
    if (t === "") return clearOnEmpty ? null : undefined;
    const n = Number(t);
    if (!Number.isFinite(n)) return undefined;
    return n;
  }

  async function saveEdit() {
    setErr(null);

    const cNum = parseNum(eCarbs,    false);
    const iNum = parseNum(eInsulin,  false);
    if (cNum == null || cNum <= 0) { setErr(tm("err_carbs_required")); return; }
    // Insulin: 0 erlaubt, leer NICHT erlaubt (T1 spec)
    if (iNum == null || iNum < 0)  { setErr(tm("err_insulin_required")); return; }

    const bgBefore = parseNum(eBgBefore, true);
    const bg1h     = parseNum(eBg1h,     true);
    const bg2h     = parseNum(eBg2h,     true);
    const bgFields: Array<[string, number | null | undefined]> = [
      [tm("field_bg_before"), bgBefore],
      [tm("field_bg_1h"),     bg1h],
      [tm("field_bg_2h"),     bg2h],
    ];
    for (const [name, v] of bgFields) {
      if (v != null && (v < 30 || v > 600)) {
        setErr(tm("err_bg_range", { field: name }));
        return;
      }
    }

    setBusy(true);
    try {
      const updated = await updateMeal(meal.id, {
        carbs_grams:    cNum,
        protein_grams:  parseNum(eProtein, true) ?? 0,
        fat_grams:      parseNum(eFat,     true) ?? 0,
        fiber_grams:    parseNum(eFiber,   true) ?? 0,
        insulin_units:  iNum,
        glucose_before: bgBefore,
        bg_1h:          bg1h,
        bg_2h:          bg2h,
        meal_type:      eType,
      });
      onUpdated?.(updated);
      setSavedFlash(true);
      setIsEditing(false);
      // Auto-clear the flash after 2s so the row settles back to its normal look.
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tm("err_save_failed"));
    } finally {
      setBusy(false);
    }
  }

  const PendingAfter = (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, color:"rgba(255,255,255,0.5)" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      {td("pending")}
    </span>
  );

  const Stat = ({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) => (
    <div style={{ display:"flex", flexDirection:"column", minWidth:70, gap:3 }}>
      <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:700, color: color || "rgba(255,255,255,0.85)", fontFamily:"var(--font-mono)" }}>{value}</span>
    </div>
  );

  const ageMs = Date.now() - parseDbTs(meal.created_at);
  const ageHours = ageMs / 3_600_000;
  const afterValue: React.ReactNode = after != null
    ? (
      <span style={{ display:"inline-flex", alignItems:"baseline", gap:6 }}>
        {`${after} mg/dL`}
        {afterTag && (
          <span style={{
            fontSize:9, fontWeight:700, letterSpacing:"0.06em",
            padding:"2px 6px", borderRadius:99,
            background:"rgba(255,255,255,0.06)",
            color:"rgba(255,255,255,0.55)",
            fontFamily:"system-ui, -apple-system, sans-serif",
          }}>
            {afterTag}
          </span>
        )}
      </span>
    )
    : (ageHours < 2 ? PendingAfter : "—");

  // ─── Edit form view ───────────────────────────────────────────────────────
  if (isEditing) {
    const inp: React.CSSProperties = {
      background: "#0D0D12", border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: "8px 10px", color: "#fff", fontSize: 13, outline: "none",
      width: "100%", fontFamily: "var(--font-mono)",
    };
    const lbl: React.CSSProperties = {
      fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em",
      textTransform: "uppercase", fontWeight: 600, marginBottom: 4,
    };
    const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={lbl}>{label}</span>
        {children}
      </div>
    );

    return (
      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" }}>
          {tm("title")}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12 }}>
          <Field label={tm("field_carbs")}>     <input type="number" inputMode="decimal" min={0} step="any" value={eCarbs}    onChange={e => setECarbs(e.target.value)}    style={inp} /></Field>
          <Field label={tm("field_protein")}>   <input type="number" inputMode="decimal" min={0} step="any" value={eProtein}  onChange={e => setEProtein(e.target.value)}  style={inp} /></Field>
          <Field label={tm("field_fat")}>       <input type="number" inputMode="decimal" min={0} step="any" value={eFat}      onChange={e => setEFat(e.target.value)}      style={inp} /></Field>
          <Field label={tm("field_fiber")}>     <input type="number" inputMode="decimal" min={0} step="any" value={eFiber}    onChange={e => setEFiber(e.target.value)}    style={inp} /></Field>
          <Field label={tm("field_insulin")}>   <input type="number" inputMode="decimal" min={0} step="any" value={eInsulin}  onChange={e => setEInsulin(e.target.value)}  style={inp} /></Field>
          <Field label={tm("field_bg_before")}> <input type="number" inputMode="decimal" min={0} step="any" value={eBgBefore} onChange={e => setEBgBefore(e.target.value)} style={inp} /></Field>
          <Field label={tm("field_bg_1h")}>     <input type="number" inputMode="decimal" min={0} step="any" value={eBg1h}     onChange={e => setEBg1h(e.target.value)}     style={inp} /></Field>
          <Field label={tm("field_bg_2h")}>     <input type="number" inputMode="decimal" min={0} step="any" value={eBg2h}     onChange={e => setEBg2h(e.target.value)}     style={inp} /></Field>
          <Field label={tm("field_meal_type")}>
            <select value={eType} onChange={e => setEType(e.target.value)} style={inp}>
              {MEAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>

        {err && (
          <div style={{ fontSize: 12, color: PINK, padding: "6px 10px", background: `${PINK}10`, border: `1px solid ${PINK}30`, borderRadius: 8 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: `1px solid ${BORDER}`, gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            {tm("footer_note")}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={cancelEdit}
              disabled={busy}
              style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, padding: "8px 14px", cursor: busy ? "default" : "pointer" }}
            >
              {tm("cancel")}
            </button>
            <button
              onClick={saveEdit}
              disabled={busy}
              style={{ background: ACCENT, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 16px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? tm("saving") : tm("save")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Read-only view ───────────────────────────────────────────────────────
  return (
    <div style={{ padding:"12px 16px 14px", display:"flex", flexDirection:"column", gap:14 }}>
      {/* OUTCOME CHIP — drives off lifecycle state, not stored evaluation alone. */}
      <div style={{ background:`${chip.color}10`, border:`1px solid ${chip.color}30`, borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:6 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
          <span style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>{td("outcome")}</span>
          <span style={{ padding:"4px 10px", borderRadius:99, fontSize:10, fontWeight:700, background:chip.color, color:"#0A0A0F", letterSpacing:"0.04em", textTransform:"uppercase" }}>
            {chip.label}
          </span>
        </div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", lineHeight:1.5 }}>{chip.body}</div>
        {chip.trendHint && (
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontStyle:"italic" }}>{chip.trendHint}</div>
        )}
      </div>

      {/* GLUCOSE */}
      <div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>{td("glucose_section")}</div>
        <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
          <Stat label={td("bg_before")} value={before != null ? `${before} mg/dL` : "—"} color={beforeColor}/>
          <Stat label={td("bg_after")}  value={afterValue} color={after != null ? afterColor : undefined}/>
          <Stat label={td("delta")}     value={delta != null ? `${delta > 0 ? "+" : ""}${delta} mg/dL` : "—"} color={deltaColor}/>
        </div>
      </div>

      {/* KEY DETAILS */}
      <div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>{td("key_details")}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {meal.input_text && (
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.5 }}>{meal.input_text}</div>
          )}
          <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
            <Stat label={td("carbs")}   value={`${carbs}g`}   color={ORANGE}/>
            <Stat label={td("protein")} value={`${protein}g`} color="#3B82F6"/>
            <Stat label={td("fat")}     value={`${fat}g`}     color="#A855F7"/>
            {meal.insulin_units != null && (
              <Stat label={td("insulin")} value={`${meal.insulin_units}u`} color={ACCENT}/>
            )}
          </div>
          {catLabel && catColor && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              <span style={{ padding:"4px 10px", borderRadius:99, fontSize:10, fontWeight:700, background:`${catColor}22`, color:catColor, border:`1px solid ${catColor}40`, letterSpacing:"0.05em", textTransform:"uppercase" }}>{catLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* TIMESTAMP + EDIT/LINK */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
        <span style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontFamily:"var(--font-mono)" }}>
          {fullTimestamp}
          {savedFlash && (
            <span style={{ marginLeft: 12, color: GREEN, fontWeight: 700 }}>{td("saved_flash")}</span>
          )}
        </span>
        <div style={{ display:"flex", gap:14, alignItems:"center" }}>
          {editable && (
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              style={{ background:"transparent", border:`1px solid ${BORDER}`, borderRadius:8, color:"rgba(255,255,255,0.75)", fontSize:12, fontWeight:600, cursor:"pointer", padding:"6px 12px", letterSpacing:"-0.01em" }}
            >
              {td("edit")}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onViewFull(); }}
            style={{ background:"transparent", border:"none", color:ACCENT, fontSize:12, fontWeight:600, cursor:"pointer", padding:"4px 0", letterSpacing:"-0.01em" }}
          >
            {viewFullLabel ?? td("view_full_entry")}
          </button>
        </div>
      </div>
    </div>
  );
}
