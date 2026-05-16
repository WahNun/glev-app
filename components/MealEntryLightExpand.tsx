"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { updateMeal, type Meal } from "@/lib/meals";
import { TYPE_COLORS, chipLabelsFrom } from "@/lib/mealTypes";
import { chipForMeal } from "@/lib/engine/chipState";
import { renderEngineMessage, renderEngineMessages } from "@/lib/engineMessages";
import { parseDbDate, parseDbTs } from "@/lib/time";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import TrendArrowIcon from "@/components/TrendArrowIcon";
import {
  fetchInsulinLogs,
  updateInsulinLogLink,
  type InsulinLog,
} from "@/lib/insulin";
import { hapticSelection, hapticSuccess, hapticError } from "@/lib/haptics";

/** Map the stored 5-state device trend string to the 3-state arrow we
 *  render. Anything else (null, undefined, unknown future buckets like
 *  "notComputable") collapses to null → renders nothing. */
function trendDirectionFor(t: string | null | undefined): "up" | "down" | "flat" | null {
  if (t === "falling" || t === "fallingQuickly") return "down";
  if (t === "stable") return "flat";
  if (t === "rising" || t === "risingQuickly") return "up";
  return null;
}

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const BORDER = "var(--border)";

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
  const tEngine = useTranslations("engine");
  const tChips = useTranslations("chips");
  const chipLabels = chipLabelsFrom(tChips);
  // Carb-unit selector now drives both the read-view stats and the edit
  // form: the eCarbs input is seeded via carbUnit.fromGrams() and saved
  // via carbUnit.toGrams() so DACH users see BE/KE consistently. The DB
  // column meals.carbs_grams is still the canonical storage in grams.
  const carbUnit = useCarbUnit();

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
    : "var(--text-dim)";
  const afterColor = after != null
    ? (after > 180 || after < 70 ? PINK : GREEN)
    : "var(--text-dim)";
  const deltaColor = delta != null
    ? (delta > 30 ? PINK : delta > 0 ? ORANGE : GREEN)
    : "var(--text-faint)";

  const date = parseDbDate(meal.meal_time ?? meal.created_at);
  const fullTimestamp = date.toLocaleString(locale, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  // Lifecycle-driven chip — pending=gray / provisional=purple / final=outcome
  const chip = chipForMeal(meal);
  const catColor = meal.meal_type ? (TYPE_COLORS[meal.meal_type] || ACCENT) : null;
  const catLabel = meal.meal_type ? chipLabels.typeLabel(meal.meal_type) : null;

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

  // Seed the carbs input in the user's chosen unit. Helper centralises
  // the null-safe convert so initial state and startEdit() stay aligned.
  // Returns "" when the meal has no carbs_grams so the input shows the
  // placeholder rather than a literal "0".
  function seedCarbsDisplay(grams: number | null | undefined): string {
    return grams != null ? String(carbUnit.fromGrams(grams)) : "";
  }

  // Edit form state — strings so empty input -> empty string (not 0).
  // eCarbs holds the value in the user's display unit (g / BE / KE).
  const [eCarbs,    setECarbs]    = useState<string>(seedCarbsDisplay(meal.carbs_grams));
  // Track the seeded display string so we can detect "no change" on save
  // and write back the original carbs_grams unchanged — otherwise BE/KE
  // rounding (e.g. 25g → 2.1 BE → 25.2g) would silently drift the value.
  const [eCarbsSeed, setECarbsSeed] = useState<string>(seedCarbsDisplay(meal.carbs_grams));
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
    const carbsSeed = seedCarbsDisplay(meal.carbs_grams);
    setECarbs(carbsSeed);
    setECarbsSeed(carbsSeed);
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
    // Convert the displayed carbs value back to grams for DB write. If
    // the user did NOT touch the field (current input string equals the
    // seeded display string AND we still have the original grams),
    // reuse the original grams to avoid BE/KE rounding drift on a
    // pure-roundtrip edit.
    const carbsUnchanged =
      meal.carbs_grams != null &&
      eCarbs.trim() === eCarbsSeed.trim();
    const carbsGramsToWrite = carbsUnchanged
      ? meal.carbs_grams!
      : carbUnit.toGrams(cNum);
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
        carbs_grams:    carbsGramsToWrite,
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
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, color:"var(--text-dim)" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      {td("pending")}
    </span>
  );

  const Stat = ({ label, value, color, adornment, mono = true }: { label: string; value: React.ReactNode; color?: string; adornment?: React.ReactNode; mono?: boolean }) => (
    <div style={{ display:"flex", flexDirection:"column", minWidth:70, gap:3 }}>
      <span style={{ fontSize:12, color:"var(--text-faint)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>{label}</span>
      <span style={{ fontSize:14, fontWeight:700, color: color || "var(--text-strong)", fontFamily: mono ? "var(--font-mono)" : undefined, display:"inline-flex", alignItems:"center" }}>
        {value}
        {adornment}
      </span>
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
            fontSize:11, fontWeight:700, letterSpacing:"0.06em",
            padding:"2px 6px", borderRadius:99,
            background:"var(--border-soft)",
            color:"var(--text-muted)",
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
      background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: "8px 10px", color:"var(--text)", fontSize: 14, outline: "none",
      width: "100%", fontFamily: "var(--font-mono)",
    };
    const lbl: React.CSSProperties = {
      fontSize: 12, color: "var(--text-dim)", letterSpacing: "0.06em",
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
        <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" }}>
          {tm("title")}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12 }}>
          <Field label={`${tm("field_carbs")} (${carbUnit.label})`}>     <input type="number" inputMode="decimal" min={0} step={carbUnit.step} placeholder={carbUnit.placeholder} value={eCarbs}    onChange={e => setECarbs(e.target.value)}    style={inp} /></Field>
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

        <BolusPickerSection meal={meal} locale={locale} />

        {err && (
          <div style={{ fontSize: 13, color: PINK, padding: "6px 10px", background: `${PINK}10`, border: `1px solid ${PINK}30`, borderRadius: 8 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: `1px solid ${BORDER}`, gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {tm("footer_note")}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={cancelEdit}
              disabled={busy}
              style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, color: "var(--text-body)", fontSize: 13, fontWeight: 600, padding: "8px 14px", cursor: busy ? "default" : "pointer" }}
            >
              {tm("cancel")}
            </button>
            <button
              onClick={saveEdit}
              disabled={busy}
              style={{ background: ACCENT, border: "none", borderRadius: 8, color:"var(--text)", fontSize: 13, fontWeight: 700, padding: "8px 16px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
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
          <span style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>{td("outcome")}</span>
          <span style={{ padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700, background:chip.color, color:"var(--on-accent)", letterSpacing:"0.04em", textTransform:"uppercase" }}>
            {chip.finalOutcome ? chipLabels.evalLabel(chip.finalOutcome) : renderEngineMessage(tEngine, chip.label)}
          </span>
        </div>
        <div style={{ fontSize:13, color:"var(--text-body)", lineHeight:1.5 }}>{renderEngineMessages(tEngine, chip.body)}</div>
        {chip.trendHint && (
          <div style={{ fontSize:13, color:"var(--text-dim)", fontStyle:"italic" }}>{renderEngineMessage(tEngine, chip.trendHint)}</div>
        )}
      </div>

      {/* GLUCOSE */}
      <div>
        <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>{td("glucose_section")}</div>
        <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
          <Stat
            label={td("bg_before")}
            value={before != null ? `${before} mg/dL` : "—"}
            color={beforeColor}
            adornment={(() => {
              const dir = trendDirectionFor(meal.pre_meal_trend);
              if (!dir) return null;
              return (
                <span
                  title={meal.pre_meal_trend ?? undefined}
                  style={{ display: "inline-flex", alignItems: "center", marginLeft: 5 }}
                >
                  <TrendArrowIcon direction={dir} color={beforeColor} />
                </span>
              );
            })()}
          />
          <Stat label={td("bg_after")}  value={afterValue} color={after != null ? afterColor : undefined} mono={after != null}/>
          <Stat label={td("delta")}     value={delta != null ? `${delta > 0 ? "+" : ""}${delta} mg/dL` : "—"} color={deltaColor}/>
        </div>
      </div>

      {/* KEY DETAILS */}
      <div>
        <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>{td("key_details")}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {meal.input_text && (
            <div style={{ fontSize:14, color:"var(--text-body)", lineHeight:1.5 }}>{meal.input_text}</div>
          )}
          <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
            <Stat label={td("carbs")}   value={carbUnit.display(carbs)}   color={ORANGE}/>
            <Stat label={td("protein")} value={`${protein}g`} color="#3B82F6"/>
            <Stat label={td("fat")}     value={`${fat}g`}     color="#A855F7"/>
            {meal.insulin_units != null && (
              <Stat label={td("insulin")} value={`${meal.insulin_units}u`} color={ACCENT}/>
            )}
          </div>
          {catLabel && catColor && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              <span style={{ padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700, background:`${catColor}22`, color:catColor, border:`1px solid ${catColor}40`, letterSpacing:"0.05em", textTransform:"uppercase" }}>{catLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* TIMESTAMP + EDIT/LINK */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
        <span style={{ fontSize:13, color:"var(--text-dim)" }}>
          {fullTimestamp}
          {savedFlash && (
            <span style={{ marginLeft: 12, color: GREEN, fontWeight: 700 }}>{td("saved_flash")}</span>
          )}
        </span>
        <div style={{ display:"flex", gap:14, alignItems:"center" }}>
          {editable && (
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              style={{ background:"transparent", border:`1px solid ${BORDER}`, borderRadius:8, color:"var(--text-body)", fontSize:13, fontWeight:600, cursor:"pointer", padding:"6px 12px", letterSpacing:"-0.01em" }}
            >
              {td("edit")}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onViewFull(); }}
            style={{ background:"transparent", border:"none", color:ACCENT, fontSize:13, fontWeight:600, cursor:"pointer", padding:"4px 0", letterSpacing:"-0.01em" }}
          >
            {viewFullLabel ?? td("view_full_entry")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Picker section rendered inside the meal edit form. Lists all bolus
 * `insulin_logs` of the current user within ±2 h of the meal time and
 * lets the user toggle the link by setting/clearing
 * `related_entry_id`. Boluses already linked to a *different* meal are
 * rendered disabled with a label so they can't be silently relinked.
 *
 * Network strategy:
 *   - Initial fetch on mount (and whenever `meal.id` changes) via
 *     `fetchInsulinLogs(fromIso, toIso)` — supabase-js + RLS scope this
 *     to the calling user automatically.
 *   - Toggle does an optimistic UI update, PATCHes /api/insulin/[id],
 *     and rolls back on error with a haptic error + inline message.
 */
function BolusPickerSection({ meal, locale }: { meal: Meal; locale: string }) {
  const tm = useTranslations("mealEdit");
  const WINDOW_MS = 2 * 60 * 60 * 1000;

  const mealMs = parseDbTs(meal.meal_time ?? meal.created_at);
  const fromIso = new Date(mealMs - WINDOW_MS).toISOString();
  const toIso   = new Date(mealMs + WINDOW_MS).toISOString();

  const [loading,  setLoading]  = useState(true);
  const [boluses,  setBoluses]  = useState<InsulinLog[]>([]);
  const [busyId,   setBusyId]   = useState<string | null>(null);
  const [pickErr,  setPickErr]  = useState<string | null>(null);
  // Distinguish a real "empty window" from a failed fetch — the empty
  // state is reassuring, the error state needs an explicit retry hint
  // so users don't mistakenly believe there are no candidate boluses.
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [reloadId, setReloadId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    fetchInsulinLogs(fromIso, toIso)
      .then(rows => {
        if (cancelled) return;
        // Only bolus rows are meaningful here. Sort by time ascending so
        // an earlier pre-bolus is presented above a later correction.
        const filtered = rows
          .filter(b => b.insulin_type === "bolus")
          .sort((a, b) => parseDbTs(a.created_at) - parseDbTs(b.created_at));
        setBoluses(filtered);
      })
      .catch(e => {
        if (cancelled) return;
        setBoluses([]);
        setLoadErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [meal.id, fromIso, toIso, reloadId]);

  async function toggleLink(b: InsulinLog, nextChecked: boolean) {
    if (busyId) return;
    setPickErr(null);
    hapticSelection();
    const prev = boluses;
    // Optimistic update — flip the row to the target state immediately.
    setBoluses(prev.map(x => x.id === b.id
      ? { ...x, related_entry_id: nextChecked ? meal.id : null }
      : x));
    setBusyId(b.id);
    try {
      await updateInsulinLogLink(b.id, nextChecked ? meal.id : null);
      hapticSuccess();
      // Let the dashboard / engine refresh once the link changed so any
      // open ICR / Recent card reflects the new pairing.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("glev:insulin-updated"));
      }
    } catch (e) {
      hapticError();
      setBoluses(prev);
      setPickErr(tm("boluses_save_failed", {
        message: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>
          {tm("boluses_title")}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.4 }}>
          {tm("boluses_hint")}
        </span>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{tm("boluses_loading")}</div>
      ) : loadErr ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: `${PINK}10`, border: `1px solid ${PINK}30`, borderRadius: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: PINK, flex: 1, minWidth: 140 }}>
            {tm("boluses_load_failed", { message: loadErr })}
          </span>
          <button
            type="button"
            onClick={() => setReloadId(n => n + 1)}
            style={{ background: "transparent", border: `1px solid ${PINK}66`, borderRadius: 8, color: PINK, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer" }}
          >
            {tm("boluses_retry")}
          </button>
        </div>
      ) : boluses.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-faint)", fontStyle: "italic" }}>{tm("boluses_empty")}</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {boluses.map(b => {
            const linkedHere   = b.related_entry_id === meal.id;
            const linkedOther  = b.related_entry_id != null && b.related_entry_id !== meal.id;
            const disabled     = linkedOther || busyId === b.id;
            const ts = parseDbDate(b.created_at);
            const timeLabel = ts.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
            return (
              <li key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${BORDER}`, borderRadius: 10, background: linkedHere ? `${ACCENT}10` : "var(--input-bg)", opacity: linkedOther ? 0.65 : 1 }}>
                <input
                  type="checkbox"
                  checked={linkedHere}
                  disabled={disabled}
                  onChange={e => toggleLink(b, e.target.checked)}
                  aria-label={`${timeLabel} — ${b.units} ${tm("boluses_unit_suffix")}`}
                  style={{ width: 18, height: 18, accentColor: ACCENT, cursor: disabled ? "not-allowed" : "pointer", flexShrink: 0 }}
                />
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, color: "var(--text-strong)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                    {timeLabel} — {b.units} {tm("boluses_unit_suffix")}
                    {b.insulin_name ? <span style={{ marginLeft: 6, color: "var(--text-muted)", fontFamily: "system-ui, sans-serif", fontWeight: 500 }}>· {b.insulin_name}</span> : null}
                  </span>
                  {linkedOther && (
                    <span style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
                      {tm("boluses_linked_other")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pickErr && (
        <div style={{ fontSize: 12, color: PINK, padding: "6px 10px", background: `${PINK}10`, border: `1px solid ${PINK}30`, borderRadius: 8 }}>
          {pickErr}
        </div>
      )}
    </div>
  );
}
