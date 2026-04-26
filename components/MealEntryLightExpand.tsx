"use client";

import React, { useState } from "react";
import { updateMeal, type Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { chipForMeal } from "@/lib/engine/chipState";
import { parseDbDate, parseDbTs } from "@/lib/time";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const BORDER = "rgba(255,255,255,0.08)";

const MEAL_TYPES: Array<{ value: string; label: string }> = [
  { value: "FAST_CARBS",   label: "Fast Carbs"   },
  { value: "HIGH_PROTEIN", label: "High Protein" },
  { value: "HIGH_FAT",     label: "High Fat"     },
  { value: "BALANCED",     label: "Balanced"     },
];

export default function MealEntryLightExpand({
  meal,
  onViewFull,
  viewFullLabel = "View full entry →",
  onUpdated,
}: {
  meal: Meal;
  onViewFull: () => void;
  viewFullLabel?: string;
  onUpdated?: (m: Meal) => void;
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

  const date = parseDbDate(meal.meal_time ?? meal.created_at);
  const fullTimestamp = date.toLocaleString("en", {
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
    if (cNum == null || cNum <= 0) { setErr("Carbs müssen > 0 sein."); return; }
    // Insulin: 0 erlaubt, leer NICHT erlaubt (T1 spec)
    if (iNum == null || iNum < 0)  { setErr("Insulindosis fehlt (0 ist erlaubt)."); return; }

    const bgBefore = parseNum(eBgBefore, true);
    const bg1h     = parseNum(eBg1h,     true);
    const bg2h     = parseNum(eBg2h,     true);
    for (const [name, v] of [["BG Before", bgBefore], ["BG 1h", bg1h], ["BG 2h", bg2h]] as const) {
      if (v != null && (v < 30 || v > 600)) {
        setErr(`${name} muss zwischen 30 und 600 mg/dL liegen.`);
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
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
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
      Pending
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
    ? `${after} mg/dL`
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
          Eintrag bearbeiten
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12 }}>
          <Field label="Carbs (g)">    <input type="number" inputMode="decimal" min={0} step="any" value={eCarbs}    onChange={e => setECarbs(e.target.value)}    style={inp} /></Field>
          <Field label="Protein (g)">  <input type="number" inputMode="decimal" min={0} step="any" value={eProtein}  onChange={e => setEProtein(e.target.value)}  style={inp} /></Field>
          <Field label="Fat (g)">      <input type="number" inputMode="decimal" min={0} step="any" value={eFat}      onChange={e => setEFat(e.target.value)}      style={inp} /></Field>
          <Field label="Fiber (g)">    <input type="number" inputMode="decimal" min={0} step="any" value={eFiber}    onChange={e => setEFiber(e.target.value)}    style={inp} /></Field>
          <Field label="Insulin (u)">  <input type="number" inputMode="decimal" min={0} step="any" value={eInsulin}  onChange={e => setEInsulin(e.target.value)}  style={inp} /></Field>
          <Field label="BG Before">    <input type="number" inputMode="decimal" min={0} step="any" value={eBgBefore} onChange={e => setEBgBefore(e.target.value)} style={inp} /></Field>
          <Field label="BG 1h">        <input type="number" inputMode="decimal" min={0} step="any" value={eBg1h}     onChange={e => setEBg1h(e.target.value)}     style={inp} /></Field>
          <Field label="BG 2h">        <input type="number" inputMode="decimal" min={0} step="any" value={eBg2h}     onChange={e => setEBg2h(e.target.value)}     style={inp} /></Field>
          <Field label="Meal Type">
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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            meal_type & Outcome werden nach Speichern automatisch neu berechnet.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={cancelEdit}
              disabled={busy}
              style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, padding: "8px 14px", cursor: busy ? "default" : "pointer" }}
            >
              Abbrechen
            </button>
            <button
              onClick={saveEdit}
              disabled={busy}
              style={{ background: ACCENT, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 16px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Speichern…" : "Speichern"}
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
          <span style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>OUTCOME</span>
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
            <span style={{ marginLeft: 12, color: GREEN, fontWeight: 700 }}>Gespeichert ✓</span>
          )}
        </span>
        <div style={{ display:"flex", gap:14, alignItems:"center" }}>
          {editable && (
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              style={{ background:"transparent", border:`1px solid ${BORDER}`, borderRadius:8, color:"rgba(255,255,255,0.75)", fontSize:12, fontWeight:600, cursor:"pointer", padding:"6px 12px", letterSpacing:"-0.01em" }}
            >
              Bearbeiten
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onViewFull(); }}
            style={{ background:"transparent", border:"none", color:ACCENT, fontSize:12, fontWeight:600, cursor:"pointer", padding:"4px 0", letterSpacing:"-0.01em" }}
          >
            {viewFullLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
