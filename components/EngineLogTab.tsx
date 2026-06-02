"use client";

import { useState, useEffect, useRef } from "react";
import IosTapButton from "@/components/IosTapButton";
import { useTranslations } from "next-intl";
import { insertInsulinLog, fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { getInsulinSettings, resolveInsulinNamePrefill } from "@/lib/userSettings";
import { insertExerciseLog, type ExerciseType } from "@/lib/exercise";
import { exerciseTypeLabelI18n } from "@/lib/exerciseEval";
import { scheduleJobsForLog } from "@/lib/cgmJobs";
import { fetchMealsForEngine, type Meal } from "@/lib/meals";
import { parseDbDate, parseDbTs } from "@/lib/time";
import { isToday } from "@/lib/utils/datetime";
import { BOLUS_MEAL_WINDOW_MS } from "@/lib/engine/pairing";
import { hapticSelection, hapticSuccess, hapticError } from "@/lib/haptics";
import TimeQuickChips from "@/components/log/TimeQuickChips";
import SnapSlider from "@/components/log/SnapSlider";
import SegmentedChoice from "@/components/log/SegmentedChoice";
import NumberField from "@/components/log/NumberField";
import CollapsibleField from "@/components/log/CollapsibleField";
import SaveButton from "@/components/log/SaveButton";
import { InfluenceForm } from "@/components/InfluenceLogForm";

// Builds the dropdown label for a meal in the "Zu Mahlzeit verknüpfen"
// picker — "HH:MM — <first food name or meal_type> (Xg C)". Defensive
// against parsed_json being null / non-array / lacking a name field.
function formatMealOption(m: Meal, fallbackLabel: string): string {
  const dt = parseDbDate(m.meal_time ?? m.created_at);
  const time = dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const carbs = Math.round(m.carbs_grams ?? 0);
  let label: string = fallbackLabel;
  if (Array.isArray(m.parsed_json) && m.parsed_json.length > 0) {
    const first = m.parsed_json[0] as { name?: string };
    if (typeof first?.name === "string" && first.name.trim()) label = first.name.trim();
  } else if (m.meal_type) {
    label = m.meal_type;
  }
  return `${time} — ${label} (${carbs}g C)`;
}

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const ORANGE = "#FF9500";
const PINK   = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

const inp: React.CSSProperties = {
  background: "var(--input-bg)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: "11px 14px",
  color:"var(--text)",
  fontSize: 14,
  outline: "none",
  width: "100%",
};
const card: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: "20px 24px",
};
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-dim)",
  display: "block",
  marginBottom: 6,
};

// ── Datetime-local helpers ──────────────────────────────────────────
// `<input type="datetime-local">` works in *local* wall-clock time
// formatted as "YYYY-MM-DDTHH:mm" (no timezone). We have to convert
// to/from real Date instances ourselves so the persisted ISO string
// matches the user's intent.
function toLocalDtString(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function nowLocalDt(): string { return toLocalDtString(new Date()); }
// 365 days back — matches the spec "from past year to real time".
// Used for the input's `min` attribute so the native picker greys
// out anything older.
function oneYearAgoLocalDt(): string {
  return toLocalDtString(new Date(Date.now() - 365 * 86400_000));
}
function parseLocalDt(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
// "vor 3 Std" / "vor 2 Tagen" — short relative-time label for the
// success banner so users immediately see we honored the back-date.
type TFn = (key: string, values?: Record<string, string | number | Date>) => string;
function relativeAgo(deltaMs: number, t: TFn): string {
  if (deltaMs < 60_000)            return t("rel_just_now");
  const min = Math.round(deltaMs / 60_000);
  if (min < 60)                    return t("rel_minutes_ago", { n: min });
  const hr  = Math.round(min / 60);
  if (hr < 24)                     return t("rel_hours_ago", { n: hr });
  const day = Math.round(hr / 24);
  return t("rel_days_ago", { n: day });
}

/**
 * Extract a human-readable message from anything that ended up in a
 * catch block. Real Errors hand back `.message` directly; supabase-js
 * PostgrestError / AuthError values are plain objects with the same
 * `.message` shape but fail `instanceof Error`, so we have to dig
 * manually. Falls back to "Unbekannter Fehler" only when the throw
 * had no usable text at all.
 */
function extractErrMessage(e: unknown, t: TFn): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts: string[] = [];
    if (typeof o.message === "string" && o.message.trim()) parts.push(o.message.trim());
    if (typeof o.details === "string" && o.details.trim()) parts.push(o.details.trim());
    if (typeof o.hint    === "string" && o.hint.trim())    parts.push(o.hint.trim());
    if (typeof o.code    === "string" && o.code.trim())    parts.push(`[${o.code.trim()}]`);
    if (parts.length) return parts.join(" — ");
  }
  if (typeof e === "string" && e.trim()) return e.trim();
  return t("unknown_error");
}

/** Pull current CGM reading; null on any failure (network, no LLU, 401). */
async function pullCurrentCgm(): Promise<number | null> {
  try {
    const r = await fetch("/api/cgm/latest", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.current?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Inline Bolus/Basal toggle. */
function Segmented<T extends string>({
  value, options, onChange, accent,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  accent: string;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${options.length},1fr)`,
      gap: 6,
      background: "var(--input-bg)",
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: 4,
    }}>
      {options.map(opt => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (!on) {
                hapticSelection();
                onChange(opt.value);
              }
            }}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: on ? `${accent}22` : "transparent",
              color: on ? accent : "var(--text-muted)",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function StatusBanner({ status, accent, t }: { status: Status; accent: string; t: TFn }) {
  if (status.kind === "idle") return null;
  if (status.kind === "submitting") {
    return (
      <div style={{
        marginTop: 14, padding: "10px 14px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 13, color: "var(--text-muted)",
      }}>
        {t("saving_inline")}
      </div>
    );
  }
  if (status.kind === "ok") {
    return (
      <div style={{
        marginTop: 14, padding: "12px 14px",
        background: `${accent}14`, border: `1px solid ${accent}33`, borderRadius: 10,
        fontSize: 14, color: accent, fontWeight: 600,
      }}>
        {status.message}
      </div>
    );
  }
  return (
    <div style={{
      marginTop: 14, padding: "12px 14px",
      background: `${PINK}14`, border: `1px solid ${PINK}33`, borderRadius: 10,
      fontSize: 14, color: PINK, fontWeight: 600,
    }}>
      {status.message}
    </div>
  );
}

export function InsulinForm({ initialType = "bolus" }: { initialType?: "bolus" | "basal" } = {}) {
  const t = useTranslations("engineLog");
  const [type, setType] = useState<"bolus" | "basal">(initialType);
  // Pre-fill the brand name with the saved bolus/basal brand for the
  // initial type (#621/#622). Falls back to "" when no brand is set or
  // during SSR. Tab switches keep the pre-fill in sync via handleTypeChange.
  const [name, setName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return resolveInsulinNamePrefill(getInsulinSettings(), initialType);
  });
  const [showInfluence, setShowInfluence] = useState(false);
  // Default starting positions: "5" IE bolus, "20" IE basal. Stored
  // as a string so the user can type free-form (e.g. "7,5"); parsed
  // and clamped to 0.5–100 IE on submit.
  const [units, setUnits] = useState<string>("5");
  const [savedTick, setSavedTick] = useState<number>(0);
  // Toggle bolus ↔ basal; only retarget the default if the user
  // hasn't customised the value.
  function handleTypeChange(next: "bolus" | "basal") {
    setType(prev => {
      if (prev === next) return prev;
      // Retarget unit default if user hasn't customised it.
      if (prev === "bolus" && units === "5")  setUnits("20");
      if (prev === "basal" && units === "20") setUnits("5");
      // Pre-fill name with the saved brand for the new tab, but only
      // when the field is empty or still matches the previous tab's brand
      // (i.e. the user hasn't typed a custom value).
      const ins = getInsulinSettings();
      const prevBrand = resolveInsulinNamePrefill(ins, prev);
      const nextBrand = resolveInsulinNamePrefill(ins, next);
      setName(n => (n === "" || n === prevBrand) ? nextBrand : n);
      return next;
    });
  }
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Quick-chip "Taken" picker state — mirrors ExerciseForm.startedMinAgo.
  // 0 = "Now" (live submission), > 0 = minutes ago (retroactive),
  // TAKEN_CUSTOM = "Andere Zeit…" (custom datetime picker visible).
  const [takenMinAgo, setTakenMinAgo] = useState<number>(0);
  const [customTakenAt, setCustomTakenAt] = useState<string>(() => nowLocalDt());
  const usingCustomTaken = takenMinAgo === TAKEN_CUSTOM;
  // Today's meals, newest first, capped at 10 — feeds the optional
  // "Zu Mahlzeit verknüpfen" dropdown that only renders for bolus entries.
  // Refetched whenever the user toggles to bolus so a meal logged in
  // another tab/session shows up without a full reload.
  const [todayMeals, setTodayMeals] = useState<Meal[]>([]);
  const [relatedMealId, setRelatedMealId] = useState<string>("");
  // Frequent entries: top-3 name+dose combos per type from last 60 days,
  // sorted by frequency. Used as quick-select chips above the name field.
  const [recentSuggestions, setRecentSuggestions] = useState<Array<{ name: string; units: number; type: "bolus" | "basal" }>>([]);

  // Load and aggregate frequent insulin entries once on mount.
  useEffect(() => {
    let cancelled = false;
    fetchRecentInsulinLogs(60).then((logs: InsulinLog[]) => {
      if (cancelled) return;
      // Count occurrences of each (type, name, rounded-units) combo.
      const freq = new Map<string, { name: string; units: number; type: "bolus" | "basal"; count: number }>();
      for (const log of logs) {
        const n = (log.insulin_name ?? "").trim();
        if (!n) continue;
        const u = Math.round((log.units ?? 0) * 2) / 2; // round to 0.5
        const key = `${log.insulin_type}|${n.toLowerCase()}|${u}`;
        const existing = freq.get(key);
        if (existing) { existing.count++; }
        else { freq.set(key, { name: n, units: u, type: log.insulin_type as "bolus" | "basal", count: 1 }); }
      }
      // Top-3 per type by frequency, then alphabetical.
      const sorted = [...freq.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      setRecentSuggestions(sorted.slice(0, 6));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (type !== "bolus") return;
    let cancelled = false;
    fetchMealsForEngine().then(all => {
      if (cancelled) return;
      const todays = all
        .filter(m => isToday(m.meal_time ?? m.created_at ?? ""))
        .sort((a, b) => parseDbDate(b.meal_time ?? b.created_at).getTime() - parseDbDate(a.meal_time ?? a.created_at).getTime())
        .slice(0, 10);
      setTodayMeals(todays);
    }).catch(() => { /* dropdown silently empty if fetch fails */ });
    return () => { cancelled = true; };
  }, [type]);

  // Voice-intent pre-fill: glev:open-bolus-log dispatched by useVoiceIntents
  // when the intent classifier recognises a bolus utterance (e.g. "4 Einheiten
  // Novorapid"). Fills in units and insulin name, but does NOT submit — the
  // user must still tap "Speichern" (compliance gate D-003).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ units?: number; insulin_name?: string; notes?: string }>).detail;
      if (typeof detail?.units === "number" && detail.units > 0) {
        setUnits(String(detail.units));
      }
      if (typeof detail?.insulin_name === "string" && detail.insulin_name.trim()) {
        setName(detail.insulin_name.trim());
      }
      if (typeof detail?.notes === "string" && detail.notes.trim()) {
        setNotes(detail.notes.trim());
      }
      // Force bolus tab so the pre-fill is visible immediately.
      setType("bolus");
    };
    window.addEventListener("glev:open-bolus-log", handler);
    return () => window.removeEventListener("glev:open-bolus-log", handler);
  }, []);

  const placeholder = type === "bolus" ? "Fiasp" : "Tresiba";
  // Accept "5" and "7,5" (German decimal). Empty/garbage parses to NaN
  // → invalidates the form via the existing `Number.isFinite` check.
  const u = Number((units ?? "").replace(",", "."));
  const nowMs = Date.now();
  // Derive effective injection instant from quick-chip or custom picker.
  // Quick-chip paths are always valid (they map to fixed minute offsets);
  // custom path validates the same range as the old datetime input did.
  const atDate: Date | null = usingCustomTaken
    ? parseLocalDt(customTakenAt)
    : new Date(nowMs - takenMinAgo * 60_000);
  const atValid = usingCustomTaken
    ? (!!atDate && atDate.getTime() >= nowMs - 365 * 86400_000 && atDate.getTime() <= nowMs + 60_000)
    : true;
  const valid = type && name.trim().length > 0 && Number.isFinite(u) && u > 0 && u <= 100 && atValid;

  async function handleSubmit() {
    if (!valid || !atDate) return;
    setStatus({ kind: "submitting" });
    // Treat anything older than 5 minutes as a back-dated entry: the
    // current CGM reading would be wrong by ≥ that delta, so we leave
    // cgm_glucose_at_log NULL and let the scheduler fill it from CGM
    // history at the actual injection instant. Mirrors the Exercise
    // form's retroactive pattern.
    const deltaMs = nowMs - atDate.getTime();
    const isRetro = deltaMs > 5 * 60_000;
    const cgm = isRetro ? null : await pullCurrentCgm();
    const atIso = atDate.toISOString();
    try {
      const inserted = await insertInsulinLog({
        insulin_type: type,
        insulin_name: name.trim(),
        units: u,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
        // bolus only — basal entries clear the related-meal UI.
        related_entry_id: type === "bolus" && relatedMealId ? relatedMealId : null,
        at: atIso,
      });
      // Anchor scheduled post-fetches on the chosen injection time so
      // back-dated entries can resolve from CGM history immediately.
      const ref = inserted?.created_at || atIso;
      void scheduleJobsForLog({
        logId: inserted.id,
        logType: type,
        refTimeIso: ref,
      });
      const typeLabel = type === "bolus" ? t("type_bolus") : t("type_basal");
      const whenLabel = isRetro ? t("logged_when_suffix", { rel: relativeAgo(deltaMs, t) }) : "";
      const trimmedName = name.trim();
      hapticSuccess();
      setSavedTick(n => n + 1);
      setStatus({
        kind: "ok",
        message: cgm != null
          ? t("logged_with_cgm", { units: u, type: typeLabel, name: trimmedName, when: whenLabel, cgm: Math.round(cgm) })
          : t("logged_no_cgm", { units: u, type: typeLabel, name: trimmedName, when: whenLabel }),
      });
      // Notify the dashboard (and any other listener) that insulin data has
      // changed. The dashboard's SWR cache revalidates on this event, and
      // the basal quick-log sheet listens to close itself automatically.
      window.dispatchEvent(new CustomEvent("glev:insulin-updated"));
      setUnits(type === "bolus" ? "5" : "20");
      setNotes("");
      setRelatedMealId("");
      // Reset both the chip picker and the custom datetime so the next
      // log doesn't silently inherit the previous back-date.
      setTakenMinAgo(0);
      setCustomTakenAt(nowLocalDt());
    } catch (e) {
      // Defensive: lib functions SHOULD wrap supabase errors in Error
      // (see lib/insulin.ts), but PostgrestError / AuthError are plain
      // objects with a `.message` field — extract it manually so a
      // missed wrap somewhere upstream doesn't degrade to the generic
      // "Unbekannter Fehler" fallback.
      const msg = extractErrMessage(e, t);
      hapticError();
      setStatus({ kind: "error", message: t("save_failed_prefix", { message: msg }) });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${GREEN}20`, border: `1px solid ${GREEN}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 2v20M2 12h20" />
          </svg>
        </span>
        {t("insulin_card_title")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>{t("type_label")}</label>
          <Segmented<"bolus" | "basal">
            value={type}
            onChange={handleTypeChange}
            accent={GREEN}
            options={[
              { value: "bolus", label: t("type_bolus") },
              { value: "basal", label: t("type_basal") },
            ]}
          />
        </div>
        <div>
          <label style={labelStyle}>{t("insulin_name_label")}</label>
          {/* Quick-select chips — top frequent entries for current type */}
          {recentSuggestions.filter(s => s.type === type).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {recentSuggestions.filter(s => s.type === type).slice(0, 3).map((s, i) => {
                const active = name === s.name && units === String(s.units);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setName(s.name); setUnits(String(s.units)); hapticSelection(); }}
                    style={{
                      padding: "5px 10px", borderRadius: 20, border: `1.5px solid ${active ? GREEN : "var(--border)"}`,
                      background: active ? `${GREEN}18` : "var(--surface-soft)",
                      color: active ? GREEN : "var(--text-dim)",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                      WebkitTapHighlightColor: "transparent",
                      transition: "all 150ms ease",
                    }}
                  >
                    <span>{s.name}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.8 }}>{s.units} IE</span>
                  </button>
                );
              })}
            </div>
          )}
          <input
            style={inp}
            placeholder={placeholder}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>{t("units_label")}</label>
          {/* Free-form text input — replaces SnapSlider so the user
              types the exact dose (e.g. "7,5") instead of dragging a
              200-step slider. Submit-time validation enforces 0.5–100 IE. */}
          <NumberField
            value={units}
            onChange={setUnits}
            min={0.5}
            max={100}
            step={0.5}
            unit={t("units_unit")}
            accent={GREEN}
            ariaLabel={t("units_label")}
            showSteppers
          />
        </div>
        <div>
          {/* Quick-chip "Taken" picker — mirrors ExerciseForm "Started".
              Most common cases (Now / 30m / 1h / 2h / 3h ago) are one
              tap; "Andere Zeit…" unlocks a full datetime picker for
              edge cases. When a chip > 0 is selected handleSubmit
              treats the entry as retroactive: cgm_glucose_at_log stays
              NULL and the CGM scheduler resolves both the baseline and
              the post-fetch windows from CGM history immediately. */}
          <label style={labelStyle}>{t("taken_label")}</label>
          <TimeQuickChips
            value={usingCustomTaken ? -999 : takenMinAgo}
            onChange={setTakenMinAgo}
            accent={GREEN}
            ariaLabel={t("taken_label")}
            options={TAKEN_OPTIONS.map(o => ({
              value: o.value,
              label: o.value === 0 ? t("started_now_btn") : t("started_ago_btn", { label: o.label }),
            }))}
          />
          <button
            type="button"
            aria-pressed={usingCustomTaken}
            onClick={() => {
              hapticSelection();
              setTakenMinAgo(usingCustomTaken ? 0 : TAKEN_CUSTOM);
            }}
            style={{
              marginTop: 8,
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 600,
              background: usingCustomTaken ? `${GREEN}1f` : "transparent",
              color: usingCustomTaken ? GREEN : "var(--text-muted)",
              border: `1px dashed ${usingCustomTaken ? GREEN : "var(--border-strong)"}`,
              borderRadius: 8,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s",
            }}
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8"  y1="2" x2="8"  y2="6" />
              <line x1="3"  y1="10" x2="21" y2="10" />
              <path d="M14 16l-3 3-2-2" />
            </svg>
            {t("started_custom_btn")}
          </button>
          {usingCustomTaken && (
            <input
              style={{ ...inp, marginTop: 8 }}
              type="datetime-local"
              min={oneYearAgoLocalDt()}
              max={nowLocalDt()}
              value={customTakenAt}
              onChange={e => setCustomTakenAt(e.target.value)}
              aria-label={t("started_custom_btn")}
            />
          )}
          <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>
            {atDate && nowMs - atDate.getTime() > 5 * 60_000
              ? t("backdated_hint", { when: relativeAgo(nowMs - atDate.getTime(), t) })
              : t("default_now_hint")}
          </div>
        </div>
        <CollapsibleField
          label={t("note_collapse_label")}
          accent={GREEN}
          hasValue={notes.trim().length > 0}
        >
          <input
            style={inp}
            placeholder={t("note_insulin_placeholder")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </CollapsibleField>
        {/* Bolus-only: explicit link to a meal logged today. Engine ICR
            pairing prefers this over the ±30min time-window heuristic.
            Hidden for basal because basal isn't dosed against a meal.
            When a meal sits within ±30min of the chosen `at` and the
            user hasn't picked anything yet, surface a one-tap "Vorschlag"
            banner so an explicit tag becomes the default behaviour
            (Task #211 — reduce reliance on the loose time-window match). */}
        {type === "bolus" && (() => {
          // Find the closest meal whose meal_time / created_at is within
          // ±30min of `at`. Mirrors lib/engine/pairing.ts so the form's
          // suggestion lines up exactly with what the engine would
          // otherwise pair via the heuristic.
          let suggestion: Meal | null = null;
          if (atDate && todayMeals.length > 0) {
            const atMs = atDate.getTime();
            let bestDelta = Infinity;
            for (const m of todayMeals) {
              const ts = parseDbTs(m.meal_time ?? m.created_at);
              if (!Number.isFinite(ts)) continue;
              const delta = Math.abs(ts - atMs);
              if (delta <= BOLUS_MEAL_WINDOW_MS && delta < bestDelta) {
                bestDelta = delta;
                suggestion = m;
              }
            }
          }
          const showSuggestion = !!suggestion && relatedMealId !== suggestion.id;
          return (
            <div>
              <label style={labelStyle}>{t("link_meal_label")}</label>
              {showSuggestion && suggestion && (
                <div style={{
                  marginBottom: 8, padding: "10px 12px", borderRadius: 10,
                  background: `${ACCENT}10`, border: `1px solid ${ACCENT}33`,
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                }}>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.4, flex: 1, minWidth: 140 }}>
                    <div style={{ fontWeight: 700, color: ACCENT, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
                      {t("link_suggestion_label")}
                    </div>
                    {t("link_suggestion_body", { meal: formatMealOption(suggestion, t("meal_fallback")) })}
                  </div>
                  <button
                    type="button"
                    onClick={() => suggestion && setRelatedMealId(suggestion.id)}
                    style={{
                      padding: "8px 14px", borderRadius: 8, border: "none",
                      background: ACCENT, color: "var(--on-accent)",
                      fontSize: 13, fontWeight: 700, cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t("link_suggestion_accept")}
                  </button>
                </div>
              )}
              <select
                style={{ ...inp, appearance: "none", WebkitAppearance: "none", cursor: todayMeals.length ? "pointer" : "default" }}
                value={relatedMealId}
                onChange={e => setRelatedMealId(e.target.value)}
                disabled={todayMeals.length === 0}
              >
                <option value="">{t("no_link")}</option>
                {todayMeals.map(m => (
                  <option key={m.id} value={m.id}>{formatMealOption(m, t("meal_fallback"))}</option>
                ))}
              </select>
              {todayMeals.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>
                  {t("no_meals_today")}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>
                  {t("today_meals_hint")}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <SaveButton
        onClick={handleSubmit}
        disabled={!valid}
        busy={status.kind === "submitting"}
        accent={GREEN}
        label={t("log_insulin_btn")}
        successKey={savedTick || null}
      />

      <StatusBanner status={status} accent={GREEN} t={t} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("insulin_disclaimer")}
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => { hapticSelection(); setShowInfluence(v => !v); }}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            width: "100%", padding: "11px 14px",
            background: showInfluence ? "#F5A52414" : "var(--surface-soft)",
            border: `1px solid ${showInfluence ? "#F5A52440" : BORDER}`,
            borderRadius: 10,
            color: showInfluence ? "#F5A524" : "var(--text-muted)",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            transition: "all 0.15s", textAlign: "left",
          }}
        >
          <span>🔬</span>
          <span style={{ flex: 1 }}>
            {showInfluence ? t("influence_toggle_hide") : t("influence_toggle_show")}
          </span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{showInfluence ? "▲" : "▼"}</span>
        </button>
        {showInfluence && (
          <div style={{ marginTop: 8 }}>
            <InfluenceForm />
          </div>
        )}
      </div>
    </div>
  );
}

// Quick-chip options for the Insulin "Taken" picker. Wider range than
// the Exercise "Started" picker (max 3 h) because users more often
// forget to log a bolus 2–3 hours after the fact than a workout.
const TAKEN_OPTIONS: { value: number; label: string }[] = [
  { value: 0,   label: "Now" },
  { value: 30,  label: "30m" },
  { value: 60,  label: "1h" },
  { value: 120, label: "2h" },
  { value: 180, label: "3h" },
];
// Sentinel: when takenMinAgo equals this value the custom datetime
// picker is shown instead of a quick chip.
const TAKEN_CUSTOM = -1;

// New exercise taxonomy used by the form. Legacy `hypertrophy` rows
// remain valid in the DB and are mapped to "Strength" for display, but
// the picker only shows the new set so going forward all rows use it.
const EXERCISE_TYPE_OPTIONS: ExerciseType[] = [
  "cardio", "strength", "hiit", "yoga", "cycling", "run", "swimming",
  "football", "tennis", "volleyball", "basketball",
  "breathwork",
  "hot_shower", "cold_shower",
];

// Retroactive-start choices. Selecting anything other than "Now"
// shifts the reference time the CGM scheduler uses to compute the
// at-end and +1h fetches, so workouts that already ended can still
// be evaluated from CGM history. Spec calls for max 3 quick chips
// (Now / 30m / 1h) plus an "Andere Zeit…" custom-time entry — the
// custom path is rendered separately in the form so the chip row
// stays compact.
const STARTED_OPTIONS: { value: number; label: string }[] = [
  { value: 0,   label: "Now" },
  { value: 30,  label: "30m" },
  { value: 60,  label: "1h" },
];
// Sentinel for the "Andere Zeit…" chip — when selected, the form
// reveals a datetime-local picker so the user can back-date freely
// (still capped at 3 h via the input's `min`).
const STARTED_CUSTOM = -1;
const STARTED_MAX_AGO_MIN = 180;

/** Custom dropdown for the Sportart picker. Built as a disclosure
 *  button + absolute-positioned options list (instead of a native
 *  `<select>`) so the open list can carry the same orange-accent
 *  styling as the Started/Intensity toggles in the same card — native
 *  `<option>` rendering is browser-controlled and can't be themed
 *  consistently across iOS Safari, Chrome, Firefox, etc.
 *
 *  Closes on outside click or Escape, exposes ARIA listbox semantics
 *  for screen readers, and keeps row heights ≥ 40 px so each option
 *  is a comfortable touch target on mobile. */
function ExerciseTypeDropdown({
  value, options, onChange, renderLabel,
}: {
  value: ExerciseType;
  options: ExerciseType[];
  onChange: (v: ExerciseType) => void;
  renderLabel: (v: ExerciseType) => string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          ...inp,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          textAlign: "left",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <span>{renderLabel(value)}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
            flexShrink: 0,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            background: "var(--input-bg)",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            maxHeight: 280,
            overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }}
        >
          {/* 2026-05-18: IosTapButton — Selecting an option synchronously
              calls setOpen(false) which unmounts this whole listbox.
              On iOS WKWebView the synthesised click would otherwise
              retarget onto whatever was behind the dropdown (often
              another form field, causing focus jumps). Pointerup-fired
              activation guarantees the selection runs against the
              still-mounted option node. */}
          {options.map(opt => {
            const on = opt === value;
            return (
              <IosTapButton
                key={opt}
                role="option"
                ariaSelected={on}
                onAct={() => {
                  if (!on) hapticSelection();
                  onChange(opt);
                  setOpen(false);
                }}
                style={{
                  padding: "11px 12px",
                  minHeight: 40,
                  borderRadius: 8,
                  border: "none",
                  background: on ? `${ORANGE}22` : "transparent",
                  color: on ? ORANGE : "var(--text)",
                  fontSize: 14,
                  fontWeight: on ? 700 : 500,
                  letterSpacing: "-0.01em",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                }}
              >
                {renderLabel(opt)}
              </IosTapButton>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ExerciseForm() {
  const tEng = useTranslations("engine");
  const tIns = useTranslations("insights");
  const t = useTranslations("engineLog");
  const [type, setType] = useState<ExerciseType>("cardio");
  const [startedMinAgo, setStartedMinAgo] = useState<number>(0);
  // "Andere Zeit…" surfaces a datetime-local input; converted back
  // to minutes-ago at submit.
  const [customStartAt, setCustomStartAt] = useState<string>(() => nowLocalDt());
  const usingCustomStart = startedMinAgo === STARTED_CUSTOM;
  // Duration in minutes — stored as string for free-form typing
  // (e.g. "45"), parsed and validated to 1–600 min on submit.
  const [duration, setDuration] = useState<string>("30");
  const [intensity, setIntensity] = useState<"low" | "medium" | "high">("medium");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [savedTick, setSavedTick] = useState<number>(0);

  // Voice-intent pre-fill: glev:open-exercise-log dispatched by useVoiceIntents
  // when the classifier recognises an exercise utterance (e.g. "30 Minuten
  // Radfahren"). Fills in duration, type and intensity — user still confirms
  // with "Speichern" (compliance gate D-003).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        duration_minutes?: number;
        exercise_type?: string;
        intensity?: "low" | "medium" | "high";
      }>).detail;
      if (typeof detail?.duration_minutes === "number" && detail.duration_minutes > 0) {
        setDuration(String(Math.min(600, Math.round(detail.duration_minutes))));
      }
      const validTypes: ExerciseType[] = ["cardio", "strength", "yoga", "cycling", "swimming", "run", "hiit", "football", "tennis", "volleyball", "basketball", "breathwork", "hot_shower", "cold_shower"];
      if (typeof detail?.exercise_type === "string" && validTypes.includes(detail.exercise_type as ExerciseType)) {
        setType(detail.exercise_type as ExerciseType);
      }
      if (detail?.intensity === "low" || detail?.intensity === "medium" || detail?.intensity === "high") {
        setIntensity(detail.intensity);
      }
    };
    window.addEventListener("glev:open-exercise-log", handler);
    return () => window.removeEventListener("glev:open-exercise-log", handler);
  }, []);

  // Accept "30" and "30,5" (German decimal). Empty/garbage parses to
  // NaN → invalidates the form via the existing `Number.isFinite` check.
  const d = Number((duration ?? "").replace(",", "."));
  // For the custom-time path, recompute minutes-ago at submit.
  function effectiveStartedMinAgo(): number {
    if (!usingCustomStart) return startedMinAgo;
    const dt = parseLocalDt(customStartAt);
    if (!dt) return 0;
    const diff = Math.round((Date.now() - dt.getTime()) / 60_000);
    return Math.max(0, Math.min(STARTED_MAX_AGO_MIN, diff));
  }
  const valid = Number.isFinite(d) && d > 0 && d <= 600
    && (!usingCustomStart || !!parseLocalDt(customStartAt));

  // Compute the actual workout start instant for the submit confirmation
  // and the CGM scheduler. For "Now" this equals submit time.
  // (`effectiveStartedMinAgo` resolves the custom-time path.)
  function computeStartIso(): string {
    return new Date(Date.now() - effectiveStartedMinAgo() * 60_000).toISOString();
  }

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    // Use the *effective* minutes-ago so the "Andere Zeit…" custom
    // datetime path is treated as retro too — otherwise startedMinAgo
    // is the -1 sentinel and the live CGM would be wrongly snapshotted.
    const minAgoEff = effectiveStartedMinAgo();
    const isRetro = minAgoEff > 0;
    // For live ("Now") submissions, anchor on the live CGM reading.
    // For retroactive submissions, leave the baseline NULL so the
    // scheduler fills it from CGM history at the actual start instant.
    const cgm = isRetro ? null : await pullCurrentCgm();
    try {
      const refIso = computeStartIso();
      const insertedEx = await insertExerciseLog({
        exercise_type: type,
        duration_minutes: d,
        intensity,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
        // Only override created_at for retroactive logs — live
        // submissions keep the DB default `now()`.
        start_at: isRetro ? refIso : undefined,
      });
      // Schedule post-fetches: at workout end (start + duration), and
      // +1h after end. For retroactive logs, refTime is shifted into
      // the past so the at-end fetch can resolve immediately from CGM
      // history.
      void scheduleJobsForLog({
        logId: insertedEx.id,
        logType: "exercise",
        refTimeIso: refIso,
        durationMinutes: d,
      });
      const typeLabel = exerciseTypeLabelI18n(tIns, type);
      const minAgo = effectiveStartedMinAgo();
      const startedOpt = STARTED_OPTIONS.find(o => o.value === minAgo);
      const startedLabel = minAgo === 0
        ? ""
        : t("exercise_started_suffix", {
            label: startedOpt?.label ?? relativeAgo(minAgo * 60_000, t),
          });
      // Map the stored intensity token to the spec wording for display.
      const intensityLabel = intensity === "low"
        ? tEng("exercise_intensity_low")
        : intensity === "high"
          ? tEng("exercise_intensity_high")
          : tEng("exercise_intensity_medium");
      hapticSuccess();
      setStatus({
        kind: "ok",
        message: cgm != null
          ? t("exercise_logged_with_cgm", { minutes: d, type: typeLabel, intensity: intensityLabel, when: startedLabel, cgm: Math.round(cgm) })
          : t("exercise_logged_no_cgm", { minutes: d, type: typeLabel, intensity: intensityLabel, when: startedLabel }),
      });
      setSavedTick(n => n + 1);
      setDuration("30");
      setNotes("");
      setStartedMinAgo(0);
      setCustomStartAt(nowLocalDt());
    } catch (e) {
      // See InsulinForm above — extract `.message` from PostgrestError-
      // like plain objects so the banner shows the real cause.
      const msg = extractErrMessage(e, t);
      hapticError();
      setStatus({ kind: "error", message: t("save_failed_prefix", { message: msg }) });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${ORANGE}20`, border: `1px solid ${ORANGE}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 6.5l11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7" />
          </svg>
        </span>
        {t("exercise_card_title")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>{t("type_label")}</label>
          {/* Dropdown picker (replaces the previous 3-column button
              grid). The list of 10 sport types was visually noisy
              across two-and-a-bit rows — the disclosure pattern keeps
              the closed state compact and scales cleanly if more
              types are added later. */}
          <ExerciseTypeDropdown
            value={type}
            options={EXERCISE_TYPE_OPTIONS}
            onChange={setType}
            renderLabel={(opt) => exerciseTypeLabelI18n(tIns, opt)}
          />
        </div>
        <div>
          <label style={labelStyle}>{tEng("exercise_started_label")}</label>
          {/* Retroactive start picker — shifts the CGM scheduler's
              reference time so a workout already finished can still
              be evaluated from CGM history within the 3 h window.

              Layout: three equal-width quick chips (Jetzt / vor 30m /
              vor 1h) so every label fits cleanly on a 375 px iPhone,
              followed by a clearly-distinct dashed-outline "Andere
              Zeit…" toggle. The custom entry used to be a 4th chip
              in the same row, but its long German label was getting
              truncated to the point users couldn't tell it existed.
              The dashed toggle + calendar/pencil glyph reads as
              "edit time" at a glance; tapping it toggles the
              datetime picker, tapping a chip returns to quick-chip
              mode. State: chip values drive `startedMinAgo`, the
              sentinel `STARTED_CUSTOM` (-1) selects the picker. */}
          <TimeQuickChips
            // When the custom path is active, pass a value none of the
            // chips can match so all three render in their inactive
            // (muted) state — keeps the visual grouping consistent
            // with the active dashed "Andere Zeit…" toggle below.
            value={usingCustomStart ? -999 : startedMinAgo}
            onChange={setStartedMinAgo}
            accent={ORANGE}
            ariaLabel={tEng("exercise_started_label")}
            options={STARTED_OPTIONS.map(o => ({
              value: o.value,
              label: o.value === 0 ? t("started_now_btn") : t("started_ago_btn", { label: o.label }),
            }))}
          />
          <button
            type="button"
            aria-pressed={usingCustomStart}
            onClick={() => {
              hapticSelection();
              setStartedMinAgo(usingCustomStart ? 0 : STARTED_CUSTOM);
            }}
            style={{
              marginTop: 8,
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 600,
              background: usingCustomStart ? `${ORANGE}1f` : "transparent",
              color: usingCustomStart ? ORANGE : "var(--text-muted)",
              border: `1px dashed ${usingCustomStart ? ORANGE : "var(--border-strong)"}`,
              borderRadius: 8,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s",
            }}
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8"  y1="2" x2="8"  y2="6" />
              <line x1="3"  y1="10" x2="21" y2="10" />
              <path d="M14 16l-3 3-2-2" />
            </svg>
            {t("started_custom_btn")}
          </button>
          {usingCustomStart && (
            <input
              style={{ ...inp, marginTop: 8 }}
              type="datetime-local"
              max={nowLocalDt()}
              min={toLocalDtString(new Date(Date.now() - STARTED_MAX_AGO_MIN * 60_000))}
              value={customStartAt}
              onChange={e => setCustomStartAt(e.target.value)}
              aria-label={t("started_custom_btn")}
            />
          )}
        </div>
        <div>
          <label style={labelStyle}>{t("duration_label")}</label>
          {/* Free-form text input — replaces SnapSlider so the user
              types the exact duration (e.g. "45") instead of dragging
              a 595-step slider. Submit-time validation enforces 1–600 min. */}
          <NumberField
            value={duration}
            onChange={setDuration}
            min={1}
            max={600}
            step={1}
            unit={t("duration_unit")}
            accent={ORANGE}
            ariaLabel={t("duration_label")}
          />
        </div>
        <div>
          <label style={labelStyle}>
            {tEng("exercise_intensity_label")} —{" "}
            <span style={{ color: ORANGE, fontWeight: 700 }}>
              {intensity === "low"
                ? tEng("exercise_intensity_low")
                : intensity === "high"
                  ? tEng("exercise_intensity_high")
                  : tEng("exercise_intensity_medium")}
            </span>
          </label>
          {/* Segmented 3-button control. Vorher: 3-stop SnapSlider,
              der auf iOS WKWebView mit native range input beim Drag
              „zurücksprang" (User-Report 2026-05-18). */}
          <SegmentedChoice<"low" | "medium" | "high">
            value={intensity}
            onChange={setIntensity}
            accent={ORANGE}
            ariaLabel={tEng("exercise_intensity_label")}
            options={[
              { value: "low",    label: tEng("exercise_intensity_low") },
              { value: "medium", label: tEng("exercise_intensity_medium") },
              { value: "high",   label: tEng("exercise_intensity_high") },
            ]}
          />
        </div>
        <CollapsibleField
          label={t("note_collapse_label")}
          accent={ORANGE}
          hasValue={notes.trim().length > 0}
        >
          <input
            style={inp}
            placeholder={t("note_exercise_placeholder")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </CollapsibleField>
      </div>

      <SaveButton
        onClick={handleSubmit}
        disabled={!valid}
        busy={status.kind === "submitting"}
        accent={ORANGE}
        label={t("log_exercise_btn")}
        successKey={savedTick || null}
      />

      <StatusBanner status={status} accent={ORANGE} t={t} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("exercise_disclaimer")}
      </div>
    </div>
  );
}

export default function EngineLogTab({ initialType }: { initialType?: "bolus" | "basal" } = {}) {
  const t = useTranslations("engineLog");
  return (
    <div>
      {/* InsulinForm + ExerciseForm sit side-by-side on desktop and stack on
          mobile. auto-fit minmax(320px, 1fr) collapses to one column once
          either form would be narrower than 320px, which lines up with the
          768px sidebar↔mobile breakpoint in Layout.tsx for typical viewports
          while still gracefully degrading on intermediate widths. */}
      <div
        className="glev-log-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}
      >
        <InsulinForm initialType={initialType} />
        <ExerciseForm />
      </div>

      {/* Manual fingerstick capture lives now as its own top-level tab
          ("FS Glucose") on the engine screen — no longer rendered here to
          avoid duplication. */}

      <div style={{
        marginTop: 20, padding: "14px 18px",
        background: "var(--surface-soft)", borderRadius: 12, border: `1px solid ${BORDER}`,
      }}>
        <div style={{ fontSize: 13, color: "var(--text-ghost)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text-dim)" }}>{t("footer_note_label")}</strong>{" "}
          {t("footer_note_body")}
        </div>
      </div>

      {/* keep ACCENT in scope for future tab additions without lint warnings */}
      <span style={{ display: "none", color: ACCENT }} />
    </div>
  );
}
