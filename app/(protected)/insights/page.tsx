"use client";

import React, { useState, useEffect, useId } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import { detectPattern } from "@/lib/engine/patterns";
import { suggestAdjustment, type AdaptiveSettings, type AdjustmentSuggestion } from "@/lib/engine/adjustment";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import GlucoseTrendFront from "@/components/GlucoseTrendChart";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import { useCardOrder } from "@/lib/cardOrder";
import { parseDbTs, parseDbDate } from "@/lib/time";

/** Default top-to-bottom order of insights sections. */
const INSIGHTS_DEFAULT_ORDER = [
  "overview",
  "glucose-trend",
  "adaptive-engine",
  "performance-tiles",
  "insulin-stats",
  "exercise-stats",
  "meal-type",
  "time-of-day",
  "patterns",
];

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

const EVAL_NORM = (ev: string|null) => {
  if (!ev) return "GOOD";
  if (ev==="OVERDOSE"||ev==="HIGH") return "HIGH";
  if (ev==="UNDERDOSE"||ev==="LOW") return "LOW";
  return ev;
};

export default function InsightsPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [insulinLogs, setInsulinLogs]   = useState<InsulinLog[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMeals().then(setMeals).catch(console.error).finally(() => setLoading(false));
    // Insulin & exercise logs feed the new sections — failure is non-fatal,
    // the rest of the insights still render.
    fetchRecentInsulinLogs(30).then(setInsulinLogs).catch(() => setInsulinLogs([]));
    fetchRecentExerciseLogs(30).then(setExerciseLogs).catch(() => setExerciseLogs([]));
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
    <div style={{ maxWidth:900, margin:"0 auto" }}>
      <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:8 }}>Performance Metrics</h1>
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"48px", textAlign:"center", color:"rgba(255,255,255,0.25)", fontSize:14 }}>Log at least 5 meals to see insights.</div>
    </div>
  );

  const now = Date.now();
  const oneWeekMs = 7 * 86400000;
  const last7 = meals.filter(m => now - parseDbTs(m.created_at) <= oneWeekMs);
  const last7Good = last7.filter(m => EVAL_NORM(m.evaluation) === "GOOD").length;
  const last7Carbs = Math.round(last7.reduce((s,m) => s + (m.carbs_grams || 0), 0));
  const last7Insulin = Math.round(last7.reduce((s,m) => s + (m.insulin_units || 0), 0) * 10) / 10;

  const normed = meals.map(m => ({ ...m, ev: EVAL_NORM(m.evaluation) }));
  const good   = normed.filter(m => m.ev==="GOOD").length;
  const low    = normed.filter(m => m.ev==="LOW").length;
  const high   = normed.filter(m => m.ev==="HIGH").length;
  const spike  = normed.filter(m => m.ev==="SPIKE").length;

  const avgGlucose = Math.round(meals.filter(m=>m.glucose_before).reduce((s,m)=>s+(m.glucose_before||0),0) / Math.max(meals.filter(m=>m.glucose_before).length,1));
  const avgCarbs   = Math.round(meals.filter(m=>m.carbs_grams).reduce((s,m)=>s+(m.carbs_grams||0),0) / Math.max(meals.filter(m=>m.carbs_grams).length,1));
  const avgInsulin = (meals.filter(m=>m.insulin_units).reduce((s,m)=>s+(m.insulin_units||0),0) / Math.max(meals.filter(m=>m.insulin_units).length,1)).toFixed(1);
  const goodRate   = Math.round(good/total*100);
  const icr7 = meals.slice(0,7).filter(m=>m.carbs_grams&&m.insulin_units).map(m=>(m.carbs_grams||0)/(m.insulin_units||1));
  const estICR     = icr7.length ? Math.round(icr7.reduce((a,b)=>a+b,0)/icr7.length) : 15;

  const getMealProtein = (m: Meal) => m.protein_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.protein||0),0) : 0);
  const getMealFat = (m: Meal) => m.fat_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fat||0),0) : 0);
  const getMealCals = (m: Meal) => m.calories ?? Math.round((m.carbs_grams||0)*4 + getMealProtein(m)*4 + getMealFat(m)*9);
  const avgCals = Math.round(meals.reduce((s,m)=>s+getMealCals(m),0) / Math.max(total,1));

  // Meal type breakdown
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

  // Time of day
  const timeGroups: Record<string,{count:number;good:number}> = {
    "Morning (5–11)": {count:0,good:0},
    "Afternoon (11–17)":{count:0,good:0},
    "Evening (17–21)": {count:0,good:0},
    "Night (21–5)":    {count:0,good:0},
  };
  meals.forEach(m => {
    const h = parseDbDate(m.created_at).getHours();
    const key = h >= 5 && h < 11 ? "Morning (5–11)" : h >= 11 && h < 17 ? "Afternoon (11–17)" : h >= 17 && h < 21 ? "Evening (17–21)" : "Night (21–5)";
    timeGroups[key].count++;
    if (EVAL_NORM(m.evaluation)==="GOOD") timeGroups[key].good++;
  });

  // Pattern detection
  const recentMeals = meals.slice(0, 10);
  const recentGood  = recentMeals.filter(m=>EVAL_NORM(m.evaluation)==="GOOD").length;
  const recentLow   = recentMeals.filter(m=>EVAL_NORM(m.evaluation)==="LOW").length;
  const recentHigh  = recentMeals.filter(m=>EVAL_NORM(m.evaluation)==="HIGH").length;
  const patterns: {icon:string;title:string;desc:string;color:string}[] = [];

  if (recentLow >= 4) patterns.push({ icon:"↑", title:"Consistent Under-dosing", desc:`${recentLow} of last 10 meals were under-dosed. Consider increasing your ICR ratio or checking carb counts.`, color:ORANGE });
  if (recentHigh >= 3) patterns.push({ icon:"↓", title:"Frequent Over-dosing", desc:`${recentHigh} of last 10 meals led to over-dose. Review correction factor — it may be too aggressive.`, color:PINK });
  if (recentGood >= 7) patterns.push({ icon:"✓", title:"Strong Recent Control", desc:`${recentGood} of your last 10 meals were well-dosed. Your current insulin strategy is working.`, color:GREEN });

  const morningSucc = timeGroups["Morning (5–11)"];
  const eveningSucc = timeGroups["Evening (17–21)"];
  if (morningSucc.count >= 3 && morningSucc.good/morningSucc.count < 0.5) patterns.push({ icon:"☀", title:"Morning Control Issues", desc:"Morning meals have a lower success rate. Dawn phenomenon may be increasing insulin resistance.", color:ORANGE });
  if (eveningSucc.count >= 3 && eveningSucc.good/eveningSucc.count > 0.8) patterns.push({ icon:"🌙", title:"Evening Dosing Strength", desc:"Evening meal dosing is particularly accurate. Consider using evening meals as reference for ICR calibration.", color:ACCENT });
  if (patterns.length === 0) patterns.push({ icon:"→", title:"No Strong Patterns Yet", desc:"Log 15+ meals to activate pattern detection. More data reveals deeper insights.", color:"rgba(255,255,255,0.3)" });

  // Adaptive engine derivations (plain — these run after early returns)
  const adaptiveICR = computeAdaptiveICR(meals);
  const enginePattern = detectPattern(meals);
  const settings: AdaptiveSettings = {
    icr: adaptiveICR.global ? Math.round(adaptiveICR.global * 10) / 10 : 15,
    correctionFactor: 50,
    lastUpdated: null,
    adjustmentHistory: [],
  };
  const suggestion: AdjustmentSuggestion = suggestAdjustment(settings, enginePattern);

  // Order in which to render meal types — always all four, even at count=0
  const TYPE_ORDER = ["FAST_CARBS", "HIGH_PROTEIN", "HIGH_FAT", "BALANCED"] as const;

  // Helpful back-side explanations for each card
  const TYPE_HELP: Record<string, string> = {
    FAST_CARBS:   "Quick-digesting carbs (white rice, bread, sweets). Cause rapid glucose spikes — pre-bolus 10–15 min ahead.",
    HIGH_PROTEIN: "Protein-dominant meals. Slower glucose rise; some users need a small carb-equivalent dose for protein.",
    HIGH_FAT:     "Fat-heavy meals delay carb absorption — consider a split or extended bolus to match the slower rise.",
    BALANCED:     "Mixed macros at moderate amounts. The most predictable category for standard ICR-based dosing.",
  };

  // Each entry is one draggable card on the insights page. Long-press to
  // enter edit mode; tap blank space to save the new order.
  const items: SortableItem[] = [
    {
      id: "overview",
      node: (
        <div className="glev-grid-4" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, gridAutoRows:"1fr" }}>
          {[
            { label:"Total Meals",       val:total.toString(),          sub:"all time",          color:ACCENT,    formula:"count(meals)",                          explain:"Every meal you've logged. More data sharpens insights." },
            { label:"Avg Carbs / Meal",  val:`${avgCarbs}g`,            sub:"per meal",          color:ORANGE,    formula:"Σ carbs_grams / meals",                 explain:"Average carbs per meal. Higher values demand sharper ICR accuracy." },
            { label:"Last 7 Days",       val:last7.length.toString(),   sub:"meals this week",   color:GREEN,     formula:"count(meals in last 7 days)",           explain:`${last7Good} good · ${last7Carbs}g carbs · ${last7Insulin}u insulin this week.` },
            { label:"Avg Glucose",       val:avgGlucose.toString(),     sub:"mg/dL pre-meal",    color:"#60A5FA", formula:"Σ glucose_before / count(non-null)",    explain:"Average pre-meal glucose. Lower = better fasting control." },
          ].map((t,i) => <InsightFlipTile key={i} tile={t}/>)}
        </div>
      ),
    },
    {
      id: "glucose-trend",
      node: (
        <FlipCard
          accent={ACCENT}
          padding="20px 24px"
          minHeight={380}
          mobileMinHeight={420}
          back={
            <FlipBack
              title="Glucose Trend"
              accent={ACCENT}
              paragraphs={[
                "Each dot is the average pre-meal glucose for that day across all logged meals. Days without data inherit the previous day's value so the line stays continuous.",
                "Look for a flat line in your target range (70–180 mg/dL) and steady morning values. A rising slope over multiple days suggests it's time to revisit your basal or ICR.",
              ]}
            />
          }
        >
          <GlucoseTrendFront meals={meals} />
        </FlipCard>
      ),
    },
    {
      id: "adaptive-engine",
      node: (
        <FlipCard
          accent={ACCENT}
          back={
          <FlipBack
            title="Adaptive Engine"
            accent={ACCENT}
            paragraphs={[
              `Glev learns your insulin-to-carb ratio (ICR) from finalised meals — meals where bg_2h is logged. Confidence rises with sample size and stability of recent ratios.`,
              `Pattern: "${enginePattern.label}" computed from ${enginePattern.sampleSize} final meals. The engine flags consistent under- or over-dosing and proposes ICR or correction-factor changes.`,
              `Any suggestion is advisory only — please confirm changes with your clinician before adopting them.`,
            ]}
          />
        }
      >
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700 }}>Adaptive Engine</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginTop:2 }}>
              {enginePattern.label} · {enginePattern.sampleSize} final meals · confidence {enginePattern.confidence}
            </div>
          </div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>
            ICR (learned): <span style={{ color:adaptiveICR.global ? GREEN : "rgba(255,255,255,0.5)", fontWeight:700 }}>
              {adaptiveICR.global ? `1:${(Math.round(adaptiveICR.global*10)/10)}` : "–"}
            </span>
          </div>
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)", lineHeight:1.5 }}>
          {enginePattern.explanation}
        </div>
        {(suggestion.hasSuggestion || enginePattern.type === "spiking" || enginePattern.type === "overdosing" || enginePattern.type === "underdosing") && (
          <div style={{ marginTop:14, padding:"12px 14px", borderRadius:10, background:"rgba(79,110,247,0.08)", border:`1px solid ${ACCENT}33` }}>
            <div style={{ fontSize:12, fontWeight:700, color:ACCENT, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>
              {suggestion.hasSuggestion ? "Suggested adjustment" : "Advisory"}
            </div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.85)", lineHeight:1.5 }}>{suggestion.message}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:8 }}>
              Suggestions are advisory only. Confirm any changes with your clinician before adopting.
            </div>
          </div>
        )}
      </FlipCard>
      ),
    },
    {
      id: "performance-tiles",
      node: (
        <div className="glev-grid-3" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
          {[
            { label:"Good Rate", val:`${goodRate}%`, sub:`${good} of ${total} meals`, color:GREEN, formula:"GOOD / Total × 100", explain:"Percentage of meals where insulin dose was optimal (within ±35% of ICR estimate)." },
            { label:"Avg Glucose Before", val:`${avgGlucose}`, sub:"mg/dL pre-meal average", color:ACCENT, formula:"Sum of glucose_before / meal count", explain:"Lower avg pre-meal glucose reflects better fasting control between meals." },
            { label:"Est. Carb Ratio", val:`1:${estICR}`, sub:"units per grams carbs", color:ORANGE, formula:"Carbs / Insulin (last 7 meals)", explain:"Your empirical ICR from recent logging. Compare to your prescribed ratio." },
            { label:"Avg Carbs/Meal", val:`${avgCarbs}g`, sub:"per logged meal", color:"#A78BFA", formula:"Sum carbs_grams / meal count", explain:"Your average carbohydrate intake per meal. High values increase dosing complexity." },
            { label:"Avg Insulin/Meal", val:`${avgInsulin}u`, sub:"rapid insulin units", color:"#60A5FA", formula:"Sum insulin_units / meal count", explain:"Average insulin per meal. Track this against carbs to validate your ratio." },
            { label:"Avg Calories", val:`${avgCals}`, sub:"kcal per meal", color:"#F472B6", formula:"(Carbs×4 + Protein×4 + Fat×9) / meals", explain:"Average caloric intake per meal based on macronutrient breakdown." },
          ].map((t,i) => (
            <InsightFlipTile key={i} tile={t}/>
          ))}
        </div>
      ),
    },
    {
      id: "insulin-stats",
      node: (() => {
        const nowMs = Date.now();
        const wkMs = 7 * 86400000;
        const moMs = 30 * 86400000;

        const bolus7  = insulinLogs.filter(l => l.insulin_type === "bolus" && nowMs - parseDbTs(l.created_at) <= wkMs);
        const bolus30 = insulinLogs.filter(l => l.insulin_type === "bolus" && nowMs - parseDbTs(l.created_at) <= moMs);
        const basal30 = insulinLogs.filter(l => l.insulin_type === "basal" && nowMs - parseDbTs(l.created_at) <= moMs);

        const sum  = (arr: InsulinLog[]) => arr.reduce((s,l) => s + (l.units || 0), 0);
        const mean = (arr: InsulinLog[]) => arr.length ? sum(arr) / arr.length : null;

        const avgBolus7  = mean(bolus7);
        const avgBolus30 = mean(bolus30);
        const avgBasal30 = mean(basal30);

        const bolusPrev7 = insulinLogs.filter(l => {
          const t = nowMs - parseDbTs(l.created_at);
          return l.insulin_type === "bolus" && t > wkMs && t <= 2 * wkMs;
        });
        const sum7  = sum(bolus7);
        const sumP7 = sum(bolusPrev7);
        let trendLabel = "—";
        let trendSub   = "no recent data";
        let trendColor = "rgba(255,255,255,0.4)";
        if (bolus7.length > 0 || bolusPrev7.length > 0) {
          if (sum7 > sumP7 * 1.1)      { trendLabel = "↑ rising";  trendSub = `${sum7.toFixed(1)}u vs ${sumP7.toFixed(1)}u prev`; trendColor = ORANGE; }
          else if (sum7 < sumP7 * 0.9) { trendLabel = "↓ falling"; trendSub = `${sum7.toFixed(1)}u vs ${sumP7.toFixed(1)}u prev`; trendColor = GREEN; }
          else                         { trendLabel = "→ stable";  trendSub = `${sum7.toFixed(1)}u vs ${sumP7.toFixed(1)}u prev`; trendColor = ACCENT; }
        }

        const bolusWithCgm = bolus30.filter(l => l.cgm_glucose_at_log != null);
        const avgCgmAtBolus = bolusWithCgm.length
          ? Math.round(bolusWithCgm.reduce((s,l) => s + (l.cgm_glucose_at_log || 0), 0) / bolusWithCgm.length)
          : null;

        return (
          <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"22px 26px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
              <div style={{ fontSize:14, fontWeight:600 }}>Insulin Logs</div>
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)" }}>
                {insulinLogs.length} log{insulinLogs.length === 1 ? "" : "s"} · last 30 d
              </span>
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:18 }}>
              Standalone bolus & basal entries from the Engine Log tab.
            </div>
            <div className="glev-grid-4" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
              <InsightFlipTile tile={{
                label:"Avg Bolus / Dose", color:GREEN,
                val: avgBolus7  != null ? `${avgBolus7.toFixed(1)}u`  : "—",
                sub: avgBolus30 != null ? `30 d avg ${avgBolus30.toFixed(1)}u` : "no data",
                formula:"Σ units / count (bolus, last 7 d)",
                explain:"Last-7-day average bolus dose, with the 30-day average for comparison.",
              }}/>
              <InsightFlipTile tile={{
                label:"Avg Basal / Dose", color:ACCENT,
                val: avgBasal30 != null ? `${avgBasal30.toFixed(1)}u` : "—",
                sub: basal30.length ? `${basal30.length} doses · 30 d` : "no data",
                formula:"Σ units / count (basal, last 30 d)",
                explain:"Mean basal dose over the last 30 days. Track this against any titration changes.",
              }}/>
              <InsightFlipTile tile={{
                label:"Insulin Trend", color:trendColor,
                val: trendLabel, sub: trendSub,
                formula:"Σ bolus units (last 7 d) vs prior 7 d",
                explain:"Direction of total bolus units week-over-week. Rising trends often follow more carb-heavy days.",
              }}/>
              <InsightFlipTile tile={{
                label:"BG @ Bolus", color:"#60A5FA",
                val: avgCgmAtBolus != null ? `${avgCgmAtBolus}` : "—",
                sub: avgCgmAtBolus != null ? `mg/dL · ${bolusWithCgm.length} logs` : "no CGM at log",
                formula:"avg cgm_glucose_at_log (bolus, 30 d)",
                explain:"Average glucose at the moment of bolus logging — high values suggest you're often dosing late.",
              }}/>
            </div>
          </div>
        );
      })(),
    },
    {
      id: "exercise-stats",
      node: (() => {
        const nowMs = Date.now();
        const wkMs = 7 * 86400000;
        const fourWk = 4 * wkMs;
        const recent = exerciseLogs.filter(l => nowMs - parseDbTs(l.created_at) <= fourWk);
        const sessionsPerWeek = recent.length / 4;
        const avgDuration = recent.length
          ? Math.round(recent.reduce((s,l) => s + l.duration_minutes, 0) / recent.length)
          : null;
        const withCgm = recent.filter(l => l.cgm_glucose_at_log != null);
        const avgCgmAtExercise = withCgm.length
          ? Math.round(withCgm.reduce((s,l) => s + (l.cgm_glucose_at_log || 0), 0) / withCgm.length)
          : null;

        return (
          <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"22px 26px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
              <div style={{ fontSize:14, fontWeight:600 }}>Exercise Logs</div>
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)" }}>
                {exerciseLogs.length} log{exerciseLogs.length === 1 ? "" : "s"} · last 30 d
              </span>
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:18 }}>
              Hypertrophy & cardio sessions logged from the Engine Log tab.
            </div>
            <div className="glev-grid-3" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
              <InsightFlipTile tile={{
                label:"Frequency", color:ORANGE,
                val: `${sessionsPerWeek.toFixed(1)}`,
                sub: `sessions / wk · last 4 wk`,
                formula:"count(sessions, last 4 wk) / 4",
                explain:"Average exercise sessions per week over the last four weeks.",
              }}/>
              <InsightFlipTile tile={{
                label:"Avg Duration", color:"#A78BFA",
                val: avgDuration != null ? `${avgDuration} min` : "—",
                sub: recent.length ? `${recent.length} sessions` : "no data",
                formula:"Σ duration_minutes / count",
                explain:"Mean session length over the last four weeks.",
              }}/>
              <InsightFlipTile tile={{
                label:"BG @ Exercise", color:"#60A5FA",
                val: avgCgmAtExercise != null ? `${avgCgmAtExercise}` : "—",
                sub: avgCgmAtExercise != null ? `mg/dL · ${withCgm.length} logs` : "no CGM at log",
                formula:"avg cgm_glucose_at_log (exercise, 4 wk)",
                explain:"Average glucose at the start of exercise sessions. Helps spot pre-workout patterns.",
              }}/>
            </div>
          </div>
        );
      })(),
    },
    {
      id: "meal-type",
      node: (
        <FlipCard
          accent={ORANGE}
          padding="22px 26px"
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
        <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Meal Type Analysis</div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:18 }}>Performance broken down by macronutrient profile</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12 }}>
          {TYPE_ORDER.map(type => {
            const data = types[type];
            const has = data.count > 0;
            const successPct = has ? Math.round(data.good/data.count*100) : 0;
            const avgC = has ? Math.round(data.totalCarbs/data.count) : 0;
            const avgI = has ? (data.totalInsulin/data.count).toFixed(1) : "0.0";
            const col  = TYPE_COLORS[type];
            const barCol = !has ? "rgba(255,255,255,0.12)" : successPct>=70?GREEN:successPct>=50?ORANGE:PINK;
            return (
              <div key={type} style={{ background:`${col}08`, border:`1px solid ${col}20`, borderRadius:12, padding:"16px", opacity: has ? 1 : 0.55 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:col, letterSpacing:"0.06em", textTransform:"uppercase" }}>{TYPE_LABELS[type]}</div>
                  {!has && (
                    <span style={{ fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>No data</span>
                  )}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  <StatRow label="Meals"     val={has ? data.count.toString() : "—"} color={has ? col : undefined}/>
                  <StatRow label="Avg Carbs" val={has ? `${avgC}g` : "—"}/>
                  <StatRow label="Avg Insulin" val={has ? `${avgI}u` : "—"}/>
                  <StatRow label="Success"   val={has ? `${successPct}%` : "—"} color={has ? barCol : undefined}/>
                </div>
                <div style={{ marginTop:10, height:4, borderRadius:99, background:"rgba(255,255,255,0.05)", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${successPct}%`, background:barCol, borderRadius:99 }}/>
                </div>
                <div style={{ marginTop:10, fontSize:10, color:"rgba(255,255,255,0.35)", lineHeight:1.4 }}>{TYPE_HELP[type]}</div>
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
          padding="22px 26px"
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
          <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Time-of-Day Analysis</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:18 }}>When are your best and worst dosing outcomes?</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {Object.entries(timeGroups).map(([label, data]) => {
              if (data.count === 0) return null;
              const pct = Math.round(data.good/data.count*100);
              const col = pct>=70?GREEN:pct>=50?ORANGE:PINK;
              return (
                <div key={label} style={{ display:"grid", gridTemplateColumns:"160px 1fr 60px 60px", gap:12, alignItems:"center" }}>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)" }}>{label}</div>
                  <div style={{ height:6, borderRadius:99, background:"rgba(255,255,255,0.05)", overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:99 }}/>
                  </div>
                  <div style={{ fontSize:12, fontWeight:700, color:col, textAlign:"right" }}>{pct}%</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", textAlign:"right" }}>{data.count} meals</div>
                </div>
              );
            })}
          </div>
        </FlipCard>
      ),
    },
    {
      id: "patterns",
      node: (
        <FlipCard
          accent={PINK}
          padding="22px 26px"
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
          <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Pattern Detection</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:18 }}>AI-driven trend detection from your dosing history</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {patterns.map((p, i) => (
              <div key={i} style={{ display:"flex", gap:14, padding:"14px 16px", background:`${p.color}08`, border:`1px solid ${p.color}20`, borderRadius:12 }}>
                <div style={{ width:36, height:36, borderRadius:99, background:`${p.color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:16 }}>
                  {p.icon}
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:p.color, marginBottom:4 }}>{p.title}</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", lineHeight:1.6 }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </FlipCard>
      ),
    },
  ];

  return (
    <div style={{ maxWidth:960, margin:"0 auto" }}>
      <style>{`
        @media (max-width: 720px) {
          .glev-grid-4 { grid-template-columns: repeat(2, 1fr) !important; }
          .glev-grid-3 { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Performance Metrics</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:13 }}>Tap any card to flip · hold to reorder · {total} meals analyzed</p>
      </div>

      <InsightsSortable items={items}/>
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
      gridStyle={{ display:"flex", flexDirection:"column", gap:20 }}
    />
  );
}

/**
 * FlipCard — generic flip wrapper used by the larger insight cards.
 * Front and back are stacked in the same CSS-grid cell so the parent's height
 * automatically equals max(front, back) without us needing to hard-code it.
 */
function FlipCard({
  children, back, accent = ACCENT, padding = "20px 24px", marginBottom,
  minHeight, mobileMinHeight,
}: {
  children: React.ReactNode;
  back: React.ReactNode;
  accent?: string;
  padding?: string;
  marginBottom?: number;
  /** Pin the grid cell (and therefore the card) to a fixed desktop height. */
  minHeight?: number;
  /** Optional override for screens ≤768px wide. */
  mobileMinHeight?: number;
}) {
  const [flipped, setFlipped] = useState(false);
  const rawId = useId();
  const sizingClass = (minHeight || mobileMinHeight)
    ? `glev-flip-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`
    : "";
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{ position:"relative", cursor:"pointer", perspective:1400, marginBottom }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); } }}
      aria-pressed={flipped}
    >
      {sizingClass && (
        <style>{`
          ${minHeight ? `.${sizingClass} { grid-template-rows: minmax(${minHeight}px, auto); }` : ""}
          ${mobileMinHeight ? `@media (max-width: 768px) { .${sizingClass} { grid-template-rows: minmax(${mobileMinHeight}px, auto); } }` : ""}
        `}</style>
      )}
      <div className={sizingClass} style={{
        display:"grid",
        transformStyle:"preserve-3d",
        transition:"transform 0.55s cubic-bezier(0.4,0,0.2,1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          background:SURFACE,
          border:`1px solid ${BORDER}`,
          borderRadius:16,
          padding,
          boxSizing:"border-box",
          position:"relative",
          // Lay out children in a column so a child can use `flex:1` to
          // soak up any extra height when the back face is taller than
          // the front (e.g. the chart card with long copy on the back).
          display:"flex",
          flexDirection:"column",
        }}>
          <span style={{ position:"absolute", top:10, right:14, fontSize:10, color:"rgba(255,255,255,0.18)" }}>↺</span>
          {children}
        </div>
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          transform:"rotateY(180deg)",
          background:`linear-gradient(145deg, ${accent}12, ${SURFACE} 65%)`,
          border:`1px solid ${accent}33`,
          borderRadius:16,
          padding,
          boxSizing:"border-box",
          overflow:"hidden",
        }}>
          {back}
        </div>
      </div>
    </div>
  );
}

function FlipBack({ title, accent, paragraphs }: { title: string; accent: string; paragraphs: string[] }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10, height:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:11, color:accent, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{title}</div>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>↺ tap to flip back</span>
      </div>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize:12, color:"rgba(255,255,255,0.65)", lineHeight:1.55 }}>{p}</div>
      ))}
    </div>
  );
}

type InsightTile = { label:string; val:string; sub:string; color:string; formula:string; explain:string };

function InsightFlipTile({ tile }: { tile: InsightTile }) {
  const [flipped, setFlipped] = useState(false);
  // The tile fills its grid cell entirely (height:100%) so the parent
  // gridAutoRows:1fr can equalise heights across the whole 2x2 mobile
  // layout — every tile renders as the exact same box. minHeight is a
  // floor for cases where a row only contains short tiles.
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); } }}
      style={{ position:"relative", cursor:"pointer", perspective:1000, minHeight:148, height:"100%" }}
    >
      <div
        style={{
          display:"grid",
          height:"100%",
          minHeight:"inherit",
          transformStyle:"preserve-3d",
          transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* FRONT */}
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          background:SURFACE,
          border:`1px solid ${BORDER}`,
          borderRadius:14,
          padding:"16px 20px",
          boxSizing:"border-box",
          display:"flex",
          flexDirection:"column",
          justifyContent:"space-between",
          gap:14,
        }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", fontWeight:600 }}>{tile.label}</div>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)", flexShrink:0 }}>↺</span>
          </div>
          <div>
            <div style={{ fontSize:32, fontWeight:800, letterSpacing:"-0.03em", color:tile.color, lineHeight:1 }}>{tile.val}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6 }}>{tile.sub}</div>
          </div>
        </div>
        {/* BACK */}
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          transform:"rotateY(180deg)",
          background:`linear-gradient(145deg, ${tile.color}12, ${SURFACE} 65%)`,
          border:`1px solid ${tile.color}33`,
          borderRadius:14,
          padding:"14px 18px",
          boxSizing:"border-box",
          display:"flex",
          flexDirection:"column",
          gap:8,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
            <div style={{ fontSize:10, color:tile.color, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{tile.label}</div>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)", flexShrink:0 }}>↺ back</span>
          </div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontFamily:"var(--font-mono)", background:"rgba(0,0,0,0.3)", padding:"6px 8px", borderRadius:6, wordBreak:"break-word" }}>{tile.formula}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", lineHeight:1.45 }}>{tile.explain}</div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, val, color }: { label:string; val:string; color?:string }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between" }}>
      <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>{label}</span>
      <span style={{ fontSize:12, fontWeight:600, color:color||"rgba(255,255,255,0.7)" }}>{val}</span>
    </div>
  );
}

