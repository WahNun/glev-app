"use client";

import React, { useState, useEffect, useId, useCallback } from "react";
import { usePlan } from "@/hooks/usePlan";
import UpgradeGate from "@/components/UpgradeGate";
import useSWR, { mutate as swrMutate } from "swr";
import RefreshingBar from "@/components/RefreshingBar";
import { useLocale, useTranslations } from "next-intl";
import { fetchMeals, fetchMealsForEngine, unifiedOutcome, type Meal } from "@/lib/meals";
import { TYPE_COLORS, chipLabelsFrom } from "@/lib/mealTypes";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import { fetchIcrSchedule, findActiveSlot, saveIcrSchedule, EMPTY_ICR_SCHEDULE, type IcrSchedule } from "@/lib/icrSchedule";
import { fetchInsulinSettings, persistEngineIcr, DEFAULT_INSULIN_SETTINGS, fetchTargetRange, getTargetRange, DEFAULT_TARGET_RANGE } from "@/lib/userSettings";
import { pairBolusesToMeals } from "@/lib/engine/pairing";
import { updateInsulinLogLink } from "@/lib/insulin";
import { fetchRejectedPairs, addRejectedPair, pairKey, type RejectedPairKey } from "@/lib/rejectedPairs";
import { detectPattern } from "@/lib/engine/patterns";
import { suggestAdjustment, type AdaptiveSettings, type AdjustmentSuggestion } from "@/lib/engine/adjustment";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import SkeletonBlock from "@/components/SkeletonBlock";
import { useCardOrder } from "@/lib/cardOrder";
// Note: PagerIndicator was the previous shared dot/segment row. The
// Insights page now uses its own InsightsCockpitIndicator (defined
// below) — counter + segment bar — per Task #329. Dashboard still
// uses the original component.
import { parseDbTs, parseDbDate } from "@/lib/time";
import { startOfDay, startOfToday, startOfDaysAgo, userTimezone } from "@/lib/utils/datetime";
import { fetchUserProfile, cycleSurfacesAvailable, type Sex } from "@/lib/userProfile";

// ─── History scope ───────────────────────────────────────────────
// Scope state (mode + anchor) now lives in `ScopeHeaderContext` so
// the global mobile header chip and this page share a single source
// of truth — see lib/scopeHeaderContext.tsx for the type defs and
// computeScopeWindow implementation. The user explicitly asked for
// the picker to move out of the page body and into the header slot
// where the old Insights/Einträge dropdown lived.
import {
  useScopeHeader,
  computeScopeWindow,
  type ScopeMode,
  type ScopeWindow,
} from "@/lib/scopeHeaderContext";

import {
  fetchFingersticks,
  type FingerstickReading,
} from "@/lib/fingerstick";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { hapticSelection } from "@/lib/haptics";
import { fetchRecentExerciseLogs, type ExerciseLog, type ExerciseType } from "@/lib/exercise";
import { evaluateExercise, type ExerciseOutcome } from "@/lib/exerciseEval";
import { fetchRecentMenstrualLogs, type MenstrualLog } from "@/lib/menstrual";
import { fetchRecentSymptomLogs, type SymptomLog, type SymptomType } from "@/lib/symptoms";
import {
  fetchRecentActivityClient,
  type ClientActivityResponse,
} from "@/lib/dailyActivity";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import { fetchCgmSamples, type ContinuousReading } from "@/lib/cgmSamplesClient";

/** Default top-to-bottom order. Hero block (time-in-range, gmi-a1c,
 *  glucose-trend, meal-evaluation) mirrors the homepage `InsightsScreen()`
 *  mockup 1:1; deeper-analysis cards stack underneath for variety. */
const INSIGHTS_DEFAULT_ORDER = [
  "time-in-range",
  "gmi-a1c",
  "glucose-trend",
  "hypo-events",
  "hyper-events",
  "glucose-variability",
  "meal-evaluation",
  "adaptive-engine",
  "tdd",
  "patterns",
  "workout-outcomes",
  "workout-bg-response",
  "workout-patterns",
  "meal-type",
  "time-of-day",
  "cycle-symptoms",
  "performance-tiles",
  "daily-steps",
  "active-day-outcomes",
];

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
// ACCENT_SOFT: lower-hierarchy sibling of ACCENT for the Raw ICR tile —
// same blue family as the Adaptive Engine, clearly lighter/less saturated
// to signal "secondary view of the same metric".
const ACCENT_SOFT="#93A5FA";
const SURFACE="var(--surface)", BORDER="var(--border)";
const HIGH_YELLOW = "#FFD166";

// Unified outcome bucketing — single source of truth shared with the
// dashboard Control Score (app/(protected)/dashboard/page.tsx). Each
// meal lands in EXACTLY one of GOOD / SPIKE / HYPO / OTHER (the legacy
// EVAL_NORM used to group SPIKE+HIGH together for the "Spiked"
// distribution, which double-counted UNDERDOSE-style outcomes against
// hypo-style ones). The mapping below mirrors the dashboard exactly:
//
//   GOOD  → "On target"
//   SPIKE → SPIKE + UNDERDOSE + LOW (legacy)  — BG ended too high
//   HYPO  → OVERDOSE + HIGH (legacy)          — BG ended too low
//   OTHER → null / unknown                    — excluded everywhere
//
// Returns `null` for unevaluated meals so a pending row never inflates
// either numerator or denominator. Use this via `unifiedOutcome(meal)`
// at the call site so the cached `evaluation` column is preferred for
// finalised rows and `lifecycleFor` recomputes for in-flight ones.
type EvalBucket = "GOOD" | "SPIKE" | "HYPO" | null;
const EVAL_NORM = (ev: string|null): EvalBucket => {
  if (!ev) return null;
  if (ev === "GOOD") return "GOOD";
  if (ev === "SPIKE" || ev === "SPIKE_STRONG" || ev === "UNDERDOSE" || ev === "LOW")  return "SPIKE";
  if (ev === "OVERDOSE" || ev === "HIGH")                    return "HYPO";
  return null;
};

// ── Clinical thresholds — hardcoded clinical-standard defaults ──
// BACKLOG: Allow users to customize clinical thresholds (Hypo, Hyper,
// TIR range, CV% target) in Settings, to be defined in consultation
// with their physician. Until implemented, use the hardcoded clinical
// standard defaults below.
const HYPO_THRESHOLD_MGDL  = 70;   // BG < 70 → hypo
const HYPER_THRESHOLD_MGDL = 250;  // BG > 250 → hyper
// TIR_LOW_MGDL / TIR_HIGH_MGDL are now read from the user's saved
// target range (user_settings.target_min_mgdl / target_max_mgdl,
// Migration 20260517) and threaded through as `tirLow` / `tirHigh`
// locals inside the component. The default constants below are only
// used as the initial sync value before the async DB load lands;
// they match DEFAULT_TARGET_RANGE so the first paint never shows a
// different band than what the user will see after the fetch.
const TIR_LOW_MGDL         = DEFAULT_TARGET_RANGE.low;
const TIR_HIGH_MGDL        = DEFAULT_TARGET_RANGE.high;
const CV_STABLE_PCT        = 36;   // < this = stable (green)
const CV_HIGH_PCT          = 50;   // > this = unstable (red); between = yellow
const MIN_DATAPOINTS       = 3;    // < this in window → "Nicht genug Daten"

/** A single BG reading drawn from any source (meal pre/post, insulin
 *  pre/post, exercise pre/end/post, fingerstick). `t` is the
 *  approximate measurement timestamp in ms since epoch. */
type BgReading = { v: number; t: number };

/** Pool every available glucose value across meals, insulin logs,
 *  exercise logs and manual fingersticks since `sinceMs`. Used by the
 *  hypo/hyper counters, the CV%-variability tile and the extended TIR
 *  bar so all three look at the same coherent reading universe. */
function collectBgReadings(
  meals: Meal[],
  insulinLogs: InsulinLog[],
  exerciseLogs: ExerciseLog[],
  fingersticks: FingerstickReading[],
  sinceMs: number,
): BgReading[] {
  const HOUR = 3600 * 1000;
  const out: BgReading[] = [];
  const push = (v: number | null | undefined, t: number) => {
    if (v == null) return;
    const num = Number(v);
    if (!Number.isFinite(num)) return;
    if (t < sinceMs) return;
    out.push({ v: num, t });
  };

  for (const m of meals) {
    const t0 = parseDbTs(m.created_at);
    const anyM = m as unknown as Record<string, unknown>;
    push(m.glucose_before as number | null | undefined, t0);
    push(anyM.bg_1h as number | null | undefined, t0 + 1 * HOUR);
    push(anyM.bg_2h as number | null | undefined, t0 + 2 * HOUR);
  }
  for (const il of insulinLogs) {
    const t0 = parseDbTs(il.created_at);
    push(il.cgm_glucose_at_log, t0);
    push(il.glucose_after_1h,  t0 +  1 * HOUR);
    push(il.glucose_after_2h,  t0 +  2 * HOUR);
    push(il.glucose_after_12h, t0 + 12 * HOUR);
    push(il.glucose_after_24h, t0 + 24 * HOUR);
  }
  for (const ex of exerciseLogs) {
    const t0 = parseDbTs(ex.created_at);
    const tEnd = t0 + (ex.duration_minutes || 0) * 60 * 1000;
    push(ex.cgm_glucose_at_log, t0);
    push(ex.glucose_at_end,     tEnd);
    push(ex.glucose_after_1h,   tEnd + 1 * HOUR);
  }
  for (const fs of fingersticks) {
    push(fs.value_mg_dl, parseDbTs(fs.measured_at));
  }
  return out;
}

/** Merge continuous CGM samples (cgm_samples + apple_health_readings —
 *  see lib/cgm/samples.ts) into an event-based reading pool. The
 *  Worker writes event-anchored values (bg_1h / glucose_after_1h /
 *  etc.) that DO overlap in time with continuous samples — without
 *  deduplication TIR / CV / hypo counters would double-count those
 *  identical readings. The window is intentionally tight (±2 min):
 *  the worker matches CGM history with a ±10 min window, but the
 *  value it picks is THE reading at one CGM-clock minute (every 5
 *  min for LLU, ~1 min for Nightscout/HK) — within ±2 min two
 *  readings are almost certainly the same physical sensor sample.
 *  Manual fingersticks at the same minute are a different
 *  measurement (different device) so we keep the dedup conservative
 *  rather than aggressive.
 */
function mergeContinuousReadings(
  events: BgReading[],
  continuous: ContinuousReading[],
  sinceMs: number,
  untilMs: number,
): BgReading[] {
  const DEDUP_MS = 2 * 60 * 1000;
  const filtered = continuous.filter(r => r.t >= sinceMs && r.t < untilMs && Number.isFinite(r.v));
  if (filtered.length === 0) return events;
  // Index continuous samples by minute bucket for O(1) overlap check.
  const minuteBucket = new Set<number>();
  for (const r of filtered) {
    const bucket = Math.round(r.t / DEDUP_MS);
    minuteBucket.add(bucket);
    minuteBucket.add(bucket - 1);
    minuteBucket.add(bucket + 1);
  }
  // Drop event readings whose timestamp lands inside any continuous
  // sample's ±2 min window — continuous wins because it's the canonical
  // raw stream the event-based worker is itself drawing from.
  const keptEvents = events.filter(r => {
    const bucket = Math.round(r.t / DEDUP_MS);
    return !minuteBucket.has(bucket);
  });
  return keptEvents.concat(filtered.map(r => ({ v: r.v, t: r.t })));
}

export default function InsightsPage() {
  // Chip-namespace translator (Task #279) — used to localize meal-type
  // headings on the per-type breakdown cards. Falls back to English
  // labels via chipLabelsFrom() when keys are missing.
  // Carb-unit selector — feeds the per-type "avg carbs" line and the
  // "Avg insulin" tile sublabel. All aggregates are computed in grams
  // upstream; only the rendered string switches to BE/KE/g.
  const { canAccess } = usePlan();
  const carbUnit = useCarbUnit();
  const tInsights = useTranslations("insights");
  const tChips = useTranslations("chips");
  const chipLabels = chipLabelsFrom(tChips);
  const locale = useLocale();
  const [meals, setMeals]               = useState<Meal[]>([]);
  // Engine-only meals subset (last 90 days) — feeds `computeAdaptiveICR`
  // and `detectPattern` so old rows from "the user a year ago" don't
  // distort the adaptive ICR's morning/afternoon/evening averages or
  // the pattern detector's recent-window classification. The full
  // `meals` array (365-day default cap) still drives the long-term
  // trend tiles (TIR, GMI, meal-type breakdown, etc.).
  const [engineMeals, setEngineMeals]   = useState<Meal[]>([]);
  const [insulinLogs, setInsulinLogs]   = useState<InsulinLog[]>([]);
  // 90-day bolus window — feeds `computeAdaptiveICR` so user-logged
  // boluses (incl. those split across multiple shots or logged
  // separately from the meal) get paired to meals via
  // `pairBolusesToMeals` and folded into the ICR average. Wider window
  // than the 14-day `insulinLogs` set above because the engine meal
  // window is also 90 days; using 14d here would silently drop pairs
  // for meals 15..90 days old.
  const [engineBoluses, setEngineBoluses] = useState<InsulinLog[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [activity, setActivity] = useState<ClientActivityResponse>({
    rows: [],
    context: { todaySteps: null, avgSteps7d: null, sampleSize7d: 0 },
  });
  const [fingersticks, setFingersticks] = useState<FingerstickReading[]>([]);
  const [menstrualLogs, setMenstrualLogs] = useState<MenstrualLog[]>([]);
  const [symptomLogs, setSymptomLogs]     = useState<SymptomLog[]>([]);
  const [loading, setLoading]           = useState(true);
  // Relink-panel open state lives HERE (not inside RelinkSourceLine) because
  // the FlipCard around the engine card renders its `children` twice — once
  // as a hidden ghost in normal flow (sets parent height) and once absolutely
  // positioned as the visible front. Local useState in RelinkSourceLine made
  // only the front instance grow when toggled, the ghost stayed collapsed,
  // parent height never updated, and the expanded panel bled visually into
  // the next grid row. Lifting the state here makes both ghost + front see
  // the same `open` value, so the ghost grows in lock-step and the parent
  // grid cell expands cleanly.
  const [relinkOpen, setRelinkOpen]     = useState(false);
  // Biological sex — gates the cycle half of the "Zyklus & Symptome"
  // card. Male users see a symptoms-only variant (cycle stats hidden,
  // card retitled). Null/unset is treated as "show everything" so
  // pre-onboarding users aren't worse off.
  const [sex, setSex] = useState<Sex | null>(null);
  // User-set manual ICR loaded from `user_settings.icr_g_per_unit`
  // (Lucas-Spec May 14 — see lib/userSettings.ts EngineIcrInfo for the
  // sister engine-computed value). Shown alongside the engine ICR in
  // the Adaptive-Engine card so the user can compare what they set
  // versus what the engine has learned. Defaults to 15 (the system
  // default) until the async fetch resolves.
  const [userIcr, setUserIcr] = useState<number>(DEFAULT_INSULIN_SETTINGS.icr);
  useEffect(() => {
    fetchInsulinSettings().then(s => setUserIcr(s.icr)).catch(() => {});
  }, []);
  // Personal TIR target range (user_settings.target_min_mgdl /
  // target_max_mgdl, Migration 20260517). Initialised synchronously
  // from the localStorage mirror so the very first paint already
  // uses the right band when the user has previously saved one on
  // this device; then refreshed from the DB so cross-device sessions
  // converge to the persisted value. Threaded through as `tirLow`
  // / `tirHigh` everywhere the page used to hardcode 70 / 180.
  const [targetRange, setTargetRange] = useState(() => getTargetRange());
  useEffect(() => {
    fetchTargetRange().then(setTargetRange).catch(() => {});
  }, []);
  const tirLow  = targetRange.low;
  const tirHigh = targetRange.high;

  // ICR schedule (Phase B2): when the user has time-banded ICRs
  // configured AND the master toggle is on, the Adaptive Engine card
  // surfaces the currently-active window so the user sees which value
  // the engine is actually using right now. `nowMinute` is recomputed
  // every 60s so the badge auto-flips when a window boundary passes
  // (e.g. lunch → dinner at 17:00) without a page reload.
  const [icrSchedule, setIcrSchedule] = useState<IcrSchedule>(EMPTY_ICR_SCHEDULE);
  const [nowMinute, setNowMinute]     = useState<number>(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes();
  });
  // Phase B3: collapsed by default — keeps the engine card visually
  // calm. User taps "Alle Fenster ansehen ↓" to reveal per-window
  // learned ICRs + status pills (TUNED/LEARNING/WARMING UP).
  const [windowsExpanded, setWindowsExpanded] = useState<boolean>(false);

  // Phase B5: per-window engine suggestion. When a window is TUNED
  // (≥8 samples) AND the engine's learned ICR drifts >10% off the
  // user's manual slot value, an inline "Engine schlägt vor: 1:14
  // [Übernehmen] [Behalten]" row appears under that window. We track:
  //   • dismissed: a Set of "slotIndex:rounded-learned" keys so a
  //     "Behalten" tap hides THIS specific suggestion but lets a new
  //     one re-appear once the engine has learned a different value.
  //   • applying: per-slot busy flag so the buttons grey out during
  //     the saveIcrSchedule round-trip and we don't double-write.
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [applyingSlot,         setApplyingSlot]         = useState<number | null>(null);
  useEffect(() => {
    fetchIcrSchedule().then(s => setIcrSchedule(s)).catch(() => {});
    const id = setInterval(() => {
      const d = new Date();
      setNowMinute(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  // Persist the engine-computed ICR back to user_settings whenever the
  // engine data window changes. Fire-and-forget — `persistEngineIcr`
  // is idempotent (skips writes when nothing changed) and swallows
  // transient errors so this never blocks render. When the user has
  // `engine_icr_auto_apply` enabled AND the engine has reached its
  // confidence threshold, the same call also pushes the value into
  // the user column + appends an audit-trail entry.
  //
  // CRITICAL: this effect MUST sit above the `if (loading) return …`
  // early returns further down, otherwise the hook count changes
  // between renders → React error #310. We recompute adaptiveICR
  // inside the effect so the hook only depends on the raw meal/bolus
  // state and not on a derived object that gets rebuilt every render.
  useEffect(() => {
    if (loading) return;
    // Persist only the global learned ICR — slot-level values stay
    // display-only for now (they live in `windows[]` on the result).
    const a = computeAdaptiveICR(engineMeals, engineBoluses, icrSchedule);
    persistEngineIcr(a.global, a.sampleSize);
  }, [loading, engineMeals, engineBoluses, icrSchedule]);
  useEffect(() => {
    fetchUserProfile().then((p) => setSex(p.sex)).catch(() => {});
  }, []);

  // History scope state — sourced from the global ScopeHeaderContext
  // so the chip in the mobile header (rendered by components/Layout.tsx
  // when `visible=true`) stays in sync with this page. Default state is
  // "week" anchored on today; we register `setVisible(true)` on mount
  // so the chip appears, and `setVisible(false)` on unmount so it goes
  // away when the user navigates to another tab.
  const {
    mode: scopeMode,
    anchor: scopeAnchor,
    setAnchor: setScopeAnchor,
    setVisible: setScopeChipVisible,
  } = useScopeHeader();
  useEffect(() => {
    setScopeChipVisible(true);
    return () => setScopeChipVisible(false);
  }, [setScopeChipVisible]);

  // Anchor stepper rendered at the top of the page body. The header
  // chip group only switches MODE (Day/Week/Month/Year); this inline
  // ◀ Today ▶ row lets the user walk back/forward through periods
  // without re-opening any dropdown. Compact so it doesn't push the
  // first swipe card down on iPhone mini.
  const stepScopeAnchor = useCallback((dir: -1 | 1) => {
    const a = new Date(scopeAnchor);
    if (scopeMode === "day")   a.setDate(a.getDate() + dir);
    if (scopeMode === "week")  a.setDate(a.getDate() + dir * 7);
    if (scopeMode === "month") a.setMonth(a.getMonth() + dir);
    if (scopeMode === "year")  a.setFullYear(a.getFullYear() + dir);
    setScopeAnchor(a);
  }, [scopeAnchor, scopeMode, setScopeAnchor]);

  // SWR-backed cached fetch — same pattern as Dashboard. The
  // SWRProvider in app/(protected)/layout.tsx persists this cache to
  // localStorage so a re-mount (tab switch on native shell) renders
  // the previous data instantly while we revalidate in the
  // background. The `loading` flag only stays true on the very first
  // visit (when the cache is empty); afterwards the page paints
  // immediately with stale data and silently refreshes.
  // Pull a window wide enough to cover the LARGEST supported scope
  // (Year) PLUS its previous comparable period for delta calculations,
  // so every card can render correctly when the user toggles
  // Day/Week/Month/Year. 730 days = 12 months current + 12 months prev,
  // capped at the wider of 90 days (engine floor) and the scope need.
  // Pull is keyed on `scopeMode` so the request is small for Day/Week
  // and only widens when the user actually picks Month/Year.
  const fetchDaysForScope: Record<typeof scopeMode, number> = {
    day:   14,   // today + prev day + small buffer (event-pool needs ≥7d for rolling stats)
    week:  21,   // 7d current + 7d prev + buffer
    month: 75,   // 30d current + 30d prev + buffer
    year:  760,  // 365 current + 365 prev + buffer
  };
  const insightsFetchDays = Math.max(90, fetchDaysForScope[scopeMode]);
  // 2026-05-18 perceived-perf split (user: "geht sowas auch bei insights"):
  // The previous single SWR fetched 9 datasets in parallel and only
  // resolved when ALL nine returned. The TIR / GMI / CV cards visually
  // dominate first paint but only need meals + insulin + fingersticks.
  // Now we run TWO SWRs:
  //   • primary: meals + insulin + fingersticks — gates the loading
  //     spinner, unblocks the page as soon as the first three queries
  //     return (typically <250 ms on a warm connection).
  //   • secondary: engineMeals + engineBoluses + exerciseLogs +
  //     menstrualLogs + symptomLogs + activity — fills the
  //     Adaptive-Engine, Patterns, Exercise, Cycle, Symptom and
  //     Activity cards once they arrive. The page is already
  //     interactive while these stream in.
  const { data: primarySWR, isValidating: primaryValidating } = useSWR(
    `insights:primary:scope:${scopeMode}:days:${insightsFetchDays}`,
    async () => {
      const fingerstickFromIso = startOfDaysAgo(insightsFetchDays - 1).toISOString();
      const [m, il, fs] = await Promise.all([
        fetchMeals({ sinceDays: insightsFetchDays, limit: Infinity }).catch(() => [] as Meal[]),
        fetchRecentInsulinLogs(insightsFetchDays).catch(() => [] as InsulinLog[]),
        fetchFingersticks(fingerstickFromIso).catch(() => [] as FingerstickReading[]),
      ]);
      return { meals: m, insulinLogs: il, fingersticks: fs };
    },
  );

  const { data: secondarySWR } = useSWR(
    `insights:secondary:scope:${scopeMode}:days:${insightsFetchDays}`,
    async () => {
      const [em, ilEngine, ex, ml, sl, act] = await Promise.all([
        fetchMealsForEngine().catch(() => [] as Meal[]),
        fetchRecentInsulinLogs(90).catch(() => [] as InsulinLog[]),
        fetchRecentExerciseLogs(insightsFetchDays).catch(() => [] as ExerciseLog[]),
        fetchRecentMenstrualLogs(insightsFetchDays).catch(() => [] as MenstrualLog[]),
        fetchRecentSymptomLogs(insightsFetchDays).catch(() => [] as SymptomLog[]),
        // Task #183: best-effort Apple-Health steps. Always resolves
        // (the helper swallows fetch errors) so a missing route or
        // empty table just hides the card.
        fetchRecentActivityClient(14),
      ]);
      return { engineMeals: em, engineBoluses: ilEngine, exerciseLogs: ex, menstrualLogs: ml, symptomLogs: sl, activity: act };
    },
  );

  useEffect(() => {
    if (!primarySWR) return;
    setMeals(primarySWR.meals);
    setInsulinLogs(primarySWR.insulinLogs);
    setFingersticks(primarySWR.fingersticks);
    setLoading(false);
  }, [primarySWR]);

  useEffect(() => {
    if (!secondarySWR) return;
    setEngineMeals(secondarySWR.engineMeals);
    setEngineBoluses(secondarySWR.engineBoluses);
    setExerciseLogs(secondarySWR.exerciseLogs);
    if (secondarySWR.activity) setActivity(secondarySWR.activity);
    setMenstrualLogs(secondarySWR.menstrualLogs);
    setSymptomLogs(secondarySWR.symptomLogs);
  }, [secondarySWR]);

  // Revalidate when other parts of the app log new entries.
  useEffect(() => {
    const primaryKey   = `insights:primary:scope:${scopeMode}:days:${insightsFetchDays}`;
    const secondaryKey = `insights:secondary:scope:${scopeMode}:days:${insightsFetchDays}`;
    function onUpdated() {
      swrMutate(primaryKey);
      swrMutate(secondaryKey);
    }
    window.addEventListener("glev:meals-updated",    onUpdated);
    window.addEventListener("glev:insulin-updated",  onUpdated);
    window.addEventListener("glev:exercise-updated", onUpdated);
    return () => {
      window.removeEventListener("glev:meals-updated",    onUpdated);
      window.removeEventListener("glev:insulin-updated",  onUpdated);
      window.removeEventListener("glev:exercise-updated", onUpdated);
    };
    // Re-key the listener when the scope changes so we invalidate the
    // active cache key, not a stale one from the previous scope.
  }, [scopeMode, insightsFetchDays]);

  // Continuous CGM samples — Option B (see
  // supabase/migrations/20260514_add_cgm_samples.sql). The backend API
  // (`/api/cgm/samples`) hard-rejects windows > 60 days, so we cap the
  // client request at 60d regardless of the scope picker. For Month
  // and Year scopes the CGM-derived cards (TIR, GMI, etc.) fall back
  // to the event-pool readings outside the 60-day continuous window —
  // tracked as follow-up #334.
  const cgmFetchDays = 60;
  const { data: continuousSamples } = useSWR(
    `insights:cgm-samples-${cgmFetchDays}d`,
    async () => {
      const toMs = Date.now();
      const fromMs = toMs - cgmFetchDays * 24 * 3600 * 1000;
      return fetchCgmSamples(fromMs, toMs);
    },
    { revalidateOnFocus: false, refreshInterval: 5 * 60 * 1000 },
  );
  const continuous: ContinuousReading[] = continuousSamples ?? [];

  // ── TIR-bar interactive selection (tap a band → context info + the
  // band visually swells). Lucas's request 2026-05-14: turn the static
  // 3-color bar into something tap-explorable so a user can ask "what
  // does my 32% TBR actually mean?" without flipping the whole card.
  // Selecting "now" highlights the live-glucose marker instead of a
  // band. Tapping the same target again deselects.
  const [tirSelected, setTirSelected] = useState<"tbr" | "tir" | "tar" | "now" | null>(null);
  const toggleTirSel = (k: "tbr" | "tir" | "tar" | "now") =>
    setTirSelected((prev) => (prev === k ? null : k));

  // Skeleton loading state — mirrors app/(protected)/insights/loading.tsx
  // shape so the visible UI never jumps when data arrives. Replaces the
  // old centered spinner because a layout-shaped skeleton feels much
  // faster to the user than a blank screen with a tiny spinner.
  if (loading) return (
    <div style={{ padding:"16px 16px 0", display:"flex", flexDirection:"column", gap:16 }}>
      <style>{`@keyframes glevPulse{0%,100%{opacity:.55}50%{opacity:.85}}`}</style>
      <SkeletonBlock height={48} />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <SkeletonBlock height={96} />
        <SkeletonBlock height={96} />
      </div>
      <SkeletonBlock height={260} />
      <SkeletonBlock height={200} />
      <SkeletonBlock height={200} />
    </div>
  );

  const total = meals.length;
  if (total === 0) return (
    <div style={{ maxWidth:480, margin:"0 auto" }}>
      <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:8 }}>Insights</h1>
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"48px", textAlign:"center", color:"var(--text-ghost)", fontSize:14 }}>{tInsights("empty_state_min_meals")}</div>
    </div>
  );

  // Scope-derived window bounds. These replace the old fixed
  // "last 7 days" / "last 14 days" / "last 30 days" anchors so every
  // card follows the user's selected period. `now` is the exclusive
  // upper bound (start of the period AFTER the selected one) so a
  // window that ends in the past (e.g. last week) doesn't accidentally
  // include today's readings.
  const scope = computeScopeWindow(scopeMode, scopeAnchor);
  const now = scope.endMs;
  const wkAgo  = scope.startMs;       // start of selected period
  const wk2Ago = scope.prevStartMs;   // start of previous comparable period
  // ── Scope-coupling helpers (Task #332) ──
  // Every card title/subtitle that used to say "7T" / "30T" pulls its
  // human label from `rangeLabel`. `prevRangeLabel` keeps the delta
  // copy ("ggü. Vorwoche/Vormonat/…") consistent with the active scope.
  // `rangeDays` is the period length in days — used as the denominator
  // for any per-day average the cards display.
  const RANGE_LABEL_KEY = { day: "range_label_day", week: "range_label_week", month: "range_label_month", year: "range_label_year" } as const;
  const PREV_RANGE_LABEL_KEY = { day: "range_delta_prev_day", week: "range_delta_prev_week", month: "range_delta_prev_month", year: "range_delta_prev_year" } as const;
  const rangeLabel = tInsights(RANGE_LABEL_KEY[scopeMode]);
  const prevRangeLabel = tInsights(PREV_RANGE_LABEL_KEY[scopeMode]);
  const rangeDays = Math.max(1, Math.round((now - wkAgo) / 86400000));
  // Day-scope is intentionally permissive: a single logged day is the
  // only data the card can ever show, so we drop the ≥3 floor for that
  // mode to avoid every tile sitting on "Nicht genug Daten" all day.
  const minDatapointsForScope = scopeMode === "day" ? 1 : MIN_DATAPOINTS;
  const last7 = meals.filter(m => {
    const t = parseDbTs(m.created_at);
    return t >= wkAgo && t < now;
  });

  // ── Cross-source BG reading pools (meals + insulin + exercise + fingerstick) ──
  // Pulled up here (was below) so TIR / TBR / TAR can use the same
  // coherent reading universe as the Hypo/Hyper counters and CV%
  // tile. Without this, manually-logged fingerstick hypos never
  // lowered TIR or appeared in the TBR band — a real safety gap that
  // hid recent low events from the user (Task: Lucas's 2026-05-11
  // bug report).
  const fourteenAgo = wkAgo;
  const readings14Events = collectBgReadings(meals, insulinLogs, exerciseLogs, fingersticks, fourteenAgo)
    .filter(r => r.t < now);
  // Merge continuous CGM samples (Option B). For users with a CGM
  // (LLU / Nightscout / Apple Health) this fills the gaps between
  // logged events so hypo/TIR/CV reflect what the sensor actually
  // saw, not just readings around meals + boluses + workouts. For
  // users without a CGM `continuous` is empty and behaviour is
  // identical to the old event-only pool.
  const readings14 = mergeContinuousReadings(readings14Events, continuous, fourteenAgo, now);
  const readings7  = readings14;
  const readingsPrev7Events = collectBgReadings(meals, insulinLogs, exerciseLogs, fingersticks, wk2Ago)
    .filter(r => r.t >= wk2Ago && r.t < scope.prevEndMs);
  const readingsPrev7 = mergeContinuousReadings(readingsPrev7Events, continuous, wk2Ago, scope.prevEndMs);

  // ── Time in Range buckets (consensus 70–180 mg/dL band) ──
  // Cross-source: every BG reading we have for the period (meal
  // pre/post, insulin pre/+1h/+2h/..., exercise pre/end/+1h, manual
  // fingersticks). Prevents "hypo I logged manually doesn't show up
  // in TIR" gaps.
  const last7Bg = readings7.map(r => r.v);
  const prev7Bg = readingsPrev7.map(r => r.v);

  // TIR/TBR/TAR rounding rule — Lucas reported a true hypo (manual
  // fingerstick) showing up in the Hypo-Events tile while TIR still
  // displayed 100%. Cause: with ~200 in-range readings + 1 hypo, the
  // hypo bucket was 0.5% and `Math.round(0.5)=1` was masked because
  // the in-range bucket independently rounded to 100. We now floor
  // every non-zero hypo/hyper bucket to at least 1% (so a single
  // out-of-range reading is never invisible) and compute TIR as the
  // residual `100 − TBR − TAR`, which keeps the three displayed
  // segments summing to exactly 100 even with the floor in place.
  const bucket = (arr: number[]) => {
    const n = arr.length;
    if (n === 0) return { vlow: 0, lo: 0, inR: 0, hi: 0, n: 0 };
    // Severe hypo band stays anchored at 54 mg/dL (clinical "Level 2
    // hypoglycaemia" cutoff — non-negotiable, not user-configurable).
    // The TBR / TAR bounds follow the user's saved target range so the
    // bar agrees with the rest of the app.
    const cVlow = arr.filter(g => g < 54).length;
    const cLo   = arr.filter(g => g >= 54 && g < tirLow).length;
    const cHi   = arr.filter(g => g > tirHigh).length;
    const pct = (c: number) => c === 0 ? 0 : Math.max(1, Math.round((c / n) * 100));
    const vlow = pct(cVlow);
    const lo   = pct(cLo);
    const hi   = pct(cHi);
    const inR  = Math.max(0, 100 - vlow - lo - hi);
    return { vlow, lo, inR, hi, n };
  };
  const b7  = bucket(last7Bg);
  const bP7 = bucket(prev7Bg);
  const tirDelta = b7.inR - bP7.inR;

  // ── Avg BG + GMI (Bergenstal 2018: GMI% = 3.31 + 0.02392·avgBG) ──
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const last7Avg = avg(last7Bg);
  const prev7Avg = avg(prev7Bg);
  const bgDelta  = (last7Avg != null && prev7Avg != null) ? Math.round(last7Avg - prev7Avg) : null;
  const gmi      = last7Avg != null ? +(3.31 + 0.02392 * last7Avg).toFixed(1) : null;
  const prevGmi  = prev7Avg != null ? +(3.31 + 0.02392 * prev7Avg).toFixed(1) : null;
  const gmiDelta = (gmi != null && prevGmi != null) ? +(gmi - prevGmi).toFixed(1) : null;

  // ── 7-day trend: daily avg pre-meal glucose, oldest → newest ──
  // Localised weekday short labels (Sun..Sat / So..Sa) come from the
  // `insights` namespace so the trend axis follows the active locale.
  const weekdayShortLabels = [
    tInsights("weekday_short_sun"),
    tInsights("weekday_short_mon"),
    tInsights("weekday_short_tue"),
    tInsights("weekday_short_wed"),
    tInsights("weekday_short_thu"),
    tInsights("weekday_short_fri"),
    tInsights("weekday_short_sat"),
  ];
  // Trend buckets — adapt resolution to the selected scope so the
  // sparkline matches the hero metrics above it.
  //   day   → 6 × 4h buckets   (0/4/8/12/16/20)
  //   week  → 7 daily buckets  (Mon..Sun, weekday-short labels)
  //   month → 4–5 weekly buckets (W1..Wn)
  //   year  → 12 monthly buckets (Jan..Dec)
  // All buckets respect the active `[wkAgo, now)` window. Empty
  // buckets carry `avg: null` so the sparkline interpolation logic
  // below can still draw a continuous line.
  // Bucket source: cross-source readings (meals + insulin + exercise +
  // fingersticks) — same pool as TIR / GMI / Hypo / Hyper / CV. Was
  // previously meals.glucose_before-only, which made manual fingerstick
  // hypos invisible in the trend line even though they showed up in TIR.
  const trendDays: { label: string; avg: number | null }[] = [];
  const avgInRange = (lo: number, hi: number): number | null => {
    let sum = 0, n = 0;
    for (const r of readings7) {
      if (r.t >= lo && r.t < hi) { sum += r.v; n++; }
    }
    return n ? sum / n : null;
  };
  if (scopeMode === "day") {
    for (let h = 0; h < 24; h += 4) {
      const bStart = wkAgo + h * 3600000;
      const bEnd   = wkAgo + (h + 4) * 3600000;
      trendDays.push({ label: String(h), avg: avgInRange(bStart, bEnd) });
    }
  } else if (scopeMode === "year") {
    const yr = new Date(wkAgo).getFullYear();
    const monthFmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: userTimezone });
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const bStart = new Date(yr, mIdx, 1).getTime();
      const bEnd   = new Date(yr, mIdx + 1, 1).getTime();
      trendDays.push({ label: monthFmt.format(new Date(bStart)), avg: avgInRange(bStart, bEnd) });
    }
  } else if (scopeMode === "month") {
    // Iterate through scope in 7-day chunks; cap at 5 buckets.
    let cursor = wkAgo;
    let wIdx = 1;
    while (cursor < now && wIdx <= 5) {
      const bEnd = Math.min(cursor + 7 * 86400000, now);
      trendDays.push({ label: `W${wIdx}`, avg: avgInRange(cursor, bEnd) });
      cursor = bEnd;
      wIdx++;
    }
  } else {
    // Week mode (and fallback): 7 daily buckets across the scope.
    for (let i = 0; i < 7; i++) {
      const bStart = wkAgo + i * 86400000;
      const bEnd   = wkAgo + (i + 1) * 86400000;
      if (bStart >= now) break;
      trendDays.push({
        label: weekdayShortLabels[new Date(bStart).getDay()],
        avg: avgInRange(bStart, bEnd),
      });
    }
  }
  // Trend fill strategy — Lucas reported the line flatlining even with
  // a non-trivial dataset (100% TIR, 112 meals). The previous algorithm
  // only forward-filled `lastVal`, so any leading null bucket fell back
  // to a single global `last7Avg` constant. With sparse data clustered
  // in 1-2 days, that produced [avg, avg, avg, dayVal, dayVal, dayVal,
  // dayVal] — visually flat after Sparkline normalised. We now do a
  // proper bidirectional fill so the rendered line follows the actual
  // shape of the data: leading nulls inherit the FIRST observed value,
  // trailing/middle nulls forward-fill from the most recent observed
  // value. Together they form a stair-step that the Sparkline can scale.
  const observedAvgs = trendDays.map(d => d.avg);
  const observedCount = observedAvgs.filter(v => v != null).length;
  const trendHasData = observedCount >= 2;
  let trendFwd: number | null = null;
  const fwdFilled: (number | null)[] = observedAvgs.map(v => {
    if (v != null) { trendFwd = v; return v; }
    return trendFwd;
  });
  let trendBwd: number | null = null;
  for (let i = fwdFilled.length - 1; i >= 0; i--) {
    const v = fwdFilled[i];
    if (v != null) { trendBwd = v; }
    else if (trendBwd != null) { fwdFilled[i] = trendBwd; }
  }
  const trendValues: number[] = fwdFilled.map(v => v ?? last7Avg ?? 100);

  // ── Hypo / Hyper event counters (7d, ATTD-style clustered events) ──
  // (`readings7` / `readings14` are computed earlier so TIR can share them.)
  // Lucas's request 2026-05-12: split hypos into two clinically-meaningful
  // buckets instead of "every reading <70 = 1 event":
  //   • Mini-Hypo     — cluster of <70 readings spanning  <15 min
  //   • Klinische Hypo— cluster of <70 readings spanning ≥15 min
  // Adjacent <70 readings are merged into the same cluster as long as
  // their gap is ≤ HYPO_GAP_MS (15 min). A single point (one CGM reading
  // or one manual fingerstick) has zero span and falls into "mini" — we
  // don't extrapolate an unknown duration. Hypers stay as raw count for
  // now (Lucas only asked about hypos); switching them to the same model
  // is a follow-up if needed.
  const HYPO_GAP_MS      = 15 * 60 * 1000;
  const HYPO_CLINICAL_MS = 15 * 60 * 1000;
  const countHypoEvents = (rs: BgReading[]): { mini: number; clinical: number } => {
    const lows = rs
      .filter(r => r.v < HYPO_THRESHOLD_MGDL)
      .sort((a, b) => a.t - b.t);
    if (lows.length === 0) return { mini: 0, clinical: 0 };
    let mini = 0, clinical = 0;
    let cStart = lows[0].t;
    let cEnd   = lows[0].t;
    const flush = () => {
      if (cEnd - cStart >= HYPO_CLINICAL_MS) clinical += 1;
      else mini += 1;
    };
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].t - cEnd <= HYPO_GAP_MS) {
        cEnd = lows[i].t;
      } else {
        flush();
        cStart = lows[i].t;
        cEnd   = lows[i].t;
      }
    }
    flush();
    return { mini, clinical };
  };
  const hypoEnough   = readings7.length >= MIN_DATAPOINTS;
  const hyperEnough  = readings7.length >= MIN_DATAPOINTS;
  const hypoEvents7d = countHypoEvents(readings7);
  const hypoTotal7d  = hypoEvents7d.mini + hypoEvents7d.clinical;
  const hyperCount7d = readings7.filter(r => r.v > HYPER_THRESHOLD_MGDL).length;

  // ── Glucose Variability CV% (14d, ATTD consensus) ──
  const cvEnough = readings14.length >= MIN_DATAPOINTS;
  let cvPct: number | null = null;
  if (cvEnough) {
    const vals = readings14.map(r => r.v);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean > 0) {
      const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
      cvPct = +((Math.sqrt(variance) / mean) * 100).toFixed(1);
    }
  }
  const cvColor = cvPct == null
    ? "var(--text-dim)"
    : cvPct < CV_STABLE_PCT ? GREEN
    : cvPct <= CV_HIGH_PCT  ? HIGH_YELLOW
    : PINK;

  // ── TDD: total daily insulin units (bolus + basal) ──
  // Two sources contribute:
  //   1. `insulin_logs.units` — standalone Insulin-Form entries
  //   2. `meals.insulin_units` — insulin typed directly into a meal
  // Casual users only ever use (2), so without it the TDD card stays
  // empty even with hundreds of logged meals. To avoid double-counting
  // when the user logs BOTH (e.g. correction bolus linked to a meal),
  // we skip a meal's insulin if any insulin_log row already points to
  // it via `related_entry_id`.
  //
  // Window: TDD follows the global scope picker (Task #332). The card
  // title is dynamic ("Tagesgesamtdosis · {range}") so the window must
  // match. Lucas's earlier complaint about Tuesday-morning empty state
  // is solved by `minDatapointsForScope` (day-scope drops the ≥3 floor)
  // rather than by hard-coding a 7d window here.
  const tddFromMs = wkAgo;
  const tddNowMs  = now;
  const linkedMealIds = new Set<string>();
  for (const il of insulinLogs) {
    if (il.related_entry_id) linkedMealIds.add(il.related_entry_id);
  }
  // Per-day map keeps bolus + basal as a tuple so the card can show
  // both legs of TDD instead of just the lump sum. Meals always count
  // as bolus (insulin_units in the meal row is always carb-cover or a
  // correction bolus, never basal). Standalone insulin_logs carry
  // their own insulin_type so we route by that.
  type DayBuckets = { bolus: number; basal: number };
  const tddByDay = new Map<string, DayBuckets>();
  const addToDay = (key: string, leg: keyof DayBuckets, u: number) => {
    const cur = tddByDay.get(key) ?? { bolus: 0, basal: 0 };
    cur[leg] += u;
    tddByDay.set(key, cur);
  };
  for (const il of insulinLogs) {
    const t = parseDbTs(il.created_at);
    if (t < tddFromMs || t >= tddNowMs) continue;
    const u = Number(il.units || 0);
    if (!Number.isFinite(u) || u <= 0) continue;
    const dayStart = startOfDay(new Date(t));
    const key = dayStart.toISOString().slice(0, 10);
    const leg: keyof DayBuckets = il.insulin_type === "basal" ? "basal" : "bolus";
    addToDay(key, leg, u);
  }
  for (const m of meals) {
    const u = Number(m.insulin_units || 0);
    if (!Number.isFinite(u) || u <= 0) continue;
    if (linkedMealIds.has(m.id)) continue;
    const t = parseDbTs(m.meal_time ?? m.created_at);
    if (t < tddFromMs || t >= tddNowMs) continue;
    const dayStart = startOfDay(new Date(t));
    const key = dayStart.toISOString().slice(0, 10);
    addToDay(key, "bolus", u);
  }
  const tddDayCount    = tddByDay.size;
  const tddEnough      = tddDayCount >= minDatapointsForScope;
  const tddTodayKey    = startOfToday().toISOString().slice(0, 10);
  const tddTodayBuckets = tddByDay.get(tddTodayKey) ?? { bolus: 0, basal: 0 };
  const tddToday       = tddTodayBuckets.bolus + tddTodayBuckets.basal;
  const tddTodayBolus  = tddTodayBuckets.bolus;
  const tddTodayBasal  = tddTodayBuckets.basal;
  const tddSumsAll     = Array.from(tddByDay.values()).reduce(
    (acc, d) => ({ bolus: acc.bolus + d.bolus, basal: acc.basal + d.basal }),
    { bolus: 0, basal: 0 },
  );
  const tddSum7        = tddSumsAll.bolus + tddSumsAll.basal;
  // Denominator = full days in the active scope (rangeDays), NOT the
  // count of days that happened to have logs. Dividing by tddDayCount
  // would inflate the per-day average when the user skipped some days.
  const tddAvg7        = tddEnough ? +(tddSum7 / rangeDays).toFixed(1) : null;
  const tddAvg7Bolus   = tddEnough ? +(tddSumsAll.bolus / rangeDays).toFixed(1) : null;
  const tddAvg7Basal   = tddEnough ? +(tddSumsAll.basal / rangeDays).toFixed(1) : null;

  // ── Extended TIR (TBR / TIR / TAR three-color view, reuses b7 buckets) ──
  const tbrPct = b7.vlow + b7.lo;     // < 70
  const tirPct = b7.inR;              // 70–180
  const tarPct = b7.hi;               // > 180

  // ── Live "current glucose" marker for the TIR bar ──
  // Uses the most-recent reading across the unified pool (continuous
  // CGM samples + event-anchored values + manual fingersticks). Drives
  // the crosshair on the bar AND the "Aktueller Wert" detail panel
  // when the user taps the marker.
  const tirLatest = readings14.length > 0
    ? readings14.reduce((a, b) => (a.t > b.t ? a : b))
    : null;
  const currentBg     = tirLatest?.v ?? null;
  const currentBgT    = tirLatest?.t ?? null;
  const currentBgAgoMin = currentBgT != null ? Math.max(0, Math.round((Date.now() - currentBgT) / 60000)) : null;
  const currentBgZone: "tbr" | "tir" | "tar" | null = currentBg == null
    ? null
    : currentBg < tirLow ? "tbr"
    : currentBg <= tirHigh ? "tir"
    : "tar";
  // Position the crosshair within the bar so it lands inside the
  // band that matches its value. Each segment's WIDTH represents
  // time-share, not value-range, so we map the value proportionally
  // INSIDE its zone. Hard caps at 40 / 300 mg/dL bracket the
  // off-the-chart edges.
  let currentMarkerPct: number | null = null;
  if (currentBg != null) {
    if (currentBg < tirLow) {
      const within = Math.max(0, Math.min(1, (currentBg - 40) / (tirLow - 40)));
      currentMarkerPct = tbrPct * within;
    } else if (currentBg <= tirHigh) {
      const within = (currentBg - tirLow) / (tirHigh - tirLow);
      currentMarkerPct = tbrPct + tirPct * within;
    } else {
      const within = Math.max(0, Math.min(1, (currentBg - tirHigh) / (300 - tirHigh)));
      currentMarkerPct = tbrPct + tirPct + tarPct * within;
    }
  }
  // Convert "% of selected scope" → human-readable hours. Scope-driven
  // (Task #332) so Day shows ~24h max, Week ~168h, Month ~720h, Year ~8760h.
  const scopeHoursTotal = rangeDays * 24;
  const tbrHours = +(tbrPct / 100 * scopeHoursTotal).toFixed(1);
  const tirHours = +(tirPct / 100 * scopeHoursTotal).toFixed(1);
  const tarHours = +(tarPct / 100 * scopeHoursTotal).toFixed(1);

  // ── Workout (exercise) analytics — scope-aware ──
  const thirtyAgo = wkAgo;
  const exercise30 = exerciseLogs.filter(ex => {
    const t = parseDbTs(ex.created_at);
    return t >= thirtyAgo && t < now;
  });
  // Pre-evaluate once so all three workout sections share the same outcomes.
  const exerciseEvaluated = exercise30.map(ex => ({ ex, outcome: evaluateExercise(ex).outcome }));

  // Outcome distribution (PENDING excluded — still in progress).
  const RANKED_OUTCOMES: ExerciseOutcome[] = ["STABLE", "DROPPED", "SPIKED", "HYPO_RISK"];
  const workoutOutcomeCounts: Record<ExerciseOutcome, number> = {
    STABLE: 0, DROPPED: 0, SPIKED: 0, HYPO_RISK: 0, PENDING: 0,
  };
  for (const { outcome } of exerciseEvaluated) workoutOutcomeCounts[outcome]++;
  const workoutClassifiedTotal = RANKED_OUTCOMES.reduce((s, o) => s + workoutOutcomeCounts[o], 0);
  const workoutTotal30         = exercise30.length;
  const workoutOutcomeEnough   = workoutTotal30 >= MIN_DATAPOINTS;

  // BG response by exercise type (avg Δ from cgm_glucose_at_log → +1h after).
  // `hypertrophy` is the legacy alias for `strength` — collapse them so the
  // row count is stable across the type-rename in lib/exercise.ts.
  const normType = (t: ExerciseType): ExerciseType => (t === "hypertrophy" ? "strength" : t);
  const typeAgg = new Map<ExerciseType, { count: number; deltaSum: number }>();
  for (const ex of exercise30) {
    const before = ex.cgm_glucose_at_log;
    const after  = ex.glucose_after_1h;
    if (before == null || after == null) continue;
    const k = normType(ex.exercise_type);
    const cur = typeAgg.get(k) ?? { count: 0, deltaSum: 0 };
    cur.count++;
    cur.deltaSum += Number(after) - Number(before);
    typeAgg.set(k, cur);
  }
  // Localized exercise-type label. Hypertrophy is normalized to strength
  // upstream, so we reuse the strength translation here as well.
  const exTypeLabel = (k: ExerciseType): string => {
    const norm = k === "hypertrophy" ? "strength" : k;
    return tInsights(`exercise_type_${norm}`);
  };
  const bgResponseRows = Array.from(typeAgg.entries())
    .filter(([, s]) => s.count >= MIN_DATAPOINTS)
    .map(([k, s]) => ({ type: k, label: exTypeLabel(k), count: s.count, avgDelta: Math.round(s.deltaSum / s.count) }))
    .sort((a, b) => b.count - a.count);
  const bgResponseEnough = bgResponseRows.length > 0;

  // Auto-detected workout patterns. Spec: max 3, hide section if < 2.
  // `count` is carried separately so sorting doesn't depend on parsing
  // a localized desc string.
  type WorkoutPattern = { title: string; desc: string; color: string; icon: string; count: number };
  const OUTCOME_COLOR: Record<ExerciseOutcome, string> = {
    STABLE: GREEN, DROPPED: HIGH_YELLOW, SPIKED: ORANGE, HYPO_RISK: PINK, PENDING: "var(--text-dim)",
  };
  const OUTCOME_ICON: Record<ExerciseOutcome, string> = {
    STABLE: "✓", DROPPED: "↓", SPIKED: "↑", HYPO_RISK: "⚠", PENDING: "•",
  };
  // Localized outcome adjective for the pattern desc template
  // ("führt häufig zu …" / "often leads to …"). PENDING never reaches
  // here (filtered above), but we keep a non-empty fallback for safety.
  const outcomeLabel = (o: ExerciseOutcome): string => {
    if (o === "PENDING") return "—";
    const key = o.toLowerCase(); // STABLE → stable, HYPO_RISK → hypo_risk
    return tInsights(`workout_outcome_${key}`);
  };
  function detectGroup<K extends string>(
    keyFn: (ex: ExerciseLog) => K | null,
    titleFn: (k: K) => string,
  ): WorkoutPattern[] {
    const groups = new Map<K, { count: number; outcomes: Map<ExerciseOutcome, number> }>();
    for (const { ex, outcome } of exerciseEvaluated) {
      if (outcome === "PENDING") continue;
      const k = keyFn(ex); if (k == null) continue;
      const g = groups.get(k) ?? { count: 0, outcomes: new Map<ExerciseOutcome, number>() };
      g.count++;
      g.outcomes.set(outcome, (g.outcomes.get(outcome) ?? 0) + 1);
      groups.set(k, g);
    }
    const out: WorkoutPattern[] = [];
    for (const [k, g] of groups) {
      if (g.count < MIN_DATAPOINTS) continue;
      let bestOutcome: ExerciseOutcome = "STABLE"; let bestN = 0;
      for (const [oc, n] of g.outcomes) if (n > bestN) { bestN = n; bestOutcome = oc; }
      // Spec: dominant outcome must be STRICTLY > 60 %. Compare on the raw
      // ratio, NOT on the rounded display percentage, to avoid 59.6 → 60
      // rounding artifacts incorrectly promoting a sub-threshold group.
      const ratio = bestN / g.count;
      if (ratio <= 0.60) continue;
      const pct = Math.round(ratio * 100);
      out.push({
        title: titleFn(k),
        desc: tInsights("workout_pattern_desc", {
          outcome: outcomeLabel(bestOutcome),
          pct,
          n: g.count,
        }),
        color: OUTCOME_COLOR[bestOutcome],
        icon: OUTCOME_ICON[bestOutcome],
        count: g.count,
      });
    }
    // Largest sample first → more trustworthy patterns float to the top.
    return out.sort((a, b) => b.count - a.count);
  }
  type TodKey = "morning" | "afternoon" | "evening" | "night";
  const todKey = (ex: ExerciseLog): TodKey => {
    const h = new Date(parseDbTs(ex.created_at)).getHours();
    return (h >= 5 && h < 11) ? "morning" : (h < 17 ? "afternoon" : (h < 22 ? "evening" : "night"));
  };
  const todLabel = (k: TodKey): string => tInsights(`workout_tod_${k}`);
  type DurKey = "short" | "medium" | "long";
  // Returns null for missing / non-finite / non-positive durations so the
  // caller (`detectGroup`) skips legacy rows where `duration_minutes` is
  // null/undefined instead of misbucketing them as "long".
  const durKey = (ex: ExerciseLog): DurKey | null => {
    const d = ex.duration_minutes;
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) return null;
    return d < 30 ? "short" : d <= 60 ? "medium" : "long";
  };
  const durLabel = (k: DurKey): string => tInsights(`workout_dur_${k}`);

  const workoutPatternsAll = [
    ...detectGroup<TodKey>(todKey, todLabel),
    ...detectGroup<ExerciseType>(ex => normType(ex.exercise_type), exTypeLabel),
    ...detectGroup<DurKey>(durKey, durLabel),
  ];
  const workoutPatterns = workoutPatternsAll.slice(0, 3);
  const showWorkoutPatterns = workoutPatterns.length >= 2;

  // ── Meal evaluation distribution ──
  // Each meal lands in EXACTLY one of GOOD / SPIKE / HYPO via the
  // unified outcome resolver — no double-counting of UNDERDOSE
  // (previously SPIKE+HIGH were lumped together so an under-dose +
  // a real glucose spike both inflated the "Spiked" bar). Denominator
  // is the GOOD+SPIKE+HYPO count, so a pending meal naturally drops
  // out without skewing the percentages.
  const evals = last7
    .map(m => EVAL_NORM(unifiedOutcome(m)))
    .filter((e): e is "GOOD" | "SPIKE" | "HYPO" => e !== null);
  const goodN  = evals.filter(e => e === "GOOD").length;
  const spikeN = evals.filter(e => e === "SPIKE").length;
  const hypoN  = evals.filter(e => e === "HYPO").length;
  const totalN = goodN + spikeN + hypoN;
  const evalPct = (n: number) => totalN > 0 ? Math.round((n / totalN) * 100) : 0;
  const evalRows = [
    { label:tInsights("eval_label_on_target"), count:goodN,  color:GREEN,  pct:evalPct(goodN)  },
    { label:tInsights("eval_label_spiked"),    count:spikeN, color:ORANGE, pct:evalPct(spikeN) },
    { label:tInsights("eval_label_low_risk"),  count:hypoN,  color:PINK,   pct:evalPct(hypoN)  },
  ];

  // ── Deeper-analysis derivations (used by cards under the hero block) ──
  // Numerator + denominator + display precision intentionally mirror
  // dashboard buildCards() (app/(protected)/dashboard/page.tsx) so the
  // two surfaces always show the identical Good rate over the same
  // meal set. Numerator counts only the "GOOD" unified bucket;
  // denominator is `meals.length` (everything fetched), exactly like
  // dashboard. Pending rows resolve to a `null` bucket via
  // `unifiedOutcome` so they don't get miscounted as GOOD.
  // Deeper-analysis aggregates derive from the in-scope meal slice
  // (`last7`) so they respect the active range picker (Task #332).
  // The numerator (`goodAll`) and the denominator (`last7.length`) both
  // come from the same scoped slice so the rate is internally consistent.
  const normed         = last7.map(m => ({ ...m, ev: EVAL_NORM(unifiedOutcome(m)) }));
  const goodAll        = normed.filter(m => m.ev==="GOOD").length;
  // Good Rate Fix: only meals with a non-null EVAL_NORM outcome count in the
  // denominator. A pending row (ev===null) stays in the meal list for other
  // metrics but must not inflate the denominator here — 7 meals where 2 are
  // still pending should read 2/5=40%, not 2/7=29%, when both evaluated are
  // GOOD. The EVAL_NORM comment already states this intent; now enforced.
  const evaluatedCount = normed.filter(m => m.ev !== null).length;
  const goodRate       = evaluatedCount ? goodAll/evaluatedCount*100 : 0;
  const avgGlucose = Math.round(last7.filter(m=>m.glucose_before).reduce((s,m)=>s+(m.glucose_before||0),0) / Math.max(last7.filter(m=>m.glucose_before).length,1));
  const avgCarbs   = Math.round(last7.filter(m=>m.carbs_grams).reduce((s,m)=>s+(m.carbs_grams||0),0) / Math.max(last7.filter(m=>m.carbs_grams).length,1));
  const avgInsulin = (last7.filter(m=>m.insulin_units).reduce((s,m)=>s+(m.insulin_units||0),0) / Math.max(last7.filter(m=>m.insulin_units).length,1)).toFixed(1);
  const icrScope = last7.filter(m=>m.carbs_grams&&m.insulin_units).map(m=>(m.carbs_grams||0)/(m.insulin_units||1));
  const estICR = icrScope.length ? Math.round(icrScope.reduce((a,b)=>a+b,0)/icrScope.length) : 15;

  // Meal type breakdown (FAST_CARBS / HIGH_PROTEIN / HIGH_FAT / BALANCED)
  const types: Record<string, {count:number; totalCarbs:number; totalInsulin:number; good:number}> = {
    FAST_CARBS:   {count:0,totalCarbs:0,totalInsulin:0,good:0},
    HIGH_PROTEIN: {count:0,totalCarbs:0,totalInsulin:0,good:0},
    HIGH_FAT:     {count:0,totalCarbs:0,totalInsulin:0,good:0},
    BALANCED:     {count:0,totalCarbs:0,totalInsulin:0,good:0},
  };
  last7.forEach(m => {
    const t = m.meal_type || "BALANCED";
    if (t in types) {
      types[t].count++;
      types[t].totalCarbs   += m.carbs_grams   || 0;
      types[t].totalInsulin += m.insulin_units  || 0;
      if (EVAL_NORM(unifiedOutcome(m))==="GOOD") types[t].good++;
    }
  });
  const TYPE_ORDER = ["FAST_CARBS", "HIGH_PROTEIN", "HIGH_FAT", "BALANCED"] as const;

  // Time-of-day buckets
  const timeGroups: Record<string,{count:number;good:number}> = {
    "Morning (5–11)":    {count:0,good:0},
    "Afternoon (11–17)": {count:0,good:0},
    "Evening (17–21)":   {count:0,good:0},
    "Night (21–5)":      {count:0,good:0},
  };
  last7.forEach(m => {
    const h = parseDbDate(m.created_at).getHours();
    const key = h >= 5 && h < 11 ? "Morning (5–11)"
              : h >= 11 && h < 17 ? "Afternoon (11–17)"
              : h >= 17 && h < 21 ? "Evening (17–21)"
              : "Night (21–5)";
    timeGroups[key].count++;
    if (EVAL_NORM(unifiedOutcome(m))==="GOOD") timeGroups[key].good++;
  });

  // Pattern detection — FIXED rolling 7-day window (Task 2026-05-18),
  // matching the dashboard's Control Score so both screens speak the
  // same language. We intentionally ignore `scopeMode` *and* `now`
  // (which is `scope.endMs`) here: browsing Month/Year or scrolling
  // back in time must not redefine what "recent" means. The detector
  // always answers "what are your last 7 *real* days doing right now?"
  // SPIKE bucket = SPIKE+UNDERDOSE+LOW (BG ended too high → under-dosed).
  // HYPO  bucket = OVERDOSE+HIGH       (BG ended too low  → over-dosed).
  const patternsNow = Date.now();
  const patternsWindowStart = startOfDaysAgo(6).getTime();
  const recentMeals = meals.filter(m => {
    const t = parseDbTs(m.created_at);
    return t >= patternsWindowStart && t < patternsNow;
  });
  const recentTotal = recentMeals.length;
  const recentGood  = recentMeals.filter(m=>EVAL_NORM(unifiedOutcome(m))==="GOOD").length;
  const recentLow   = recentMeals.filter(m=>EVAL_NORM(unifiedOutcome(m))==="SPIKE").length;
  const recentHigh  = recentMeals.filter(m=>EVAL_NORM(unifiedOutcome(m))==="HYPO").length;
  // Time-of-day groupings used by the morning/evening pattern checks
  // are derived from the SAME fixed 7-day window — otherwise the card
  // would mix "rolling-7d" signals with scope-filtered ones and feel
  // inconsistent (architect review 2026-05-18).
  const patternTimeGroups: Record<string,{count:number;good:number}> = {
    "Morning (5–11)":    {count:0,good:0},
    "Afternoon (11–17)": {count:0,good:0},
    "Evening (17–21)":   {count:0,good:0},
    "Night (21–5)":      {count:0,good:0},
  };
  recentMeals.forEach(m => {
    const h = parseDbDate(m.created_at).getHours();
    const key = h >= 5 && h < 11 ? "Morning (5–11)"
              : h >= 11 && h < 17 ? "Afternoon (11–17)"
              : h >= 17 && h < 21 ? "Evening (17–21)"
              : "Night (21–5)";
    patternTimeGroups[key].count++;
    if (EVAL_NORM(unifiedOutcome(m))==="GOOD") patternTimeGroups[key].good++;
  });
  // Rate-based gates so the cards don't contradict each other (Task 2026-05-18):
  // previously each pattern fired on its absolute count, so "10 under-dosed"
  // and "14 well-dosed" could appear at the same time in a 27-meal window.
  // We still keep the floor counts (≥4 / ≥3 / ≥7) so a tiny sample can't
  // trip any card; on top of that we require a majority rate for the
  // dosing-issue cards and demote "Strong recent control" so it only shows
  // when no issue card fired AND the GOOD share is ≥60%.
  const recentUnderRate = recentTotal > 0 ? recentLow  / recentTotal : 0;
  const recentOverRate  = recentTotal > 0 ? recentHigh / recentTotal : 0;
  const recentGoodRate  = recentTotal > 0 ? recentGood / recentTotal : 0;
  const patterns: {icon:string;title:string;desc:string;color:string}[] = [];
  const underFires = recentLow  >= 4 && recentUnderRate >= 0.4;
  const overFires  = recentHigh >= 3 && recentOverRate  >= 0.3;
  if (underFires) patterns.push({ icon:"↑", title:tInsights("pattern_under_dosing_title"), desc:tInsights("pattern_under_dosing_desc", { n: recentLow,  total: recentTotal }), color:ORANGE });
  if (overFires)  patterns.push({ icon:"↓", title:tInsights("pattern_over_dosing_title"),  desc:tInsights("pattern_over_dosing_desc",  { n: recentHigh, total: recentTotal }), color:PINK   });
  if (!underFires && !overFires && recentGood >= 7 && recentGoodRate >= 0.6) {
    patterns.push({ icon:"✓", title:tInsights("pattern_strong_control_title"), desc:tInsights("pattern_strong_control_desc", { n: recentGood, total: recentTotal }), color:GREEN });
  }
  const morningSucc = patternTimeGroups["Morning (5–11)"];
  const eveningSucc = patternTimeGroups["Evening (17–21)"];
  if (morningSucc.count >= 3 && morningSucc.good/morningSucc.count < 0.5) patterns.push({ icon:"☀", title:tInsights("pattern_morning_issues_title"),    desc:tInsights("pattern_morning_issues_desc"),    color:ORANGE });
  if (eveningSucc.count >= 3 && eveningSucc.good/eveningSucc.count > 0.8) patterns.push({ icon:"🌙", title:tInsights("pattern_evening_strength_title"), desc:tInsights("pattern_evening_strength_desc"), color:ACCENT });
  // Empty-state copy depends on whether the user has enough meals for
  // the detector to be statistically meaningful. <15 meals → onboarding
  // hint ("log more"). >=15 meals → mixed-signal hint (Lucas reported
  // seeing the "log 15+" copy with 113 meals on 2026-05-12). Uses the
  // fixed 7-day window so the empty-state matches the detector's
  // semantics (was `last7.length` which followed scopeMode).
  if (patterns.length === 0) {
    if (recentTotal >= 15) {
      patterns.push({ icon:"→", title:tInsights("pattern_mixed_title"), desc:tInsights("pattern_mixed_desc"), color:"var(--text-faint)" });
    } else {
      patterns.push({ icon:"→", title:tInsights("pattern_no_signals_title"), desc:tInsights("pattern_no_signals_desc"), color:"var(--text-faint)" });
    }
  }

  // Adaptive engine derivations — driven by the engine-only 90-day pull
  // (`engineMeals`) so the morning/afternoon/evening ICR buckets and the
  // pattern detector's recent-window stats aren't dragged off course by
  // year-old rows. Long-term tiles below continue to read from `meals`.
  const adaptiveICR  = computeAdaptiveICR(engineMeals, engineBoluses, icrSchedule);
  const enginePattern = detectPattern(engineMeals);
  const settings: AdaptiveSettings = {
    icr: adaptiveICR.global ? Math.round(adaptiveICR.global * 10) / 10 : 15,
    correctionFactor: 50,
    lastUpdated: null,
    adjustmentHistory: [],
  };
  const suggestion: AdjustmentSuggestion = suggestAdjustment(settings, enginePattern);


  // ─────────────────────────────────────────────────────────────────
  // HERO cards (mockup 1:1) + DEEPER-ANALYSIS cards underneath.
  // Hero matches `InsightsScreen()` in components/AppMockupPhone.tsx
  // exactly (12×14 padding, 9 px uppercase labels, 36/24 hero numbers).
  // Deeper cards reuse the same compact language for visual consistency.
  // ─────────────────────────────────────────────────────────────────
  // Uniform card height: viewport-relative so the hero pager hugs the
  // available space on small phones (iPhone 13 mini / SE) instead of
  // pushing the context box under the bottom nav. The upper cap
  // matches the Adaptive-Engine card's natural collapsed size — the
  // engine card is now the visual reference, so every other insight
  // card uses the same floor and the grid reads as one consistent
  // height instead of the old half-empty 460 px shells. Cards with
  // more content (expanded windows, advisory suggestion block, etc.)
  // still grow naturally past this floor.
  // CSS clamp() also serves as the SSR fallback — it resolves to the
  // upper bound (360 px) when dvh isn't measurable.
  const CARD_MIN_H: string = "clamp(280px, calc(100dvh - 380px), 360px)";

  const items: SortableItem[] = [
    {
      id: "time-in-range",
      node: (
        <UpgradeGate feature="tir_analysis">
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={GREEN}
          back={
            <FlipBack
              title={tInsights("tir_back_title")}
              accent={GREEN}
              paragraphs={[
                tInsights("tir_back_p1"),
                tInsights("tir_back_p2"),
                tInsights("tir_back_p3", { n: b7.n, range: rangeLabel, prev: prevRangeLabel }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_time_in_range_title")}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tirLow}–{tirHigh} mg/dL</div>
          </div>
          {b7.n === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"var(--text-faint)", fontSize:13 }}>
              {tInsights("card_time_in_range_empty")}
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
                <div style={{ fontSize:36, fontWeight:800, color:GREEN, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {b7.inR}
                </div>
                <div style={{ fontSize:14, color:GREEN, fontWeight:700 }}>%</div>
                {prev7Bg.length > 0 && (
                  <div style={{ marginLeft:"auto", fontSize:11, color: tirDelta >= 0 ? GREEN : ORANGE, fontWeight:600 }}>
                    {tirDelta >= 0 ? "+" : ""}{tirDelta} {tInsights("delta_vs_prev_week", { prev: prevRangeLabel })}
                  </div>
                )}
              </div>
              {/* 3-color TBR / TIR / TAR bar (clinical consensus,
                  ATTD three-band visual standard). Lucas 2026-05-14:
                  each segment is now tap-explorable — selecting a band
                  swells it (scaleY) and reveals a contextual info panel
                  below. The crosshair shows the most recent reading. */}
              <div style={{ position:"relative", paddingTop:14, paddingBottom: currentMarkerPct != null ? 22 : 4 }}>
                {/* Bar wrapper. Padding above/below leaves room for the
                    selected segment to "breathe" without clipping its
                    glow. The bar itself is a pill carved out of the
                    surface — we keep `overflow:visible` so a selected
                    segment's outer glow can spill, and rely on per-
                    segment rounding for the pill shape. */}
                <div
                  role="group"
                  aria-label={`Time below range ${tbrPct} percent, in range ${tirPct} percent, above range ${tarPct} percent`}
                  style={{
                    position:"relative",
                    display:"flex",
                    height:14,
                    borderRadius:99,
                    background:"rgba(255,255,255,0.06)",
                    boxShadow:"inset 0 1px 1px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(255,255,255,0.05)",
                  }}
                >
                  {([
                    { key:"tbr" as const, pct: tbrPct, color: PINK,        label: tInsights("tir_legend_below") },
                    { key:"tir" as const, pct: tirPct, color: GREEN,       label: tInsights("tir_legend_in") },
                    { key:"tar" as const, pct: tarPct, color: HIGH_YELLOW, label: tInsights("tir_legend_above") },
                  ]).filter(s => s.pct > 0).map((s, i, arr) => {
                    const isSel  = tirSelected === s.key;
                    const dimmed = tirSelected != null && tirSelected !== "now" && !isSel;
                    const isFirst = i === 0;
                    const isLast  = i === arr.length - 1;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void hapticSelection(); toggleTirSel(s.key); }}
                        aria-pressed={isSel}
                        aria-label={`${s.label}: ${s.pct}%`}
                        style={{
                          width:`${s.pct}%`,
                          // Glassy gradient fill — top-light, bottom-dark
                          // mimics the rim-light reading of a liquid
                          // glass cap rather than a flat solid block.
                          background:`linear-gradient(180deg, ${s.color} 0%, ${s.color}E0 55%, ${s.color}CC 100%)`,
                          border:"none",
                          padding:0,
                          cursor:"pointer",
                          height:"100%",
                          // Apple-Wallet light-sweep needs a clipping
                          // host — the overlay div uses absolute inset:0
                          // and we don't want the streak bleeding past
                          // the rounded caps.
                          position:"relative",
                          overflow:"hidden",
                          borderTopLeftRadius:     isFirst ? 99 : 0,
                          borderBottomLeftRadius:  isFirst ? 99 : 0,
                          borderTopRightRadius:    isLast  ? 99 : 0,
                          borderBottomRightRadius: isLast  ? 99 : 0,
                          // Selection effect — DON'T scale wildly. Lift
                          // gently, brighten, and let the surrounding
                          // soft glow (drop-shadow filter) sell it as
                          // "the glass underneath is lit up".
                          transform: isSel ? "translateY(-2px) scaleY(1.35)" : "scaleY(1)",
                          transformOrigin:"center",
                          opacity: dimmed ? 0.45 : 1,
                          filter: isSel
                            ? `brightness(1.15) saturate(1.15) drop-shadow(0 0 6px ${s.color}AA) drop-shadow(0 2px 8px ${s.color}66)`
                            : "none",
                          // Bright top-edge highlight = wet-glass meniscus.
                          boxShadow: isSel
                            ? "inset 0 1px 0 0 rgba(255,255,255,0.55), inset 0 -1px 0 0 rgba(0,0,0,0.18)"
                            : "inset 0 1px 0 0 rgba(255,255,255,0.32), inset 0 -1px 0 0 rgba(0,0,0,0.18)",
                          transition:"transform 280ms cubic-bezier(0.22, 0.9, 0.32, 1.18), filter 220ms ease-out, opacity 220ms ease-out, box-shadow 220ms ease-out",
                        }}
                      >
                        {/* Light-sweep overlay (Apple-Wallet feel).
                            One-shot 700ms streak, staggered 80ms per
                            segment so TIR/Below/Above feel like they
                            materialise in sequence rather than at once.
                            `forwards` fill keeps the final transparent
                            state so the bar doesn't flash again on
                            re-render. */}
                        <span
                          aria-hidden
                          className="glev-tir-sweep"
                          style={{ animationDelay: `${i * 80}ms` }}
                        />
                      </button>
                    );
                  })}
                </div>
                {/* Live "you are here" crosshair — taps the marker to
                    reveal the current-value detail panel. */}
                {currentMarkerPct != null && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void hapticSelection(); toggleTirSel("now"); }}
                    aria-pressed={tirSelected === "now"}
                    aria-label={`${tInsights("tir_marker_aria")}: ${Math.round(currentBg!)} mg/dL`}
                    style={{
                      position:"absolute",
                      left:`calc(${currentMarkerPct}% - 9px)`,
                      top: 4,
                      width: 18,
                      height: 28,
                      padding: 0,
                      border:"none",
                      background:"transparent",
                      cursor:"pointer",
                      display:"flex",
                      flexDirection:"column",
                      alignItems:"center",
                      justifyContent:"flex-start",
                    }}
                  >
                    <div style={{
                      width: 2,
                      height: 28,
                      background: "var(--text)",
                      borderRadius: 2,
                      boxShadow: tirSelected === "now"
                        ? "0 0 0 2px var(--surface), 0 0 0 3px var(--text)"
                        : "0 0 0 1.5px var(--surface)",
                      transition: "box-shadow 180ms",
                    }}/>
                    <div style={{
                      marginTop: 2,
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily:"var(--font-mono)",
                      color:"var(--text)",
                      whiteSpace:"nowrap",
                      transform:"translateX(0)",
                    }}>
                      {Math.round(currentBg!)}
                    </div>
                  </button>
                )}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, fontSize:11, color:"var(--text-dim)", flexWrap:"wrap", gap:6 }}>
                <span style={{ color:PINK,        fontWeight: tirSelected === "tbr" ? 700 : 500 }}>● {tInsights("tir_legend_below")} · {tbrPct}%</span>
                <span style={{ color:GREEN,       fontWeight: tirSelected === "tir" ? 700 : 500 }}>● {tInsights("tir_legend_in")} · {tirPct}%</span>
                <span style={{ color:HIGH_YELLOW, fontWeight: tirSelected === "tar" ? 700 : 500 }}>● {tInsights("tir_legend_above")} · {tarPct}%</span>
              </div>
              {/* Contextual info panel — appears when a band or the
                  marker is tapped. Tap the same target again to close. */}
              {/* Mini hypo bar chart — same style as the hypo-events card */}
            {hypoEnough && (() => {
              const nowMs = Date.now();
              const vals = Array.from({ length: 7 }, (_, i) => {
                const s = nowMs - (6 - i) * 86400000;
                return readings14.filter(r => r.t >= s && r.t < s + 86400000 && r.v < HYPO_THRESHOLD_MGDL).length;
              });
              const lbls = Array.from({ length: 7 }, (_, i) => String(new Date(nowMs - (6 - i) * 86400000).getDate()));
              return <InsightMicroBars values={vals} labels={lbls} color={PINK} title={tInsights("micro_trend_7d")} barHeight={90} />;
            })()}
            {tirSelected != null && (() => {
                const cfg =
                  tirSelected === "tbr" ? { color: PINK,        title: tInsights("tir_detail_tbr_title"),  body: tInsights("tir_detail_tbr_body",  { pct: tbrPct, hours: tbrHours, mini: hypoEvents7d.mini, clinical: hypoEvents7d.clinical, range: rangeLabel }) } :
                  tirSelected === "tir" ? { color: GREEN,       title: tInsights("tir_detail_tir_title"),  body: tInsights("tir_detail_tir_body",  { pct: tirPct, hours: tirHours, range: rangeLabel }) } :
                  tirSelected === "tar" ? { color: HIGH_YELLOW, title: tInsights("tir_detail_tar_title"),  body: tInsights("tir_detail_tar_body",  { pct: tarPct, hours: tarHours, range: rangeLabel }) } :
                  /* now */              { color: "var(--text)", title: tInsights("tir_detail_now_title"),
                                            body: currentBg == null
                                              ? tInsights("tir_detail_now_empty")
                                              : tInsights("tir_detail_now_body", {
                                                  bg: Math.round(currentBg),
                                                  ago: currentBgAgoMin ?? 0,
                                                  zone: currentBgZone === "tbr" ? tInsights("tir_zone_tbr")
                                                       : currentBgZone === "tir" ? tInsights("tir_zone_tir")
                                                       : tInsights("tir_zone_tar"),
                                                }) };
                return (
                  <div
                    role="region"
                    aria-live="polite"
                    style={{
                      marginTop: 12,
                      padding: "10px 12px",
                      background: `linear-gradient(180deg, ${cfg.color}1A 0%, rgba(255,255,255,0.04) 60%, ${cfg.color}10 100%)`,
                      backdropFilter: "blur(30px) saturate(160%)",
                      WebkitBackdropFilter: "blur(30px) saturate(160%)",
                      border: `1px solid ${cfg.color}55`,
                      borderRadius: 14,
                      borderLeftWidth: 3,
                      boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.18), 0 4px 14px rgba(0,0,0,0.20)",
                    }}
                  >
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform:"uppercase", color: cfg.color }}>
                        {cfg.title}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void hapticSelection(); setTirSelected(null); }}
                        aria-label={tInsights("tir_detail_close")}
                        style={{ background:"transparent", border:"none", color:"var(--text-dim)", fontSize: 16, lineHeight: 1, cursor:"pointer", padding: "0 4px" }}
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
                      {cfg.body}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </FlipCard>
        </UpgradeGate>
      ),
    },
    {
      // Combined Avg-BG + GMI card. Previously rendered as two narrow
      // side-by-side FlipCards which left huge blank space below each
      // value once we shrank CARD_MIN_H. Lucas asked for them in one
      // chip stacked underneath each other — same data, one shared
      // header row, sparkline spanning the full width.
      // ID kept as "gmi-a1c" for backwards compat with persisted
      // card-orders from earlier versions.
      id: "gmi-a1c",
      node: (
        <UpgradeGate feature="hba1c_gmi">
        <FlipCard
          accent={ACCENT}
          back={
            <FlipBack
              title={tInsights("avg_bg_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("avg_bg_back_p1", { range: rangeLabel }),
                tInsights("gmi_back_p1"),
                last7Avg != null
                  ? tInsights("gmi_back_p3_with_avg", { avg: Math.round(last7Avg), n: last7Bg.length, range: rangeLabel })
                  : tInsights("gmi_back_p3_no_avg", { range: rangeLabel }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {/* Row 1 — Ø Glukose */}
            <div>
              <CardLabel text={tInsights("card_avg_bg_title")}/>
              {last7Avg == null ? (
                <div style={{ fontSize:28, fontWeight:800, color:"var(--text-ghost)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
              ) : (
                <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:4, flexWrap:"wrap" }}>
                  <div style={{ fontSize:28, fontWeight:800, color:"var(--text)", fontFamily:"var(--font-mono)", lineHeight:1, letterSpacing:"-0.03em" }}>
                    {Math.round(last7Avg)}
                  </div>
                  <div style={{ fontSize:12, color:"var(--text-dim)" }}>mg/dL</div>
                  {bgDelta != null && (
                    <div style={{ marginLeft:"auto", fontSize:11, color: bgDelta < 0 ? GREEN : bgDelta > 0 ? ORANGE : "var(--text-dim)", fontWeight:600 }}>
                      {bgDelta > 0 ? "+" : bgDelta < 0 ? "−" : ""}{Math.abs(bgDelta)} {tInsights("delta_vs_prev", { prev: prevRangeLabel })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Divider so the two metrics read as distinct rows
                inside one shared chip. */}
            <div style={{ height:1, background:"var(--border-soft)", opacity:0.6 }}/>

            {/* Row 2 — GMI / geschätzter HbA1c */}
            <div>
              <CardLabel text={tInsights("card_gmi_title")}/>
              {gmi == null ? (
                <div style={{ fontSize:28, fontWeight:800, color:"var(--text-ghost)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
              ) : (
                <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:4, flexWrap:"wrap" }}>
                  <div style={{ fontSize:28, fontWeight:800, color:"var(--text)", fontFamily:"var(--font-mono)", lineHeight:1, letterSpacing:"-0.03em" }}>
                    {gmi.toFixed(1)}
                  </div>
                  <div style={{ fontSize:12, color:"var(--text-dim)" }}>%</div>
                  {gmiDelta != null && (
                    <div style={{ marginLeft:"auto", fontSize:11, color: gmiDelta < 0 ? GREEN : gmiDelta > 0 ? ORANGE : "var(--text-dim)", fontWeight:600 }}>
                      {gmiDelta > 0 ? "+" : gmiDelta < 0 ? "−" : ""}{Math.abs(gmiDelta).toFixed(1)} {tInsights("delta_vs_prev", { prev: prevRangeLabel })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Shared 7-day sparkline — full card width now that both
                metrics live in the same chip. Reuses the same series
                the Glucose Trend card derives from `last7Bg` (no extra
                fetch). Hidden until we have at least 2 days of data. */}
            {trendHasData && trendValues.length >= 2 && (
              <div style={{ opacity:0.85 }}>
                <Sparkline values={trendValues.slice(-8)} color={ACCENT}/>
              </div>
            )}
          </div>
        </FlipCard>
        </UpgradeGate>
      ),
    },
    {
      id: "glucose-trend",
      node: (
        <UpgradeGate feature="trends_variability">
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={ACCENT}
          back={
            <FlipBack
              title={tInsights("trend_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("trend_back_p1", { range: rangeLabel }),
                tInsights("trend_back_p2"),
              ]}
            />
          }
        >
          {/* Header — title left, "Ø pro Tag" subtitle + the actual
              7-day average number on the right. Without the number the
              card only showed the sparkline + the "Ø pro Tag" label,
              which read as a promise ("here comes the average") with
              nothing delivering it. Color-coded the same way as the
              other glucose tiles: green in-range, orange high, pink
              low. Falls back to "—" while we don't yet have ≥2 days of
              data so the slot doesn't disappear. */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <CardLabel text={tInsights("card_glucose_trend_title", { range: rangeLabel })}/>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end" }}>
              <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("card_glucose_trend_sub")}</div>
              <div style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                fontFamily: "var(--font-mono)",
                color: last7Avg == null
                  ? "var(--text-faint)"
                  : last7Avg > 140
                    ? ORANGE
                    : last7Avg < 80
                      ? PINK
                      : GREEN,
              }}>
                {last7Avg != null ? Math.round(last7Avg) : "—"}
                {last7Avg != null && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", marginLeft: 4 }}>
                    mg/dL
                  </span>
                )}
              </div>
            </div>
          </div>
          {trendHasData ? (
            <>
              <Sparkline values={trendValues} color={ACCENT} height={100}/>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:11, color:"var(--text-faint)" }}>
                {trendDays.map((d, i) => <span key={i}>{d.label}</span>)}
              </div>
            </>
          ) : (
            <div style={{
              minHeight: 64, display:"flex", alignItems:"center", justifyContent:"center",
              fontSize: 13, color: "var(--text-dim)", textAlign: "center", padding: "8px 4px",
            }}>
              {tInsights("card_glucose_trend_empty")}
            </div>
          )}
        </FlipCard>
        </UpgradeGate>
      ),
    },
    // ── Hypo events counter (7d, BG < 70 mg/dL) ──
    {
      id: "hypo-events",
      node: (() => {
        // Card accent prioritises the more severe bucket: pink for any
        // clinical (≥15 min) hypo, orange for mini-only, green for none.
        const accent = hypoEvents7d.clinical > 0
          ? PINK
          : hypoEvents7d.mini > 0
            ? ORANGE
            : GREEN;
        return (
          <UpgradeGate feature="tir_analysis">
          <FlipCard
            minHeight={CARD_MIN_H}
            accent={accent}
            back={
              <ThresholdBack
                title={tInsights("hypo_label", { range: rangeLabel })}
                accent={accent}
                paragraphs={[
                  tInsights("hypo_back_p1", { range: rangeLabel }),
                  tInsights("hypo_back_p2"),
                  tInsights("hypo_back_p3_clusters"),
                  hypoEnough
                    ? tInsights("readings_window_p3", { n: readings7.length, range: rangeLabel })
                    : tInsights("min_readings_window_required", { min: MIN_DATAPOINTS, range: rangeLabel }),
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text={tInsights("card_hypo_events_title", { range: rangeLabel })}/>
              <div style={{ fontSize:11, color:"var(--text-dim)" }}>&lt; {HYPO_THRESHOLD_MGDL} mg/dL</div>
            </div>
            {!hypoEnough ? (
              <div style={{ padding:"18px 0", textAlign:"center" }}>
                <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
                <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:4 }}>{tInsights("min_readings_required", { min: MIN_DATAPOINTS })}</div>
              </div>
            ) : hypoTotal7d === 0 ? (
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:GREEN, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>0</div>
                <div style={{ fontSize:13, color:GREEN, fontWeight:600 }}>
                  {tInsights("hypo_count_zero")}
                </div>
                <div style={{ marginLeft:"auto", fontSize:11, color:"var(--text-dim)" }}>
                  {tInsights("readings_count", { n: readings7.length })}
                </div>
              </div>
            ) : (
              // Two-bucket layout — Mini-Hypo (<15 min) and Klinische Hypo
              // (≥15 min) side-by-side. Each shows a count + a short
              // duration hint so Lucas knows what each bucket means at a
              // glance without flipping the card.
              <div>
                <div style={{ display:"flex", gap:12 }}>
                  <div style={{ flex:1 }}>
                    <div style={{
                      fontSize:30, fontWeight:800,
                      color: hypoEvents7d.mini > 0 ? ORANGE : "var(--text-faint)",
                      letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1,
                    }}>
                      {hypoEvents7d.mini}
                    </div>
                    <div style={{ fontSize:12, color:"var(--text-dim)", fontWeight:600, marginTop:4 }}>
                      {tInsights("hypo_mini_label")}
                    </div>
                    <div style={{ fontSize:10, color:"var(--text-faint)", marginTop:2 }}>
                      {tInsights("hypo_mini_sub")}
                    </div>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{
                      fontSize:30, fontWeight:800,
                      color: hypoEvents7d.clinical > 0 ? PINK : "var(--text-faint)",
                      letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1,
                    }}>
                      {hypoEvents7d.clinical}
                    </div>
                    <div style={{ fontSize:12, color:"var(--text-dim)", fontWeight:600, marginTop:4 }}>
                      {tInsights("hypo_clinical_label")}
                    </div>
                    <div style={{ fontSize:10, color:"var(--text-faint)", marginTop:2 }}>
                      {tInsights("hypo_clinical_sub")}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop:8, fontSize:11, color:"var(--text-dim)", textAlign:"right" }}>
                  {tInsights("readings_count", { n: readings7.length })}
                </div>
              </div>
            )}
            {/* 7-day daily hypo readings bar chart */}
            {hypoEnough && (() => {
              const nowMs = Date.now();
              const vals = Array.from({ length: 7 }, (_, i) => {
                const s = nowMs - (6 - i) * 86400000;
                return readings14.filter(r => r.t >= s && r.t < s + 86400000 && r.v < HYPO_THRESHOLD_MGDL).length;
              });
              const lbls = Array.from({ length: 7 }, (_, i) => String(new Date(nowMs - (6 - i) * 86400000).getDate()));
              return <InsightMicroBars values={vals} labels={lbls} color={accent} title={tInsights("micro_trend_7d")} barHeight={90} />;
            })()}
          </FlipCard>
          </UpgradeGate>
        );
      })(),
    },
    // ── Hyper events counter (7d, BG > 250 mg/dL) ──
    {
      id: "hyper-events",
      node: (() => {
        const accent = hyperCount7d > 0 ? ORANGE : GREEN;
        return (
          <UpgradeGate feature="tir_analysis">
          <FlipCard
            minHeight={CARD_MIN_H}
            accent={accent}
            back={
              <ThresholdBack
                title={tInsights("hyper_label", { range: rangeLabel })}
                accent={accent}
                paragraphs={[
                  tInsights("hyper_back_p1", { range: rangeLabel }),
                  tInsights("hyper_back_p2"),
                  hyperEnough
                    ? tInsights("readings_window_p3", { n: readings7.length, range: rangeLabel })
                    : tInsights("min_readings_window_required", { min: MIN_DATAPOINTS, range: rangeLabel }),
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text={tInsights("card_hyper_events_title", { range: rangeLabel })}/>
              <div style={{ fontSize:11, color:"var(--text-dim)" }}>&gt; {HYPER_THRESHOLD_MGDL} mg/dL</div>
            </div>
            {!hyperEnough ? (
              <div style={{ padding:"18px 0", textAlign:"center" }}>
                <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
                <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:4 }}>{tInsights("min_readings_required", { min: MIN_DATAPOINTS })}</div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:accent, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {hyperCount7d}
                </div>
                <div style={{ fontSize:13, color:accent, fontWeight:600 }}>
                  {hyperCount7d === 0 ? tInsights("hyper_count_zero") : hyperCount7d === 1 ? tInsights("hyper_count_one") : tInsights("hyper_count_many")}
                </div>
                <div style={{ marginLeft:"auto", fontSize:11, color:"var(--text-dim)" }}>
                  {tInsights("readings_count", { n: readings7.length })}
                </div>
              </div>
            )}
            {/* 7-day daily hyper readings bar chart */}
            {hyperEnough && (() => {
              const nowMs = Date.now();
              const vals = Array.from({ length: 7 }, (_, i) => {
                const s = nowMs - (6 - i) * 86400000;
                return readings14.filter(r => r.t >= s && r.t < s + 86400000 && r.v > HYPER_THRESHOLD_MGDL).length;
              });
              const lbls = Array.from({ length: 7 }, (_, i) => String(new Date(nowMs - (6 - i) * 86400000).getDate()));
              return <InsightMicroBars values={vals} labels={lbls} color={accent} title={tInsights("micro_trend_7d")} barHeight={90} />;
            })()}
          </FlipCard>
          </UpgradeGate>
        );
      })(),
    },
    // ── Glucose Variability CV% (14d, ATTD consensus thresholds) ──
    {
      id: "glucose-variability",
      node: (
        <UpgradeGate feature="trends_variability">
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={cvColor}
          back={
            <ThresholdBack
              title={tInsights("cv_back_title")}
              accent={cvColor}
              paragraphs={[
                tInsights("cv_back_p1"),
                tInsights("cv_back_p2"),
                cvEnough
                  ? tInsights("cv_back_p3", { n: readings14.length })
                  : tInsights("cv_back_p3_insufficient", { min: MIN_DATAPOINTS }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("cv_label")}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>CV%</div>
          </div>
          {!cvEnough || cvPct == null ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:4 }}>{tInsights("min_readings_required", { min: MIN_DATAPOINTS })}</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:cvColor, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {cvPct.toFixed(1)}
                </div>
                <div style={{ fontSize:14, color:cvColor, fontWeight:700 }}>%</div>
                <div style={{ marginLeft:"auto", fontSize:11, color:cvColor, fontWeight:700 }}>
                  {cvPct < CV_STABLE_PCT
                    ? tInsights("cv_status_stable")
                    : cvPct <= CV_HIGH_PCT
                      ? tInsights("cv_status_medium")
                      : tInsights("cv_status_unstable")}
                </div>
              </div>
              {/* Threshold bar: green ≤36, yellow 36–50, red >50 (clamped to 75% for display). */}
              <div style={{ position:"relative", height:6, borderRadius:99, overflow:"hidden", background:"var(--surface-soft)" }}>
                <div style={{ position:"absolute", left:0,           top:0, bottom:0, width:`${(CV_STABLE_PCT/75)*100}%`,                              background:GREEN,       opacity:0.55 }}/>
                <div style={{ position:"absolute", left:`${(CV_STABLE_PCT/75)*100}%`, top:0, bottom:0, width:`${((CV_HIGH_PCT-CV_STABLE_PCT)/75)*100}%`, background:HIGH_YELLOW, opacity:0.55 }}/>
                <div style={{ position:"absolute", left:`${(CV_HIGH_PCT/75)*100}%`,   top:0, bottom:0, right:0,                                          background:PINK,        opacity:0.55 }}/>
                <div style={{ position:"absolute", left:`${Math.min(cvPct, 75) / 75 * 100}%`, top:-2, bottom:-2, width:2, background:"var(--text)", borderRadius:1, transform:"translateX(-1px)" }}/>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:11, color:"var(--text-dim)" }}>
                <span style={{ color:GREEN }}>{tInsights("cv_legend_stable")}</span>
                <span style={{ color:HIGH_YELLOW }}>{tInsights("cv_legend_medium")}</span>
                <span style={{ color:PINK }}>{tInsights("cv_legend_unstable")}</span>
              </div>
              {/* 14-day daily CV% bar chart */}
              {(() => {
                const nowMs = Date.now();
                const cvVals = Array.from({ length: 14 }, (_, i) => {
                  const s = nowMs - (13 - i) * 86400000;
                  const dayVals = readings14.filter(r => r.t >= s && r.t < s + 86400000).map(r => r.v);
                  if (dayVals.length < 3) return 0;
                  const mean = dayVals.reduce((a, b) => a + b, 0) / dayVals.length;
                  const variance = dayVals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / dayVals.length;
                  return +(Math.sqrt(variance) / mean * 100).toFixed(1);
                });
                return <InsightMicroBars values={cvVals} color={cvColor} title={tInsights("micro_trend_14d")} barHeight={80} />;
              })()}
            </>
          )}
        </FlipCard>
        </UpgradeGate>
      ),
    },
    {
      id: "meal-evaluation",
      node: (
        <UpgradeGate feature="meal_bz_rating">
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={ORANGE}
          back={
            <FlipBack
              title={tInsights("meal_eval_back_title")}
              accent={ORANGE}
              paragraphs={[
                tInsights("meal_eval_back_p1"),
                tInsights("meal_eval_back_p2"),
                tInsights("meal_eval_back_p3", { n: totalN, range: rangeLabel }),
              ]}
            />
          }
        >
          <CardLabel text={tInsights("card_meal_evaluation_title", { range: rangeLabel })}/>
          {totalN === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"var(--text-faint)", fontSize:13 }}>
              {tInsights("card_meal_evaluation_empty")}
            </div>
          ) : (
            <>
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
                {evalRows.map(r => (
                  <div key={r.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:60, fontSize:12, color:r.color }}>{r.label}</div>
                    <div style={{ flex:1, height:6, background:"var(--surface-soft)", borderRadius:99, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${r.pct}%`, background:r.color, borderRadius:99, transition:"width 0.3s" }}/>
                    </div>
                    <div
                      title={`${r.pct}%`}
                      style={{ width:24, textAlign:"right", fontSize:12, color:"var(--text)", fontFamily:"var(--font-mono)", fontWeight:600 }}
                    >
                      {r.count}
                    </div>
                  </div>
                ))}
              </div>
              {/* 7-day daily meal hit-rate bar chart */}
              {(() => {
                const nowMs = Date.now();
                const evalVals = Array.from({ length: 7 }, (_, i) => {
                  const s = nowMs - (6 - i) * 86400000;
                  const dayMeals = meals.filter(m => { const t = parseDbTs(m.created_at); return t >= s && t < s + 86400000; });
                  const good = dayMeals.filter(m => m.evaluation === "GOOD").length;
                  return dayMeals.length > 0 ? Math.round((good / dayMeals.length) * 100) : 0;
                });
                const evalLabels = Array.from({ length: 7 }, (_, i) => String(new Date(nowMs - (6 - i) * 86400000).getDate()));
                return <InsightMicroBars values={evalVals} labels={evalLabels} color={GREEN} title={tInsights("micro_hit_rate_7d")} barHeight={80} />;
              })()}
            </>
          )}
        </FlipCard>
        </UpgradeGate>
      ),
    },
    // ──── Deeper analysis cards (below the hero block) ────
    {
      id: "adaptive-engine",
      node: (
        <UpgradeGate feature="adaptive_icr">
        <FlipCard
          accent={ACCENT}
          back={
            <IcrInfoBack
              heading={tInsights("engine_back_heading")}
              accent={ACCENT}
              body={tInsights("engine_back_body")}
              subLine={tInsights("engine_back_subline")}
            />
          }
        >
          {(() => {
            // Engine status maps to confidence: high → TUNED (green/ready),
            // medium → LEARNING (accent), low → WARMING UP (orange).
            // Mirrors the "AI FOOD PARSER · GPT-powered · READY" chip vibe.
            const conf = enginePattern.confidence;
            const statusLabel = conf === "high"
              ? tInsights("engine_status_tuned")
              : conf === "medium"
                ? tInsights("engine_status_learning")
                : tInsights("engine_status_warming_up");
            const statusColor = conf === "high" ? GREEN : conf === "medium" ? ACCENT : ORANGE;
            const icrText = adaptiveICR.global
              ? `1:${(Math.round(adaptiveICR.global * 10) / 10)}`
              : "–";
            return (
              <>
                {/* Corner-pinned ℹ in the very top-right of the card. Sits inside
                    the front shell's top padding so it never overlaps the status
                    pill below and never shifts existing layout. */}
                <InfoCornerIcon/>
                {/* Plain header row — CardLabel on left, status pill on right.
                    No chip wrapper: the headline lives in the card itself. */}
                <div style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  gap:10, marginBottom:12,
                }}>
                  <CardLabel text={tInsights("engine_label")}/>
                  <span style={{
                    display:"inline-flex", alignItems:"center", gap:6,
                    fontSize:11, fontWeight:700, letterSpacing:"0.1em",
                    color: statusColor, flexShrink:0,
                    padding:"3px 8px", borderRadius:99,
                    border:`1px solid ${statusColor}55`,
                    background:`${statusColor}18`,
                  }}>
                    <span style={{
                      width:6, height:6, borderRadius:"50%",
                      background: statusColor,
                      boxShadow: `0 0 6px ${statusColor}`,
                    }}/>
                    {statusLabel}
                  </span>
                </div>

                {/* Two-value ICR block (Lucas-Spec May 14): show the
                    user's manual value AND the engine-computed value
                    side-by-side so it's clear they're two different
                    numbers and the engine never silently overwrote the
                    user's setting.
                      Row 1 ("Dein Faktor"): white, bold — this is the
                        value bolus calc actually uses.
                      Row 2 ("Engine"):       dimmed grey + mono — the
                        suggestion. Hidden when no engine value yet
                        (warming-up state), so we don't render an
                        empty "1:–" placeholder.
                    Bottom-border + marginBottom keep the pattern-
                    evaluation block underneath clearly separated. */}
                <div style={{
                  display:"flex", flexDirection:"column", gap:6,
                  padding:"2px 2px 14px", marginBottom:16,
                  borderBottom:`1px solid var(--border-soft)`,
                }}>
                  {/* DEIN FAKTOR — user-set, ACCENT-blau (Lucas: "die
                      blaue Schrift sah eigentlich ganz geil aus"). Größer
                      + fetter als die Engine-Zeile, weil das der Wert ist,
                      mit dem der Bolus tatsächlich rechnet. */}
                  <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                    <span style={{ fontSize:11, color:"var(--text-dim)", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>
                      {tInsights("engine_user_icr_label")}
                    </span>
                    <span style={{
                      fontSize:20, fontWeight:800,
                      color: ACCENT,
                      fontFamily:"var(--font-mono)",
                      lineHeight:1, letterSpacing:"-0.03em",
                    }}>
                      {tInsights("engine_user_icr_value", { value: Math.round(userIcr * 10) / 10 })}
                    </span>
                  </div>
                  {/* Phase B2 active-window badge — only renders when the
                      user has the schedule master toggle on AND a slot
                      currently covers `nowMinute`. Tells the user which
                      value the engine is actually using right now (since
                      Phase B1, the recommender resolves the slot value
                      via getEffectiveICR). Slot label can be empty —
                      fall back to "Fenster N" so the badge is never
                      blank. Quiet styling: small, GREEN-tinted pill so
                      it reads as a status indicator, not a primary value. */}
                  {(() => {
                    const slot = findActiveSlot(icrSchedule, nowMinute);
                    if (!slot) return null;
                    const label = slot.label?.trim()
                      ? slot.label
                      : tInsights("engine_window_unnamed", { n: slot.slotIndex });
                    return (
                      <div style={{
                        display:"inline-flex", alignSelf:"flex-start",
                        alignItems:"center", gap:6,
                        padding:"3px 8px", borderRadius:99,
                        background: `${GREEN}18`,
                        border: `1px solid ${GREEN}55`,
                        fontSize:11, fontWeight:600, lineHeight:1.2,
                        color: GREEN, marginTop:2,
                      }}>
                        <span style={{
                          width:6, height:6, borderRadius:"50%",
                          background: GREEN, boxShadow: `0 0 6px ${GREEN}`,
                        }}/>
                        {tInsights("engine_window_active", {
                          label,
                          icr: Math.round(slot.icrGPerUnit * 10) / 10,
                        })}
                      </div>
                    );
                  })()}
                  {/* ENGINE — adaptive, ebenfalls ACCENT-blau aber
                      kleiner, damit visuelle Hierarchie klar bleibt
                      (User = primär, Engine = sekundär). Der "X Mahl-
                      zeiten"-Counter rechts war Lucas zu dominant —
                      jetzt fontSize 10 + faint statt 11 + dim, damit er
                      ruhiger neben den Zahlen sitzt. Nur eingeblendet,
                      sobald die Engine tatsächlich einen Wert hat. */}
                  {adaptiveICR.global != null && (
                    <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                      <span style={{ fontSize:11, color:"var(--text-faint)", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>
                        {tInsights("engine_label_icr")}
                      </span>
                      <span style={{
                        fontSize:14, fontWeight:700,
                        color: ACCENT,
                        fontFamily:"var(--font-mono)",
                        lineHeight:1, letterSpacing:"-0.03em",
                        opacity: 0.85,
                      }}>
                        {icrText}
                      </span>
                      <span style={{ fontSize:10, color:"var(--text-faint)", marginLeft:"auto", textAlign:"right", lineHeight:1.3, opacity: 0.7 }}>
                        {tInsights("engine_final_meals", { n: enginePattern.sampleSize })}
                      </span>
                    </div>
                  )}
                  {/* Scope-coupling badge (Task #332). The engine itself
                      keeps its 90-day learning window — but we surface
                      how many in-scope meals the user has so the card's
                      relationship to the global range picker is honest. */}
                  <div style={{ fontSize:10, color:"var(--text-faint)", marginTop:2, opacity:0.8 }}>
                    {tInsights("engine_meals_in_range", { n: last7.length })}
                  </div>
                  {/* Phase B3+B4 — per-window learned ICRs. Collapsed by
                      default so the card stays calm; only renders when
                      the schedule master toggle is on AND the engine
                      returned at least one window. Each row shows:
                        • slot label (falls back to "Fenster N")
                        • the user's manual slot ICR (Du 1:X)
                        • the engine's learned slot ICR (1:Y) or status
                          text when there aren't enough samples
                        • a status pill: TUNED ≥8, LEARNING 3-7, WARMING
                          UP <3 (Phase B4 thresholds — keeps parity with
                          the engine-wide ≥3 floor used for adaptiveICR
                          buckets while adding a higher "tuned" bar). */}
                  {adaptiveICR.windows.length > 0 && (
                    <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:4 }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setWindowsExpanded(v => !v); }}
                        onKeyDown={(e) => e.stopPropagation()}
                        style={{
                          alignSelf:"flex-start",
                          background:"transparent", border:"none", padding:0,
                          color:"var(--text-dim)", fontSize:11, fontWeight:600,
                          letterSpacing:"0.05em", cursor:"pointer",
                          textDecoration:"underline", textUnderlineOffset:3,
                        }}
                      >
                        {tInsights(
                          windowsExpanded ? "engine_windows_close" : "engine_windows_open",
                        )}
                      </button>
                      {windowsExpanded && (
                        <div style={{
                          display:"flex", flexDirection:"column", gap:6,
                          marginTop:8,
                          padding:"8px 10px", borderRadius:8,
                          background:"var(--card-2, rgba(255,255,255,0.03))",
                          border:"1px solid var(--border)",
                        }}>
                          {adaptiveICR.windows.map(w => {
                            const label = w.label?.trim()
                              ? w.label
                              : tInsights("engine_window_unnamed", { n: w.slotIndex });
                            const TUNED_MIN = 8;
                            const statusKey =
                              w.sampleSize >= TUNED_MIN ? "engine_status_tuned" :
                              w.sampleSize >= 3         ? "engine_status_learning" :
                                                          "engine_status_warming_up";
                            const statusColor =
                              w.sampleSize >= TUNED_MIN ? GREEN :
                              w.sampleSize >= 3         ? ACCENT :
                                                          "var(--text-faint)";
                            const learnedRounded = w.learnedIcr != null
                              ? Math.round(w.learnedIcr * 10) / 10
                              : null;
                            const learnedText = learnedRounded != null ? `1:${learnedRounded}` : "—";

                            // Phase B5 suggestion gate: TUNED + learned set
                            // + drift > 10% + not yet dismissed for this
                            // exact value + the manual value differs from
                            // the rounded learned (otherwise applying is a
                            // no-op). Drift is symmetric (|Δ| / manual).
                            const SUGGEST_MIN_DRIFT = 0.10;
                            const drift = learnedRounded != null && w.manualIcr > 0
                              ? Math.abs(learnedRounded - w.manualIcr) / w.manualIcr
                              : 0;
                            const dismissKey = `${w.slotIndex}:${learnedRounded ?? ""}`;
                            const showSuggestion =
                              w.sampleSize >= TUNED_MIN &&
                              learnedRounded != null &&
                              learnedRounded !== Math.round(w.manualIcr * 10) / 10 &&
                              drift > SUGGEST_MIN_DRIFT &&
                              !dismissedSuggestions.has(dismissKey);
                            const isApplying = applyingSlot === w.slotIndex;

                            const handleApply = async () => {
                              if (learnedRounded == null) return;
                              setApplyingSlot(w.slotIndex);
                              try {
                                // Replace just this slot's icr — keep the
                                // rest of the schedule (label, time band,
                                // enabled flag, master toggle) intact.
                                const next: IcrSchedule = {
                                  ...icrSchedule,
                                  slots: icrSchedule.slots.map(s =>
                                    s.slotIndex === w.slotIndex
                                      ? { ...s, icrGPerUnit: learnedRounded }
                                      : s,
                                  ),
                                };
                                await saveIcrSchedule(next);
                                setIcrSchedule(next);
                              } catch {
                                // Swallow — the worst case is the user taps
                                // again. We don't want a crash on a side
                                // panel inside the engine card.
                              } finally {
                                setApplyingSlot(null);
                              }
                            };

                            return (
                              <div key={w.slotIndex} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                                <div style={{
                                  display:"flex", alignItems:"center",
                                  gap:8, fontSize:12, lineHeight:1.3,
                                  flexWrap:"wrap",
                                }}>
                                  <span style={{
                                    fontWeight:700, color:"var(--text)",
                                    minWidth:64,
                                  }}>
                                    {label}
                                  </span>
                                  <span style={{
                                    color:"var(--text-dim)",
                                    fontFamily:"var(--font-mono)",
                                  }}>
                                    {tInsights("engine_window_manual_short", {
                                      icr: Math.round(w.manualIcr * 10) / 10,
                                    })}
                                  </span>
                                  <span style={{
                                    color: ACCENT, opacity: 0.85,
                                    fontFamily:"var(--font-mono)", fontWeight:700,
                                  }}>
                                    {tInsights("engine_window_learned_short", {
                                      icr: learnedText,
                                    })}
                                  </span>
                                  <span style={{
                                    marginLeft:"auto",
                                    display:"inline-flex", alignItems:"center", gap:6,
                                  }}>
                                    <span style={{
                                      fontSize:10, fontWeight:700, letterSpacing:"0.08em",
                                      padding:"2px 6px", borderRadius:99,
                                      background: `${statusColor}18`,
                                      color: statusColor,
                                      border: `1px solid ${statusColor}55`,
                                    }}>
                                      {tInsights(statusKey)}
                                    </span>
                                    <span style={{ fontSize:10, color:"var(--text-faint)" }}>
                                      {tInsights("engine_final_meals", { n: w.sampleSize })}
                                    </span>
                                  </span>
                                </div>
                                {showSuggestion && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    style={{
                                    display:"flex", alignItems:"center",
                                    flexWrap:"wrap", gap:8,
                                    padding:"6px 8px",
                                    borderRadius:6,
                                    background: `${ACCENT}12`,
                                    border: `1px solid ${ACCENT}44`,
                                  }}>
                                    <span style={{
                                      fontSize:11, color:"var(--text)", lineHeight:1.3,
                                    }}>
                                      {tInsights("engine_window_suggest", {
                                        icr: learnedRounded,
                                      })}
                                    </span>
                                    <span style={{ marginLeft:"auto", display:"inline-flex", gap:6 }}>
                                      <button
                                        type="button"
                                        disabled={isApplying}
                                        onClick={handleApply}
                                        style={{
                                          fontSize:11, fontWeight:700,
                                          padding:"4px 10px", borderRadius:99,
                                          background: ACCENT, color:"#fff",
                                          border:"none",
                                          cursor: isApplying ? "default" : "pointer",
                                          opacity: isApplying ? 0.6 : 1,
                                        }}
                                      >
                                        {tInsights(isApplying ? "engine_window_applying" : "engine_window_apply")}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isApplying}
                                        onClick={() => {
                                          setDismissedSuggestions(prev => {
                                            const next = new Set(prev);
                                            next.add(dismissKey);
                                            return next;
                                          });
                                        }}
                                        style={{
                                          fontSize:11, fontWeight:600,
                                          padding:"4px 10px", borderRadius:99,
                                          background:"transparent",
                                          color:"var(--text-dim)",
                                          border:"1px solid var(--border)",
                                          cursor: isApplying ? "default" : "pointer",
                                          opacity: isApplying ? 0.6 : 1,
                                        }}
                                      >
                                        {tInsights("engine_window_keep")}
                                      </button>
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Pattern label — German renders localized strings; English
                    keeps the engine defaults from lib/engine/patterns.ts as
                    the single source of truth.
                    Order rationale (BB-Hierarchie, May 2026): Verdict first,
                    then explanation, then meta-source line at the bottom —
                    so the eye reads What? → Why? → From which data?. */}
                {(() => {
                  const n = enginePattern.sampleSize;
                  const safe = n > 0 ? n : 1;
                  const pctFor: Record<typeof enginePattern.type, number> = {
                    balanced: n > 0 ? Math.round((enginePattern.counts.good / safe) * 100) : 0,
                    overdosing: n > 0 ? Math.round((enginePattern.counts.overdose / safe) * 100) : 0,
                    underdosing: n > 0 ? Math.round((enginePattern.counts.underdose / safe) * 100) : 0,
                    spiking: n > 0 ? Math.round((enginePattern.counts.spike / safe) * 100) : 0,
                    insufficient_data: 0,
                  };
                  const isDe = locale === "de";
                  const label = isDe
                    ? tInsights(`pattern_${enginePattern.type}_label` as const)
                    : enginePattern.label;
                  const explanation = isDe
                    ? tInsights(`pattern_${enginePattern.type}_explanation` as const, {
                        pct: pctFor[enginePattern.type],
                        n,
                      })
                    : enginePattern.explanation;
                  return (
                    <>
                      {/* Lower-half hierarchy (BB v1, max-3-Sizes rule):
                          Verdict 14/700 text-primary, Body 13/regular
                          text-muted, Meta-Source line below at 11/faint.
                          Hierarchy carried by weight + color, not by
                          stacking ever-larger fonts. */}
                      <div style={{ fontSize:14, fontWeight:700, color:"var(--text)", lineHeight:1.4, marginBottom:4 }}>
                        {label}
                      </div>
                      <div style={{ fontSize:13, color:"var(--text-muted)", lineHeight:1.5 }}>
                        {explanation}
                      </div>
                    </>
                  );
                })()}

                {/* ICR source breakdown — makes it visible whether the
                    adaptive ICR is being driven by separately-logged
                    bolus shots (paired via related_entry_id or ±30-min
                    time-window) or by the legacy meal.insulin_units
                    column. When at least one pair came in via the
                    time-window heuristic, the line becomes a tap
                    target that opens an inline relink panel — the user
                    can upgrade those heuristic pairs to explicit tags
                    (Task #211). Hidden when there are zero contributing
                    meals (warming-up state already says so).
                    Sits BELOW the verdict/explanation as a quiet meta
                    footnote (May 2026 hierarchy fix). */}
                {adaptiveICR.sampleSize > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <RelinkSourceLine
                      adaptiveICR={adaptiveICR}
                      engineMeals={engineMeals}
                      engineBoluses={engineBoluses}
                      open={relinkOpen}
                      onToggle={setRelinkOpen}
                      onLinked={(bolusId, mealId) => {
                        setEngineBoluses(prev => prev.map(b => b.id === bolusId ? { ...b, related_entry_id: mealId } : b));
                        setInsulinLogs(prev => prev.map(b => b.id === bolusId ? { ...b, related_entry_id: mealId } : b));
                      }}
                    />
                  </div>
                )}

                {/* Suggestion / advisory block — the engine returns a
                    structured i18n descriptor (message.key + message.params)
                    so the UI can render it in whichever locale is active
                    without leaking any UI/i18n imports into lib/engine. */}
                {(suggestion.hasSuggestion || enginePattern.type === "spiking" || enginePattern.type === "overdosing" || enginePattern.type === "underdosing") && (
                  <div style={{
                    marginTop:12, padding:"10px 12px", borderRadius:10,
                    background:`linear-gradient(135deg, ${ACCENT}14, ${ACCENT}06)`,
                    border:`1px solid ${ACCENT}33`,
                  }}>
                    <div style={{
                      display:"flex", alignItems:"center", gap:6,
                      fontSize:11, fontWeight:700, color:ACCENT,
                      letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4,
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.6 1 1.5 1 2.3v1h6v-1c0-.8.3-1.7 1-2.3A7 7 0 0 0 12 2z"/>
                      </svg>
                      {suggestion.hasSuggestion ? tInsights("engine_pill_suggested") : tInsights("engine_pill_advisory")}
                    </div>
                    <div style={{ fontSize:13, color:"var(--text-strong)", lineHeight:1.5 }}>
                      {tInsights(suggestion.message.key, suggestion.message.params)}
                    </div>
                    {/* Curve-derived advisories (Task #237 follow-up):
                        rendered as compact bullet rows directly under the
                        primary suggestion. Independent of `hasSuggestion`
                        — a balanced pattern can still surface a "20 % of
                        meals dipped 1–3h later" signal. */}
                    {suggestion.advisories && suggestion.advisories.length > 0 && (
                      <ul style={{
                        listStyle:"none", margin:"8px 0 0 0", padding:0,
                        display:"flex", flexDirection:"column", gap:4,
                      }}>
                        {suggestion.advisories.map((a, i) => (
                          <li key={`${a.key}-${i}`} style={{
                            fontSize:13, color:"var(--text-muted)", lineHeight:1.5,
                            display:"flex", gap:6, alignItems:"flex-start",
                          }}>
                            <span style={{ color:ACCENT, fontWeight:700, marginTop:1 }}>•</span>
                            <span>{tInsights(a.key as Parameters<typeof tInsights>[0], a.params)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div style={{ marginTop:8 }}>
                      <DisclaimerChip/>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </FlipCard>
        </UpgradeGate>
      ),
    },
    // ── Total Daily Dose · 7d (sum of insulin units per day) ──
    {
      id: "tdd",
      node: (
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={ACCENT}
          back={
            <ThresholdBack
              title={tInsights("tdd_label", { range: rangeLabel })}
              accent={ACCENT}
              paragraphs={[
                tInsights("tdd_back_p1"),
                tInsights("tdd_back_p2", { range: rangeLabel, days: rangeDays }),
                tddEnough
                  ? tInsights("tdd_back_p3", { logs: insulinLogs.filter(il => { const t = parseDbTs(il.created_at); return t >= tddFromMs && t < tddNowMs; }).length, days: tddDayCount, range: rangeLabel })
                  : tInsights("tdd_back_p3_insufficient", { min: minDatapointsForScope, range: rangeLabel }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_tdd_title", { range: rangeLabel })}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("card_tdd_sub")}</div>
          </div>
          {!tddEnough || tddAvg7 == null ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:4 }}>{tInsights("tdd_min_required", { min: minDatapointsForScope })}</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <div style={{ fontSize:36, fontWeight:800, color:"var(--text)", letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {tddAvg7.toFixed(1)}
                </div>
                <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:700 }}>{tInsights("tdd_unit_main")}</div>
                <div style={{ marginLeft:"auto", fontSize:11, color:"var(--text-dim)" }}>{tInsights("tdd_avg_7d", { range: rangeLabel })}</div>
              </div>
              {/* Bolus / Basal split for the 7-day average. Helps Lucas
                  see whether his TDD is dominated by carb-cover boluses
                  or by basal — important for interpreting changes. Two
                  pills side-by-side; sum equals the headline number
                  above (we divide both legs by the same 7-day window). */}
              {(tddAvg7Bolus != null || tddAvg7Basal != null) && (
                <div style={{ marginTop:8, display:"flex", gap:6 }}>
                  <div style={{
                    flex:1, padding:"6px 10px", background:`${ACCENT}10`, border:`1px solid ${ACCENT}25`,
                    borderRadius:10, display:"flex", flexDirection:"column", gap:2,
                  }}>
                    <div style={{ fontSize:10, color:"var(--text-faint)", letterSpacing:"0.06em", fontWeight:600, textTransform:"uppercase" }}>
                      {tInsights("tdd_bolus_label")}
                    </div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                      <div style={{ fontSize:18, fontWeight:800, color:ACCENT, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                        {(tddAvg7Bolus ?? 0).toFixed(1)}
                      </div>
                      <div style={{ fontSize:11, color:ACCENT, fontWeight:700 }}>U</div>
                    </div>
                  </div>
                  <div style={{
                    flex:1, padding:"6px 10px", background:`${ACCENT_SOFT}12`, border:`1px solid ${ACCENT_SOFT}30`,
                    borderRadius:10, display:"flex", flexDirection:"column", gap:2,
                  }}>
                    <div style={{ fontSize:10, color:"var(--text-faint)", letterSpacing:"0.06em", fontWeight:600, textTransform:"uppercase" }}>
                      {tInsights("tdd_basal_label")}
                    </div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                      <div style={{ fontSize:18, fontWeight:800, color:ACCENT_SOFT, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                        {(tddAvg7Basal ?? 0).toFixed(1)}
                      </div>
                      <div style={{ fontSize:11, color:ACCENT_SOFT, fontWeight:700 }}>U</div>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ marginTop:10, display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:`${ACCENT}10`, border:`1px solid ${ACCENT}25`, borderRadius:10 }}>
                <div style={{ fontSize:12, color:"var(--text-muted)", fontWeight:600 }}>{tInsights("tdd_today")}</div>
                <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                  {/* Today's bolus / basal slivers — small label + value
                      stack so Lucas can see at a glance "today is mostly
                      basal" or "today I've boluses 6, basal 12". */}
                  <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                    <span style={{ fontSize:10, color:"var(--text-faint)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                      {tInsights("tdd_bolus_label")}
                    </span>
                    <span style={{ fontSize:13, fontWeight:800, color:ACCENT, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                      {tddTodayBolus.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                    <span style={{ fontSize:10, color:"var(--text-faint)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                      {tInsights("tdd_basal_label")}
                    </span>
                    <span style={{ fontSize:13, fontWeight:800, color:ACCENT_SOFT, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                      {tddTodayBasal.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ display:"flex", alignItems:"baseline", gap:4, paddingLeft:6, borderLeft:`1px solid ${ACCENT}30` }}>
                    <div style={{ fontSize:18, fontWeight:800, color:ACCENT, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                      {tddToday.toFixed(1)}
                    </div>
                    <div style={{ fontSize:12, color:ACCENT, fontWeight:700 }}>U</div>
                  </div>
                </div>
              </div>
              {/* 7-day daily total dose bar chart */}
              {(() => {
                const nowMs = Date.now();
                const tddBarVals = Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(nowMs - (6 - i) * 86400000);
                  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                  const b = tddByDay.get(key);
                  return b ? +(b.bolus + b.basal).toFixed(1) : 0;
                });
                const tddBarLabels = Array.from({ length: 7 }, (_, i) => String(new Date(nowMs - (6 - i) * 86400000).getDate()));
                return <InsightMicroBars values={tddBarVals} labels={tddBarLabels} color={ACCENT} title={tInsights("micro_tdd_7d")} barHeight={80} />;
              })()}
            </>
          )}
        </FlipCard>
      ),
    },
    {
      id: "patterns",
      node: (
        <UpgradeGate feature="bz_pattern_recognition">
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={PINK}
          back={
            <FlipBack
              title={tInsights("patterns_back_title")}
              accent={PINK}
              paragraphs={[
                tInsights("patterns_back_p1"),
                tInsights("patterns_back_p2"),
                tInsights("patterns_back_p3"),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text={tInsights("card_patterns_title")}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("card_patterns_signal_count", { n: patterns.length })}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"8px 10px", background:`${p.color}08`, border:`1px solid ${p.color}20`, borderRadius:10, alignItems:"flex-start" }}>
                <div style={{ width:22, height:22, borderRadius:99, background:`${p.color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:13 }}>
                  {p.icon}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:p.color, marginBottom:2 }}>{p.title}</div>
                  <div style={{ fontSize:12, color:"var(--text-dim)", lineHeight:1.45 }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </FlipCard>
        </UpgradeGate>
      ),
    },
    // ── Workout Outcome Distribution · 30d ──
    {
      id: "workout-outcomes",
      node: (
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={ACCENT}
          back={
            <ThresholdBack
              title={tInsights("workout_outcomes_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("workout_outcomes_back_p1"),
                tInsights("workout_outcomes_back_p2"),
                workoutOutcomeEnough
                  ? tInsights("workout_outcomes_back_p3", { total: workoutTotal30, classified: workoutClassifiedTotal, range: rangeLabel })
                  : tInsights("workout_outcomes_back_p3_insufficient", { min: MIN_DATAPOINTS, range: rangeLabel }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_workout_outcomes_title", { range: rangeLabel })}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("card_workout_outcomes_sub")}</div>
          </div>
          {!workoutOutcomeEnough ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:4 }}>{tInsights("workout_outcomes_min_required", { min: MIN_DATAPOINTS, range: rangeLabel })}</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
                <div style={{ fontSize:36, fontWeight:800, color:"var(--text)", letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {workoutTotal30}
                </div>
                <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("workout_outcomes_total_30d", { range: rangeLabel })}</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {RANKED_OUTCOMES.map(oc => {
                  const n = workoutOutcomeCounts[oc];
                  const pct = workoutClassifiedTotal > 0 ? Math.round((n / workoutClassifiedTotal) * 100) : 0;
                  const color = OUTCOME_COLOR[oc];
                  const label = tInsights(`workout_outcome_label_${oc.toLowerCase()}`);
                  return (
                    <div key={oc} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:78, fontSize:12, color, fontWeight:700, letterSpacing:"0.02em" }}>{label}</div>
                      <div style={{ flex:1, position:"relative", height:6, borderRadius:99, background:"var(--surface-soft)", overflow:"hidden" }}>
                        <div style={{ width:`${pct}%`, height:"100%", background:color, opacity:0.85 }}/>
                      </div>
                      <div style={{ width:54, textAlign:"right", fontSize:12, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
                        {pct}% · {n}
                      </div>
                    </div>
                  );
                })}
                {workoutOutcomeCounts.PENDING > 0 && (
                  <div style={{ marginTop:2, fontSize:11, color:"var(--text-faint)" }}>
                    {tInsights("workout_outcomes_pending_suffix", { n: workoutOutcomeCounts.PENDING })}
                  </div>
                )}
              </div>
            </>
          )}
        </FlipCard>
      ),
    },
    // ── BG Response by Exercise Type · 30d ──
    {
      id: "workout-bg-response",
      node: (
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={ACCENT}
          back={
            <ThresholdBack
              title={tInsights("workout_bg_response_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("workout_bg_response_back_p1"),
                tInsights("workout_bg_response_back_p2"),
                bgResponseEnough
                  ? tInsights("workout_bg_response_back_p3", { n: bgResponseRows.length })
                  : tInsights("workout_bg_response_back_p3_insufficient"),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("workout_bg_response_label")}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("workout_bg_response_sub")}</div>
          </div>
          {!bgResponseEnough ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:4 }}>{tInsights("workout_bg_response_min_required", { min: MIN_DATAPOINTS })}</div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {bgResponseRows.map(row => {
                const positive = row.avgDelta > 0;
                const negative = row.avgDelta < 0;
                const color = negative ? GREEN : positive ? ORANGE : "var(--text-muted)";
                const sign = positive ? "+" : negative ? "−" : "±";
                return (
                  <div key={row.type} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:"var(--surface-soft)", border:"1px solid var(--border-soft)", borderRadius:10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", letterSpacing:"0.01em" }}>{row.label}</div>
                      <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:1 }}>{tInsights("workout_bg_response_session_count", { n: row.count })}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                      <div style={{ fontSize:18, fontWeight:800, color, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                        {sign}{Math.abs(row.avgDelta)}
                      </div>
                      <div style={{ fontSize:11, color:"var(--text-dim)", fontWeight:600 }}>mg/dL</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </FlipCard>
      ),
    },
    // ── Workout Patterns (auto-detected, hidden if < 2 patterns) ──
    {
      id: "workout-patterns",
      // Spec: "If fewer than 2 meaningful patterns found: hide this
      // section entirely". A null `node` is filtered out below before
      // it reaches SortableCardGrid.
      node: showWorkoutPatterns ? (
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={ACCENT}
          back={
            <ThresholdBack
              title={tInsights("workout_patterns_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("workout_patterns_back_p1"),
                tInsights("workout_patterns_back_p2"),
                tInsights("workout_patterns_back_p3", { patterns: workoutPatterns.length, evaluated: exerciseEvaluated.length, range: rangeLabel }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_workout_patterns_title")}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("card_workout_patterns_signal_count", { n: workoutPatterns.length })}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {workoutPatterns.map((p, i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"8px 10px", background:`${p.color}10`, border:`1px solid ${p.color}25`, borderRadius:10, alignItems:"flex-start" }}>
                <div style={{ width:22, height:22, borderRadius:99, background:`${p.color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:13, color:p.color, fontWeight:700 }}>
                  {p.icon}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:p.color, marginBottom:2 }}>{p.title}</div>
                  <div style={{ fontSize:12, color:"var(--text-dim)", lineHeight:1.45 }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </FlipCard>
      ) : null,
    },
    {
      id: "meal-type",
      node: (
        <UpgradeGate feature="meal_type_breakdown">
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={ORANGE}
          back={
            <FlipBack
              title={tInsights("meal_type_back_title")}
              accent={ORANGE}
              paragraphs={[
                tInsights("meal_type_back_p1"),
                tInsights("meal_type_back_p2"),
                tInsights("meal_type_back_p3"),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text={tInsights("card_meal_type_title")}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("card_meal_type_sub")}</div>
          </div>
          {/* `minmax(0,1fr)` (statt nacktem `1fr`) zwingt beide Spalten
              auf exakt 50% — sonst pusht ein langes deutsches Label
              wie "SCHNELLE KOHLENHYDRATE" die linke Spalte breiter und
              die rechte Karte rutscht über den Kartenrand hinaus. Mit
              minmax(0,…) greift auch das `text-overflow: ellipsis` des
              Labels. */}
          <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:6 }}>
            {TYPE_ORDER.map(type => {
              const data = types[type];
              const has = data.count > 0;
              const successPct = has ? Math.round(data.good/data.count*100) : 0;
              const avgC = has ? Math.round(data.totalCarbs/data.count) : 0;
              const avgI = has ? (data.totalInsulin/data.count).toFixed(1) : "0.0";
              const col  = TYPE_COLORS[type];
              const barCol = !has ? "var(--border-strong)" : successPct>=70?GREEN:successPct>=50?ORANGE:PINK;
              return (
                <div key={type} style={{ background:`${col}08`, border:`1px solid ${col}20`, borderRadius:10, padding:"8px 10px", opacity: has ? 1 : 0.55 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, gap:4 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:col, letterSpacing:"0.06em", textTransform:"uppercase", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{chipLabels.typeLabel(type)}</div>
                    <div style={{ fontSize:13, fontWeight:700, color:has?barCol:"var(--text-faint)", fontFamily:"var(--font-mono)" }}>
                      {has ? `${successPct}%` : "—"}
                    </div>
                  </div>
                  <div style={{ height:4, borderRadius:99, background:"var(--surface-soft)", overflow:"hidden", marginBottom:6 }}>
                    <div style={{ height:"100%", width:`${successPct}%`, background:barCol, borderRadius:99 }}/>
                  </div>
                  <div style={{ fontSize:11, color:"var(--text-dim)", lineHeight:1.4 }}>
                    {has
                      ? tInsights("meal_type_card_summary", { n: data.count, carbs: carbUnit.display(avgC), insulin: avgI })
                      : tInsights("meal_type_card_no_data")}
                  </div>
                </div>
              );
            })}
          </div>
        </FlipCard>
        </UpgradeGate>
      ),
    },
    {
      id: "time-of-day",
      node: (
        <FlipCard
          minHeight={CARD_MIN_H}
          accent={GREEN}
          back={
            <FlipBack
              title={tInsights("time_of_day_back_title")}
              accent={GREEN}
              paragraphs={[
                tInsights("time_of_day_back_p1"),
                tInsights("time_of_day_back_p2"),
                tInsights("time_of_day_back_p3"),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text={tInsights("card_time_of_day_title")}/>
            <div style={{ fontSize:11, color:"var(--text-dim)" }}>{tInsights("card_time_of_day_sub")}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {Object.entries(timeGroups).map(([label, data]) => {
              const has = data.count > 0;
              const pct = has ? Math.round(data.good/data.count*100) : 0;
              const col = !has ? "var(--border-strong)" : pct>=70?GREEN:pct>=50?ORANGE:PINK;
              const i18nKey =
                label === "Morning (5–11)"    ? "time_of_day_morning"   :
                label === "Afternoon (11–17)" ? "time_of_day_afternoon" :
                label === "Evening (17–21)"   ? "time_of_day_evening"   :
                                                "time_of_day_night";
              return (
                <div key={label} style={{ display:"grid", gridTemplateColumns:"110px 1fr 32px 32px", gap:8, alignItems:"center" }}>
                  <div style={{ fontSize:12, color:"var(--text-muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{tInsights(i18nKey)}</div>
                  <div style={{ height:6, borderRadius:99, background:"var(--surface-soft)", overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:99 }}/>
                  </div>
                  <div style={{ fontSize:12, fontWeight:700, color: has?col:"var(--text-faint)", textAlign:"right", fontFamily:"var(--font-mono)" }}>{has?`${pct}%`:"—"}</div>
                  <div style={{ fontSize:11, color:"var(--text-faint)", textAlign:"right" }}>{data.count}</div>
                </div>
              );
            })}
          </div>
        </FlipCard>
      ),
    },
    // ── Cycle & Symptoms snapshot — last 30d aggregate ──
    // Pure documentation surface: counts bleeding days from menstrual_logs
    // (clamped to a 30d window so an open-ended row doesn't dominate) and
    // ranks the user's three most-frequent symptoms with avg severity.
    // Hidden when there's no data so users without cycle/symptom logging
    // don't see an empty placeholder.
    (() => {
      // Window: follows the global scope picker (Task #332) instead of a
      // fixed 30 days, so the Cycle & Symptoms card stays coherent when
      // the user switches between Heute/7T/30T/12M.
      const windowStartMs = wkAgo;
      const windowEndMs = now;
      const windowStartDay = new Date(windowStartMs);
      const ws = windowStartDay.toISOString().slice(0, 10);

      // Bleeding days = sum of (end_date ?? window_end) - max(start_date, window_start)
      // for each row that has a flow_intensity, capped to the window end.
      const todayStr = new Date(windowEndMs - 1).toISOString().slice(0, 10);
      let bleedingDays = 0;
      const phaseCounts: Record<string, number> = {};
      for (const r of menstrualLogs) {
        if (r.start_date < ws && (r.end_date ?? r.start_date) < ws) continue;
        if (r.flow_intensity) {
          const s = r.start_date < ws ? ws : r.start_date;
          const eRaw = r.end_date ?? r.start_date;
          const e = eRaw > todayStr ? todayStr : eRaw;
          const sMs = new Date(`${s}T00:00:00`).getTime();
          const eMs = new Date(`${e}T00:00:00`).getTime();
          if (eMs >= sMs) bleedingDays += Math.round((eMs - sMs) / 86400000) + 1;
        }
        // Prefer the refactored 4-phase enum; fall back to the legacy
        // phase_marker so pre-refactor rows still contribute counts.
        // The labels above bucket either key the same way because both
        // share the `cycle_phase_<token>` i18n namespace (legacy 'pms'
        // and 'other' tokens still resolve via the deprecated keys).
        const phaseKey = r.cycle_phase ?? r.phase_marker;
        if (phaseKey) {
          phaseCounts[phaseKey] = (phaseCounts[phaseKey] || 0) + 1;
        }
      }

      // Symptom ranking: count occurrences and track running severity sum.
      const symStats: Record<string, { count: number; sevSum: number }> = {};
      let totalSymptomEntries = 0;
      for (const s of symptomLogs) {
        const occ = new Date(s.occurred_at).getTime();
        if (occ < windowStartMs || occ >= windowEndMs) continue;
        totalSymptomEntries += 1;
        for (const sym of s.symptom_types || []) {
          const cur = symStats[sym] ||= { count: 0, sevSum: 0 };
          cur.count += 1;
          // Per-symptom severity from the severities map. Fall back to
          // the row average when a legacy / mis-keyed entry is missing
          // its per-symptom value so we still produce a sensible avg.
          const perSym = (s.severities ?? {})[sym];
          if (typeof perSym === "number") {
            cur.sevSum += perSym;
          } else {
            const fallbackVals: number[] = [];
            for (const v of Object.values(s.severities ?? {})) {
              if (typeof v === "number") fallbackVals.push(v);
            }
            const fallback = fallbackVals.length > 0
              ? fallbackVals.reduce((a, b) => a + b, 0) / fallbackVals.length
              : 3;
            cur.sevSum += fallback;
          }
        }
      }
      const topSymptoms = Object.entries(symStats)
        .map(([k, v]) => ({ key: k as SymptomType, count: v.count, avgSev: v.sevSum / v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // The entire card is only shown for users who can menstruate.
      // Male users have no clinical use for cycle OR symptom context here
      // — symptom logging without cycle correlation adds no insight.
      // Null/unset sex (legacy onboarding) defaults to visible so no data is lost.
      if (sex === "male") return { id: "cycle-symptoms", node: null };

      const showCycle = cycleSurfacesAvailable(sex);
      const hasAny = showCycle
        ? (bleedingDays > 0 || Object.keys(phaseCounts).length > 0 || totalSymptomEntries > 0)
        : totalSymptomEntries > 0;
      if (!hasAny) return { id: "cycle-symptoms", node: null };

      return {
        id: "cycle-symptoms",
        node: (
          <FlipCard
            minHeight={CARD_MIN_H}
            accent={PINK}
            back={
              <FlipBack
                title={tInsights("cycle_symptoms_back_title")}
                accent={PINK}
                paragraphs={[
                  tInsights("cycle_symptoms_back_p1", { range: rangeLabel }),
                  tInsights("cycle_symptoms_back_p2"),
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text={tInsights(showCycle ? "card_cycle_symptoms_title" : "card_symptoms_only_title")}/>
              <div style={{ fontSize:11, color:"var(--text-dim)" }}>
                {tInsights("card_cycle_symptoms_window", { range: rangeLabel })}
              </div>
            </div>

            <div style={{
              display:"grid",
              // Male users hide the cycle tile entirely, so the symptom
              // tile spans the full card width instead of leaving a gap.
              gridTemplateColumns: showCycle ? "1fr 1fr" : "1fr",
              gap:8, marginBottom:10,
            }}>
              {showCycle && (
                <div style={{ background:`${PINK}10`, border:`1px solid ${PINK}24`, borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.06em", fontWeight:700, textTransform:"uppercase" }}>
                    {tInsights("cycle_bleeding_days_label")}
                  </div>
                  <div style={{ fontSize:22, fontWeight:800, color:PINK, fontFamily:"var(--font-mono)", lineHeight:1.1, marginTop:4 }}>
                    {bleedingDays}
                  </div>
                  {Object.keys(phaseCounts).length > 0 && (
                    <div style={{ fontSize:12, color:"var(--text-dim)", marginTop:6, lineHeight:1.4 }}>
                      {Object.entries(phaseCounts).map(([k, n]) => `${tInsights(`cycle_phase_${k}` as never)} ×${n}`).join(" · ")}
                    </div>
                  )}
                </div>
              )}
              <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.06em", fontWeight:700, textTransform:"uppercase" }}>
                  {tInsights("symptom_entries_label")}
                </div>
                <div style={{ fontSize:22, fontWeight:800, color:"var(--text-strong)", fontFamily:"var(--font-mono)", lineHeight:1.1, marginTop:4 }}>
                  {totalSymptomEntries}
                </div>
                <div style={{ fontSize:12, color:"var(--text-dim)", marginTop:6 }}>
                  {tInsights("symptom_entries_sub")}
                </div>
              </div>
            </div>

            {topSymptoms.length > 0 ? (
              <div>
                <div style={{ fontSize:12, color:"var(--text-dim)", fontWeight:700, marginBottom:6, letterSpacing:"0.04em" }}>
                  {tInsights("symptom_top_label")}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {topSymptoms.map(s => (
                    <div key={s.key} style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:8, alignItems:"center", padding:"6px 10px", background:"var(--surface-soft)", borderRadius:8 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>
                        {tInsights(`symptom_${s.key}` as never)}
                      </div>
                      <div style={{ fontSize:12, color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>
                        ×{s.count}
                      </div>
                      <div style={{ display:"flex", gap:2 }} aria-label={`avg ${s.avgSev.toFixed(1)} of 5`}>
                        {[1,2,3,4,5].map(n => (
                          <span key={n} style={{
                            width:5, height:5, borderRadius:99,
                            background: n <= Math.round(s.avgSev) ? "#A78BFA" : "var(--border-strong)",
                          }}/>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize:13, color:"var(--text-faint)", fontStyle:"italic" }}>
                {tInsights("symptom_top_empty", { range: rangeLabel })}
              </div>
            )}
          </FlipCard>
        ),
      };
    })(),
    {
      id: "performance-tiles",
      node: (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, minHeight: CARD_MIN_H }}>
          {[
            // Raw ICR moved to slot 0 (top-left) so it sits visually adjacent
            // to the Adaptive Engine hero card directly above the grid —
            // grouping both ICR-related views into one cluster. Color switched
            // from ORANGE to ACCENT_SOFT (lighter sibling of the Adaptive
            // Engine's ACCENT) to signal "same metric family, lower hierarchy".
            // Color rules (page-wide, see Lucas' brief):
            //   GREEN  → in-target metrics  (TIR, Trefferquote, Ø Glukose im Ziel)
            //   text   → neutral data points (HbA1c/GMI, Ø Glukose vor Essen, Ø Insulin)
            //   #A78BFA → raw / uncorrected   (Roher KH-Faktor)
            { label:tInsights("tile_raw_icr_label"),      val:`1:${estICR}`,   sub:tInsights("tile_raw_icr_sub"), color:"#A78BFA",
              formula:tInsights("tile_raw_icr_formula"),   explain:tInsights("tile_raw_icr_explain"),
              infoBack: (
                <IcrInfoBack
                  heading={tInsights("raw_icr_info_heading")}
                  accent="#A78BFA"
                  body={tInsights("raw_icr_info_body")}
                  subLine={tInsights("raw_icr_info_subline")}
                />
              ),
            },
            { label:tInsights("tile_avg_glucose_label"),  val:`${avgGlucose}`, sub:tInsights("tile_avg_glucose_sub"),           color:"var(--text)",
              formula:tInsights("tile_avg_glucose_formula"),      explain:tInsights("tile_avg_glucose_explain") },
            // Good rate (Trefferquote) — in-target metric → GREEN.
            { label:tInsights("tile_good_rate_label"),    val:`${goodRate.toFixed(1)}%`,  sub:tInsights("tile_good_rate_sub", { good: goodAll, total: evaluatedCount }),   color:GREEN,
              formula:tInsights("tile_good_rate_formula"),            explain:tInsights("tile_good_rate_explain") },
            { label:tInsights("tile_avg_insulin_label"),  val:`${avgInsulin}u`, sub:tInsights("tile_avg_insulin_sub", { carbs: carbUnit.display(avgCarbs) }), color:"var(--text)",
              formula:tInsights("tile_avg_insulin_formula"),               explain:tInsights("tile_avg_insulin_explain") },
          ].map((t,i) => <InsightFlipTile key={i} tile={t}/>)}
        </div>
      ),
    },
    // ── Daily Steps (Task #183) — hidden when no Apple-Health rows ──
    (() => {
      const ctx = activity.context;
      const rows = activity.rows;
      const visible = rows.length > 0;
      const todayDisplay =
        ctx.todaySteps != null ? ctx.todaySteps.toLocaleString(locale) : "—";
      const avgDisplay =
        ctx.avgSteps7d != null ? ctx.avgSteps7d.toLocaleString(locale) : "—";
      const deltaPct =
        ctx.todaySteps != null && ctx.avgSteps7d != null && ctx.avgSteps7d > 0
          ? Math.round(((ctx.todaySteps - ctx.avgSteps7d) / ctx.avgSteps7d) * 100)
          : null;
      const deltaColor =
        deltaPct == null ? "var(--text-dim)" :
        deltaPct >= 30 ? GREEN :
        deltaPct <= -30 ? ORANGE : "var(--text-dim)";
      // Mini-sparkline: last 7 days, oldest left → newest right.
      const last7 = rows.slice(0, 7).slice().reverse();
      const maxSteps = Math.max(1, ...last7.map(r => r.steps));
      return {
        id: "daily-steps",
        node: visible ? (
          <FlipCard
            minHeight={CARD_MIN_H}
            accent={ACCENT}
            back={
              <FlipBack
                title={tInsights("daily_steps_back_title")}
                accent={ACCENT}
                paragraphs={[
                  tInsights("daily_steps_back_p1"),
                  tInsights("daily_steps_back_p2"),
                  tInsights("daily_steps_back_p3"),
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text={tInsights("card_daily_steps_title")}/>
              <div style={{ fontSize:11, color:"var(--text-dim)" }}>
                {tInsights("card_daily_steps_source")}
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:8, marginBottom:10 }}>
              <div style={{ padding:"10px 12px", background:`${ACCENT}10`, border:`1px solid ${ACCENT}25`, borderRadius:10 }}>
                <div style={{ fontSize:11, color:"var(--text-dim)", fontWeight:600, marginBottom:4 }}>
                  {tInsights("card_daily_steps_today")}
                </div>
                <div style={{ fontSize:20, fontWeight:800, fontFamily:"var(--font-mono)", color:"var(--text)", lineHeight:1 }}>
                  {todayDisplay}
                </div>
              </div>
              <div style={{ padding:"10px 12px", background:"var(--surface-2)", border:`1px solid ${BORDER}`, borderRadius:10 }}>
                <div style={{ fontSize:11, color:"var(--text-dim)", fontWeight:600, marginBottom:4 }}>
                  {tInsights("card_daily_steps_avg7d")}
                </div>
                <div style={{ fontSize:20, fontWeight:800, fontFamily:"var(--font-mono)", color:"var(--text)", lineHeight:1 }}>
                  {avgDisplay}
                </div>
                {deltaPct != null && (
                  <div style={{ fontSize:11, color:deltaColor, fontWeight:600, marginTop:4 }}>
                    {deltaPct >= 0 ? "+" : ""}{deltaPct}%
                  </div>
                )}
              </div>
            </div>
            {last7.length > 0 && (
              <div style={{ display:"flex", alignItems:"flex-end", gap:4, height:36 }}>
                {last7.map((r, i) => {
                  const h = Math.max(2, Math.round((r.steps / maxSteps) * 34));
                  return (
                    <div
                      key={i}
                      title={`${r.date}: ${r.steps.toLocaleString(locale)}`}
                      style={{
                        flex:1,
                        height:h,
                        background:ACCENT,
                        opacity:0.55 + 0.45 * (r.steps / maxSteps),
                        borderRadius:3,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </FlipCard>
        ) : null,
      };
    })(),
    // ── Active-day outcomes (Task #336) ──
    // Compares meal evaluation distribution on the user's most active
    // days (≥ 1.3 × median daily steps) vs typical days. Requires at
    // least 14 days of step data AND at least MIN_DATAPOINTS classified
    // meals on EACH side — otherwise the comparison would be noise.
    // Compliance-safe: pure observation, no dose advice.
    (() => {
      const stepRows = activity.rows;
      if (stepRows.length < 14) return { id: "active-day-outcomes", node: null };

      // Build a per-day step lookup. We only consider days that the
      // iOS shell actually reported, so an idle day without a row is
      // not silently treated as "0 steps".
      const stepsByDay = new Map<string, number>();
      for (const r of stepRows) stepsByDay.set(r.date, r.steps);

      // Median across the reported window — robust to one big outlier
      // day. Threshold mirrors the existing daily-steps card's "+30%
      // vs baseline → high" colour rule.
      const stepValues = stepRows.map(r => r.steps).sort((a, b) => a - b);
      const mid = Math.floor(stepValues.length / 2);
      const medianSteps = stepValues.length % 2 === 0
        ? Math.round((stepValues[mid - 1] + stepValues[mid]) / 2)
        : stepValues[mid];
      const HIGH_FACTOR = 1.3;
      const highThreshold = Math.round(medianSteps * HIGH_FACTOR);

      // Match each in-pool meal to its local-day step count. Meals on
      // days without a step row are excluded (we have no signal to
      // group them).
      const dateIso = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const buckets = {
        active: { good: 0, spike: 0, hypo: 0 },
        typical: { good: 0, spike: 0, hypo: 0 },
      };
      for (const m of meals) {
        const iso = dateIso(parseDbDate(m.created_at));
        const steps = stepsByDay.get(iso);
        if (steps == null) continue;
        const ev = EVAL_NORM(unifiedOutcome(m));
        if (!ev) continue;
        const slot = steps >= highThreshold ? buckets.active : buckets.typical;
        if (ev === "GOOD") slot.good++;
        else if (ev === "SPIKE") slot.spike++;
        else if (ev === "HYPO") slot.hypo++;
      }
      const activeN = buckets.active.good + buckets.active.spike + buckets.active.hypo;
      const typicalN = buckets.typical.good + buckets.typical.spike + buckets.typical.hypo;
      if (activeN < MIN_DATAPOINTS || typicalN < MIN_DATAPOINTS) {
        return { id: "active-day-outcomes", node: null };
      }

      const pct = (num: number, denom: number) =>
        denom > 0 ? Math.round((num / denom) * 100) : 0;
      const activeGoodPct  = pct(buckets.active.good,  activeN);
      const typicalGoodPct = pct(buckets.typical.good, typicalN);
      const goodDelta = activeGoodPct - typicalGoodPct;
      // Signed share of meals that ran "low risk" (over-dosed) on
      // active days vs typical — the most actionable signal.
      const activeHypoPct  = pct(buckets.active.hypo,  activeN);
      const typicalHypoPct = pct(buckets.typical.hypo, typicalN);
      const hypoDelta = activeHypoPct - typicalHypoPct;

      const rowsFor = (b: { good: number; spike: number; hypo: number }, n: number) => [
        { label: tInsights("eval_label_on_target"), count: b.good,  color: GREEN,  pct: pct(b.good,  n) },
        { label: tInsights("eval_label_spiked"),    count: b.spike, color: ORANGE, pct: pct(b.spike, n) },
        { label: tInsights("eval_label_low_risk"),  count: b.hypo,  color: PINK,   pct: pct(b.hypo,  n) },
      ];

      const headline =
        Math.abs(goodDelta) < 5
          ? tInsights("active_day_outcomes_headline_flat", {
              active: activeGoodPct, typical: typicalGoodPct,
            })
          : goodDelta > 0
            ? tInsights("active_day_outcomes_headline_better", {
                delta: Math.abs(goodDelta), active: activeGoodPct, typical: typicalGoodPct,
              })
            : tInsights("active_day_outcomes_headline_worse", {
                delta: Math.abs(goodDelta), active: activeGoodPct, typical: typicalGoodPct,
              });

      const hypoNote =
        Math.abs(hypoDelta) >= 10
          ? (hypoDelta > 0
              ? tInsights("active_day_outcomes_hypo_more", { delta: Math.abs(hypoDelta) })
              : tInsights("active_day_outcomes_hypo_less", { delta: Math.abs(hypoDelta) }))
          : null;

      const renderGroup = (
        title: string,
        sub: string,
        b: { good: number; spike: number; hypo: number },
        n: number,
      ) => (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
            <div style={{ fontSize:12, color:"var(--text)", fontWeight:700 }}>{title}</div>
            <div style={{ fontSize:11, color:"var(--text-faint)" }}>{sub}</div>
          </div>
          {rowsFor(b, n).map(r => (
            <div key={r.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:60, fontSize:11, color:r.color }}>{r.label}</div>
              <div style={{ flex:1, height:5, background:"var(--surface-soft)", borderRadius:99, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${r.pct}%`, background:r.color, borderRadius:99, transition:"width 0.3s" }}/>
              </div>
              <div style={{ width:30, textAlign:"right", fontSize:11, color:"var(--text)", fontFamily:"var(--font-mono)", fontWeight:600 }}>
                {r.pct}%
              </div>
            </div>
          ))}
        </div>
      );

      return {
        id: "active-day-outcomes",
        node: (
          <FlipCard
            minHeight={CARD_MIN_H}
            accent={GREEN}
            back={
              <FlipBack
                title={tInsights("active_day_outcomes_back_title")}
                accent={GREEN}
                paragraphs={[
                  tInsights("active_day_outcomes_back_p1"),
                  tInsights("active_day_outcomes_back_p2", { threshold: highThreshold.toLocaleString(locale) }),
                  tInsights("active_day_outcomes_back_p3"),
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text={tInsights("card_active_day_outcomes_title")}/>
              <div style={{ fontSize:11, color:"var(--text-dim)" }}>
                {tInsights("card_active_day_outcomes_threshold", {
                  threshold: highThreshold.toLocaleString(locale),
                })}
              </div>
            </div>
            <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.5, marginBottom:12 }}>
              {headline}
              {hypoNote && (
                <> <span style={{ color: hypoDelta > 0 ? PINK : GREEN }}>{hypoNote}</span></>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {renderGroup(
                tInsights("active_day_outcomes_active_label"),
                tInsights("active_day_outcomes_meal_count", { n: activeN }),
                buckets.active, activeN,
              )}
              {renderGroup(
                tInsights("active_day_outcomes_typical_label"),
                tInsights("active_day_outcomes_meal_count", { n: typicalN }),
                buckets.typical, typicalN,
              )}
            </div>
          </FlipCard>
        ),
      };
    })(),
  ];

  return (
    // 480px max-width keeps the cards in their natural mockup
    // proportions on tablet/desktop instead of stretching them out.
    <div style={{ maxWidth:480, margin:"0 auto" }}>
      {/* Persistent semantic heading for screen readers — keeps a
          stable `h1` landmark on the page even after the transient
          banner below unmounts. Visually hidden via the
          screen-reader-only style snippet, matches the title that the
          banner displays. */}
      <h1
        style={{
          position: "absolute",
          width: 1, height: 1, padding: 0, margin: -1,
          overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
        }}
      >
        Insights
      </h1>
      <RefreshingBar visible={primaryValidating} />
      {/* Transient header hint: shows the page title + interaction
          subtitle briefly on entry, then auto-dismisses on the user's
          first interaction (or after a backstop timeout) so the swipe
          pager can claim the vertical space below. Wrapped in its own
          component so the listener wiring stays scoped. */}
      <InsightsHeaderHint
        subtitle={tInsights("header_subtitle", { n: total })}
      />

      {/* Inline anchor stepper — pairs with the 4 mode chips in the
          mobile header (Day/Week/Month/Year). The chip group only
          switches mode; this row walks the user back/forward through
          periods (◀ Today ▶ / ◀ This Week ▶ / …) without any tap-to-
          open dropdown. 2026-05-18 user request. */}
      <ScopeAnchorStepper
        mode={scopeMode}
        anchor={scopeAnchor}
        onStep={stepScopeAnchor}
      />

      {/* Swipe-focused layout (Task #316). Replaces the legacy vertical
          SortableCardGrid feed: a single dominant card sits in the top
          ~58% of the visible area and the user pages horizontally; the
          bottom ~42% renders a context block tied to the active card. */}
      <InsightsSwipePager
        items={items.filter(it => it.node !== null)}
        dynamicById={(() => {
          // Per-card live data lines. These are computed from the same
          // in-scope aggregates the cards themselves use, so the context
          // panel always mirrors what the user is looking at on the
          // focused card — not just static copy. When a value isn't
          // meaningful for the active scope (e.g. CV% with too few
          // readings) we omit the line entirely.
          const dyn: Record<string, string | null> = {};
          if (b7.n >= MIN_DATAPOINTS) {
            const sign = tirDelta > 0 ? "+" : tirDelta < 0 ? "" : "±";
            dyn["time-in-range"] = tInsights("swipe_dyn_tir", { pct: b7.inR, delta: `${sign}${tirDelta}` });
          }
          if (last7Avg != null) {
            dyn["gmi-a1c"] = tInsights("swipe_dyn_gmi", {
              avg: Math.round(last7Avg),
              gmi: gmi != null ? gmi.toFixed(1) : "—",
            });
            dyn["glucose-trend"] = tInsights("swipe_dyn_trend", {
              avg: Math.round(last7Avg),
              delta: bgDelta != null ? (bgDelta > 0 ? `+${bgDelta}` : `${bgDelta}`) : "—",
            });
          }
          dyn["hypo-events"] = tInsights("swipe_dyn_hypo", {
            count: readings7.filter(r => r.v < HYPO_THRESHOLD_MGDL).length,
          });
          dyn["hyper-events"] = tInsights("swipe_dyn_hyper", { count: hyperCount7d });
          if (cvPct != null) {
            dyn["glucose-variability"] = tInsights("swipe_dyn_cv", { cv: cvPct.toFixed(1) });
          }
          if (total > 0) {
            dyn["meal-evaluation"] = tInsights("swipe_dyn_meal_eval", {
              good: goodAll, total, rate: goodRate.toFixed(0),
            });
            dyn["performance-tiles"] = tInsights("swipe_dyn_perf", {
              icr: estICR, rate: goodRate.toFixed(0),
            });
            dyn["meal-type"] = tInsights("swipe_dyn_meal_count", { n: total });
            dyn["time-of-day"] = tInsights("swipe_dyn_meal_count", { n: total });
          }
          if (adaptiveICR.global != null) {
            dyn["adaptive-engine"] = tInsights("swipe_dyn_engine", {
              engine: adaptiveICR.global.toFixed(1),
              user: userIcr,
              n: adaptiveICR.sampleSize,
            });
          }
          if (tddAvg7 != null) {
            dyn["tdd"] = tInsights("swipe_dyn_tdd", {
              tdd: tddAvg7.toFixed(1),
              bolus: tddAvg7Bolus != null ? tddAvg7Bolus.toFixed(1) : "—",
              basal: tddAvg7Basal != null ? tddAvg7Basal.toFixed(1) : "—",
            });
          }
          if (enginePattern.sampleSize > 0) {
            dyn["patterns"] = tInsights("swipe_dyn_pattern", {
              type: enginePattern.label,
              n: enginePattern.sampleSize,
            });
          }
          if (exerciseLogs.length > 0) {
            dyn["workout-outcomes"] = tInsights("swipe_dyn_workouts", { n: exerciseLogs.length });
            dyn["workout-bg-response"] = tInsights("swipe_dyn_workouts", { n: exerciseLogs.length });
            dyn["workout-patterns"] = tInsights("swipe_dyn_workouts", { n: exerciseLogs.length });
          }
          if (activity.context.todaySteps != null) {
            dyn["daily-steps"] = tInsights("swipe_dyn_daily_steps", {
              steps: activity.context.todaySteps.toLocaleString(locale),
            });
          }
          // Only surface the swipe-pager context line when the card
          // itself is actually rendering — `items` already encodes
          // the full gating (14+ step days AND ≥3 classified meals
          // on EACH side), so checking node !== null keeps the
          // dynamic line and the card in lock-step.
          if (items.find(it => it.id === "active-day-outcomes")?.node) {
            dyn["active-day-outcomes"] = tInsights("swipe_dyn_active_day_outcomes", {
              days: activity.rows.length,
            });
          }
          if (symptomLogs.length > 0 || menstrualLogs.length > 0) {
            dyn["cycle-symptoms"] = tInsights("swipe_dyn_cycle", {
              symptoms: symptomLogs.length, cycle: menstrualLogs.length,
            });
          }
          return dyn;
        })()}
        lastDataAtMs={(() => {
          // Newest timestamp across every data source feeding this page.
          // Renders as the "Stand: ..." footnote in the context block so
          // the user knows how fresh the numbers are.
          const timestamps: number[] = [];
          for (const m of meals) timestamps.push(parseDbTs(m.created_at));
          for (const l of insulinLogs) timestamps.push(parseDbTs(l.created_at));
          for (const l of exerciseLogs) timestamps.push(parseDbTs(l.created_at));
          for (const f of fingersticks) timestamps.push(parseDbTs(f.measured_at));
          return timestamps.length > 0 ? Math.max(...timestamps) : null;
        })()}
        locale={locale}
      />
    </div>
  );
}

/** Transient page-title banner for the Insights screen.
 *  Shows "Insights" + the interaction subtitle ("Tap any card to flip ·
 *  hold to reorder · N meals analyzed") briefly on mount, then fades
 *  itself out — and collapses out of the layout — on the user's first
 *  interaction anywhere in the document. A 4s backstop timer also
 *  dismisses it for users who just look without touching, so the swipe
 *  pager always ends up reclaiming the vertical space.
 *
 *  The banner uses `pointer-events: none` so it never absorbs the
 *  dismissing tap itself — the touch passes straight through to the
 *  card beneath. A single `pointerdown` listener covers touch + mouse
 *  + pen; we also listen on `keydown` so keyboard users can dismiss
 *  by typing/tab. All listeners are `once: true` and torn down in the
 *  effect cleanup. */
/* ScopeAnchorStepper — compact ◀ label ▶ row rendered at the top of
   the insights body. The mode (Day / Week / Month / Year) is picked
   from the inline chip group in the global header; this widget only
   walks the anchor forward/backward through periods. */
function ScopeAnchorStepper({
  mode, anchor, onStep,
}: {
  mode: import("@/lib/scopeHeaderContext").ScopeMode;
  anchor: Date;
  onStep: (dir: -1 | 1) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("scopeHeader");
  const scope = computeScopeWindow(mode, anchor);
  const nowMs = Date.now();
  const isCurrent = scope.endMs > nowMs && scope.startMs <= nowMs;
  const canNext = scope.endMs <= nowMs;

  const label = (() => {
    if (mode === "day") {
      const today = startOfToday().getTime();
      if (scope.startMs === today) return t("today");
      const yesterday = startOfDaysAgo(1).getTime();
      if (scope.startMs === yesterday) return t("yesterday");
      return new Intl.DateTimeFormat(locale, {
        day: "numeric", month: "short", timeZone: userTimezone,
      }).format(new Date(scope.startMs));
    }
    if (mode === "week") {
      if (isCurrent) return t("this_week");
      const start = new Date(scope.startMs);
      const end = new Date(scope.endMs - 86400000);
      const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: userTimezone });
      return `${fmt.format(start)}–${fmt.format(end)}`;
    }
    if (mode === "month") {
      return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: userTimezone })
        .format(new Date(scope.startMs));
    }
    return new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: userTimezone })
      .format(new Date(scope.startMs));
  })();

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 4px 10px",
    }}>
      <button
        type="button"
        onClick={() => onStep(-1)}
        aria-label={t("prev_aria")}
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: "transparent", border: "1px solid var(--border)",
          color: "var(--text-strong)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div style={{
        flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600,
        color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {label}
      </div>
      <button
        type="button"
        onClick={() => canNext && onStep(1)}
        disabled={!canNext}
        aria-label={t("next_aria")}
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: "transparent", border: "1px solid var(--border)",
          color: canNext ? "var(--text-strong)" : "var(--text-faint)",
          cursor: canNext ? "pointer" : "not-allowed",
          opacity: canNext ? 1 : 0.4,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  );
}

function InsightsHeaderHint({ subtitle }: { subtitle: string }) {
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState(true);

  // Wire the dismiss listeners. They only attach while the hint is
  // still open — once it's been dismissed we don't keep them around.
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    window.addEventListener("pointerdown", dismiss, { once: true });
    window.addEventListener("keydown",     dismiss, { once: true });
    // Backstop: even if the user never touches the screen, the hint
    // shouldn't linger forever and crowd the swipe pager. 4 seconds
    // is long enough to read "Tap any card to flip · hold to reorder
    // · N meals analyzed" comfortably.
    const auto = window.setTimeout(dismiss, 4000);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown",     dismiss);
      window.clearTimeout(auto);
    };
  }, [open]);

  // After the fade-out finishes, fully unmount so the banner reserves
  // no layout space at all. Matches the 400ms CSS transition below.
  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => setMounted(false), 450);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      aria-hidden={!open}
      style={{
        overflow: "hidden",
        maxHeight: open ? 80 : 0,
        opacity: open ? 1 : 0,
        marginBottom: open ? 18 : 0,
        transition: "max-height 400ms ease, opacity 400ms ease, margin-bottom 400ms ease",
        // Critical: the banner must NOT absorb the dismissing tap.
        // Pointer events pass through to the swipe pager underneath
        // so the user's first card-tap also flips that card.
        pointerEvents: "none",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
        Insights
      </h1>
      <p style={{ color: "var(--text-faint)", fontSize: 13 }}>{subtitle}</p>
    </div>
  );
}

/** Horizontal swipe pager + reactive context block.
 *  Replaces the previous vertical feed on the Insights screen.
 *
 *  - Top zone (~58%): horizontal scroll-snap container, one card per
 *    page. Each card sits in its own slot with generous padding so it
 *    reads as the single point of focus. Dense cards (e.g. Adaptive
 *    Engine) can still scroll vertically inside their slot — the
 *    outer page never scrolls.
 *  - Bottom zone (~42%): static surface that swaps title + body text
 *    based on which card is currently snapped. Inner-scrolls if needed.
 *  - A dot row between the two zones acts as the position indicator.
 *
 *  Active index is tracked from the scroll position (rounded by slot
 *  width) so the indicator and context follow the natural swipe motion. */
function InsightsSwipePager({
  items,
  dynamicById = {},
  lastDataAtMs = null,
  locale,
}: {
  items: { id: string; node: React.ReactNode }[];
  /** Per-card dynamic data line, derived from the same aggregates the
   *  cards themselves render. When a card has no entry, the context
   *  block falls back to title + body only. */
  dynamicById?: Record<string, string | null>;
  /** Timestamp of the newest data point feeding the page; shown as a
   *  "Stand: ..." footnote so the user can gauge data freshness. */
  lastDataAtMs?: number | null;
  /** Active locale — used to format the lastDataAt timestamp. */
  locale?: string;
}) {
  const tInsights = useTranslations("insights");
  const [active, setActive] = useState(0);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  // Per-card natural-height map (filled by ResizeObserver below). Used
  // to size the focus pager so the active card fits without inner
  // scroll — small cards get bumped up to MIN_CARD_H, FlipCard backs
  // grow the slot organically when expanded.
  const itemRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const [heights, setHeights] = useState<Record<number, number>>({});

  // Sizing budget for the adaptive focus pager. The active card's
  // measured height (plus slot padding) drives the scroller height
  // exactly — no minimum floor. The user explicitly asked that the
  // bottom edge of each card hug whatever sits below it (context
  // box / dots) instead of leaving blank space when a small KPI
  // tile is in focus, so we removed the previous 320px floor and
  // let short cards stay short. A FlipCard back that expands beyond
  // a viewport's worth simply lets the page scroll, matching the
  // earlier "expanded backs never scroll inside the card" rule.
  // Slot padding was 6px top + 6px bottom. Trimmed to 3+3 so the
  // bottom edge of a short KPI card hugs the cockpit indicator below
  // even tighter — part of Task #329's "sparse cards shouldn't sit in
  // an oversized slot" pass. ResizeObserver still drives pagerHeight
  // from the active card's natural height, so taller cards just grow
  // the slot as before.
  const SLOT_PAD_V = 6;
  // First-paint fallback — used only until the ResizeObserver lands
  // the first measurement. Small enough that any real card will
  // measure taller and replace it immediately; large enough that
  // the layout doesn't collapse to zero on initial mount.
  const FIRST_PAINT_H = 160;

  // Empty-state guard. Suppress dots/position counters and render a
  // dedicated card-shaped placeholder instead of "1 of 0".
  if (items.length === 0) {
    return (
      <div
        style={{
          minHeight: "calc(100dvh - 230px)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            flex: "0 1 58%",
            minHeight: 220,
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: 16,
            padding: "32px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: "var(--text-faint)",
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {tInsights("empty_state_min_meals")}
        </div>
        <div
          style={{
            flex: "1 1 42%",
            minHeight: 160,
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            borderRadius: 16,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-faint)",
            }}
          >
            {tInsights("swipe_context_label")}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
            {tInsights("swipe_default_title")}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            {tInsights("swipe_default_body")}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "right", lineHeight: 1.4 }}>
            {tInsights("page_medical_disclaimer")}
          </div>
        </div>
      </div>
    );
  }

  const updateActive = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / w)));
    setActive((prev) => {
      if (prev === idx) return prev;
      hapticSelection();
      return idx;
    });
  }, [items.length]);

  // See DashboardCluster.settleSnap for the rationale — same iOS
  // Safari / Android Chrome bug where mandatory snap occasionally
  // leaves the scroller mid-slide after a soft flick. We debounce
  // after the scroll stops, then snap to the nearest slide ourselves
  // when the browser failed to. Programmatic motions (settle + the
  // indicator's onSelect) all flow through one helper so they can't
  // race each other.
  const settleTimerRef = React.useRef<number | null>(null);
  const programmaticScrollRef = React.useRef(false);
  const programmaticReleaseTimerRef = React.useRef<number | null>(null);
  const scheduleProgrammaticRelease = React.useCallback(() => {
    if (programmaticReleaseTimerRef.current != null) {
      window.clearTimeout(programmaticReleaseTimerRef.current);
    }
    programmaticReleaseTimerRef.current = window.setTimeout(() => {
      programmaticReleaseTimerRef.current = null;
      programmaticScrollRef.current = false;
    }, 220);
  }, []);
  // 2026-05-18 iOS TestFlight UX: the "cards slowly snap in after
  // swipe" complaint traced back to two layered animations:
  //   1. After the user's flick decays, iOS' native snap settles
  //      within ~1px of the slot; our settleSnap then noticed the
  //      residual and replayed a *smooth* scroll over another ~300ms.
  //   2. The 220ms `height` transition on the pager re-animated on
  //      every active-card change.
  // Fix: settleSnap now uses instant ("auto") scroll — the user has
  // already perceived the swipe as complete, so re-animating it
  // feels like lag. Indicator taps still use smooth (long visible
  // jump). Debounce dropped from 140 → 70ms so the settle catches
  // the rest sooner on slower-decaying flicks.
  const programmaticScrollTo = React.useCallback((left: number, smooth = true) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    programmaticScrollRef.current = true;
    el.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
    scheduleProgrammaticRelease();
  }, [scheduleProgrammaticRelease]);
  const settleSnap = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const target = Math.round(el.scrollLeft / w) * w;
    if (Math.abs(el.scrollLeft - target) > 1) {
      // Instant snap — see comment above programmaticScrollTo.
      programmaticScrollTo(target, false);
    }
  }, [programmaticScrollTo]);

  const onScroll = React.useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateActive();
    });
    if (programmaticScrollRef.current) {
      scheduleProgrammaticRelease();
      return;
    }
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      settleSnap();
    }, 70);
  }, [updateActive, settleSnap, scheduleProgrammaticRelease]);

  // Realign on width change (orientation, container resize). Pins
  // scrollLeft back to `active * clientWidth` instantly so the user
  // never sees a partial slide after a resize.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0 || w === lastW) return;
      lastW = w;
      const target = active * w;
      if (Math.abs(el.scrollLeft - target) > 1) {
        programmaticScrollRef.current = true;
        el.scrollLeft = target;
        scheduleProgrammaticRelease();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, scheduleProgrammaticRelease]);

  React.useEffect(() => {
    return () => {
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
      if (programmaticReleaseTimerRef.current != null) window.clearTimeout(programmaticReleaseTimerRef.current);
    };
  }, []);

  // Clamp active when item count drops (e.g. workout-patterns disappears).
  useEffect(() => {
    if (active >= items.length && items.length > 0) setActive(items.length - 1);
  }, [active, items.length]);

  // Measure each card's natural height. Re-measures automatically when
  // a FlipCard expands its back (FlipCard renders a hidden ghost in
  // normal flow that drives parent height) or when underlying data
  // refreshes. The map key is the slot index; we keep stale entries
  // around so swiping between already-measured cards is jank-free.
  React.useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observers: ResizeObserver[] = [];
    itemRefs.current.slice(0, items.length).forEach((el, idx) => {
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const h = Math.ceil(e.contentRect.height);
          if (h <= 0) continue;
          setHeights((prev) => (prev[idx] === h ? prev : { ...prev, [idx]: h }));
        }
      });
      ro.observe(el);
      observers.push(ro);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, [items.length]);

  // Drop measurements for indices that no longer exist (item count
  // shrinks, e.g. workout-patterns card disappears). Keeps the state
  // map from growing unbounded across renders.
  useEffect(() => {
    setHeights((prev) => {
      const next: Record<number, number> = {};
      for (const k of Object.keys(prev)) {
        const i = Number(k);
        if (i < items.length) next[i] = prev[i];
      }
      return next;
    });
  }, [items.length]);

  // Pager height for the active card. Tracks the measured natural
  // height exactly (plus the slot's vertical padding) so the bottom
  // edge of the card sits flush against the context box below — no
  // 320px floor, no blank space when a short KPI card is in focus.
  // The first-paint fallback only applies until the first
  // measurement arrives.
  const activeMeasured = heights[active];
  const pagerHeight = activeMeasured != null
    ? activeMeasured + SLOT_PAD_V
    : FIRST_PAINT_H;

  // Translation helper — returns localized title/body for a given card
  // id, falling back to a generic "swipe to learn more" copy when the
  // id isn't in the catalogue (e.g. a future card added before its
  // context strings land).
  const ctxFor = (id: string | undefined) => {
    if (!id) return { title: tInsights("swipe_default_title"), body: tInsights("swipe_default_body") };
    const titleKey = `swipe_ctx_${id}_title`;
    const bodyKey  = `swipe_ctx_${id}_body`;
    let title: string;
    let body: string;
    try { title = tInsights(titleKey); } catch { title = tInsights("swipe_default_title"); }
    try { body  = tInsights(bodyKey);  } catch { body  = tInsights("swipe_default_body"); }
    // next-intl returns the key itself when missing — treat that as fallback too.
    if (title === titleKey) title = tInsights("swipe_default_title");
    if (body  === bodyKey)  body  = tInsights("swipe_default_body");
    return { title, body };
  };
  const activeCtx = ctxFor(items[active]?.id);

  // Adaptive wrapper: the surface tries to fit within one viewport
  // (~`100dvh - 230px` for header+nav+buffer) but grows beyond it
  // when a card is taller than the budget — e.g. an expanded FlipCard
  // back. Page-level scrolling kicks in only in that overflow case;
  // the *inside* of a card never scrolls, per user request.
  return (
    <div
      style={{
        minHeight: "calc(100dvh - 230px)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overscrollBehavior: "contain",
        touchAction: "pan-x pan-y",
      }}
    >
      {/* Focus pager — horizontal snap scroll. Height is driven by the
          active card's measured natural height (clamped to a minimum so
          tiny KPI cards still feel like the focal point), not a fixed
          flex ratio. */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          style={{
            height: pagerHeight,
            display: "flex",
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            overscrollBehaviorX: "contain",
            WebkitOverflowScrolling: "touch",
            // 2026-05-18: 220 → 120ms. The height re-animation kicked
            // in *after* the swipe settled and made the whole panel
            // feel like it was still moving long after the card had
            // landed. 120ms is short enough to feel snappy but long
            // enough to avoid a visible step when card heights differ.
            transition: "height 120ms ease",
          }}
        >
          {items.map((it, idx) => (
            <div
              key={it.id}
              data-card-id={it.id}
              style={{
                // border-box pins the slot's outer width to exactly
                // the scroller's clientWidth despite the inner 6px
                // horizontal padding — without this, default
                // content-box made each slot 12px wider than the
                // viewport, causing scroll-snap to land between
                // slides (the "stops halfway, shows 3 cards" bug the
                // user reported). Using "start" alignment is also more
                // reliable than "center" with mandatory snap on touch.
                boxSizing: "border-box",
                flex: "0 0 100%",
                width: "100%",
                scrollSnapAlign: "start",
                scrollSnapStop: "always",
                // 2026-05-17 UX: bump horizontal slot padding from
                // 6 → 14 so adjacent cards have a clearly visible
                // gap (~28px) during swipe transitions and don't
                // look glued together. Matches the dashboard
                // ClusterFrame slot padding so the swipe behaviour
                // feels identical across screens.
                padding: "6px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <div
                ref={(el) => { itemRefs.current[idx] = el; }}
                style={{ width: "100%" }}
              >
                {it.node}
              </div>
            </div>
          ))}
        </div>

        {/* Cockpit position indicator (Task #329). Replaces the
            generic dot/segment row with a branded readout: zero-padded
            position counter on the left ("04 / 15", mono font, ACCENT
            on the current value, dim on the total), thin segment
            progress bar filling the remaining width. Tap any segment
            to navigate; role=tablist and aria-selected are preserved
            so screen readers / keyboards keep working. We picked the
            counter + bar over a scrollable label rail because it
            scales gracefully to 15+ cards without horizontal scrolling
            inside the indicator itself. */}
        <InsightsCockpitIndicator
          total={items.length}
          active={active}
          onSelect={(i) => {
            const el = scrollerRef.current;
            if (!el) return;
            // Route through the shared programmatic helper so the
            // settle timer can't race with the indicator's smooth
            // scroll.
            programmaticScrollTo(i * el.clientWidth);
          }}
          label={tInsights("swipe_context_label")}
          labelForIndex={(i, total) =>
            tInsights("swipe_position", { current: i + 1, total })
          }
        />
      </div>

      {/* Context zone — reacts to the active card. Grows with its own
          content; takes whatever vertical space is left after the
          focus pager. No inner scroll. */}
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 180,
          background: "var(--surface)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-faint)",
          }}
        >
          {tInsights("swipe_context_label")}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
          {activeCtx.title}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
          {activeCtx.body}
        </div>
        {/* Dynamic, card-specific data line. Pulled from the same
            aggregates the focused card itself renders — so the context
            mirrors live values (TIR%, GMI, CV, TDD, etc.) instead of
            being a static blurb. Skipped silently when no entry is
            available for the active card. */}
        {(() => {
          const activeId = items[active]?.id;
          const dyn = activeId ? dynamicById[activeId] : null;
          if (!dyn) return null;
          return (
            <div
              style={{
                marginTop: 4,
                padding: "8px 10px",
                borderRadius: 10,
                background: "var(--surface-2, rgba(127,127,127,0.08))",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text)",
                lineHeight: 1.5,
              }}
            >
              {dyn}
            </div>
          );
        })()}
        <div style={{ flex: 1 }} />
        {/* Data-freshness footnote — shows the newest timestamp across
            meals, insulin, exercise and fingerstick sources so the
            user can gauge how current the context numbers really are. */}
        {lastDataAtMs != null && (
          <div style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.4 }}>
            {tInsights("swipe_data_through", {
              ts: new Intl.DateTimeFormat(locale || "de", {
                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
              }).format(new Date(lastDataAtMs)),
            })}
          </div>
        )}
        {/* Footer disclaimer only — the position counter moved up into
            the cockpit indicator (Task #329) so the bottom of the
            context block can be devoted entirely to the medical
            disclaimer instead of repeating "N of M". */}
        <div
          style={{
            paddingTop: 8,
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          <span style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "right", lineHeight: 1.4, display: "block" }}>
            {tInsights("page_medical_disclaimer")}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Cockpit-branded position indicator for the Insights swipe pager
 * (Task #329). Two parts laid out on a single thin row:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ 04 / 15   ▔▔▔▔▔▔██▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
 *   └──────────────────────────────────────────────────────┘
 *   • Left:  zero-padded "NN / Total" counter in JetBrains Mono,
 *            current value tinted ACCENT (brand blue), divider &
 *            total in --text-faint so the active number reads first.
 *   • Right: thin segmented track with a single sliding fill (also
 *            ACCENT) — animates between segments instead of redrawing
 *            so 15+ cards still feel calm. Invisible tap targets
 *            stretched across the track (full segment width × ~18px)
 *            preserve tap-navigation on touch; role=tablist with
 *            aria-selected/aria-label keeps screen-reader & keyboard
 *            access on par with the previous shared PagerIndicator.
 */
function InsightsCockpitIndicator({
  total,
  active,
  onSelect,
  label,
  labelForIndex,
}: {
  total: number;
  active: number;
  onSelect: (index: number) => void;
  label?: string;
  labelForIndex?: (index: number, total: number) => string;
}) {
  if (total <= 1) return null;
  const segPct = 100 / total;
  // Zero-pad to the width of `total` so the counter never jitters
  // between 1- and 2-digit positions (e.g. "9/15" → " 9/15"). For
  // >=10 we keep both numbers 2-digit; >=100 would scale up but
  // we never approach that with insight cards.
  const pad = String(total).length;
  const cur = String(active + 1).padStart(pad, "0");
  const tot = String(total).padStart(pad, "0");
  return (
    <div
      role="tablist"
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 6,
        marginBottom: 2,
        padding: "0 4px",
      }}
    >
      {/* Focus-ring style for the keyboard-visible state. Inline style
          can't express :focus-visible, so we ship a small scoped block. */}
      <style>{`
        .insights-cockpit-tab:focus { outline: none; }
        .insights-cockpit-tab:focus-visible {
          outline: 2px solid var(--text);
          outline-offset: 3px;
          border-radius: 4px;
        }
      `}</style>
      <div
        aria-hidden
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "var(--text-faint)",
          display: "inline-flex",
          alignItems: "baseline",
          gap: 2,
          minWidth: pad * 2 + 6,
          flexShrink: 0,
        }}
      >
        <span style={{ color: ACCENT }}>{cur}</span>
        <span>/</span>
        <span>{tot}</span>
      </div>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: 2,
          background: "var(--border-soft)",
          borderRadius: 99,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${segPct}%`,
            background: ACCENT,
            borderRadius: 99,
            transform: `translateX(${active * 100}%)`,
            transition: "transform 240ms cubic-bezier(.2,.7,.2,1)",
            boxShadow: `0 0 6px ${ACCENT}88`,
          }}
        />
        {/* Invisible tap targets — full-segment-wide × ~18px tall
            hit area so touch input is comfortable without bulking
            the visible track. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: -8,
            bottom: -8,
            display: "flex",
          }}
        >
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={
                labelForIndex
                  ? labelForIndex(i, total)
                  : `${i + 1} / ${total}`
              }
              onClick={() => onSelect(i)}
              className="insights-cockpit-tab"
              style={{
                appearance: "none",
                background: "transparent",
                border: 0,
                padding: 0,
                margin: 0,
                flex: 1,
                cursor: "pointer",
                height: "100%",
                color: "inherit",
                font: "inherit",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}


/** Wrapper so we don't re-instantiate useCardOrder on every parent render. */
/**
 * Tappable replacement for the engine ICR source-breakdown line.
 *
 * When the user has any time-window pairs, the line becomes clickable
 * and reveals an inline panel listing each ±30-min pair with a
 * "Bestätigen" button. Confirming sends a PATCH to /api/insulin/[id]
 * to set `related_entry_id`, which upgrades that meal from
 * "zeitnah gepaart" to "explizit getaggt" on the very next render
 * (the parent `onLinked` callback patches the local state so the
 * counts update without a full refetch). Task #211.
 */
function RelinkSourceLine({
  adaptiveICR,
  engineMeals,
  engineBoluses,
  onLinked,
  open,
  onToggle,
}: {
  adaptiveICR: ReturnType<typeof computeAdaptiveICR>;
  engineMeals: Meal[];
  engineBoluses: InsulinLog[];
  onLinked: (bolusId: string, mealId: string) => void;
  /** Controlled — must be lifted to the InsightsPage level. See the
   *  note next to `relinkOpen` useState for why local state breaks
   *  the FlipCard ghost-mirror layout. */
  open: boolean;
  onToggle: (next: boolean) => void;
}) {
  const tInsights = useTranslations("insights");
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    onToggle(typeof next === "function" ? next(open) : next);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  // "Nein, war anders" persists to the `rejected_pairs` table (added
  // 2026-05-15) keyed on (meal_id, bolus_id) so a dismissal sticks
  // across reloads. We hold the set in component state and seed it
  // from `fetchRejectedPairs` on mount; new rejections are written
  // optimistically (UI hides immediately) and rolled back on error
  // so the user can retry. Keying on the pair (not just bolus_id)
  // lets the same bolus still be suggested for a different meal in
  // the ±30-min window — only the rejected combination is poisoned.
  const [rejectedPairs, setRejectedPairs] = useState<Set<RejectedPairKey>>(new Set());
  useEffect(() => {
    fetchRejectedPairs().then(setRejectedPairs).catch(() => {});
  }, []);

  // Recompute the time-window pairs from the same primitives the
  // engine uses, then keep only the ones whose pairing came from the
  // heuristic (explicit ones don't need the user's attention).
  const allPairs = pairBolusesToMeals(engineBoluses, engineMeals);
  const timeWindowPairs = allPairs
    .filter(p => p.source === "time-window")
    .filter(p => !rejectedPairs.has(pairKey(p.meal.id, p.bolus.id)));
  const hasTimeWindow = timeWindowPairs.length > 0;
  const mealColumn = Math.max(0, adaptiveICR.sampleSize - adaptiveICR.pairedCount);

  return (
    // The whole block sits inside a FlipCard whose outer div toggles
    // rotateY on click + Enter/Space. Without stopping propagation here
    // every tap on "Review matches", every confirm-button click, and
    // every key press inside the panel would also flip the card. Swallow
    // both event types at the wrapper so the entire interactive subtree
    // is shielded.
    <div
      style={{ marginTop: -4, marginBottom: 10 }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => hasTimeWindow && setOpen(o => !o)}
        title={tInsights("engine_icr_source_tooltip")}
        disabled={!hasTimeWindow}
        style={{
          width: "100%", textAlign: "left",
          background: "transparent", border: "none", padding: 0,
          fontSize: 13, color: "var(--text-faint)", lineHeight: 1.5,
          cursor: hasTimeWindow ? "pointer" : "default",
          font: "inherit",
        }}
      >
        {tInsights("engine_icr_source", {
          explicit:    adaptiveICR.pairedExplicitCount,
          timeWindow:  adaptiveICR.pairedTimeWindowCount,
          mealColumn,
          total:       adaptiveICR.sampleSize,
        })}
        {hasTimeWindow && (
          <span style={{ marginLeft: 6, color: "var(--accent)", fontWeight: 500 }}>
            {open ? tInsights("engine_icr_relink_close") : tInsights("engine_icr_relink_open")}
          </span>
        )}
      </button>
      {open && hasTimeWindow && (
        <div style={{
          marginTop: 8, padding: "10px 12px", borderRadius: 10,
          background: "var(--surface-soft)", border: `1px solid var(--border)`,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tInsights("engine_icr_relink_intro")}
          </div>
          {timeWindowPairs.map(p => {
            const bolusTime = parseDbDate(p.bolus.created_at);
            const mealTime = parseDbDate(p.meal.meal_time ?? p.meal.created_at);
            const mealLabel: string = (() => {
              if (Array.isArray(p.meal.parsed_json) && p.meal.parsed_json.length > 0) {
                const first = p.meal.parsed_json[0] as { name?: string };
                if (typeof first?.name === "string" && first.name.trim()) return first.name.trim();
              }
              if (p.meal.meal_type) return p.meal.meal_type;
              return tInsights("engine_icr_relink_meal_fallback");
            })();
            const dtFmt = (d: Date) => d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
            const isBusy = busyId === p.bolus.id;
            const isErr = errorId === p.bolus.id;
            return (
              <div key={p.bolus.id} style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "8px 10px", borderRadius: 8,
                background: "var(--surface)", border: `1px solid var(--border-soft)`,
              }}>
                <div style={{ flex: 1, minWidth: 160, fontSize: 13, color: "var(--text-strong)", lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 700 }}>{p.bolus.units}u {p.bolus.insulin_name || ""}</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {tInsights("engine_icr_relink_pair_line", {
                      bolusAt: dtFmt(bolusTime),
                      meal: mealLabel,
                      mealAt: dtFmt(mealTime),
                      deltaMin: Math.round(p.deltaMs / 60_000),
                    })}
                  </div>
                  {isErr && (
                    <div style={{ fontSize: 12, color: PINK, marginTop: 4 }}>
                      {tInsights("engine_icr_relink_failed")}
                    </div>
                  )}
                </div>
                {/* Two-button row: primary "Yes, that's right" persists the
                    pairing via related_entry_id; secondary "No, that's not
                    it" only dismisses the row locally (see dismissedIds
                    note above). Stacked vertically when narrow so labels
                    never get cut off. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={async () => {
                      setBusyId(p.bolus.id);
                      setErrorId(null);
                      try {
                        await updateInsulinLogLink(p.bolus.id, p.meal.id);
                        onLinked(p.bolus.id, p.meal.id);
                      } catch {
                        setErrorId(p.bolus.id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "none",
                      background: ACCENT, color: "var(--on-accent)",
                      fontSize: 13, fontWeight: 700,
                      cursor: isBusy ? "wait" : "pointer",
                      opacity: isBusy ? 0.7 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isBusy ? tInsights("engine_icr_relink_busy") : tInsights("engine_icr_relink_confirm")}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={async () => {
                      // Optimistic add — UI hides the row instantly.
                      // Roll back if the persist fails so the user
                      // can retry; surface the error inline.
                      const key = pairKey(p.meal.id, p.bolus.id);
                      setRejectedPairs(prev => {
                        const next = new Set(prev);
                        next.add(key);
                        return next;
                      });
                      setErrorId(null);
                      try {
                        await addRejectedPair(p.meal.id, p.bolus.id);
                      } catch {
                        setRejectedPairs(prev => {
                          const next = new Set(prev);
                          next.delete(key);
                          return next;
                        });
                        setErrorId(p.bolus.id);
                      }
                    }}
                    style={{
                      padding: "6px 12px", borderRadius: 8,
                      background: "transparent",
                      border: `1px solid var(--border)`,
                      color: "var(--text-dim)",
                      fontSize: 13, fontWeight: 500,
                      cursor: isBusy ? "wait" : "pointer",
                      opacity: isBusy ? 0.5 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tInsights("engine_icr_relink_reject")}
                  </button>
                </div>
              </div>
            );
          })}
          {/* Bottom-of-panel hint — explains what "Yes" actually does so
              the user understands they're teaching the engine, not just
              clicking a generic button. Quiet styling so it doesn't
              compete with the row buttons. */}
          <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5, paddingTop: 2 }}>
            {tInsights("engine_icr_relink_hint")}
          </div>
        </div>
      )}
    </div>
  );
}

function InsightsSortable({ items }: { items: SortableItem[] }) {
  const { order, setOrder } = useCardOrder("insights", INSIGHTS_DEFAULT_ORDER);
  return (
    <SortableCardGrid
      items={items}
      order={order}
      onOrderChange={setOrder}
      gridStyle={{ display:"flex", flexDirection:"column", gap:10 }}
    />
  );
}

/** Mockup-spec card label: 9 px, 0.1em tracking, uppercase, dim white. */
function CardLabel({ text, color }: { text: string; color?: string }) {
  return (
    <div style={{
      fontSize:11, fontWeight:700, letterSpacing:"0.1em",
      color: color ?? "var(--text-dim)", textTransform:"uppercase",
    }}>{text}</div>
  );
}

/** Compact bar chart for 7–14-day trend data inside Insight cards.
 *  Zero-value bars render as a faint stub so the time axis stays visible. */
function InsightMicroBars({
  values, color, labels, title, barHeight = 72,
}: {
  values: number[];
  color: string;
  labels?: string[];
  title?: string;
  barHeight?: number;
}) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ marginTop: 16 }}>
      {title && (
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 8 }}>
          {title}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: barHeight }}>
        {values.map((v, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 3 }}>
            <div style={{
              width: "100%",
              height: v > 0 ? `${Math.max((v / max) * 100, 10)}%` : "5%",
              background: v > 0 ? color : "var(--border-soft)",
              borderRadius: "3px 3px 0 0",
              transition: "height 0.5s ease",
            }} />
            {labels && (
              <div style={{ fontSize: 8, color: "var(--text-faint)", lineHeight: 1, flexShrink: 0 }}>
                {labels[i]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sparkline — ported 1:1 from `components/AppMockupPhone.tsx`. */
function Sparkline({ values, color, height = 36 }: { values: number[]; color: string; height?: number }) {
  const W = 268, H = height;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop:8, display:"block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill={`url(#spark-${gradId})`} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/**
 * FlipCard — generic flip wrapper with dynamic height.
 *
 * Height behaviour: an INVISIBLE ghost div sits in normal flow rendering
 * the *active* face's content — that's what determines the parent's
 * height. Both the real front and back faces are absolutely positioned
 * over the ghost. When the user flips, the active face swaps at the
 * midpoint of the 0.55 s spin (275 ms) — exactly when the card is
 * edge-on and the height change is hidden behind the perspective. This
 * means:
 *   • Front-only state → parent = front content height (tight, matches mockup)
 *   • Flipped state → parent grows to back content height (no clipping, no scroll)
 *
 * Padding / borderRadius defaults match the mockup's `MockCard`.
 */
/** Small medical-disclaimer pill. Neutral gray — informational, not alarming.
 *  Falls back to the localized ICR-context disclaimer when no `text` is passed. */
function DisclaimerChip({ text }: { text?: string } = {}) {
  const tInsights = useTranslations("insights");
  return (
    <div style={{
      display:"inline-flex", alignItems:"flex-start", gap:6,
      padding:"5px 10px", borderRadius:12,
      background:"var(--surface-soft)",
      border:"1px solid var(--border-strong)",
      fontSize:12, color:"var(--text-muted)", lineHeight:1.35,
      maxWidth:"100%",
    }}>
      <span aria-hidden style={{ fontSize:13, lineHeight:1.2 }}>⚕️</span>
      <span>{text ?? tInsights("disclaimer_default")}</span>
    </div>
  );
}

/** Back-of-card content used by every clinical-threshold tile.
 *  Mirrors the `FlipBack` style but pins a `DisclaimerChip` (with the
 *  threshold-specific text) at the bottom, like `IcrInfoBack`. */
function ThresholdBack({
  title,
  accent,
  paragraphs,
}: { title: string; accent: string; paragraphs: string[] }) {
  const tInsights = useTranslations("insights");
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", gap:8 }}>
      <div style={{ fontSize:13, color:accent, fontWeight:700, letterSpacing:"0.01em", lineHeight:1.25 }}>
        {title}
      </div>
      <div style={{ fontSize:12, color:"var(--text-body)", lineHeight:1.5, display:"flex", flexDirection:"column", gap:6 }}>
        {paragraphs.map((p, i) => <div key={i}>{p}</div>)}
      </div>
      <div style={{ marginTop:"auto", display:"flex", flexDirection:"column", gap:6, alignItems:"flex-start" }}>
        <DisclaimerChip text={tInsights("disclaimer_threshold")}/>
      </div>
    </div>
  );
}

/** Redesigned ICR back: heading + body + sub-line + disclaimer pinned bottom + bottom tap-to-flip hint. */
function IcrInfoBack({ heading, body, subLine, accent }: {
  heading: string; body: string; subLine: string; accent: string;
}) {
  const tInsights = useTranslations("insights");
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", gap:8 }}>
      <div style={{ fontSize:13, color:accent, fontWeight:700, letterSpacing:"0.01em", lineHeight:1.25 }}>
        {heading}
      </div>
      <div style={{ fontSize:13, color:"var(--text-body)", lineHeight:1.55 }}>{body}</div>
      <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.02em", marginTop:2 }}>
        {subLine}
      </div>
      {/* Bottom region: disclaimer chip + return hint, both pinned to the bottom. */}
      <div style={{ marginTop:"auto", paddingTop:10, display:"flex", flexDirection:"column", gap:6 }}>
        <DisclaimerChip/>
        <div style={{ fontSize:11, color:"var(--text-faint)", textAlign:"right", letterSpacing:"0.02em" }}>
          {tInsights("flip_hint_back")}
        </div>
      </div>
    </div>
  );
}

/** Subtle ℹ affordance pinned to a tile's top-right corner. Sized & positioned
 *  to sit inside the card's top padding so it never collides with header content
 *  (e.g. status pills) and never shifts existing layout. Pointer-events disabled
 *  so the parent's tap-to-flip stays the click target. */
function InfoCornerIcon() {
  return (
    <span aria-hidden style={{
      position:"absolute", top:3, right:6,
      fontSize:12, lineHeight:1,
      color:"var(--text-dim)",
      pointerEvents:"none",
    }}>{"\u2139\uFE0E"}</span>
  );
}

function FlipCard({
  children, back, accent = ACCENT, padding = "12px 14px", variant = "default", minHeight = 0,
}: {
  children: React.ReactNode;
  back: React.ReactNode;
  accent?: string;
  padding?: string;
  /** Minimum height for the ghost div that drives the card's natural height.
   *  Set to CARD_MIN_H on all standard insight cards for uniform sizing.
   *  Accepts a number (px) or a CSS string (e.g. clamp/calc with 100dvh)
   *  so the hero pager can scale viewport-relative on small phones. */
  minHeight?: number | string;
  /** "glass" applies an Apple-style Liquid Glass surface: translucent
   *  backdrop blur, refractive 1px border, and a soft inner highlight
   *  along the top edge to fake the "wet glass" cap. Falls back to a
   *  semi-transparent surface on browsers without backdrop-filter.
   *  Default is "glass" — the entire Insights tab now wears the
   *  Wallet/Liquid-Glass treatment. Pass `variant="default"` only if
   *  you explicitly need the legacy flat shell (no current callers). */
  variant?: "default" | "glass";
}) {
  const [flipped, setFlipped] = useState(false);
  // Which face's content the ghost mirrors. Swapped at flip-midpoint
  // (~275 ms) so the parent-height jump happens while the card is
  // edge-on — invisible to the user.
  const [activeFace, setActiveFace] = useState<"front"|"back">("front");

  useEffect(() => {
    const target = flipped ? "back" : "front";
    if (target === activeFace) return;
    const t = setTimeout(() => setActiveFace(target), 275);
    return () => clearTimeout(t);
  }, [flipped, activeFace]);

  // ── Liquid-Glass shell (variant="glass") ──────────────────────────
  // Apple iOS 26-style frosted surface. Three stacked layers fake the
  // "wet glass" optic in pure CSS:
  //   1. backdrop-filter blur+saturate so what's behind bleeds through
  //   2. semi-transparent base tint (lighter on top via gradient) so
  //      the surface has body even on flat backgrounds
  //   3. inset box-shadow combo: bright top-edge highlight + subtle
  //      bottom shadow that together suggest a refractive cap
  // Border uses a soft white→transparent gradient via background-clip
  // for the rim-light effect Apple uses on glass elements.
  const glassFront: React.CSSProperties = {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.06) 100%)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 18,
    padding,
    boxSizing: "border-box",
    boxShadow:
      "inset 0 1px 0 0 rgba(255,255,255,0.22), inset 0 -1px 0 0 rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.28)",
    // The Apple-Wallet light-sweep overlay (.glev-card-sweep) below
    // is positioned `absolute inset:0` and must be clipped to the
    // rounded glass shell — without overflow:hidden the streak
    // bleeds past the rim-light border on the corners.
    overflow: "hidden",
  };
  const glassBack: React.CSSProperties = {
    background: `linear-gradient(160deg, ${accent}1F 0%, rgba(255,255,255,0.06) 60%, ${accent}10 100%)`,
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: `1px solid ${accent}55`,
    borderRadius: 18,
    padding,
    boxSizing: "border-box",
    boxShadow:
      `inset 0 1px 0 0 rgba(255,255,255,0.22), inset 0 -1px 0 0 rgba(0,0,0,0.18), 0 8px 24px ${accent}22`,
  };

  const frontShell: React.CSSProperties = variant === "glass" ? glassFront : {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    padding,
    boxSizing: "border-box",
  };
  const backShell: React.CSSProperties = variant === "glass" ? glassBack : {
    background: `linear-gradient(145deg, ${accent}12, ${SURFACE} 65%)`,
    border: `1px solid ${accent}33`,
    borderRadius: 14,
    padding,
    boxSizing: "border-box",
  };

  return (
    <div
      onClick={() => setFlipped(f => !f)}
      className="glev-flip-card"
      style={{ position:"relative", cursor:"pointer", perspective:1400 }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); } }}
      aria-pressed={flipped}
    >
      {/* GHOST — invisible, in normal flow, determines parent height.
          minHeight enforces uniform card sizing across the pager. */}
      <div aria-hidden style={{ visibility:"hidden", pointerEvents:"none", minHeight: minHeight || undefined, ...(activeFace==="back" ? backShell : frontShell) }}>
        {activeFace === "back" ? back : children}
      </div>
      {/* FLIP STAGE — absolutely overlays the ghost. */}
      <div style={{
        position:"absolute", inset:0,
        transformStyle:"preserve-3d",
        transition:"transform 0.55s cubic-bezier(0.4,0,0.2,1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        {/* FRONT */}
        <div style={{
          position:"absolute", inset:0,
          backfaceVisibility:"hidden",
          ...frontShell,
        }}>
          {children}
        </div>
        {/* BACK */}
        <div style={{
          position:"absolute", inset:0,
          backfaceVisibility:"hidden",
          transform:"rotateY(180deg)",
          ...backShell,
        }}>
          {back}
        </div>
      </div>
    </div>
  );
}

function FlipBack({ title, accent, paragraphs }: { title: string; accent: string; paragraphs: string[] }) {
  const tInsights = useTranslations("insights");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:12, color:accent, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{title}</div>
        <span style={{ fontSize:11, color:"var(--text-faint)" }}>{tInsights("flip_hint_back")}</span>
      </div>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize:13, color:"var(--text-muted)", lineHeight:1.5 }}>{p}</div>
      ))}
    </div>
  );
}

/** Compact 2-up stat tile used by the performance-tiles card.
 *  Same dynamic-height ghost trick as FlipCard: parent height tracks
 *  the active face so flipping to a longer back grows the tile rather
 *  than clipping/scrolling. Tile shrinks back when flipped to front. */
type InsightTile = { label:string; val:string; sub:string; color:string; formula:string; explain:string; infoBack?: React.ReactNode };
function InsightFlipTile({ tile }: { tile: InsightTile }) {
  const [flipped, setFlipped] = useState(false);
  const [activeFace, setActiveFace] = useState<"front"|"back">("front");

  useEffect(() => {
    const target = flipped ? "back" : "front";
    if (target === activeFace) return;
    const t = setTimeout(() => setActiveFace(target), 250); // midpoint of 0.5 s flip
    return () => clearTimeout(t);
  }, [flipped, activeFace]);

  // Tile padding raised from 10→16 vertical so the small tiles
  // (Raw ICR, Ø Glucose, Trefferquote, Ø Insulin) breathe — label,
  // hero value and sub-line shouldn't sit on top of each other. Hero
  // value also gets a touch more marginTop (6→8) for the same reason.
  const frontShell: React.CSSProperties = {
    background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14,
    padding:"16px 12px", boxSizing:"border-box",
  };
  const backShell: React.CSSProperties = {
    background:`linear-gradient(145deg, ${tile.color}12, ${SURFACE} 65%)`,
    border:`1px solid ${tile.color}33`, borderRadius:14,
    padding:"16px 12px", boxSizing:"border-box",
  };

  const frontContent = (
    <>
      <CardLabel text={tile.label}/>
      <div style={{ fontSize:20, fontWeight:800, color:tile.color, fontFamily:"var(--font-mono)", lineHeight:1, letterSpacing:"-0.03em", marginTop:8 }}>
        {tile.val}
      </div>
      <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:6 }}>{tile.sub}</div>
      {/* Show ℹ affordance only on tiles that opt-in to a richer back side. */}
      {tile.infoBack && <InfoCornerIcon/>}
    </>
  );
  // If the tile supplies a custom info back (e.g. Raw ICR), render that instead
  // of the default formula/explain pair. Other tiles keep the legacy back.
  const backContent = tile.infoBack ?? (
    <>
      <div style={{ fontSize:11, fontWeight:700, color:tile.color, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>
        {tile.label}
      </div>
      <div style={{ fontSize:11, color:"var(--text-muted)", fontFamily:"var(--font-mono)", background:"var(--surface-soft)", padding:"4px 6px", borderRadius:5, marginBottom:4, wordBreak:"break-word" }}>
        {tile.formula}
      </div>
      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.4 }}>{tile.explain}</div>
    </>
  );

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setFlipped(f => !f); }}
      className="glev-flip-card"
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); } }}
      style={{ position:"relative", cursor:"pointer", perspective:1000 }}
    >
      {/* GHOST — invisible, in normal flow, determines parent height. */}
      <div aria-hidden style={{ visibility:"hidden", pointerEvents:"none", ...(activeFace==="back" ? backShell : frontShell) }}>
        {activeFace === "back" ? backContent : frontContent}
      </div>
      {/* FLIP STAGE */}
      <div style={{
        position:"absolute", inset:0,
        transformStyle:"preserve-3d",
        transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", ...frontShell }}>
          {frontContent}
        </div>
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", ...backShell }}>
          {backContent}
        </div>
      </div>
    </div>
  );
}
