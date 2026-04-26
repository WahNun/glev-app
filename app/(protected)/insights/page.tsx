"use client";

import React, { useState, useEffect, useId } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import { detectPattern } from "@/lib/engine/patterns";
import { suggestAdjustment, type AdaptiveSettings, type AdjustmentSuggestion } from "@/lib/engine/adjustment";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import { useCardOrder } from "@/lib/cardOrder";
import { parseDbTs, parseDbDate } from "@/lib/time";
import {
  fetchFingersticks,
  type FingerstickReading,
} from "@/lib/fingerstick";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog, type ExerciseType } from "@/lib/exercise";
import { evaluateExercise, type ExerciseOutcome } from "@/lib/exerciseEval";

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
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";
const HIGH_YELLOW = "#FFD166";

const WEEKDAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const EVAL_NORM = (ev: string|null) => {
  if (!ev) return "GOOD";
  if (ev==="OVERDOSE"||ev==="HIGH") return "HIGH";
  if (ev==="UNDERDOSE"||ev==="LOW") return "LOW";
  return ev;
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
  const [meals, setMeals]               = useState<Meal[]>([]);
  const [insulinLogs, setInsulinLogs]   = useState<InsulinLog[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [fingersticks, setFingersticks] = useState<FingerstickReading[]>([]);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    // 14d covers every metric window (CV% needs 14d; hypo/hyper/TDD only 7d).
    const fingerstickFromIso = new Date(Date.now() - 14 * 86400000).toISOString();
    Promise.all([
      fetchMeals().catch(() => [] as Meal[]),
      fetchRecentInsulinLogs(14).catch(() => [] as InsulinLog[]),
      fetchRecentExerciseLogs(30).catch(() => [] as ExerciseLog[]),
      fetchFingersticks(fingerstickFromIso).catch(() => [] as FingerstickReading[]),
    ])
      .then(([m, il, ex, fs]) => {
        setMeals(m);
        setInsulinLogs(il);
        setExerciseLogs(ex);
        setFingersticks(fs);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", gap:12, color:"rgba(255,255,255,0.3)" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:20, height:20, border:`2px solid ${ACCENT}`, borderTopColor:"transparent", borderRadius:99, animation:"spin 0.8s linear infinite" }}/>
      Loading insights…
    </div>
  );

  const total = meals.length;
  if (total === 0) return (
    <div style={{ maxWidth:480, margin:"0 auto" }}>
      <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:8 }}>Insights</h1>
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"48px", textAlign:"center", color:"rgba(255,255,255,0.25)", fontSize:14 }}>Log at least 5 meals to see insights.</div>
    </div>
  );

  const now = Date.now();
  const oneWeekMs = 7 * 86400000;
  const wkAgo  = now - oneWeekMs;
  const wk2Ago = now - 2 * oneWeekMs;
  const last7 = meals.filter(m => now - parseDbTs(m.created_at) <= oneWeekMs);

  // ── Time in Range buckets (consensus 70–180 mg/dL band) ──
  const last7Bg = last7.filter(m => m.glucose_before != null).map(m => m.glucose_before as number);
  const prev7Bg = meals.filter(m => {
    const t = parseDbTs(m.created_at);
    return t > wk2Ago && t <= wkAgo && m.glucose_before != null;
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
  const trendDays: { label: string; avg: number | null }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now - i * 86400000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = dayStart.getTime() + 86400000;
    const dayBgs = meals
      .filter(m => {
        const t = parseDbTs(m.created_at);
        return t >= dayStart.getTime() && t < dayEnd && m.glucose_before != null;
      })
      .map(m => m.glucose_before as number);
    trendDays.push({
      label: WEEKDAY_SHORT[dayStart.getDay()],
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
  const fourteenAgo = now - 14 * 86400000;
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
    ? "rgba(255,255,255,0.4)"
    : cvPct < CV_STABLE_PCT ? GREEN
    : cvPct <= CV_HIGH_PCT  ? HIGH_YELLOW
    : PINK;

  // ── TDD: total daily insulin units (bolus + basal) ──
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const tddByDay = new Map<string, number>();
  for (const il of insulinLogs) {
    const t = parseDbTs(il.created_at);
    if (t < wkAgo) continue;
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    tddByDay.set(key, (tddByDay.get(key) ?? 0) + Number(il.units || 0));
  }
  const tddDayCount    = tddByDay.size;
  const tddEnough      = tddDayCount >= MIN_DATAPOINTS;
  const tddTodayKey    = startToday.toISOString().slice(0, 10);
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
  const EX_TYPE_LABEL_DE: Record<ExerciseType, string> = {
    run: "Laufen", cycling: "Radfahren", cardio: "Cardio",
    hiit: "HIIT", strength: "Krafttraining", hypertrophy: "Krafttraining", yoga: "Yoga",
  };
  const bgResponseRows = Array.from(typeAgg.entries())
    .filter(([, s]) => s.count >= MIN_DATAPOINTS)
    .map(([k, s]) => ({ type: k, label: EX_TYPE_LABEL_DE[k] ?? k, count: s.count, avgDelta: Math.round(s.deltaSum / s.count) }))
    .sort((a, b) => b.count - a.count);
  const bgResponseEnough = bgResponseRows.length > 0;

  // Auto-detected workout patterns. Spec: max 3, hide section if < 2.
  type WorkoutPattern = { title: string; desc: string; color: string; icon: string };
  const OUTCOME_LABEL_DE: Record<ExerciseOutcome, string> = {
    STABLE: "stabilem BG", DROPPED: "starkem BG-Abfall",
    SPIKED: "BG-Anstiegen", HYPO_RISK: "Hypo-Risiko", PENDING: "—",
  };
  const OUTCOME_COLOR_DE: Record<ExerciseOutcome, string> = {
    STABLE: GREEN, DROPPED: HIGH_YELLOW, SPIKED: ORANGE, HYPO_RISK: PINK, PENDING: "rgba(255,255,255,0.4)",
  };
  const OUTCOME_ICON_DE: Record<ExerciseOutcome, string> = {
    STABLE: "✓", DROPPED: "↓", SPIKED: "↑", HYPO_RISK: "⚠", PENDING: "•",
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
        desc: `führt häufig zu ${OUTCOME_LABEL_DE[bestOutcome]} (${pct} % von ${g.count} Sessions)`,
        color: OUTCOME_COLOR_DE[bestOutcome],
        icon: OUTCOME_ICON_DE[bestOutcome],
      });
    }
    // Largest sample first → more trustworthy patterns float to the top.
    return out.sort((a, b) => {
      const an = parseInt(a.desc.match(/von (\d+)/)?.[1] ?? "0", 10);
      const bn = parseInt(b.desc.match(/von (\d+)/)?.[1] ?? "0", 10);
      return bn - an;
    });
  }
  const TOD_LABEL_DE = { morning:"Morgentraining", afternoon:"Nachmittagstraining", evening:"Abendtraining", night:"Nachttraining" } as const;
  type TodKey = keyof typeof TOD_LABEL_DE;
  const todKey = (ex: ExerciseLog): TodKey => {
    const h = new Date(parseDbTs(ex.created_at)).getHours();
    return (h >= 5 && h < 11) ? "morning" : (h < 17 ? "afternoon" : (h < 22 ? "evening" : "night"));
  };
  const DUR_LABEL_DE = { short:"Trainings unter 30 Minuten", medium:"Trainings 30–60 Minuten", long:"Trainings über 60 Minuten" } as const;
  type DurKey = keyof typeof DUR_LABEL_DE;
  // Returns null for missing / non-finite / non-positive durations so the
  // caller (`detectGroup`) skips legacy rows where `duration_minutes` is
  // null/undefined instead of misbucketing them as "long".
  const durKey = (ex: ExerciseLog): DurKey | null => {
    const d = ex.duration_minutes;
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) return null;
    return d < 30 ? "short" : d <= 60 ? "medium" : "long";
  };

  const workoutPatternsAll = [
    ...detectGroup<TodKey>(todKey, k => TOD_LABEL_DE[k]),
    ...detectGroup<ExerciseType>(ex => normType(ex.exercise_type), k => EX_TYPE_LABEL_DE[k] ?? k),
    ...detectGroup<DurKey>(durKey, k => DUR_LABEL_DE[k]),
  ];
  const workoutPatterns = workoutPatternsAll.slice(0, 3);
  const showWorkoutPatterns = workoutPatterns.length >= 2;

  // ── Meal evaluation distribution ──
  const evals = last7
    .map(m => EVAL_NORM(m.evaluation))
    .filter(e => e === "GOOD" || e === "SPIKE" || e === "HIGH" || e === "LOW");
  const goodN  = evals.filter(e => e === "GOOD").length;
  const spikeN = evals.filter(e => e === "SPIKE" || e === "HIGH").length;
  const lowN   = evals.filter(e => e === "LOW").length;
  const totalN = goodN + spikeN + lowN;
  const evalPct = (n: number) => totalN > 0 ? Math.round((n / totalN) * 100) : 0;
  const evalRows = [
    { label:"On target", count:goodN,  color:GREEN,  pct:evalPct(goodN)  },
    { label:"Spiked",    count:spikeN, color:ORANGE, pct:evalPct(spikeN) },
    { label:"Low risk",  count:lowN,   color:PINK,   pct:evalPct(lowN)   },
  ];

  // ── Deeper-analysis derivations (used by cards under the hero block) ──
  const normed     = meals.map(m => ({ ...m, ev: EVAL_NORM(m.evaluation) }));
  const goodAll    = normed.filter(m => m.ev==="GOOD").length;
  const goodRate   = Math.round(goodAll/total*100);
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
      if (EVAL_NORM(m.evaluation)==="GOOD") types[t].good++;
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
    if (EVAL_NORM(m.evaluation)==="GOOD") timeGroups[key].good++;
  });

  // Pattern detection (last 10 meals + time-of-day cross-check)
  const recentMeals = meals.slice(0, 10);
  const recentGood  = recentMeals.filter(m=>EVAL_NORM(m.evaluation)==="GOOD").length;
  const recentLow   = recentMeals.filter(m=>EVAL_NORM(m.evaluation)==="LOW").length;
  const recentHigh  = recentMeals.filter(m=>EVAL_NORM(m.evaluation)==="HIGH").length;
  const patterns: {icon:string;title:string;desc:string;color:string}[] = [];
  if (recentLow >= 4)  patterns.push({ icon:"↑", title:"Consistent under-dosing", desc:`${recentLow} of last 10 meals were under-dosed. Consider increasing your ICR ratio or checking carb counts.`, color:ORANGE });
  if (recentHigh >= 3) patterns.push({ icon:"↓", title:"Frequent over-dosing", desc:`${recentHigh} of last 10 meals led to over-dose. Review correction factor — it may be too aggressive.`, color:PINK });
  if (recentGood >= 7) patterns.push({ icon:"✓", title:"Strong recent control", desc:`${recentGood} of your last 10 meals were well-dosed. Your current insulin strategy is working.`, color:GREEN });
  const morningSucc = timeGroups["Morning (5–11)"];
  const eveningSucc = timeGroups["Evening (17–21)"];
  if (morningSucc.count >= 3 && morningSucc.good/morningSucc.count < 0.5) patterns.push({ icon:"☀", title:"Morning control issues", desc:"Morning meals have a lower success rate. Dawn phenomenon may be increasing insulin resistance.", color:ORANGE });
  if (eveningSucc.count >= 3 && eveningSucc.good/eveningSucc.count > 0.8) patterns.push({ icon:"🌙", title:"Evening dosing strength", desc:"Evening meal dosing is particularly accurate. Use evening meals as reference for ICR calibration.", color:ACCENT });
  if (patterns.length === 0) patterns.push({ icon:"→", title:"No strong patterns yet", desc:"Log 15+ meals to activate pattern detection. More data reveals deeper insights.", color:"rgba(255,255,255,0.3)" });

  // Adaptive engine derivations
  const adaptiveICR  = computeAdaptiveICR(meals);
  const enginePattern = detectPattern(meals);
  const settings: AdaptiveSettings = {
    icr: adaptiveICR.global ? Math.round(adaptiveICR.global * 10) / 10 : 15,
    correctionFactor: 50,
    lastUpdated: null,
    adjustmentHistory: [],
  };
  const suggestion: AdjustmentSuggestion = suggestAdjustment(settings, enginePattern);

  const TYPE_HELP: Record<string, string> = {
    FAST_CARBS:   "Quick-digesting carbs. Pre-bolus 10–15 min ahead.",
    HIGH_PROTEIN: "Slower glucose rise; some users need a small carb-equivalent dose for protein.",
    HIGH_FAT:     "Fat-heavy meals delay carb absorption — consider a split or extended bolus.",
    BALANCED:     "Mixed macros at moderate amounts. Most predictable for standard ICR dosing.",
  };

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
              title="Time in Range"
              accent={GREEN}
              paragraphs={[
                "Time in Range is the share of pre-meal glucose readings inside the 70–180 mg/dL consensus target band for adults with type 1 diabetes.",
                "Buckets follow the consensus recommendations: Very low (<54), Low (54–69), In range (70–180), High (>180). Spending more time in range is consistently linked to better long-term outcomes.",
                `Computed from ${b7.n} pre-meal reading${b7.n === 1 ? "" : "s"} in the last 7 days. The delta vs the prior 7 days reflects week-over-week movement.`,
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text="Time in range · 7d"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>70–180 mg/dL</div>
          </div>
          {b7.n === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:11 }}>
              Log meals with pre-meal glucose to see your time-in-range.
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
                    {tirDelta >= 0 ? "+" : ""}{tirDelta} vs prev wk
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
                style={{ display:"flex", height:12, borderRadius:99, overflow:"hidden", background:"rgba(255,255,255,0.04)" }}
              >
                {tbrPct > 0 && <div style={{ width:`${tbrPct}%`, background:PINK }}/>}
                {tirPct > 0 && <div style={{ width:`${tirPct}%`, background:GREEN }}/>}
                {tarPct > 0 && <div style={{ width:`${tarPct}%`, background:HIGH_YELLOW }}/>}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:9, color:"rgba(255,255,255,0.5)", flexWrap:"wrap", gap:6 }}>
                <span style={{ color:PINK }}>● TBR &lt;70 · {tbrPct}%</span>
                <span style={{ color:GREEN }}>● TIR 70–180 · {tirPct}%</span>
                <span style={{ color:HIGH_YELLOW }}>● TAR &gt;180 · {tarPct}%</span>
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
                title="Average Glucose"
                accent={ACCENT}
                paragraphs={[
                  "Mean pre-meal glucose across the last 7 days, calculated only from meals with a logged pre-meal reading.",
                  "Lower values reflect better fasting and overnight control. The delta vs the prior 7 days surfaces week-over-week movement.",
                  `Computed from ${last7Bg.length} reading${last7Bg.length === 1 ? "" : "s"} in the last 7 days.`,
                ]}
              />
            }
          >
            <CardLabel text="Avg BG"/>
            {last7Avg == null ? (
              <div style={{ fontSize:24, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
                  <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                    {Math.round(last7Avg)}
                  </div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>mg/dL</div>
                </div>
                {bgDelta != null && (
                  <div style={{ fontSize:9, color: bgDelta < 0 ? GREEN : bgDelta > 0 ? ORANGE : "rgba(255,255,255,0.4)", marginTop:2, fontWeight:600 }}>
                    {bgDelta > 0 ? "+" : bgDelta < 0 ? "−" : ""}{Math.abs(bgDelta)} vs prev
                  </div>
                )}
              </>
            )}
          </FlipCard>
          <FlipCard
            accent={ACCENT}
            back={
              <FlipBack
                title="GMI / Estimated A1C"
                accent={ACCENT}
                paragraphs={[
                  "GMI (Glucose Management Indicator) approximates lab A1C from your average glucose. Formula: GMI(%) = 3.31 + 0.02392 × avg BG (mg/dL) — Bergenstal et al., Diabetes Care 2018.",
                  "A useful interim signal between clinic A1C draws — but not a substitute. Real A1C captures longer-term glycation that GMI cannot, and individual differences in red-blood-cell turnover can shift the two apart.",
                  `Computed from your last 7 days of pre-meal readings${last7Avg != null ? ` (avg ${Math.round(last7Avg)} mg/dL across ${last7Bg.length})` : ""}.`,
                ]}
              />
            }
          >
            <CardLabel text="GMI / est. A1C"/>
            {gmi == null ? (
              <div style={{ fontSize:24, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
                  <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                    {gmi.toFixed(1)}
                  </div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>%</div>
                </div>
                {gmiDelta != null && (
                  <div style={{ fontSize:9, color: gmiDelta < 0 ? GREEN : gmiDelta > 0 ? ORANGE : "rgba(255,255,255,0.4)", marginTop:2, fontWeight:600 }}>
                    {gmiDelta > 0 ? "+" : gmiDelta < 0 ? "−" : ""}{Math.abs(gmiDelta).toFixed(1)} vs prev
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
              title="7-Day Trend"
              accent={ACCENT}
              paragraphs={[
                "Average pre-meal glucose for each of the last 7 days. Days without data inherit the previous day's value so the line stays continuous.",
                "Look for a flat line in your target range (70–180 mg/dL) and steady morning values. A rising slope over multiple days suggests it's time to revisit your basal or ICR.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text="7-day trend"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>avg per day</div>
          </div>
          <Sparkline values={trendValues} color={ACCENT}/>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:8, color:"rgba(255,255,255,0.35)" }}>
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
                title="Hypo Events · 7d"
                accent={accent}
                paragraphs={[
                  "Anzahl Glukose-Messwerte unter 70 mg/dL in den letzten 7 Tagen. Gepoolt aus Mahlzeiten, Insulin- und Bewegungs-Logs sowie manuellen Fingersticks.",
                  "70 mg/dL ist die klinische Grenze für Hypoglykämie (ATTD-Konsensus 2019). Häufige Hypos können auf zu hohe Bolus-Dosen, zu hohes Basal oder ein zu niedriges ICR hindeuten.",
                  hypoEnough
                    ? `Berechnet aus ${readings7.length} Messwert${readings7.length === 1 ? "" : "en"} der letzten 7 Tage.`
                    : "Mindestens 3 Messwerte in 7 Tagen nötig, um diese Karte anzuzeigen.",
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text="Hypo Events · 7d"/>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>&lt; {HYPO_THRESHOLD_MGDL} mg/dL</div>
            </div>
            {!hypoEnough ? (
              <div style={{ padding:"18px 0", textAlign:"center" }}>
                <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", fontWeight:600 }}>Nicht genug Daten</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:4 }}>≥ {MIN_DATAPOINTS} Messwerte erforderlich</div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:accent, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {hypoCount7d}
                </div>
                <div style={{ fontSize:11, color:accent, fontWeight:600 }}>
                  {hypoCount7d === 0 ? "Keine Hypos" : hypoCount7d === 1 ? "Hypo" : "Hypos"}
                </div>
                <div style={{ marginLeft:"auto", fontSize:9, color:"rgba(255,255,255,0.4)" }}>
                  {readings7.length} Messwerte
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
                title="Hyper Events · 7d"
                accent={accent}
                paragraphs={[
                  "Anzahl Glukose-Messwerte über 250 mg/dL in den letzten 7 Tagen. Gepoolt aus Mahlzeiten, Insulin- und Bewegungs-Logs sowie manuellen Fingersticks.",
                  "Werte über 250 mg/dL gelten als deutliche Hyperglykämie (ATTD-Konsensus 2019). Häufige Hyper-Events können auf ein zu hohes ICR, einen zu niedrigen Bolus oder ein zu niedriges Basal hindeuten.",
                  hyperEnough
                    ? `Berechnet aus ${readings7.length} Messwert${readings7.length === 1 ? "" : "en"} der letzten 7 Tage.`
                    : "Mindestens 3 Messwerte in 7 Tagen nötig, um diese Karte anzuzeigen.",
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <CardLabel text="Hyper Events · 7d"/>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>&gt; {HYPER_THRESHOLD_MGDL} mg/dL</div>
            </div>
            {!hyperEnough ? (
              <div style={{ padding:"18px 0", textAlign:"center" }}>
                <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", fontWeight:600 }}>Nicht genug Daten</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:4 }}>≥ {MIN_DATAPOINTS} Messwerte erforderlich</div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:accent, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {hyperCount7d}
                </div>
                <div style={{ fontSize:11, color:accent, fontWeight:600 }}>
                  {hyperCount7d === 0 ? "Keine Hypers" : hyperCount7d === 1 ? "Hyper" : "Hypers"}
                </div>
                <div style={{ marginLeft:"auto", fontSize:9, color:"rgba(255,255,255,0.4)" }}>
                  {readings7.length} Messwerte
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
              title="Glukose-Variabilität · 14d"
              accent={cvColor}
              paragraphs={[
                "Variationskoeffizient (CV%) = (Standardabweichung / Mittelwert) × 100, berechnet aus allen Glukose-Messwerten der letzten 14 Tage. Zeigt, wie stabil oder schwankend deine Glukose verläuft — unabhängig vom Niveau.",
                "ATTD-Konsensus 2019: < 36 % gilt als stabil (grün), 36–50 % als mittel (gelb), > 50 % als instabil (rot). Höhere CV-Werte korrelieren mit häufigeren Hypos.",
                cvEnough
                  ? `Berechnet aus ${readings14.length} Messwert${readings14.length === 1 ? "" : "en"} der letzten 14 Tage.`
                  : "Mindestens 3 Messwerte in 14 Tagen nötig, um diese Karte anzuzeigen.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text="Glukose-Variabilität · 14d"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>CV%</div>
          </div>
          {!cvEnough || cvPct == null ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", fontWeight:600 }}>Nicht genug Daten</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:4 }}>≥ {MIN_DATAPOINTS} Messwerte erforderlich</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:8 }}>
                <div style={{ fontSize:36, fontWeight:800, color:cvColor, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {cvPct.toFixed(1)}
                </div>
                <div style={{ fontSize:14, color:cvColor, fontWeight:700 }}>%</div>
                <div style={{ marginLeft:"auto", fontSize:9, color:cvColor, fontWeight:700 }}>
                  {cvPct < CV_STABLE_PCT ? "Stabil" : cvPct <= CV_HIGH_PCT ? "Mittel" : "Instabil"}
                </div>
              </div>
              {/* Threshold bar: green ≤36, yellow 36–50, red >50 (clamped to 75% for display). */}
              <div style={{ position:"relative", height:6, borderRadius:99, overflow:"hidden", background:"rgba(255,255,255,0.05)" }}>
                <div style={{ position:"absolute", left:0,           top:0, bottom:0, width:`${(CV_STABLE_PCT/75)*100}%`,                              background:GREEN,       opacity:0.55 }}/>
                <div style={{ position:"absolute", left:`${(CV_STABLE_PCT/75)*100}%`, top:0, bottom:0, width:`${((CV_HIGH_PCT-CV_STABLE_PCT)/75)*100}%`, background:HIGH_YELLOW, opacity:0.55 }}/>
                <div style={{ position:"absolute", left:`${(CV_HIGH_PCT/75)*100}%`,   top:0, bottom:0, right:0,                                          background:PINK,        opacity:0.55 }}/>
                <div style={{ position:"absolute", left:`${Math.min(cvPct, 75) / 75 * 100}%`, top:-2, bottom:-2, width:2, background:"#fff", borderRadius:1, transform:"translateX(-1px)" }}/>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:8, color:"rgba(255,255,255,0.4)" }}>
                <span style={{ color:GREEN }}>● &lt; 36 stabil</span>
                <span style={{ color:HIGH_YELLOW }}>● 36–50 mittel</span>
                <span style={{ color:PINK }}>● &gt; 50 instabil</span>
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
              title="Meal Evaluation"
              accent={ORANGE}
              paragraphs={[
                "Each logged meal is bucketed into one of three outcome bands once the post-meal glucose lands: On target (within ±35% of the ICR estimate), Spiked (post-meal high), and Low risk (post-meal low).",
                "Spike-heavy weeks often signal under-dosing or pre-bolus timing issues. Low-risk-heavy weeks often signal over-dosing — review your correction factor with your clinician.",
                `Computed from ${totalN} evaluated meal${totalN === 1 ? "" : "s"} in the last 7 days.`,
              ]}
            />
          }
        >
          <CardLabel text="Meal evaluation · 7d"/>
          {totalN === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:11 }}>
              Log meals with post-meal glucose to see your distribution.
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
              {evalRows.map(r => (
                <div key={r.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:60, fontSize:10, color:r.color }}>{r.label}</div>
                  <div style={{ flex:1, height:6, background:"rgba(255,255,255,0.04)", borderRadius:99, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${r.pct}%`, background:r.color, borderRadius:99, transition:"width 0.3s" }}/>
                  </div>
                  <div
                    title={`${r.pct}%`}
                    style={{ width:24, textAlign:"right", fontSize:10, color:"#fff", fontFamily:"var(--font-mono)", fontWeight:600 }}
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
              heading="Wie wird dieser Wert berechnet?"
              accent={ACCENT}
              body="Der Adaptive ICR basiert auf allen abgeschlossenen Mahlzeiten (state = final, bg_2h vorhanden). Jede Mahlzeit wird nach Outcome gewichtet: Mahlzeiten mit gutem BG-Verlauf zählen stärker als Spikes oder Underdoses. Er zeigt, welche Carb-Insulin-Quote bei dir empirisch zu stabilen Werten geführt hat — nicht was du dosiert hast, sondern was tatsächlich gewirkt hat."
              subLine="Datenbasis: alle finalisierten Mahlzeiten · outcome-gewichtet"
            />
          }
        >
          {(() => {
            // Engine status maps to confidence: high → TUNED (green/ready),
            // medium → LEARNING (accent), low → WARMING UP (orange).
            // Mirrors the "AI FOOD PARSER · GPT-powered · READY" chip vibe.
            const conf = enginePattern.confidence;
            const statusLabel = conf === "high" ? "TUNED" : conf === "medium" ? "LEARNING" : "WARMING UP";
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
                  <CardLabel text="Adaptive Engine"/>
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
                  borderBottom:`1px solid rgba(255,255,255,0.05)`,
                }}>
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>
                    ICR
                  </span>
                  <span style={{
                    fontSize:24, fontWeight:800,
                    color: adaptiveICR.global ? ACCENT : "rgba(255,255,255,0.25)",
                    fontFamily:"var(--font-mono)",
                    lineHeight:1, letterSpacing:"-0.03em",
                  }}>
                    {icrText}
                  </span>
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginLeft:"auto", textAlign:"right", lineHeight:1.25 }}>
                    outcome-weighted<br/>
                    {enginePattern.sampleSize} final meal{enginePattern.sampleSize === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Pattern label */}
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.65)", lineHeight:1.5, marginBottom:6 }}>
                  <span style={{ color:"#fff", fontWeight:600 }}>{enginePattern.label}</span>
                </div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", lineHeight:1.5 }}>
                  {enginePattern.explanation}
                </div>

                {/* Suggestion / advisory block */}
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
                      {suggestion.hasSuggestion ? "Suggested adjustment" : "Advisory"}
                    </div>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.85)", lineHeight:1.5 }}>{suggestion.message}</div>
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
              title="Total Daily Dose · 7d"
              accent={ACCENT}
              paragraphs={[
                "Total Daily Dose (TDD) ist die Summe aller protokollierten Insulin-Einheiten pro Tag — Bolus + Basal aus dem Engine-Log.",
                "Hauptzahl: Tagesdurchschnitt der letzten 7 Tage (Summe ÷ 7). Heutige Tagessumme separat darunter. Eine konstante TDD signalisiert stabile Stoffwechseleinstellung; Schwankungen > 20 % können auf veränderten Insulinbedarf hindeuten.",
                tddEnough
                  ? `Berechnet aus ${insulinLogs.filter(il => parseDbTs(il.created_at) >= now - 7 * 86400000).length} Insulin-Logs an ${tddDayCount} Tagen der letzten 7 Tage.`
                  : "Mindestens 3 Tage mit Insulin-Logs in 7 Tagen nötig, um diese Karte anzuzeigen.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text="Total Daily Dose · 7d"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>U / Tag</div>
          </div>
          {!tddEnough || tddAvg7 == null ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", fontWeight:600 }}>Nicht genug Daten</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:4 }}>≥ {MIN_DATAPOINTS} Tage mit Insulin-Logs erforderlich</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <div style={{ fontSize:36, fontWeight:800, color:"#fff", letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {tddAvg7.toFixed(1)}
                </div>
                <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)", fontWeight:700 }}>U/Tag</div>
                <div style={{ marginLeft:"auto", fontSize:9, color:"rgba(255,255,255,0.4)" }}>Ø 7d</div>
              </div>
              <div style={{ marginTop:10, display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:`${ACCENT}10`, border:`1px solid ${ACCENT}25`, borderRadius:10 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontWeight:600 }}>Heute</div>
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
              title="Pattern Detection"
              accent={PINK}
              paragraphs={[
                "Glev scans the most recent 10 meals plus your time-of-day breakdown looking for repeating signals: consistent under-dosing, frequent over-dosing, strong recent control, weak mornings or strong evenings.",
                "Patterns only fire when there's enough recent data — log 15+ meals to unlock the full set of detectors.",
                "These flags are heuristics, not diagnoses. Use them as starting points for conversations with your clinician.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text="Pattern detection"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>{patterns.length} signal{patterns.length===1?"":"s"}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"8px 10px", background:`${p.color}08`, border:`1px solid ${p.color}20`, borderRadius:10, alignItems:"flex-start" }}>
                <div style={{ width:22, height:22, borderRadius:99, background:`${p.color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:11 }}>
                  {p.icon}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:p.color, marginBottom:2 }}>{p.title}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.5)", lineHeight:1.45 }}>{p.desc}</div>
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
              title="Workout Outcome Distribution"
              accent={ACCENT}
              paragraphs={[
                "Glev klassifiziert jeden Workout anhand deines Glukoseverlaufs: STABLE = BG blieb im Zielbereich. DROPPED = BG fiel deutlich, aber kein Hypo-Risiko. SPIKED = BG stieg unerwartet an. HYPO_RISK = BG fiel unter 70 mg/dL oder näherte sich kritisch.",
                "PENDING-Sessions (CGM-Werte noch nicht eingetroffen) werden nicht gewertet. Der Hauptzähler zeigt alle Trainings inklusive PENDING — die Verteilung darunter nur die ausgewerteten.",
                workoutOutcomeEnough
                  ? `${workoutTotal30} Trainings in den letzten 30 Tagen, davon ${workoutClassifiedTotal} ausgewertet.`
                  : "Mindestens 3 Trainings in 30 Tagen nötig, um diese Karte anzuzeigen.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text="Workout Outcomes · 30d"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>Verteilung</div>
          </div>
          {!workoutOutcomeEnough ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", fontWeight:600 }}>Nicht genug Daten</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:4 }}>≥ {MIN_DATAPOINTS} Trainings in 30 Tagen erforderlich</div>
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
                <div style={{ fontSize:36, fontWeight:800, color:"#fff", letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {workoutTotal30}
                </div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontWeight:600 }}>Trainings letzte 30 Tage</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {RANKED_OUTCOMES.map(oc => {
                  const n = workoutOutcomeCounts[oc];
                  const pct = workoutClassifiedTotal > 0 ? Math.round((n / workoutClassifiedTotal) * 100) : 0;
                  const color = OUTCOME_COLOR_DE[oc];
                  return (
                    <div key={oc} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:78, fontSize:10, color, fontWeight:700, letterSpacing:"0.02em" }}>{oc}</div>
                      <div style={{ flex:1, position:"relative", height:6, borderRadius:99, background:"rgba(255,255,255,0.04)", overflow:"hidden" }}>
                        <div style={{ width:`${pct}%`, height:"100%", background:color, opacity:0.85 }}/>
                      </div>
                      <div style={{ width:54, textAlign:"right", fontSize:10, color:"rgba(255,255,255,0.55)", fontFamily:"var(--font-mono)" }}>
                        {pct}% · {n}
                      </div>
                    </div>
                  );
                })}
                {workoutOutcomeCounts.PENDING > 0 && (
                  <div style={{ marginTop:2, fontSize:9, color:"rgba(255,255,255,0.35)" }}>
                    + {workoutOutcomeCounts.PENDING} PENDING (CGM-Werte ausstehend)
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
              title="BG Response nach Trainingsart"
              accent={ACCENT}
              paragraphs={[
                "Zeigt wie verschiedene Trainingsarten deinen Blutzucker im Durchschnitt beeinflussen — gemessen von vor dem Training bis eine Stunde danach. Hilft Muster zu erkennen, welche Aktivitäten BG-Anpassungen erfordern.",
                "Pro Trainingsart sind mindestens 3 Sessions mit vollständigen CGM-Werten (vor und +1h) nötig, sonst wird die Zeile ausgeblendet.",
                bgResponseEnough
                  ? `${bgResponseRows.length} Trainingsart${bgResponseRows.length === 1 ? "" : "en"} mit ausreichend Daten.`
                  : "Noch keine Trainingsart erreicht 3 Sessions mit vollständigen CGM-Werten.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text="BG-Response · Trainingsart"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>vor → +1h</div>
          </div>
          {!bgResponseEnough ? (
            <div style={{ padding:"18px 0", textAlign:"center" }}>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", fontWeight:600 }}>Nicht genug Daten</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:4 }}>≥ {MIN_DATAPOINTS} Sessions pro Trainingsart erforderlich</div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {bgResponseRows.map(row => {
                const positive = row.avgDelta > 0;
                const negative = row.avgDelta < 0;
                const color = negative ? GREEN : positive ? ORANGE : "rgba(255,255,255,0.6)";
                const sign = positive ? "+" : negative ? "−" : "±";
                return (
                  <div key={row.type} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:10 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#fff", letterSpacing:"0.01em" }}>{row.label}</div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", marginTop:1 }}>{row.count} Session{row.count === 1 ? "" : "s"}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
                      <div style={{ fontSize:18, fontWeight:800, color, fontFamily:"var(--font-mono)", lineHeight:1 }}>
                        {sign}{Math.abs(row.avgDelta)}
                      </div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", fontWeight:600 }}>mg/dL</div>
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
              title="Workout Patterns"
              accent={ACCENT}
              paragraphs={[
                "Automatisch erkannte Muster aus deinen Workout-Daten. Mindestens 3 Sessions pro Gruppe (Tageszeit, Trainingsart, Dauer) erforderlich. Muster aktualisieren sich mit jedem neuen Workout.",
                "Ein Muster erscheint nur, wenn ein Outcome (STABLE / DROPPED / SPIKED / HYPO_RISK) in mindestens 60 % der Sessions einer Gruppe dominiert. PENDING-Sessions zählen nicht mit.",
                `Aktuell ${workoutPatterns.length} Muster aus ${exerciseEvaluated.length} ausgewerteten Trainings der letzten 30 Tage.`,
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text="Workout Patterns"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>{workoutPatterns.length} Signal{workoutPatterns.length === 1 ? "" : "e"}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {workoutPatterns.map((p, i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"8px 10px", background:`${p.color}10`, border:`1px solid ${p.color}25`, borderRadius:10, alignItems:"flex-start" }}>
                <div style={{ width:22, height:22, borderRadius:99, background:`${p.color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:11, color:p.color, fontWeight:700 }}>
                  {p.icon}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:p.color, marginBottom:2 }}>{p.title}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.5)", lineHeight:1.45 }}>{p.desc}</div>
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
              title="Meal Type Analysis"
              accent={ORANGE}
              paragraphs={[
                "Glev classifies every meal into one of four macro profiles — Fast Carbs, High Protein, High Fat, or Balanced — based on the ratio of carbs, protein and fat.",
                "Success % is the share of meals in that category that landed in the GOOD outcome band. Categories with low success often need a different bolus strategy (timing, split dose, extended bolus).",
                "Categories with no logged meals are shown empty — log at least one meal of that type to see numbers.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text="Meal type · success %"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>by macro profile</div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {TYPE_ORDER.map(type => {
              const data = types[type];
              const has = data.count > 0;
              const successPct = has ? Math.round(data.good/data.count*100) : 0;
              const avgC = has ? Math.round(data.totalCarbs/data.count) : 0;
              const avgI = has ? (data.totalInsulin/data.count).toFixed(1) : "0.0";
              const col  = TYPE_COLORS[type];
              const barCol = !has ? "rgba(255,255,255,0.12)" : successPct>=70?GREEN:successPct>=50?ORANGE:PINK;
              return (
                <div key={type} style={{ background:`${col}08`, border:`1px solid ${col}20`, borderRadius:10, padding:"8px 10px", opacity: has ? 1 : 0.55 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, gap:4 }}>
                    <div style={{ fontSize:9, fontWeight:700, color:col, letterSpacing:"0.06em", textTransform:"uppercase", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{TYPE_LABELS[type]}</div>
                    <div style={{ fontSize:11, fontWeight:700, color:has?barCol:"rgba(255,255,255,0.3)", fontFamily:"var(--font-mono)" }}>
                      {has ? `${successPct}%` : "—"}
                    </div>
                  </div>
                  <div style={{ height:4, borderRadius:99, background:"rgba(255,255,255,0.05)", overflow:"hidden", marginBottom:6 }}>
                    <div style={{ height:"100%", width:`${successPct}%`, background:barCol, borderRadius:99 }}/>
                  </div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)", lineHeight:1.4 }}>
                    {has ? `${data.count} meal${data.count===1?"":"s"} · ${avgC}g · ${avgI}u` : "No data"}
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
              title="Time-of-Day Analysis"
              accent={GREEN}
              paragraphs={[
                "Meals are grouped by the hour of day they were logged: Morning (5–11), Afternoon (11–17), Evening (17–21), Night (21–5).",
                "Success % is the share of meals in that window that landed GOOD. A weak window (e.g. mornings <50%) often points at the dawn phenomenon, where insulin sensitivity is lower and you may need a higher morning ICR.",
                "Strong windows (>80%) are reliable references when you're calibrating your dosing for new foods.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text="Time of day · success %"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>by window</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {Object.entries(timeGroups).map(([label, data]) => {
              const has = data.count > 0;
              const pct = has ? Math.round(data.good/data.count*100) : 0;
              const col = !has ? "rgba(255,255,255,0.12)" : pct>=70?GREEN:pct>=50?ORANGE:PINK;
              return (
                <div key={label} style={{ display:"grid", gridTemplateColumns:"110px 1fr 32px 32px", gap:8, alignItems:"center" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</div>
                  <div style={{ height:6, borderRadius:99, background:"rgba(255,255,255,0.04)", overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:99 }}/>
                  </div>
                  <div style={{ fontSize:10, fontWeight:700, color: has?col:"rgba(255,255,255,0.3)", textAlign:"right", fontFamily:"var(--font-mono)" }}>{has?`${pct}%`:"—"}</div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", textAlign:"right" }}>{data.count}</div>
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
            { label:"Raw ICR",      val:`1:${estICR}`,   sub:"raw 7d avg · ignores outcome", color:ACCENT_SOFT,
              formula:"carbs / insulin (last 7)",      explain:"Naive average of carbs ÷ insulin over the last 7 meals. Ignores whether the dose actually landed in target — spikes and overdoses count the same as good outcomes. The Adaptive Engine ICR above is the smarter, outcome-weighted version.",
              infoBack: (
                <IcrInfoBack
                  heading="Was zeigt dieser Wert?"
                  accent={ACCENT_SOFT}
                  body="Der Raw ICR ist der einfache Durchschnitt deiner letzten 7 Dosierungen — unabhängig davon ob das Ergebnis gut oder schlecht war. Er spiegelt dein tatsächliches Dosierverhalten der letzten Tage wider. Wenn dieser Wert stark vom Adaptive ICR abweicht, kann das bedeuten dass du zuletzt anders dosiert hast als dein langfristiger Schnitt — das ist eine Beobachtung, keine Empfehlung."
                  subLine="Datenbasis: letzte 7 Mahlzeiten mit Carbs + Insulin · ungewichtet"
                />
              ),
            },
            { label:"Avg glucose",  val:`${avgGlucose}`, sub:"mg/dL pre-meal",           color:ACCENT,
              formula:"Σ glucose_before / count",      explain:"Average pre-meal glucose. Lower reflects better fasting control." },
            // Good rate moved out of slot 0 into Raw ICR's previous position.
            { label:"Good rate",    val:`${goodRate}%`,  sub:`${goodAll} of ${total}`,   color:GREEN,
              formula:"GOOD / Total × 100",            explain:"Share of meals where the dose was within ±35% of the ICR estimate." },
            { label:"Avg insulin",  val:`${avgInsulin}u`, sub:`${avgCarbs}g avg carbs`, color:"#A78BFA",
              formula:"Σ units / count",               explain:"Mean insulin per meal. Track against carbs to validate your ratio." },
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
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:12 }}>Tap any card to flip · hold to reorder · {total} meals analyzed</p>
      </div>

      {/* Filter out items whose node was set to null (e.g. workout-patterns
          when fewer than 2 patterns are detected — spec says hide entirely). */}
      <InsightsSortable items={items.filter(it => it.node !== null)}/>
    </div>
  );
}

/** Wrapper so we don't re-instantiate useCardOrder on every parent render. */
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
      color: color ?? "rgba(255,255,255,0.4)", textTransform:"uppercase",
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
/** Small medical-disclaimer pill. Neutral gray — informational, not alarming. */
/** Default disclaimer text for ICR-context cards. */
const DEFAULT_DISCLAIMER_TEXT = "ICR-Anpassungen immer mit deinem Diabetologen besprechen.";
/** Disclaimer text used by every clinical-threshold card (hypo / hyper / CV% / TDD). */
const THRESHOLD_DISCLAIMER_TEXT = "Schwellenwerte sind klinische Standardwerte. Besprich Abweichungen immer mit deinem Diabetologen.";

function DisclaimerChip({ text = DEFAULT_DISCLAIMER_TEXT }: { text?: string } = {}) {
  return (
    <div style={{
      display:"inline-flex", alignItems:"flex-start", gap:6,
      padding:"5px 10px", borderRadius:12,
      background:"rgba(255,255,255,0.04)",
      border:"1px solid rgba(255,255,255,0.1)",
      fontSize:10, color:"rgba(255,255,255,0.55)", lineHeight:1.35,
      maxWidth:"100%",
    }}>
      <span aria-hidden style={{ fontSize:11, lineHeight:1.2 }}>⚕️</span>
      <span>{text}</span>
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
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", gap:8 }}>
      <div style={{ fontSize:12, color:accent, fontWeight:700, letterSpacing:"0.01em", lineHeight:1.25 }}>
        {title}
      </div>
      <div style={{ fontSize:10, color:"rgba(255,255,255,0.7)", lineHeight:1.5, display:"flex", flexDirection:"column", gap:6 }}>
        {paragraphs.map((p, i) => <div key={i}>{p}</div>)}
      </div>
      <div style={{ marginTop:"auto", display:"flex", flexDirection:"column", gap:6, alignItems:"flex-start" }}>
        <DisclaimerChip text={THRESHOLD_DISCLAIMER_TEXT}/>
      </div>
    </div>
  );
}

/** Redesigned ICR back: heading + body + sub-line + disclaimer pinned bottom + bottom tap-to-flip hint. */
function IcrInfoBack({ heading, body, subLine, accent }: {
  heading: string; body: string; subLine: string; accent: string;
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", gap:8 }}>
      <div style={{ fontSize:12, color:accent, fontWeight:700, letterSpacing:"0.01em", lineHeight:1.25 }}>
        {heading}
      </div>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", lineHeight:1.55 }}>{body}</div>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.02em", marginTop:2 }}>
        {subLine}
      </div>
      {/* Bottom region: disclaimer chip + return hint, both pinned to the bottom. */}
      <div style={{ marginTop:"auto", paddingTop:10, display:"flex", flexDirection:"column", gap:6 }}>
        <DisclaimerChip/>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.32)", textAlign:"right", letterSpacing:"0.02em" }}>
          ← zurück
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
      color:"rgba(255,255,255,0.45)",
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
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:10, color:accent, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{title}</div>
        <span style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>↺ tap to flip back</span>
      </div>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize:11, color:"rgba(255,255,255,0.65)", lineHeight:1.5 }}>{p}</div>
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
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", marginTop:4 }}>{tile.sub}</div>
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
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.6)", fontFamily:"var(--font-mono)", background:"rgba(0,0,0,0.3)", padding:"4px 6px", borderRadius:5, marginBottom:4, wordBreak:"break-word" }}>
        {tile.formula}
      </div>
      <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)", lineHeight:1.4 }}>{tile.explain}</div>
    </>
  );

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setFlipped(f => !f); }}
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
