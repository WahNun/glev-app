"use client";

import { useEffect, useState } from "react";
import {
  saveMeal,
  classifyMeal,
  computeEvaluation,
  computeCalories,
  type Meal,
} from "@/lib/meals";
import { scheduleAutoFillForMeal } from "@/lib/postMealCgmAutoFill";
import { supabase } from "@/lib/supabase";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.08)";

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "FAST_CARBS",   label: "Fast carbs" },
  { value: "BALANCED",     label: "Balanced" },
  { value: "HIGH_PROTEIN", label: "High protein" },
  { value: "HIGH_FAT",     label: "High fat" },
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
  const [error,   setError]     = useState<string | null>(null);

  // Reset every time the modal opens so historical entries don't leak between sessions.
  useEffect(() => {
    if (!open) return;
    const fresh = new Date();
    setMealTime(toDatetimeLocal(fresh));
    setDesc(""); setCarbs(""); setProtein(""); setFat(""); setFiber("");
    setInsulin(""); setGlucose(""); setMealType("AUTO");
    setBg1h(""); setBg1hAt(""); setBg2h(""); setBg2hAt("");
    setSaving(false); setError(null);
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

  if (!open) return null;

  const carbsN   = num(carbs);
  const proteinN = num(protein) ?? 0;
  const fatN     = num(fat) ?? 0;
  const fiberN   = num(fiber) ?? 0;
  const insulinN = num(insulin);
  const glucoseN = num(glucose);
  const bg1hN    = num(bg1h);
  const bg2hN    = num(bg2h);

  const canSubmit = carbsN != null && carbsN > 0 && insulinN != null && glucoseN != null;

  async function handleSubmit() {
    setError(null);

    // ─── Required fields ───────────────────────────────────────────────
    if (carbsN == null || carbsN <= 0) { setError("Carbs are required."); return; }
    if (insulinN == null)              { setError("Insulin units are required."); return; }
    if (glucoseN == null)              { setError("Glucose before is required."); return; }
    const mt = parseLocalDt(mealTime);
    if (!mt) { setError("Please pick a valid meal time."); return; }

    // ─── Physiological ranges ──────────────────────────────────────────
    // HTML min/max are advisory — typed input can still produce out-of-range
    // values. We block obviously implausible numbers so the entry log stays
    // analytically clean (negative insulin, BG=10, carbs=999, etc).
    if (carbsN > 500)                            { setError("Carbs look too high — please double-check (max 500g)."); return; }
    if (proteinN < 0 || proteinN > 500)          { setError("Protein must be between 0 and 500g."); return; }
    if (fatN     < 0 || fatN     > 500)          { setError("Fat must be between 0 and 500g."); return; }
    if (fiberN   < 0 || fiberN   > 200)          { setError("Fiber must be between 0 and 200g."); return; }
    if (insulinN < 0 || insulinN > 50)           { setError("Insulin must be between 0 and 50 units."); return; }
    if (glucoseN < 30 || glucoseN > 600)         { setError("Glucose before must be between 30 and 600 mg/dL."); return; }
    if (bg1hN != null && (bg1hN < 30 || bg1hN > 600)) { setError("1h reading must be between 30 and 600 mg/dL."); return; }
    if (bg2hN != null && (bg2hN < 30 || bg2hN > 600)) { setError("2h reading must be between 30 and 600 mg/dL."); return; }

    const cls = mealType === "AUTO" ? classifyMeal(carbsN, proteinN, fatN) : mealType;
    const ev  = computeEvaluation(carbsN, insulinN, glucoseN);

    setSaving(true);
    try {
      const mealIso = mt.toISOString();
      const meal = await saveMeal({
        inputText:    desc.trim() || "Manual entry",
        parsedJson:   [],
        glucoseBefore: glucoseN,
        glucoseAfter:  null,
        carbsGrams:   carbsN,
        proteinGrams: proteinN,
        fatGrams:     fatN,
        fiberGrams:   fiberN,
        calories:     computeCalories(carbsN, proteinN, fatN),
        insulinUnits: insulinN,
        mealType:     cls,
        evaluation:   ev,
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
      }

      // Auto-fill any missing 1h / 2h slot from CGM history. Past-due slots
      // (e.g. when user logs a meal that already happened > 1h ago without
      // a 1h reading) are picked up by the layout-level reconciliation.
      try { scheduleAutoFillForMeal(meal.id, mealIso); } catch { /* non-fatal */ }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("glev:meal-saved", { detail: { id: meal.id, mealTime: mealIso } }));
      }

      onCreated(meal);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry.");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    background: "#0D0D12",
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: "10px 12px",
    color: "#fff",
    fontSize: 13,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: "rgba(255,255,255,0.4)",
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
        background: "rgba(0,0,0,0.65)",
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
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>New manual entry</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
              Backfill a past meal. Skips voice / GPT — saved straight to your log.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: "rgba(255,255,255,0.55)",
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
          {/* Meal time */}
          <div>
            <label style={labelStyle}>Meal time</label>
            <input type="datetime-local" value={mealTime} onChange={(e) => setMealTime(e.target.value)} style={inp}/>
            <div style={{ marginTop: 4, fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              Defaults to now — change to log a historical meal.
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Meal description</label>
            <input
              value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="e.g. 100g broccoli, 23g nut mix, 130g banana"
              style={{ ...inp, fontSize: 13 }}
            />
          </div>

          {/* Macros 2x2 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Carbs (g)</label>
              <input value={carbs} onChange={(e) => setCarbs(e.target.value)} type="number" min={0} placeholder="e.g. 60" style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>Fiber (g)</label>
              <input value={fiber} onChange={(e) => setFiber(e.target.value)} type="number" min={0} placeholder="e.g. 8" style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>Protein (g)</label>
              <input value={protein} onChange={(e) => setProtein(e.target.value)} type="number" min={0} placeholder="e.g. 30" style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>Fat (g)</label>
              <input value={fat} onChange={(e) => setFat(e.target.value)} type="number" min={0} placeholder="e.g. 15" style={inp}/>
            </div>
          </div>

          {/* Classification */}
          <div>
            <label style={labelStyle}>Classification</label>
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
              style={{ ...inp, appearance: "auto" }}
            >
              <option value="AUTO">Auto from macros</option>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Insulin + Glucose before */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Insulin (u)</label>
              <input value={insulin} onChange={(e) => setInsulin(e.target.value)} type="number" min={0} step={0.5} placeholder="e.g. 1.5" style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>Glucose before (mg/dL)</label>
              <input value={glucose} onChange={(e) => setGlucose(e.target.value)} type="number" min={30} max={600} placeholder="e.g. 115" style={inp}/>
            </div>
          </div>

          {/* Optional 1h / 2h follow-ups */}
          <div style={{
            border: `1px dashed ${BORDER}`,
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase" }}>
              Follow-up readings <span style={{ opacity: 0.6, textTransform: "none", letterSpacing: 0 }}>· optional</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>1h reading (mg/dL)</label>
                <input value={bg1h} onChange={(e) => setBg1h(e.target.value)} type="number" min={30} max={600} placeholder="—" style={inp}/>
              </div>
              <div>
                <label style={labelStyle}>1h taken at</label>
                <input value={bg1hAt} onChange={(e) => setBg1hAt(e.target.value)} type="datetime-local" style={inp}/>
              </div>
              <div>
                <label style={labelStyle}>2h reading (mg/dL)</label>
                <input value={bg2h} onChange={(e) => setBg2h(e.target.value)} type="number" min={30} max={600} placeholder="—" style={inp}/>
              </div>
              <div>
                <label style={labelStyle}>2h taken at</label>
                <input value={bg2hAt} onChange={(e) => setBg2hAt(e.target.value)} type="datetime-local" style={inp}/>
              </div>
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
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: `1px solid ${BORDER}`,
          display: "flex", gap: 10, justifyContent: "flex-end",
          background: "rgba(255,255,255,0.02)",
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "10px 16px", borderRadius: 10,
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: "rgba(255,255,255,0.55)",
              fontSize: 13, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            style={{
              padding: "10px 18px", borderRadius: 10, border: "none",
              background: !canSubmit || saving
                ? "rgba(255,255,255,0.06)"
                : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
              color: !canSubmit || saving ? "rgba(255,255,255,0.3)" : "#fff",
              fontSize: 13, fontWeight: 700,
              cursor: !canSubmit || saving ? "not-allowed" : "pointer",
              boxShadow: !canSubmit || saving ? "none" : `0 4px 20px ${ACCENT}40`,
              transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {saving ? (
              <>
                <style>{`@keyframes mem_spin{to{transform:rotate(360deg)}}`}</style>
                <span style={{
                  width: 12, height: 12,
                  border: `1.5px solid rgba(255,255,255,0.4)`,
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  animation: "mem_spin 0.7s linear infinite",
                }}/>
                Saving…
              </>
            ) : (
              <>
                <span style={{ fontSize: 14, lineHeight: 1, color: GREEN }}>✓</span>
                Save entry
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export type { Meal };
