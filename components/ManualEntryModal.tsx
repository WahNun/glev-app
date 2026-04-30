"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { scheduleJobsForLog } from "@/lib/cgmJobs";
import {
  saveMeal,
  classifyMeal,
  computeCalories,
  type Meal,
} from "@/lib/meals";
import { scheduleAutoFillForMeal, findCgmReadingNearTime } from "@/lib/postMealCgmAutoFill";
import { supabase } from "@/lib/supabase";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

const TYPE_OPTIONS: ReadonlyArray<{ value: string; key: "type_fast_carbs" | "type_balanced" | "type_high_protein" | "type_high_fat" }> = [
  { value: "FAST_CARBS",   key: "type_fast_carbs" },
  { value: "BALANCED",     key: "type_balanced" },
  { value: "HIGH_PROTEIN", key: "type_high_protein" },
  { value: "HIGH_FAT",     key: "type_high_fat" },
];

function toDatetimeLocal(d: Date): string {
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalDt(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function num(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export default function ManualEntryModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (meal: Meal) => void;
}) {
  const t = useTranslations("manualEntry");
  const now = new Date();

  const [mealTime, setMealTime] = useState<string>(toDatetimeLocal(now));
  const [desc,    setDesc]      = useState("");
  const [carbs,   setCarbs]     = useState("");
  const [protein, setProtein]   = useState("");
  const [fat,     setFat]       = useState("");
  const [fiber,   setFiber]     = useState("");
  const [insulin, setInsulin]   = useState("");
  const [glucose, setGlucose]   = useState("");
  const [mealType,setMealType]  = useState<string>("AUTO");
  const [bg1h,    setBg1h]      = useState("");
  const [bg1hAt,  setBg1hAt]    = useState("");
  const [bg2h,    setBg2h]      = useState("");
  const [bg2hAt,  setBg2hAt]    = useState("");

  const [saving,  setSaving]    = useState(false);
  const [saved,   setSaved]     = useState(false);
  const [error,   setError]     = useState<string | null>(null);

  // CGM auto-fill provenance — tracks which BG fields the modal populated
  // from /api/cgm/history (so a meal_time tweak can refresh them) vs which
  // ones the user typed by hand (locked from overwrite). Reset on open.
  const [autoFilled, setAutoFilled] = useState<{ glucose: boolean; bg1h: boolean; bg2h: boolean }>({
    glucose: false, bg1h: false, bg2h: false,
  });

  // Two-step wizard: "form" = inputs (meal time, macros, insulin, glucose-before),
  // "review" = read-only summary including auto-filled 1h/2h. Save only fires
  // from the review step. Resets to "form" each time the modal opens.
  const [step, setStep] = useState<"form" | "review">("form");
  // True while a CGM fetch is in-flight after a meal-time edit, so the
  // Weiter-button can show "Glukose laden…" instead of letting the user
  // proceed before the auto-fill resolves.
  const [cgmLoading, setCgmLoading] = useState(false);

  // Reset every time the modal opens so historical entries don't leak between sessions.
  useEffect(() => {
    if (!open) return;
    const fresh = new Date();
    setMealTime(toDatetimeLocal(fresh));
    setDesc(""); setCarbs(""); setProtein(""); setFat(""); setFiber("");
    setInsulin(""); setGlucose(""); setMealType("AUTO");
    setBg1h(""); setBg1hAt(""); setBg2h(""); setBg2hAt("");
    setAutoFilled({ glucose: false, bg1h: false, bg2h: false });
    setSaving(false); setError(null);
    setStep("form");
    setCgmLoading(false);
  }, [open]);

  // Default the bg_1h / bg_2h timestamps to +1h / +2h after the meal time when
  // the user hasn't touched them yet — matches the natural backfill workflow.
  useEffect(() => {
    const mt = parseLocalDt(mealTime);
    if (!mt) return;
    if (!bg1hAt) setBg1hAt(toDatetimeLocal(new Date(mt.getTime() + 60 * 60 * 1000)));
    if (!bg2hAt) setBg2hAt(toDatetimeLocal(new Date(mt.getTime() + 120 * 60 * 1000)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealTime]);

  // CGM auto-fill — when the user picks (or changes) the meal time, look up
  // the closest CGM reading at the meal time itself for "glucose before",
  // and at meal_time +1h / +2h for the optional follow-up readings (only
  // if those targets are already in the past). Manually-typed values are
  // never overwritten: the autoFilled flag records modal-owned values,
  // and the field's onChange handler clears the flag the moment the user
  // edits it. Debounced 400 ms so dragging the datetime input doesn't
  // spam the network. Failures (no CGM linked, history endpoint down,
  // no reading inside the ±60min window) silently leave the field
  // empty — manual entry is always the fallback.
  useEffect(() => {
    if (!open) return;
    const mt = parseLocalDt(mealTime);
    if (!mt) return;
    setCgmLoading(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      const ms = mt.getTime();
      const now = Date.now();
      // ±5 min around "now" → use the live /api/cgm/latest endpoint so
      // a real-time meal log gets the freshest sensor value rather than
      // the up-to-30s-stale /history cache. Past times bypass /latest
      // and use the historical lookup. Future times skip CGM entirely.
      const NOW_WINDOW_MS = 5 * 60 * 1000;
      const delta = ms - now; // negative = past, positive = future

      try {
        // glucose-before — only fetch if user hasn't typed something
        // (or last value was auto-filled and meal time changed).
        if ((!glucose || autoFilled.glucose) && delta <= NOW_WINDOW_MS) {
          let v: number | null = null;
          if (delta >= -NOW_WINDOW_MS) {
            // "now" — pull the freshest reading directly from the source.
            try {
              const r = await fetch("/api/cgm/latest", { cache: "no-store" });
              if (r.ok) {
                const j = await r.json();
                const raw = j?.current?.value;
                if (Number.isFinite(raw)) v = Math.round(raw);
              }
            } catch { /* fall through to history */ }
          }
          if (v == null) {
            // Past meal (or /latest unavailable) — historical lookup.
            const hit = await findCgmReadingNearTime(ms);
            if (hit) v = Math.round(hit.value);
          }
          if (!cancelled && v != null) {
            setGlucose(String(v));
            setAutoFilled(s => ({ ...s, glucose: true }));
          }
        }

        // bg_1h: only if +1h is already in the past (no future CGM data).
        if (now >= ms + 60 * 60 * 1000 && (!bg1h || autoFilled.bg1h)) {
          const hit = await findCgmReadingNearTime(ms + 60 * 60 * 1000);
          if (!cancelled && hit) {
            setBg1h(String(Math.round(hit.value)));
            setAutoFilled(s => ({ ...s, bg1h: true }));
          }
        }
        // bg_2h: only if +2h is already in the past.
        if (now >= ms + 120 * 60 * 1000 && (!bg2h || autoFilled.bg2h)) {
          const hit = await findCgmReadingNearTime(ms + 120 * 60 * 1000);
          if (!cancelled && hit) {
            setBg2h(String(Math.round(hit.value)));
            setAutoFilled(s => ({ ...s, bg2h: true }));
          }
        }
      } finally {
        if (!cancelled) setCgmLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); setCgmLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealTime, open]);

  if (!open) return null;

  const carbsN   = num(carbs);
  const proteinN = num(protein) ?? 0;
  const fatN     = num(fat) ?? 0;
  const fiberN   = num(fiber) ?? 0;
  const insulinN = num(insulin);
  const glucoseN = num(glucose);
  const bg1hN    = num(bg1h);
  const bg2hN    = num(bg2h);

  // Relaxed save criterion — the only hard requirement is that the user
  // has actually filled at least one macro field (so the row carries
  // some nutritional info downstream). Crucially we check the *string*
  // input, not the parsed number, so an explicit "0" counts as filled
  // (a pure observation log with carbs=0 / protein=0 is legit). This
  // also stops the "Weiter →" button from flickering between disabled
  // and enabled while the user types: the empty intermediate state
  // (e.g. clearing a digit) is the only thing that disables the button,
  // not a transient parsed value of 0.
  // Insulin, glucose-before and the 1h/2h follow-ups stay optional:
  // glucose-before auto-fills from CGM history when a source is linked,
  // and insulin can be a pure food-only log (e.g. a quick snack the
  // user wants in the diary without a bolus). This unblocks both
  // "Protein Eistee · 24g protein · 0g carbs · no bolus" style entries
  // *and* the previously-blocked all-zero observation entries.
  const hasAnyMacroFilled =
    carbs.trim()   !== "" ||
    protein.trim() !== "" ||
    fat.trim()     !== "" ||
    fiber.trim()   !== "";
  const canSubmit = hasAnyMacroFilled;

  async function handleSubmit() {
    setError(null);

    // ─── Required field ────────────────────────────────────────────────
    if (!hasAnyMacroFilled) {
      setError(t("err_at_least_one_macro"));
      return;
    }
    const mt = parseLocalDt(mealTime);
    if (!mt) { setError(t("err_invalid_meal_time")); return; }

    // ─── Physiological ranges ──────────────────────────────────────────
    // HTML min/max are advisory — typed input can still produce out-of-range
    // values. We block obviously implausible numbers so the entry log stays
    // analytically clean (negative insulin, BG=10, carbs=999, etc). All
    // checks now skip when the field is empty, since insulin / glucose are
    // optional. 0 is a valid value for every macro and stays accepted.
    if (carbsN != null && (carbsN < 0 || carbsN > 500))        { setError(t("err_carbs_too_high")); return; }
    if (proteinN < 0 || proteinN > 500)             { setError(t("err_protein_range")); return; }
    if (fatN     < 0 || fatN     > 500)             { setError(t("err_fat_range")); return; }
    if (fiberN   < 0 || fiberN   > 200)             { setError(t("err_fiber_range")); return; }
    if (insulinN != null && (insulinN < 0 || insulinN > 50))   { setError(t("err_insulin_range")); return; }
    if (glucoseN != null && (glucoseN < 30 || glucoseN > 600)) { setError(t("err_glucose_range")); return; }
    if (bg1hN != null && (bg1hN < 30 || bg1hN > 600)) { setError(t("err_bg1h_range")); return; }
    if (bg2hN != null && (bg2hN < 30 || bg2hN > 600)) { setError(t("err_bg2h_range")); return; }

    // Coerce missing values for the persisted row + classifier. carbs=0
    // is legitimate (pure protein/fat snack); the classifier handles it.
    const carbsForSave = carbsN ?? 0;
    const cls = mealType === "AUTO" ? classifyMeal(carbsForSave, proteinN, fatN, fiberN) : mealType;
    // Evaluation is no longer pre-computed at save time — the deterministic
    // lifecycleFor pipeline (lib/engine/lifecycle.ts) decides when a row
    // reaches "final" and only THEN writes the evaluation column. When
    // bg_1h / bg_2h are passed below, updateMealReadings (and the
    // updateMeal recompute path) populate it accordingly.

    setSaving(true);
    try {
      const mealIso = mt.toISOString();
      const meal = await saveMeal({
        inputText:    desc.trim() || t("default_input_text"),
        parsedJson:   [],
        glucoseBefore: glucoseN,
        glucoseAfter:  null,
        carbsGrams:   carbsForSave,
        proteinGrams: proteinN,
        fatGrams:     fatN,
        fiberGrams:   fiberN,
        calories:     computeCalories(carbsForSave, proteinN, fatN),
        insulinUnits: insulinN,
        mealType:     cls,
        evaluation:   null,
        createdAt:    mealIso,
        mealTime:     mealIso,
      });

      // Optionally write 1h / 2h readings with their custom timestamps. We do
      // a direct supabase update here (instead of updateMealReadings) so the
      // user-entered timestamps are preserved verbatim — the shared helper
      // always stamps "now".
      const patch: Record<string, unknown> = {};
      if (bg1hN != null) {
        patch.bg_1h    = bg1hN;
        const at1 = parseLocalDt(bg1hAt) ?? new Date(mt.getTime() + 60 * 60 * 1000);
        patch.bg_1h_at = at1.toISOString();
      }
      if (bg2hN != null) {
        patch.bg_2h    = bg2hN;
        const at2 = parseLocalDt(bg2hAt) ?? new Date(mt.getTime() + 120 * 60 * 1000);
        patch.bg_2h_at = at2.toISOString();
        // Mirror to legacy glucose_after when the schema migration hasn't run.
        patch.glucose_after = bg2hN;
      }

      // Persist with iterative schema-cache fallback: if Supabase's PostgREST
      // cache reports an unknown column we remove that column (plus its sibling
      // timestamp/value) and retry, looping until the patch succeeds or runs
      // out of fields. We track the columns that actually persisted so the
      // optimistic Meal handed back to the parent never claims data we failed
      // to save.
      const persisted: Record<string, unknown> = {};
      if (Object.keys(patch).length && supabase) {
        const remaining: Record<string, unknown> = { ...patch };
        const maxAttempts = 6;
        for (let i = 0; i < maxAttempts; i++) {
          if (Object.keys(remaining).length === 0) break;
          const { error: upErr } = await supabase.from("meals").update(remaining).eq("id", meal.id);
          if (!upErr) {
            Object.assign(persisted, remaining);
            break;
          }
          const match = upErr.message?.match(/Could not find the '([^']+)' column/);
          if (!match) {
            // Genuine error (RLS, network, constraint) — surface it.
            throw new Error(upErr.message);
          }
          const col = match[1];
          delete remaining[col];
          if (col === "bg_1h" || col === "bg_1h_at") {
            delete remaining.bg_1h;
            delete remaining.bg_1h_at;
          }
          if (col === "bg_2h" || col === "bg_2h_at") {
            delete remaining.bg_2h;
            delete remaining.bg_2h_at;
          }
          if (col === "glucose_after") delete remaining.glucose_after;
        }
        // Reflect the *actually persisted* fields on the local Meal so the UI
        // never shows an extra reading the database rejected.
        Object.assign(meal, persisted);

        // Refresh the cached `evaluation` column whenever a 2h reading was
        // attached — the row may now satisfy lifecycleFor.state === "final"
        // and the dashboard Control Score reads `evaluation` directly. The
        // direct supabase update path above bypasses updateMealReadings (so
        // user-entered timestamps are preserved verbatim), so we run the
        // same finalize step here. Skips when only bg_1h is set (1h alone
        // never goes final). Failures are non-fatal — the next read of the
        // row will still recompute via lifecycleFor.
        if (persisted.bg_2h !== undefined) {
          try {
            // Pull personal ICR/CF/target from the DB-backed user_settings
            // helper so the lifecycle's no-bgAfter fallback (and its
            // window classifier) use the user's real ratios — not the
            // localStorage mirror, which can lag the DB.
            const [{ lifecycleFor }, { fetchInsulinSettings }] = await Promise.all([
              import("@/lib/engine/lifecycle"),
              import("@/lib/userSettings"),
            ]);
            const settings = await fetchInsulinSettings();
            const lc = lifecycleFor(meal, new Date(), settings);
            const evaluation = lc.state === "final" ? lc.outcome : null;
            if (evaluation !== meal.evaluation) {
              const { error: evErr } = await supabase.from("meals")
                .update({ evaluation }).eq("id", meal.id);
              if (!evErr) meal.evaluation = evaluation;
            }
          } catch { /* non-fatal — lifecycleFor will recompute on next read */ }
        }
      }

      // Auto-fill any missing 1h / 2h slot from CGM history. Past-due slots
      // (e.g. when user logs a meal that already happened > 1h ago without
      // a 1h reading) are picked up by the layout-level reconciliation.
      try { scheduleAutoFillForMeal(meal.id, mealIso); } catch { /* non-fatal */ }
      // Unified CGM job scheduler — covers all log types. Conservative: only
      // writes columns that are still NULL, so it coexists safely with the
      // legacy per-meal auto-fill above.
      void scheduleJobsForLog({ logId: meal.id, logType: "meal", refTimeIso: mealIso });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("glev:meal-saved", { detail: { id: meal.id, mealTime: mealIso } }));
      }

      // FIX A: Brief inline "Gespeichert ✓" state so the user gets explicit
      // visual confirmation before the modal disappears. Without this the
      // modal closes the instant the network round-trip resolves and the
      // user is left wondering whether the save actually went through.
      setSaving(false);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onCreated(meal);
        onClose();
      }, 900);
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("err_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    background: "var(--input-bg)",
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: "10px 12px",
    color:"var(--text)",
    fontSize: 13,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: "var(--text-dim)",
    marginBottom: 6,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    display: "block",
    fontWeight: 600,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "var(--overlay)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "32px 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560,
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${BORDER}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>{t("title")}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
              {t("subtitle")}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close_aria")}
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {step === "form" && (<>
          {/* Meal time */}
          <div>
            <label style={labelStyle}>{t("meal_time_label")}</label>
            <input type="datetime-local" value={mealTime} onChange={(e) => setMealTime(e.target.value)} style={inp}/>
            <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-faint)" }}>
              {t("meal_time_hint")}
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>{t("description_label")}</label>
            <input
              value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder={t("description_placeholder")}
              style={{ ...inp, fontSize: 13 }}
            />
          </div>

          {/* Macros 2x2 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>{t("carbs_label")}</label>
              <input value={carbs} onChange={(e) => setCarbs(e.target.value)} type="number" min={0} placeholder={t("carbs_placeholder")} style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>{t("fiber_label")}</label>
              <input value={fiber} onChange={(e) => setFiber(e.target.value)} type="number" min={0} placeholder={t("fiber_placeholder")} style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>{t("protein_label")}</label>
              <input value={protein} onChange={(e) => setProtein(e.target.value)} type="number" min={0} placeholder={t("protein_placeholder")} style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>{t("fat_label")}</label>
              <input value={fat} onChange={(e) => setFat(e.target.value)} type="number" min={0} placeholder={t("fat_placeholder")} style={inp}/>
            </div>
          </div>

          {/* Classification */}
          <div>
            <label style={labelStyle}>{t("classification_label")}</label>
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
              style={{ ...inp, appearance: "auto" }}
            >
              <option value="AUTO">{t("auto_from_macros")}</option>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.key)}</option>
              ))}
            </select>
          </div>

          {/* Insulin + Glucose before */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>{t("insulin_label")}</label>
              <input value={insulin} onChange={(e) => setInsulin(e.target.value)} type="number" min={0} step={0.5} placeholder={t("insulin_placeholder")} style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>{t("glucose_before_label")}</label>
              <input
                value={glucose}
                onChange={(e) => { setGlucose(e.target.value); setAutoFilled(s => ({ ...s, glucose: false })); }}
                type="number" min={30} max={600}
                placeholder={autoFilled.glucose ? t("glucose_auto_placeholder") : t("glucose_placeholder")}
                style={{ ...inp, color: autoFilled.glucose ? ACCENT : "#fff" }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: PINK,
              padding: "8px 12px",
              background: `${PINK}10`,
              borderRadius: 8,
              border: `1px solid ${PINK}25`,
            }}>{error}</div>
          )}
        </>)}

        {step === "review" && (() => {
          const mt = parseLocalDt(mealTime);
          const mtStr = mt ? mt.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : mealTime;
          const carbsForSave = carbsN ?? 0;
          const cls = mealType === "AUTO" ? classifyMeal(carbsForSave, proteinN, fatN, fiberN) : mealType;
          const clsKey = TYPE_OPTIONS.find(o => o.value === cls)?.key;
          const clsLabel = clsKey ? t(clsKey) : cls;
          const at1 = parseLocalDt(bg1hAt);
          const at2 = parseLocalDt(bg2hAt);
          const Row = ({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) => (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.04em" }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: accent ?? "#fff", textAlign: "right" }}>{value}</span>
            </div>
          );
          const fmtTime = (d: Date | null) => d ? d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {t("review_intro")}
              </div>

              {/* Meal */}
              <div style={{ background: "var(--surface-soft)", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 14px" }}>
                <Row label={t("row_time")} value={mtStr} />
                <Row label={t("row_description")} value={desc.trim() || "—"} />
                <Row label={t("row_classification")} value={clsLabel} />
              </div>

              {/* Macros */}
              <div style={{ background: "var(--surface-soft)", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 14px" }}>
                <Row label={t("row_carbs")}   value={`${carbsForSave} g`} />
                <Row label={t("row_protein")} value={`${proteinN} g`} />
                <Row label={t("row_fat")}     value={`${fatN} g`} />
                <Row label={t("row_fiber")}   value={`${fiberN} g`} />
                <Row label={t("row_calories")} value={`${computeCalories(carbsForSave, proteinN, fatN)} kcal`} />
              </div>

              {/* Insulin + Glucose */}
              <div style={{ background: "var(--surface-soft)", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 14px" }}>
                <Row label={t("row_insulin")} value={insulinN != null ? `${insulinN} u` : "—"} />
                <Row
                  label={t("row_glucose_before")}
                  value={glucoseN != null ? `${glucoseN} mg/dL${autoFilled.glucose ? t("auto_suffix") : ""}` : "—"}
                  accent={glucoseN != null && autoFilled.glucose ? ACCENT : undefined}
                />
              </div>

              {/* Follow-ups (CGM-derived) */}
              {(bg1hN != null || bg2hN != null) && (
                <div style={{ background: "var(--surface-soft)", border: `1px dashed ${BORDER}`, borderRadius: 12, padding: "10px 14px" }}>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                    {t("followup_label")} <span style={{ opacity: 0.6, textTransform: "none", letterSpacing: 0 }}>{t("followup_source")}</span>
                  </div>
                  {bg1hN != null && (
                    <Row
                      label={t("followup_1h", { when: fmtTime(at1) })}
                      value={`${bg1hN} mg/dL${autoFilled.bg1h ? t("auto_suffix") : ""}`}
                      accent={autoFilled.bg1h ? ACCENT : undefined}
                    />
                  )}
                  {bg2hN != null && (
                    <Row
                      label={t("followup_2h", { when: fmtTime(at2) })}
                      value={`${bg2hN} mg/dL${autoFilled.bg2h ? t("auto_suffix") : ""}`}
                      accent={autoFilled.bg2h ? ACCENT : undefined}
                    />
                  )}
                </div>
              )}

              {error && (
                <div style={{
                  fontSize: 12, color: PINK,
                  padding: "8px 12px",
                  background: `${PINK}10`,
                  borderRadius: 8,
                  border: `1px solid ${PINK}25`,
                }}>{error}</div>
              )}
            </div>
          );
        })()}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: `1px solid ${BORDER}`,
          display: "flex", gap: 10, justifyContent: "flex-end",
          background: "var(--surface-soft)",
        }}>
          <button
            onClick={() => step === "review" ? setStep("form") : onClose()}
            disabled={saving}
            style={{
              padding: "10px 16px", borderRadius: 10,
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 13, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {step === "review" ? t("back_btn") : t("cancel_btn")}
          </button>
          {step === "form" ? (
            <button
              onClick={() => {
                if (!hasAnyMacroFilled) {
                  setError(t("err_at_least_one_macro"));
                  return;
                }
                setError(null);
                setStep("review");
              }}
              disabled={!canSubmit || cgmLoading}
              title={cgmLoading ? t("loading_glucose_title") : undefined}
              style={{
                padding: "10px 18px", borderRadius: 10, border: "none",
                background: !canSubmit || cgmLoading
                  ? "var(--border-soft)"
                  : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                color: !canSubmit || cgmLoading ? "var(--text-faint)" : "#fff",
                fontSize: 13, fontWeight: 700,
                cursor: !canSubmit || cgmLoading ? "not-allowed" : "pointer",
                boxShadow: !canSubmit || cgmLoading ? "none" : `0 4px 20px ${ACCENT}40`,
                transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              {cgmLoading ? t("loading_glucose_btn") : t("next_btn")}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving || saved}
              style={{
                padding: "10px 18px", borderRadius: 10,
                border: saved ? `1px solid ${GREEN}55` : "none",
                background: saved
                  ? `${GREEN}22`
                  : saving
                  ? "var(--border-soft)"
                  : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                color: saved ? GREEN : saving ? "var(--text-faint)" : "#fff",
                fontSize: 13, fontWeight: 700,
                cursor: saving || saved ? "default" : "pointer",
                boxShadow: saving || saved ? "none" : `0 4px 20px ${ACCENT}40`,
                transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              {saved ? (
                <>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>✓</span>
                  {t("saved_btn")}
                </>
              ) : saving ? (
                <>
                  <style>{`@keyframes mem_spin{to{transform:rotate(360deg)}}`}</style>
                  <span style={{
                    width: 12, height: 12,
                    border: `1.5px solid var(--text-dim)`,
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "mem_spin 0.7s linear infinite",
                  }}/>
                  {t("saving_btn")}
                </>
              ) : (
                <>
                  <span style={{ fontSize: 14, lineHeight: 1, color: GREEN }}>✓</span>
                  {t("confirm_btn")}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { Meal };
