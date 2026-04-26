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

/** Default top-to-bottom order. Hero block (time-in-range, gmi-a1c,
 *  glucose-trend, meal-evaluation) mirrors the homepage `InsightsScreen()`
 *  mockup 1:1; deeper-analysis cards stack underneath for variety. */
const INSIGHTS_DEFAULT_ORDER = [
  "time-in-range",
  "gmi-a1c",
  "glucose-trend",
  "meal-evaluation",
  "adaptive-engine",
  "patterns",
  "meal-type",
  "time-of-day",
  "performance-tiles",
];

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";
const HIGH_YELLOW = "#FFD166";

const WEEKDAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const EVAL_NORM = (ev: string|null) => {
  if (!ev) return "GOOD";
  if (ev==="OVERDOSE"||ev==="HIGH") return "HIGH";
  if (ev==="UNDERDOSE"||ev==="LOW") return "LOW";
  return ev;
};

export default function InsightsPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMeals().then(setMeals).catch(console.error).finally(() => setLoading(false));
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
              <div style={{ display:"flex", height:12, borderRadius:99, overflow:"hidden", background:"rgba(255,255,255,0.04)" }}>
                {b7.vlow > 0 && <div style={{ width:`${b7.vlow}%`, background:PINK }}/>}
                {b7.lo   > 0 && <div style={{ width:`${b7.lo}%`,   background:ORANGE }}/>}
                {b7.inR  > 0 && <div style={{ width:`${b7.inR}%`,  background:GREEN }}/>}
                {b7.hi   > 0 && <div style={{ width:`${b7.hi}%`,   background:HIGH_YELLOW }}/>}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:8, color:"rgba(255,255,255,0.4)", flexWrap:"wrap", gap:4 }}>
                <span style={{ color:PINK }}>● V.low {b7.vlow}%</span>
                <span style={{ color:ORANGE }}>● Low {b7.lo}%</span>
                <span style={{ color:GREEN }}>● In {b7.inR}%</span>
                <span style={{ color:HIGH_YELLOW }}>● High {b7.hi}%</span>
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
                {/* Plain header row — CardLabel on left, status pill on right.
                    No chip wrapper: the headline lives in the card itself. */}
                <div style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  gap:10, marginBottom:12,
                }}>
                  <CardLabel text="Adaptive Engine"/>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:8, flexShrink:0 }}>
                    {/* Subtle ℹ: signals a back side without competing with status pill. */}
                    <span aria-hidden style={{
                      width:14, height:14, borderRadius:"50%",
                      display:"inline-flex", alignItems:"center", justifyContent:"center",
                      fontSize:9, fontWeight:700, fontStyle:"italic", fontFamily:"Georgia, serif",
                      color:"rgba(255,255,255,0.4)",
                      border:"1px solid rgba(255,255,255,0.18)",
                      background:"rgba(255,255,255,0.02)",
                      lineHeight:1,
                    }}>i</span>
                    <span style={{
                      display:"inline-flex", alignItems:"center", gap:6,
                      fontSize:9, fontWeight:700, letterSpacing:"0.1em",
                      color: statusColor,
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
                  </div>
                )}
              </>
            );
          })()}
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
            { label:"Good rate",    val:`${goodRate}%`,  sub:`${goodAll} of ${total}`,   color:GREEN,
              formula:"GOOD / Total × 100",            explain:"Share of meals where the dose was within ±35% of the ICR estimate." },
            { label:"Avg glucose",  val:`${avgGlucose}`, sub:"mg/dL pre-meal",           color:ACCENT,
              formula:"Σ glucose_before / count",      explain:"Average pre-meal glucose. Lower reflects better fasting control." },
            { label:"Raw ICR",      val:`1:${estICR}`,   sub:"raw 7d avg · ignores outcome", color:ORANGE,
              formula:"carbs / insulin (last 7)",      explain:"Naive average of carbs ÷ insulin over the last 7 meals. Ignores whether the dose actually landed in target — spikes and overdoses count the same as good outcomes. The Adaptive Engine ICR above is the smarter, outcome-weighted version.",
              infoBack: (
                <IcrInfoBack
                  heading="Was zeigt dieser Wert?"
                  accent={ORANGE}
                  body="Der Raw ICR ist der einfache Durchschnitt deiner letzten 7 Dosierungen — unabhängig davon ob das Ergebnis gut oder schlecht war. Er spiegelt dein tatsächliches Dosierverhalten der letzten Tage wider. Wenn dieser Wert stark vom Adaptive ICR abweicht, kann das bedeuten dass du zuletzt anders dosiert hast als dein langfristiger Schnitt — das ist eine Beobachtung, keine Empfehlung."
                  subLine="Datenbasis: letzte 7 Mahlzeiten mit Carbs + Insulin · ungewichtet"
                />
              ),
            },
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
function DisclaimerChip() {
  return (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:6,
      padding:"5px 10px", borderRadius:99,
      background:"rgba(255,255,255,0.04)",
      border:"1px solid rgba(255,255,255,0.1)",
      fontSize:10, color:"rgba(255,255,255,0.55)", lineHeight:1.35,
      maxWidth:"100%",
    }}>
      <span aria-hidden style={{ fontSize:11, lineHeight:1 }}>⚕️</span>
      <span>ICR-Anpassungen immer mit deinem Diabetologen besprechen.</span>
    </div>
  );
}

/** Redesigned ICR back: heading + body + sub-line + disclaimer pinned bottom + tap-to-flip hint. */
function IcrInfoBack({ heading, body, subLine, accent }: {
  heading: string; body: string; subLine: string; accent: string;
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", gap:8 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:2 }}>
        <div style={{ fontSize:10, color:accent, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>
          {heading}
        </div>
        <span style={{ fontSize:9, color:"rgba(255,255,255,0.35)", flexShrink:0 }}>← zurück</span>
      </div>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", lineHeight:1.55 }}>{body}</div>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.02em", marginTop:2 }}>
        {subLine}
      </div>
      <div style={{ marginTop:"auto", paddingTop:10 }}>
        <DisclaimerChip/>
      </div>
    </div>
  );
}

/** Subtle ℹ affordance pinned to a tile's top-right corner.
 *  Position: absolute against the nearest positioned ancestor (front-face shell).
 *  Pointer-events disabled so the parent's tap-to-flip stays the click target. */
function InfoCornerIcon() {
  return (
    <span aria-hidden style={{
      position:"absolute", top:6, right:8,
      width:14, height:14, borderRadius:"50%",
      display:"inline-flex", alignItems:"center", justifyContent:"center",
      fontSize:9, fontWeight:700, fontStyle:"italic", fontFamily:"Georgia, serif",
      color:"rgba(255,255,255,0.4)",
      border:"1px solid rgba(255,255,255,0.18)",
      background:"rgba(255,255,255,0.02)",
      pointerEvents:"none", lineHeight:1,
    }}>i</span>
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
