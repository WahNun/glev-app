"use client";

import React, { useState, useEffect, useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { fetchMeals, fetchMealsForEngine, unifiedOutcome, type Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import { pairBolusesToMeals } from "@/lib/engine/pairing";
import { updateInsulinLogLink } from "@/lib/insulin";
import { detectPattern } from "@/lib/engine/patterns";
import { suggestAdjustment, type AdaptiveSettings, type AdjustmentSuggestion } from "@/lib/engine/adjustment";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import { useCardOrder } from "@/lib/cardOrder";
import { parseDbTs, parseDbDate } from "@/lib/time";
import { startOfDay, startOfToday, startOfDaysAgo } from "@/lib/utils/datetime";
import {
  fetchFingersticks,
  type FingerstickReading,
} from "@/lib/fingerstick";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog, type ExerciseType } from "@/lib/exercise";
import { evaluateExercise, type ExerciseOutcome } from "@/lib/exerciseEval";
import { useCarbUnit } from "@/hooks/useCarbUnit";

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
  "performance-tiles",
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
  if (ev === "SPIKE" || ev === "UNDERDOSE" || ev === "LOW")  return "SPIKE";
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
const TIR_LOW_MGDL         = 70;   // TIR target band lower bound (TBR < this)
const TIR_HIGH_MGDL        = 180;  // TIR target band upper bound (TAR > this)
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

export default function InsightsPage() {
  // Carb-unit selector — feeds the per-type "avg carbs" line and the
  // "Avg insulin" tile sublabel. All aggregates are computed in grams
  // upstream; only the rendered string switches to BE/KE/g.
  const carbUnit = useCarbUnit();
  const tInsights = useTranslations("insights");
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
  const [fingersticks, setFingersticks] = useState<FingerstickReading[]>([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    // 14d covers every metric window (CV% needs 14d; hypo/hyper/TDD only 7d).
    // Calendar-aware lower bound: midnight 13 days ago in user's TZ → covers
    // today + previous 13 calendar days.
    const fingerstickFromIso = startOfDaysAgo(13).toISOString();
    Promise.all([
      fetchMeals().catch(() => [] as Meal[]),
      fetchMealsForEngine().catch(() => [] as Meal[]),
      fetchRecentInsulinLogs(14).catch(() => [] as InsulinLog[]),
      fetchRecentInsulinLogs(90).catch(() => [] as InsulinLog[]),
      fetchRecentExerciseLogs(30).catch(() => [] as ExerciseLog[]),
      fetchFingersticks(fingerstickFromIso).catch(() => [] as FingerstickReading[]),
    ])
      .then(([m, em, il, ilEngine, ex, fs]) => {
        setMeals(m);
        setEngineMeals(em);
        setInsulinLogs(il);
        setEngineBoluses(ilEngine);
        setExerciseLogs(ex);
        setFingersticks(fs);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", gap:12, color:"var(--text-faint)" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:20, height:20, border:`2px solid ${ACCENT}`, borderTopColor:"transparent", borderRadius:99, animation:"spin 0.8s linear infinite" }}/>
      {tInsights("loading_insights")}
    </div>
  );

  const total = meals.length;
  if (total === 0) return (
    <div style={{ maxWidth:480, margin:"0 auto" }}>
      <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:8 }}>Insights</h1>
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"48px", textAlign:"center", color:"var(--text-ghost)", fontSize:14 }}>{tInsights("empty_state_min_meals")}</div>
    </div>
  );

  const now = Date.now();
  // Calendar-aware week boundaries (midnight in user's TZ) — see
  // lib/utils/datetime. wkAgo = midnight 6d ago → "last 7 calendar days
  // including today". wk2Ago = midnight 13d ago → prior 7-day window.
  const wkAgo  = startOfDaysAgo(6).getTime();
  const wk2Ago = startOfDaysAgo(13).getTime();
  const last7 = meals.filter(m => parseDbTs(m.created_at) >= wkAgo);

  // ── Time in Range buckets (consensus 70–180 mg/dL band) ──
  const last7Bg = last7.filter(m => m.glucose_before != null).map(m => m.glucose_before as number);
  const prev7Bg = meals.filter(m => {
    const t = parseDbTs(m.created_at);
    return t >= wk2Ago && t < wkAgo && m.glucose_before != null;
  }).map(m => m.glucose_before as number);

  const bucket = (arr: number[]) => {
    const t = arr.length || 1;
    return {
      vlow: Math.round((arr.filter(g => g < 54).length / t) * 100),
      lo:   Math.round((arr.filter(g => g >= 54 && g < 70).length / t) * 100),
      inR:  Math.round((arr.filter(g => g >= 70 && g <= 180).length / t) * 100),
      hi:   Math.round((arr.filter(g => g > 180).length / t) * 100),
      n: arr.length,
    };
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
  const trendDays: { label: string; avg: number | null }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDaysAgo(i);
    const dayEndMs = startOfDaysAgo(i - 1).getTime();
    const dayBgs = meals
      .filter(m => {
        const t = parseDbTs(m.created_at);
        return t >= dayStart.getTime() && t < dayEndMs && m.glucose_before != null;
      })
      .map(m => m.glucose_before as number);
    trendDays.push({
      label: weekdayShortLabels[dayStart.getDay()],
      avg: dayBgs.length ? dayBgs.reduce((a, b) => a + b, 0) / dayBgs.length : null,
    });
  }
  let lastVal: number | null = null;
  const firstFallback = last7Avg ?? 100;
  const trendValues: number[] = trendDays.map(d => {
    if (d.avg != null) { lastVal = d.avg; return d.avg; }
    return lastVal ?? firstFallback;
  });

  // ── Cross-source BG reading pools (meals + insulin + exercise + fingerstick) ──
  // Calendar-aware: midnight 13d ago in user's TZ = "last 14 calendar days".
  const fourteenAgo = startOfDaysAgo(13).getTime();
  const readings14 = collectBgReadings(meals, insulinLogs, exerciseLogs, fingersticks, fourteenAgo);
  const readings7  = readings14.filter(r => r.t >= wkAgo);

  // ── Hypo / Hyper event counters (7d, count of individual readings) ──
  const hypoEnough  = readings7.length >= MIN_DATAPOINTS;
  const hyperEnough = readings7.length >= MIN_DATAPOINTS;
  const hypoCount7d  = readings7.filter(r => r.v < HYPO_THRESHOLD_MGDL).length;
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
  const tddByDay = new Map<string, number>();
  for (const il of insulinLogs) {
    const t = parseDbTs(il.created_at);
    if (t < wkAgo) continue;
    const dayStart = startOfDay(new Date(t));
    const key = dayStart.toISOString().slice(0, 10);
    tddByDay.set(key, (tddByDay.get(key) ?? 0) + Number(il.units || 0));
  }
  const tddDayCount    = tddByDay.size;
  const tddEnough      = tddDayCount >= MIN_DATAPOINTS;
  const tddTodayKey    = startOfToday().toISOString().slice(0, 10);
  const tddToday       = tddByDay.get(tddTodayKey) ?? 0;
  const tddSum7        = Array.from(tddByDay.values()).reduce((a, b) => a + b, 0);
  const tddAvg7        = tddEnough ? +(tddSum7 / 7).toFixed(1) : null;

  // ── Extended TIR (TBR / TIR / TAR three-color view, reuses b7 buckets) ──
  const tbrPct = b7.vlow + b7.lo;     // < 70
  const tirPct = b7.inR;              // 70–180
  const tarPct = b7.hi;               // > 180

  // ── Workout (exercise) analytics, 30-day window ──
  const thirtyAgo = now - 30 * 86400000;
  const exercise30 = exerciseLogs.filter(ex => parseDbTs(ex.created_at) >= thirtyAgo);
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
  const normed   = meals.map(m => ({ ...m, ev: EVAL_NORM(unifiedOutcome(m)) }));
  const goodAll  = normed.filter(m => m.ev==="GOOD").length;
  const goodRate = total ? goodAll/total*100 : 0;
  const avgGlucose = Math.round(meals.filter(m=>m.glucose_before).reduce((s,m)=>s+(m.glucose_before||0),0) / Math.max(meals.filter(m=>m.glucose_before).length,1));
  const avgCarbs   = Math.round(meals.filter(m=>m.carbs_grams).reduce((s,m)=>s+(m.carbs_grams||0),0) / Math.max(meals.filter(m=>m.carbs_grams).length,1));
  const avgInsulin = (meals.filter(m=>m.insulin_units).reduce((s,m)=>s+(m.insulin_units||0),0) / Math.max(meals.filter(m=>m.insulin_units).length,1)).toFixed(1);
  const icr7 = meals.slice(0,7).filter(m=>m.carbs_grams&&m.insulin_units).map(m=>(m.carbs_grams||0)/(m.insulin_units||1));
  const estICR = icr7.length ? Math.round(icr7.reduce((a,b)=>a+b,0)/icr7.length) : 15;

  // Meal type breakdown (FAST_CARBS / HIGH_PROTEIN / HIGH_FAT / BALANCED)
  const types: Record<string, {count:number; totalCarbs:number; totalInsulin:number; good:number}> = {
    FAST_CARBS:   {count:0,totalCarbs:0,totalInsulin:0,good:0},
    HIGH_PROTEIN: {count:0,totalCarbs:0,totalInsulin:0,good:0},
    HIGH_FAT:     {count:0,totalCarbs:0,totalInsulin:0,good:0},
    BALANCED:     {count:0,totalCarbs:0,totalInsulin:0,good:0},
  };
  meals.forEach(m => {
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
  meals.forEach(m => {
    const h = parseDbDate(m.created_at).getHours();
    const key = h >= 5 && h < 11 ? "Morning (5–11)"
              : h >= 11 && h < 17 ? "Afternoon (11–17)"
              : h >= 17 && h < 21 ? "Evening (17–21)"
              : "Night (21–5)";
    timeGroups[key].count++;
    if (EVAL_NORM(unifiedOutcome(m))==="GOOD") timeGroups[key].good++;
  });

  // Pattern detection (last 10 meals + time-of-day cross-check).
  // SPIKE bucket = SPIKE+UNDERDOSE+LOW (BG ended too high → under-dosed).
  // HYPO  bucket = OVERDOSE+HIGH       (BG ended too low  → over-dosed).
  const recentMeals = meals.slice(0, 10);
  const recentGood  = recentMeals.filter(m=>EVAL_NORM(unifiedOutcome(m))==="GOOD").length;
  const recentLow   = recentMeals.filter(m=>EVAL_NORM(unifiedOutcome(m))==="SPIKE").length;
  const recentHigh  = recentMeals.filter(m=>EVAL_NORM(unifiedOutcome(m))==="HYPO").length;
  const patterns: {icon:string;title:string;desc:string;color:string}[] = [];
  if (recentLow >= 4)  patterns.push({ icon:"↑", title:tInsights("pattern_under_dosing_title"),     desc:tInsights("pattern_under_dosing_desc",    { n: recentLow  }), color:ORANGE });
  if (recentHigh >= 3) patterns.push({ icon:"↓", title:tInsights("pattern_over_dosing_title"),      desc:tInsights("pattern_over_dosing_desc",     { n: recentHigh }), color:PINK   });
  if (recentGood >= 7) patterns.push({ icon:"✓", title:tInsights("pattern_strong_control_title"),   desc:tInsights("pattern_strong_control_desc",  { n: recentGood }), color:GREEN  });
  const morningSucc = timeGroups["Morning (5–11)"];
  const eveningSucc = timeGroups["Evening (17–21)"];
  if (morningSucc.count >= 3 && morningSucc.good/morningSucc.count < 0.5) patterns.push({ icon:"☀", title:tInsights("pattern_morning_issues_title"),    desc:tInsights("pattern_morning_issues_desc"),    color:ORANGE });
  if (eveningSucc.count >= 3 && eveningSucc.good/eveningSucc.count > 0.8) patterns.push({ icon:"🌙", title:tInsights("pattern_evening_strength_title"), desc:tInsights("pattern_evening_strength_desc"), color:ACCENT });
  if (patterns.length === 0) patterns.push({ icon:"→", title:tInsights("pattern_no_signals_title"), desc:tInsights("pattern_no_signals_desc"), color:"var(--text-faint)" });

  // Adaptive engine derivations — driven by the engine-only 90-day pull
  // (`engineMeals`) so the morning/afternoon/evening ICR buckets and the
  // pattern detector's recent-window stats aren't dragged off course by
  // year-old rows. Long-term tiles below continue to read from `meals`.
  const adaptiveICR  = computeAdaptiveICR(engineMeals, engineBoluses);
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
  const items: SortableItem[] = [
    {
      id: "time-in-range",
      node: (
        <FlipCard
          accent={GREEN}
          back={
            <FlipBack
              title={tInsights("tir_back_title")}
              accent={GREEN}
              paragraphs={[
                tInsights("tir_back_p1"),
                tInsights("tir_back_p2"),
                tInsights("tir_back_p3", { n: b7.n }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_time_in_range_title")}/>
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>70–180 mg/dL</div>
          </div>
          {b7.n === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"var(--text-faint)", fontSize:11 }}>
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
                  <div style={{ marginLeft:"auto", fontSize:9, color: tirDelta >= 0 ? GREEN : ORANGE, fontWeight:600 }}>
                    {tirDelta >= 0 ? "+" : ""}{tirDelta} {tInsights("delta_vs_prev_week")}
                  </div>
                )}
              </div>
              {/* 3-color TBR / TIR / TAR bar (clinical consensus). The
                  legacy 4-segment bar (vlow/lo/inR/hi from `b7`) was
                  collapsed into TBR=vlow+lo / TIR=inR / TAR=hi to match
                  the ATTD consensus three-band visual standard. */}
              <div
                role="img"
                aria-label={`Time below range ${tbrPct} percent, in range ${tirPct} percent, above range ${tarPct} percent`}
                style={{ display:"flex", height:12, borderRadius:99, overflow:"hidden", background:"var(--surface-soft)" }}
              >
                {tbrPct > 0 && <div style={{ width:`${tbrPct}%`, background:PINK }}/>}
                {tirPct > 0 && <div style={{ width:`${tirPct}%`, background:GREEN }}/>}
                {tarPct > 0 && <div style={{ width:`${tarPct}%`, background:HIGH_YELLOW }}/>}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:9, color:"var(--text-dim)", flexWrap:"wrap", gap:6 }}>
                <span style={{ color:PINK }}>● {tInsights("tir_legend_below")} · {tbrPct}%</span>
                <span style={{ color:GREEN }}>● {tInsights("tir_legend_in")} · {tirPct}%</span>
                <span style={{ color:HIGH_YELLOW }}>● {tInsights("tir_legend_above")} · {tarPct}%</span>
              </div>
            </>
          )}
        </FlipCard>
      ),
    },
    {
      // Two side-by-side stat cards. ID kept as "gmi-a1c" for backwards
      // compat with persisted card-orders from earlier versions.
      id: "gmi-a1c",
      node: (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          <FlipCard
            accent={ACCENT}
            back={
              <FlipBack
                title={tInsights("avg_bg_back_title")}
                accent={ACCENT}
                paragraphs={[
                  tInsights("avg_bg_back_p1"),
                  tInsights("avg_bg_back_p2"),
                  tInsights("avg_bg_back_p3", { n: last7Bg.length }),
                ]}
              />
            }
          >
            <CardLabel text={tInsights("card_avg_bg_title")}/>
            {last7Avg == null ? (
              <div style={{ fontSize:24, fontWeight:800, color:"var(--text-ghost)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
                  <div style={{ fontSize:24, fontWeight:800, color:"var(--text)", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                    {Math.round(last7Avg)}
                  </div>
                  <div style={{ fontSize:9, color:"var(--text-dim)" }}>mg/dL</div>
                </div>
                {bgDelta != null && (
                  <div style={{ fontSize:9, color: bgDelta < 0 ? GREEN : bgDelta > 0 ? ORANGE : "var(--text-dim)", marginTop:2, fontWeight:600 }}>
                    {bgDelta > 0 ? "+" : bgDelta < 0 ? "−" : ""}{Math.abs(bgDelta)} {tInsights("delta_vs_prev")}
                  </div>
                )}
              </>
            )}
          </FlipCard>
          <FlipCard
            accent={ACCENT}
            back={
              <FlipBack
                title={tInsights("gmi_back_title")}
                accent={ACCENT}
                paragraphs={[
                  tInsights("gmi_back_p1"),
                  tInsights("gmi_back_p2"),
                  last7Avg != null
                    ? tInsights("gmi_back_p3_with_avg", { avg: Math.round(last7Avg), n: last7Bg.length })
                    : tInsights("gmi_back_p3_no_avg"),
                ]}
              />
            }
          >
            <CardLabel text={tInsights("card_gmi_title")}/>
            {gmi == null ? (
              <div style={{ fontSize:24, fontWeight:800, color:"var(--text-ghost)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
                  <div style={{ fontSize:24, fontWeight:800, color:"var(--text)", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                    {gmi.toFixed(1)}
                  </div>
                  <div style={{ fontSize:9, color:"var(--text-dim)" }}>%</div>
                </div>
                {gmiDelta != null && (
                  <div style={{ fontSize:9, color: gmiDelta < 0 ? GREEN : gmiDelta > 0 ? ORANGE : "var(--text-dim)", marginTop:2, fontWeight:600 }}>
                    {gmiDelta > 0 ? "+" : gmiDelta < 0 ? "−" : ""}{Math.abs(gmiDelta).toFixed(1)} {tInsights("delta_vs_prev")}
                  </div>
                )}
              </>
            )}
          </FlipCard>
        </div>
      ),
    },
    {
      id: "glucose-trend",
      node: (
        <FlipCard
          accent={ACCENT}
          back={
            <FlipBack
              title={tInsights("trend_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("trend_back_p1"),
                tInsights("trend_back_p2"),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text={tInsights("card_glucose_trend_title")}/>
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("card_glucose_trend_sub")}</div>
          </div>
          <Sparkline values={trendValues} color={ACCENT}/>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:8, color:"var(--text-faint)" }}>
            {trendDays.map((d, i) => <span key={i}>{d.label}</span>)}
          </div>
        </FlipCard>
      ),
    },
    // ── Hypo events counter (7d, BG < 70 mg/dL) ──
    {
      id: "hypo-events",
      node: (() => {
        const accent = hypoCount7d > 0 ? PINK : GREEN;
        return (
          <FlipCard
            accent={accent}
            back={
              <ThresholdBack
                title={tInsights("hypo_label")}
                accent={accent}
                paragraphs={[
                  tInsights("hypo_back_p1"),
                  tInsights("hypo_back_p2"),
                  hypoEnough
                    ? tInsights("readings_window_p3", { n: readings7.length })
                    : tInsights("min_readings_window_required", { min: MIN_DATAPOINTS }),
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text={tInsights("card_hypo_events_title")}/>
              <div style={{ fontSize:9, color:"var(--text-dim)" }}>&lt; {HYPO_THRESHOLD_MGDL} mg/dL</div>
            </div>
            {!hypoEnough ? (
              <div style={{ padding:"18px 0", textAlign:"center" }}>
                <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
                <div style={{ fontSize:9, color:"var(--text-faint)", marginTop:4 }}>{tInsights("min_readings_required", { min: MIN_DATAPOINTS })}</div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:accent, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {hypoCount7d}
                </div>
                <div style={{ fontSize:11, color:accent, fontWeight:600 }}>
                  {hypoCount7d === 0 ? tInsights("hypo_count_zero") : hypoCount7d === 1 ? tInsights("hypo_count_one") : tInsights("hypo_count_many")}
                </div>
                <div style={{ marginLeft:"auto", fontSize:9, color:"var(--text-dim)" }}>
                  {tInsights("readings_count", { n: readings7.length })}
                </div>
              </div>
            )}
          </FlipCard>
        );
      })(),
    },
    // ── Hyper events counter (7d, BG > 250 mg/dL) ──
    {
      id: "hyper-events",
      node: (() => {
        const accent = hyperCount7d > 0 ? ORANGE : GREEN;
        return (
          <FlipCard
            accent={accent}
            back={
              <ThresholdBack
                title={tInsights("hyper_label")}
                accent={accent}
                paragraphs={[
                  tInsights("hyper_back_p1"),
                  tInsights("hyper_back_p2"),
                  hyperEnough
                    ? tInsights("readings_window_p3", { n: readings7.length })
                    : tInsights("min_readings_window_required", { min: MIN_DATAPOINTS }),
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text={tInsights("card_hyper_events_title")}/>
              <div style={{ fontSize:9, color:"var(--text-dim)" }}>&gt; {HYPER_THRESHOLD_MGDL} mg/dL</div>
            </div>
            {!hyperEnough ? (
              <div style={{ padding:"18px 0", textAlign:"center" }}>
                <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
                <div style={{ fontSize:9, color:"var(--text-faint)", marginTop:4 }}>{tInsights("min_readings_required", { min: MIN_DATAPOINTS })}</div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:accent, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {hyperCount7d}
                </div>
                <div style={{ fontSize:11, color:accent, fontWeight:600 }}>
                  {hyperCount7d === 0 ? tInsights("hyper_count_zero") : hyperCount7d === 1 ? tInsights("hyper_count_one") : tInsights("hyper_count_many")}
                </div>
                <div style={{ marginLeft:"auto", fontSize:9, color:"var(--text-dim)" }}>
                  {tInsights("readings_count", { n: readings7.length })}
                </div>
              </div>
            )}
          </FlipCard>
        );
      })(),
    },
    // ── Glucose Variability CV% (14d, ATTD consensus thresholds) ──
    {
      id: "glucose-variability",
      node: (
        <FlipCard
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
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>CV%</div>
          </div>
          {!cvEnough || cvPct == null ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:9, color:"var(--text-faint)", marginTop:4 }}>{tInsights("min_readings_required", { min: MIN_DATAPOINTS })}</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:cvColor, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {cvPct.toFixed(1)}
                </div>
                <div style={{ fontSize:14, color:cvColor, fontWeight:700 }}>%</div>
                <div style={{ marginLeft:"auto", fontSize:9, color:cvColor, fontWeight:700 }}>
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
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:8, color:"var(--text-dim)" }}>
                <span style={{ color:GREEN }}>{tInsights("cv_legend_stable")}</span>
                <span style={{ color:HIGH_YELLOW }}>{tInsights("cv_legend_medium")}</span>
                <span style={{ color:PINK }}>{tInsights("cv_legend_unstable")}</span>
              </div>
            </>
          )}
        </FlipCard>
      ),
    },
    {
      id: "meal-evaluation",
      node: (
        <FlipCard
          accent={ORANGE}
          back={
            <FlipBack
              title={tInsights("meal_eval_back_title")}
              accent={ORANGE}
              paragraphs={[
                tInsights("meal_eval_back_p1"),
                tInsights("meal_eval_back_p2"),
                tInsights("meal_eval_back_p3", { n: totalN }),
              ]}
            />
          }
        >
          <CardLabel text={tInsights("card_meal_evaluation_title")}/>
          {totalN === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"var(--text-faint)", fontSize:11 }}>
              {tInsights("card_meal_evaluation_empty")}
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
              {evalRows.map(r => (
                <div key={r.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:60, fontSize:10, color:r.color }}>{r.label}</div>
                  <div style={{ flex:1, height:6, background:"var(--surface-soft)", borderRadius:99, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${r.pct}%`, background:r.color, borderRadius:99, transition:"width 0.3s" }}/>
                  </div>
                  <div
                    title={`${r.pct}%`}
                    style={{ width:24, textAlign:"right", fontSize:10, color:"var(--text)", fontFamily:"var(--font-mono)", fontWeight:600 }}
                  >
                    {r.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </FlipCard>
      ),
    },
    // ──── Deeper analysis cards (below the hero block) ────
    {
      id: "adaptive-engine",
      node: (
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
                    fontSize:9, fontWeight:700, letterSpacing:"0.1em",
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

                {/* Hero ICR — matches the colourful big-number style used by
                    Avg BG / GMI / performance tiles: 24px mono, lineHeight 1,
                    ACCENT colour as the engine's signature. */}
                <div style={{
                  display:"flex", alignItems:"baseline", gap:8,
                  padding:"2px 2px 10px", marginBottom:10,
                  borderBottom:`1px solid var(--border-soft)`,
                }}>
                  <span style={{ fontSize:10, color:"var(--text-dim)", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>
                    {tInsights("engine_label_icr")}
                  </span>
                  <span style={{
                    fontSize:24, fontWeight:800,
                    color: adaptiveICR.global ? ACCENT : "var(--text-ghost)",
                    fontFamily:"var(--font-mono)",
                    lineHeight:1, letterSpacing:"-0.03em",
                  }}>
                    {icrText}
                  </span>
                  <span style={{ fontSize:10, color:"var(--text-faint)", marginLeft:"auto", textAlign:"right", lineHeight:1.25 }}>
                    {tInsights("engine_outcome_weighted")}<br/>
                    {tInsights("engine_final_meals", { n: enginePattern.sampleSize })}
                  </span>
                </div>

                {/* ICR source breakdown — makes it visible whether the
                    adaptive ICR is being driven by separately-logged
                    bolus shots (paired via related_entry_id or ±30-min
                    time-window) or by the legacy meal.insulin_units
                    column. When at least one pair came in via the
                    time-window heuristic, the line becomes a tap
                    target that opens an inline relink panel — the user
                    can upgrade those heuristic pairs to explicit tags
                    (Task #211). Hidden when there are zero contributing
                    meals (warming-up state already says so). */}
                {adaptiveICR.sampleSize > 0 && (
                  <RelinkSourceLine
                    adaptiveICR={adaptiveICR}
                    engineMeals={engineMeals}
                    engineBoluses={engineBoluses}
                    onLinked={(bolusId, mealId) => {
                      setEngineBoluses(prev => prev.map(b => b.id === bolusId ? { ...b, related_entry_id: mealId } : b));
                      setInsulinLogs(prev => prev.map(b => b.id === bolusId ? { ...b, related_entry_id: mealId } : b));
                    }}
                  />
                )}

                {/* Pattern label — German renders localized strings; English
                    keeps the engine defaults from lib/engine/patterns.ts as
                    the single source of truth. */}
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
                      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.5, marginBottom:6 }}>
                        <span style={{ color:"var(--text)", fontWeight:600 }}>{label}</span>
                      </div>
                      <div style={{ fontSize:11, color:"var(--text-muted)", lineHeight:1.5 }}>
                        {explanation}
                      </div>
                    </>
                  );
                })()}

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
                      fontSize:9, fontWeight:700, color:ACCENT,
                      letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4,
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.6 1 1.5 1 2.3v1h6v-1c0-.8.3-1.7 1-2.3A7 7 0 0 0 12 2z"/>
                      </svg>
                      {suggestion.hasSuggestion ? tInsights("engine_pill_suggested") : tInsights("engine_pill_advisory")}
                    </div>
                    <div style={{ fontSize:11, color:"var(--text-strong)", lineHeight:1.5 }}>
                      {tInsights(suggestion.message.key, suggestion.message.params)}
                    </div>
                    <div style={{ marginTop:8 }}>
                      <DisclaimerChip/>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </FlipCard>
      ),
    },
    // ── Total Daily Dose · 7d (sum of insulin units per day) ──
    {
      id: "tdd",
      node: (
        <FlipCard
          accent={ACCENT}
          back={
            <ThresholdBack
              title={tInsights("tdd_label")}
              accent={ACCENT}
              paragraphs={[
                tInsights("tdd_back_p1"),
                tInsights("tdd_back_p2"),
                tddEnough
                  ? tInsights("tdd_back_p3", { logs: insulinLogs.filter(il => parseDbTs(il.created_at) >= wkAgo).length, days: tddDayCount })
                  : tInsights("tdd_back_p3_insufficient", { min: MIN_DATAPOINTS }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_tdd_title")}/>
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("card_tdd_sub")}</div>
          </div>
          {!tddEnough || tddAvg7 == null ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:9, color:"var(--text-faint)", marginTop:4 }}>{tInsights("tdd_min_required", { min: MIN_DATAPOINTS })}</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <div style={{ fontSize:36, fontWeight:800, color:"var(--text)", letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {tddAvg7.toFixed(1)}
                </div>
                <div style={{ fontSize:14, color:"var(--text-dim)", fontWeight:700 }}>{tInsights("tdd_unit_main")}</div>
                <div style={{ marginLeft:"auto", fontSize:9, color:"var(--text-dim)" }}>{tInsights("tdd_avg_7d")}</div>
              </div>
              <div style={{ marginTop:10, display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:`${ACCENT}10`, border:`1px solid ${ACCENT}25`, borderRadius:10 }}>
                <div style={{ fontSize:10, color:"var(--text-muted)", fontWeight:600 }}>{tInsights("tdd_today")}</div>
                <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                  <div style={{ fontSize:18, fontWeight:800, color:ACCENT, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                    {tddToday.toFixed(1)}
                  </div>
                  <div style={{ fontSize:10, color:ACCENT, fontWeight:700 }}>U</div>
                </div>
              </div>
            </>
          )}
        </FlipCard>
      ),
    },
    {
      id: "patterns",
      node: (
        <FlipCard
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
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("card_patterns_signal_count", { n: patterns.length })}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"8px 10px", background:`${p.color}08`, border:`1px solid ${p.color}20`, borderRadius:10, alignItems:"flex-start" }}>
                <div style={{ width:22, height:22, borderRadius:99, background:`${p.color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:11 }}>
                  {p.icon}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:p.color, marginBottom:2 }}>{p.title}</div>
                  <div style={{ fontSize:10, color:"var(--text-dim)", lineHeight:1.45 }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </FlipCard>
      ),
    },
    // ── Workout Outcome Distribution · 30d ──
    {
      id: "workout-outcomes",
      node: (
        <FlipCard
          accent={ACCENT}
          back={
            <ThresholdBack
              title={tInsights("workout_outcomes_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("workout_outcomes_back_p1"),
                tInsights("workout_outcomes_back_p2"),
                workoutOutcomeEnough
                  ? tInsights("workout_outcomes_back_p3", { total: workoutTotal30, classified: workoutClassifiedTotal })
                  : tInsights("workout_outcomes_back_p3_insufficient", { min: MIN_DATAPOINTS }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_workout_outcomes_title")}/>
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("card_workout_outcomes_sub")}</div>
          </div>
          {!workoutOutcomeEnough ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:9, color:"var(--text-faint)", marginTop:4 }}>{tInsights("workout_outcomes_min_required", { min: MIN_DATAPOINTS })}</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
                <div style={{ fontSize:36, fontWeight:800, color:"var(--text)", letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {workoutTotal30}
                </div>
                <div style={{ fontSize:11, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("workout_outcomes_total_30d")}</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {RANKED_OUTCOMES.map(oc => {
                  const n = workoutOutcomeCounts[oc];
                  const pct = workoutClassifiedTotal > 0 ? Math.round((n / workoutClassifiedTotal) * 100) : 0;
                  const color = OUTCOME_COLOR[oc];
                  const label = tInsights(`workout_outcome_label_${oc.toLowerCase()}`);
                  return (
                    <div key={oc} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:78, fontSize:10, color, fontWeight:700, letterSpacing:"0.02em" }}>{label}</div>
                      <div style={{ flex:1, position:"relative", height:6, borderRadius:99, background:"var(--surface-soft)", overflow:"hidden" }}>
                        <div style={{ width:`${pct}%`, height:"100%", background:color, opacity:0.85 }}/>
                      </div>
                      <div style={{ width:54, textAlign:"right", fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
                        {pct}% · {n}
                      </div>
                    </div>
                  );
                })}
                {workoutOutcomeCounts.PENDING > 0 && (
                  <div style={{ marginTop:2, fontSize:9, color:"var(--text-faint)" }}>
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
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("workout_bg_response_sub")}</div>
          </div>
          {!bgResponseEnough ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:600 }}>{tInsights("insufficient_data")}</div>
              <div style={{ fontSize:9, color:"var(--text-faint)", marginTop:4 }}>{tInsights("workout_bg_response_min_required", { min: MIN_DATAPOINTS })}</div>
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
                      <div style={{ fontSize:11, fontWeight:700, color:"var(--text)", letterSpacing:"0.01em" }}>{row.label}</div>
                      <div style={{ fontSize:9, color:"var(--text-dim)", marginTop:1 }}>{tInsights("workout_bg_response_session_count", { n: row.count })}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                      <div style={{ fontSize:18, fontWeight:800, color, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                        {sign}{Math.abs(row.avgDelta)}
                      </div>
                      <div style={{ fontSize:9, color:"var(--text-dim)", fontWeight:600 }}>mg/dL</div>
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
          accent={ACCENT}
          back={
            <ThresholdBack
              title={tInsights("workout_patterns_back_title")}
              accent={ACCENT}
              paragraphs={[
                tInsights("workout_patterns_back_p1"),
                tInsights("workout_patterns_back_p2"),
                tInsights("workout_patterns_back_p3", { patterns: workoutPatterns.length, evaluated: exerciseEvaluated.length }),
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text={tInsights("card_workout_patterns_title")}/>
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("card_workout_patterns_signal_count", { n: workoutPatterns.length })}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {workoutPatterns.map((p, i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"8px 10px", background:`${p.color}10`, border:`1px solid ${p.color}25`, borderRadius:10, alignItems:"flex-start" }}>
                <div style={{ width:22, height:22, borderRadius:99, background:`${p.color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:11, color:p.color, fontWeight:700 }}>
                  {p.icon}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:p.color, marginBottom:2 }}>{p.title}</div>
                  <div style={{ fontSize:10, color:"var(--text-dim)", lineHeight:1.45 }}>{p.desc}</div>
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
        <FlipCard
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
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("card_meal_type_sub")}</div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
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
                    <div style={{ fontSize:9, fontWeight:700, color:col, letterSpacing:"0.06em", textTransform:"uppercase", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{TYPE_LABELS[type]}</div>
                    <div style={{ fontSize:11, fontWeight:700, color:has?barCol:"var(--text-faint)", fontFamily:"var(--font-mono)" }}>
                      {has ? `${successPct}%` : "—"}
                    </div>
                  </div>
                  <div style={{ height:4, borderRadius:99, background:"var(--surface-soft)", overflow:"hidden", marginBottom:6 }}>
                    <div style={{ height:"100%", width:`${successPct}%`, background:barCol, borderRadius:99 }}/>
                  </div>
                  <div style={{ fontSize:9, color:"var(--text-dim)", lineHeight:1.4 }}>
                    {has
                      ? tInsights("meal_type_card_summary", { n: data.count, carbs: carbUnit.display(avgC), insulin: avgI })
                      : tInsights("meal_type_card_no_data")}
                  </div>
                </div>
              );
            })}
          </div>
        </FlipCard>
      ),
    },
    {
      id: "time-of-day",
      node: (
        <FlipCard
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
            <div style={{ fontSize:9, color:"var(--text-dim)" }}>{tInsights("card_time_of_day_sub")}</div>
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
                  <div style={{ fontSize:10, color:"var(--text-muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{tInsights(i18nKey)}</div>
                  <div style={{ height:6, borderRadius:99, background:"var(--surface-soft)", overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:99 }}/>
                  </div>
                  <div style={{ fontSize:10, fontWeight:700, color: has?col:"var(--text-faint)", textAlign:"right", fontFamily:"var(--font-mono)" }}>{has?`${pct}%`:"—"}</div>
                  <div style={{ fontSize:9, color:"var(--text-faint)", textAlign:"right" }}>{data.count}</div>
                </div>
              );
            })}
          </div>
        </FlipCard>
      ),
    },
    {
      id: "performance-tiles",
      node: (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {[
            // Raw ICR moved to slot 0 (top-left) so it sits visually adjacent
            // to the Adaptive Engine hero card directly above the grid —
            // grouping both ICR-related views into one cluster. Color switched
            // from ORANGE to ACCENT_SOFT (lighter sibling of the Adaptive
            // Engine's ACCENT) to signal "same metric family, lower hierarchy".
            { label:tInsights("tile_raw_icr_label"),      val:`1:${estICR}`,   sub:tInsights("tile_raw_icr_sub"), color:ACCENT_SOFT,
              formula:tInsights("tile_raw_icr_formula"),   explain:tInsights("tile_raw_icr_explain"),
              infoBack: (
                <IcrInfoBack
                  heading={tInsights("raw_icr_info_heading")}
                  accent={ACCENT_SOFT}
                  body={tInsights("raw_icr_info_body")}
                  subLine={tInsights("raw_icr_info_subline")}
                />
              ),
            },
            { label:tInsights("tile_avg_glucose_label"),  val:`${avgGlucose}`, sub:tInsights("tile_avg_glucose_sub"),           color:ACCENT,
              formula:tInsights("tile_avg_glucose_formula"),      explain:tInsights("tile_avg_glucose_explain") },
            // Good rate moved out of slot 0 into Raw ICR's previous position.
            { label:tInsights("tile_good_rate_label"),    val:`${goodRate.toFixed(1)}%`,  sub:tInsights("tile_good_rate_sub", { good: goodAll, total }),   color:GREEN,
              formula:tInsights("tile_good_rate_formula"),            explain:tInsights("tile_good_rate_explain") },
            { label:tInsights("tile_avg_insulin_label"),  val:`${avgInsulin}u`, sub:tInsights("tile_avg_insulin_sub", { carbs: carbUnit.display(avgCarbs) }), color:"#A78BFA",
              formula:tInsights("tile_avg_insulin_formula"),               explain:tInsights("tile_avg_insulin_explain") },
          ].map((t,i) => <InsightFlipTile key={i} tile={t}/>)}
        </div>
      ),
    },
  ];

  return (
    // 480px max-width keeps the cards in their natural mockup
    // proportions on tablet/desktop instead of stretching them out.
    <div style={{ maxWidth:480, margin:"0 auto" }}>
      <div style={{ marginBottom:18 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Insights</h1>
        <p style={{ color:"var(--text-faint)", fontSize:12 }}>{tInsights("header_subtitle", { n: total })}</p>
      </div>

      {/* Filter out items whose node was set to null (e.g. workout-patterns
          when fewer than 2 patterns are detected — spec says hide entirely). */}
      <InsightsSortable items={items.filter(it => it.node !== null)}/>
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
}: {
  adaptiveICR: ReturnType<typeof computeAdaptiveICR>;
  engineMeals: Meal[];
  engineBoluses: InsulinLog[];
  onLinked: (bolusId: string, mealId: string) => void;
}) {
  const tInsights = useTranslations("insights");
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  // Recompute the time-window pairs from the same primitives the
  // engine uses, then keep only the ones whose pairing came from the
  // heuristic (explicit ones don't need the user's attention).
  const allPairs = pairBolusesToMeals(engineBoluses, engineMeals);
  const timeWindowPairs = allPairs.filter(p => p.source === "time-window");
  const hasTimeWindow = timeWindowPairs.length > 0;
  const mealColumn = Math.max(0, adaptiveICR.sampleSize - adaptiveICR.pairedCount);

  return (
    <div style={{ marginTop: -4, marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => hasTimeWindow && setOpen(o => !o)}
        title={tInsights("engine_icr_source_tooltip")}
        disabled={!hasTimeWindow}
        style={{
          width: "100%", textAlign: "left",
          background: "transparent", border: "none", padding: 0,
          fontSize: 10, color: "var(--text-faint)", lineHeight: 1.4,
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
          <span style={{ marginLeft: 6, color: "var(--accent)", fontWeight: 700 }}>
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
          <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.5 }}>
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
                <div style={{ flex: 1, minWidth: 160, fontSize: 11, color: "var(--text-strong)", lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 700 }}>{p.bolus.units}u {p.bolus.insulin_name || ""}</div>
                  <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
                    {tInsights("engine_icr_relink_pair_line", {
                      bolusAt: dtFmt(bolusTime),
                      meal: mealLabel,
                      mealAt: dtFmt(mealTime),
                      deltaMin: Math.round(p.deltaMs / 60_000),
                    })}
                  </div>
                  {isErr && (
                    <div style={{ fontSize: 10, color: PINK, marginTop: 4 }}>
                      {tInsights("engine_icr_relink_failed")}
                    </div>
                  )}
                </div>
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
                    fontSize: 11, fontWeight: 700,
                    cursor: isBusy ? "wait" : "pointer",
                    opacity: isBusy ? 0.7 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isBusy ? tInsights("engine_icr_relink_busy") : tInsights("engine_icr_relink_confirm")}
                </button>
              </div>
            );
          })}
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
      fontSize:9, fontWeight:700, letterSpacing:"0.1em",
      color: color ?? "var(--text-dim)", textTransform:"uppercase",
    }}>{text}</div>
  );
}

/** Sparkline — ported 1:1 from `components/AppMockupPhone.tsx`. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 268, H = 36;
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
      fontSize:10, color:"var(--text-muted)", lineHeight:1.35,
      maxWidth:"100%",
    }}>
      <span aria-hidden style={{ fontSize:11, lineHeight:1.2 }}>⚕️</span>
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
      <div style={{ fontSize:12, color:accent, fontWeight:700, letterSpacing:"0.01em", lineHeight:1.25 }}>
        {title}
      </div>
      <div style={{ fontSize:10, color:"var(--text-body)", lineHeight:1.5, display:"flex", flexDirection:"column", gap:6 }}>
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
      <div style={{ fontSize:12, color:accent, fontWeight:700, letterSpacing:"0.01em", lineHeight:1.25 }}>
        {heading}
      </div>
      <div style={{ fontSize:11, color:"var(--text-body)", lineHeight:1.55 }}>{body}</div>
      <div style={{ fontSize:9, color:"var(--text-dim)", letterSpacing:"0.02em", marginTop:2 }}>
        {subLine}
      </div>
      {/* Bottom region: disclaimer chip + return hint, both pinned to the bottom. */}
      <div style={{ marginTop:"auto", paddingTop:10, display:"flex", flexDirection:"column", gap:6 }}>
        <DisclaimerChip/>
        <div style={{ fontSize:9, color:"var(--text-faint)", textAlign:"right", letterSpacing:"0.02em" }}>
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
      fontSize:10, lineHeight:1,
      color:"var(--text-dim)",
      pointerEvents:"none",
    }}>{"\u2139\uFE0E"}</span>
  );
}

function FlipCard({
  children, back, accent = ACCENT, padding = "12px 14px",
}: {
  children: React.ReactNode;
  back: React.ReactNode;
  accent?: string;
  padding?: string;
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

  const frontShell: React.CSSProperties = {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    padding,
    boxSizing: "border-box",
  };
  const backShell: React.CSSProperties = {
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
      {/* GHOST — invisible, in normal flow, determines parent height. */}
      <div aria-hidden style={{ visibility:"hidden", pointerEvents:"none", ...(activeFace==="back" ? backShell : frontShell) }}>
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
        <div style={{ fontSize:10, color:accent, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{title}</div>
        <span style={{ fontSize:9, color:"var(--text-faint)" }}>{tInsights("flip_hint_back")}</span>
      </div>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize:11, color:"var(--text-muted)", lineHeight:1.5 }}>{p}</div>
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

  const frontShell: React.CSSProperties = {
    background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14,
    padding:"10px 12px", boxSizing:"border-box",
  };
  const backShell: React.CSSProperties = {
    background:`linear-gradient(145deg, ${tile.color}12, ${SURFACE} 65%)`,
    border:`1px solid ${tile.color}33`, borderRadius:14,
    padding:"10px 12px", boxSizing:"border-box",
  };

  const frontContent = (
    <>
      <CardLabel text={tile.label}/>
      <div style={{ fontSize:24, fontWeight:800, color:tile.color, fontFamily:"var(--font-mono)", lineHeight:1, letterSpacing:"-0.03em", marginTop:6 }}>
        {tile.val}
      </div>
      <div style={{ fontSize:9, color:"var(--text-faint)", marginTop:4 }}>{tile.sub}</div>
      {/* Show ℹ affordance only on tiles that opt-in to a richer back side. */}
      {tile.infoBack && <InfoCornerIcon/>}
    </>
  );
  // If the tile supplies a custom info back (e.g. Raw ICR), render that instead
  // of the default formula/explain pair. Other tiles keep the legacy back.
  const backContent = tile.infoBack ?? (
    <>
      <div style={{ fontSize:9, fontWeight:700, color:tile.color, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>
        {tile.label}
      </div>
      <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", background:"var(--surface-soft)", padding:"4px 6px", borderRadius:5, marginBottom:4, wordBreak:"break-word" }}>
        {tile.formula}
      </div>
      <div style={{ fontSize:10, color:"var(--text-muted)", lineHeight:1.4 }}>{tile.explain}</div>
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
