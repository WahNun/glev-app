"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { fetchMeals, computeCalories, type Meal } from "@/lib/meals";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import { fetchMacroTargets, DEFAULT_MACRO_TARGETS, type MacroTargets } from "@/lib/userSettings";
import { TYPE_COLORS, TYPE_LABELS, TYPE_EXPLAIN, getEvalColor, getEvalLabel, getEvalExplain } from "@/lib/mealTypes";
import MealEntryCardCollapsed from "@/components/MealEntryCardCollapsed";
import MealEntryLightExpand from "@/components/MealEntryLightExpand";
import CurrentDayGlucoseCard from "@/components/CurrentDayGlucoseCard";
import GlucoseTrendFront from "@/components/GlucoseTrendChart";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import { useCardOrder } from "@/lib/cardOrder";
import { parseDbDate, parseDbTs } from "@/lib/time";

/** Default top-to-bottom order of dashboard sections. Each ID also appears
 *  as a key in the items array below — keep them in sync. */
const DASHBOARD_DEFAULT_ORDER = ["today-glucose", "today-macros", "stats", "charts", "recent-entries"];

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

function evalColor(ev: string | null) { return getEvalColor(ev); }
function evalLabel(ev: string | null) { return getEvalLabel(ev); }

interface CardData {
  key: string; label: string; color: string;
  value: string;          // displayed value (e.g. "30")
  unit: string;           // unit appended (e.g. "/100" or "%")
  bar: number;            // progress 0..100
  sub: string;            // contextual caption (e.g. "15 entries", "3 good")
  formula: string; explanation: string; interpretation: string;
}

function buildCards(meals: Meal[]): CardData[] {
  const total = meals.length;
  const good   = meals.filter(m => m.evaluation === "GOOD").length;
  const spike  = meals.filter(m => m.evaluation === "SPIKE" || m.evaluation === "LOW" || m.evaluation === "UNDERDOSE").length;
  const hypo   = meals.filter(m => m.evaluation === "HIGH" || m.evaluation === "OVERDOSE").length;
  const goodRate  = total ? (good / total) * 100 : 0;
  const spikeRate = total ? (spike / total) * 100 : 0;
  const hypoRate  = total ? (hypo / total) * 100 : 0;
  const score     = total ? Math.round(goodRate * 0.7 + (100 - spikeRate - hypoRate) * 0.3) : 0;
  return [
    {
      key:"control", label:"Control Score", color:ACCENT,
      value: total ? score.toString() : "—", unit: "/100",
      bar: score,
      sub: `${total} entries`,
      formula: "Score = (Good% × 70) + (Non-extreme% × 30)",
      explanation: "Control Score measures overall insulin decision quality. It rewards correct dosing and penalizes overdoses and spikes.",
      interpretation: "80+ = Excellent, 60–79 = Good, 40–59 = Fair, <40 = Needs attention",
    },
    {
      key:"good", label:"Good Rate", color:GREEN,
      value: total ? goodRate.toFixed(1) : "—", unit: "%",
      bar: goodRate,
      sub: `${good} good`,
      formula: "Good Rate = (GOOD outcomes / Total meals) × 100",
      explanation: "The percentage of meals where your insulin dose was in the optimal range — neither too high nor too low.",
      interpretation: "Target >70%. Each GOOD outcome means your dose was within ±35% of the ICR-calculated ideal.",
    },
    {
      key:"spike", label:"Spike Rate", color:ORANGE,
      value: total ? spikeRate.toFixed(1) : "—", unit: "%",
      bar: spikeRate,
      sub: "Hyperglycemia",
      formula: "Spike Rate = (LOW outcomes / Total) × 100",
      explanation: "Meals where insulin was insufficient. Under-dosing leads to glucose spikes, which increase HbA1c long-term.",
      interpretation: "Target <15%. Consistent under-dosing suggests your ICR or correction factor needs adjustment.",
    },
    {
      key:"hypo", label:"Hypo Rate", color:PINK,
      value: total ? hypoRate.toFixed(1) : "—", unit: "%",
      bar: hypoRate,
      sub: "Hypoglycemia",
      formula: "Hypo Rate = (HIGH outcomes / Total) × 100",
      explanation: "Meals where insulin exceeded requirements. Over-dosing risks hypoglycemia, which can be dangerous.",
      interpretation: "Target <10%. If rising, reduce correction factor or ICR temporarily.",
    },
  ];
}

function FlipCard({ card }: { card: CardData }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div onClick={() => setFlipped(f => !f)} className="glev-stat-card" style={{ position:"relative", cursor:"pointer", height:140, perspective:1000 }}>
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)", transform:flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* Front */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"14px 18px", boxSizing:"border-box", display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600, textTransform:"uppercase" }}>{card.label}</div>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)" }}>↺</span>
          </div>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:8 }}>
            <div style={{ display:"flex", alignItems:"flex-end", gap:4 }}>
              <span style={{ fontSize:56, fontWeight:800, color:card.color, letterSpacing:"-0.03em", lineHeight:1, fontFamily:"var(--font-mono)" }}>{card.value}</span>
              <span style={{ fontSize:13, color:"rgba(255,255,255,0.3)", paddingBottom:3 }}>{card.unit}</span>
            </div>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>{card.sub}</span>
          </div>
          <div style={{ height:4, background:"rgba(255,255,255,0.07)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${Math.min(Math.max(card.bar, 0), 100)}%`, height:"100%", background:card.color, borderRadius:99, transition:"width 0.6s ease" }}/>
          </div>
        </div>
        {/* Back */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:`linear-gradient(145deg,${card.color}12,${SURFACE} 65%)`, border:`1px solid ${card.color}33`, borderRadius:14, padding:"12px 16px", boxSizing:"border-box", overflow:"hidden", display:"flex", flexDirection:"column", gap:6, justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:10, color:card.color, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{card.label}</div>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)" }}>↺ back</span>
          </div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)", lineHeight:1.45, fontFamily:"var(--font-mono)" }}>{card.formula}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", lineHeight:1.4 }}>{card.explanation.slice(0,110)}…</div>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ meals }: { meals: Meal[] }) {
  const DAYS = 14;
  const [flipped, setFlipped] = useState(false);
  const now = Date.now();
  const buckets: Record<string, number[]> = {};
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(now - (DAYS-1-i) * 86400000);
    buckets[d.toDateString()] = [];
  }
  meals.forEach(m => {
    const d = parseDbDate(m.created_at).toDateString();
    if (d in buckets && m.glucose_before) buckets[d].push(m.glucose_before);
  });
  const points = Object.values(buckets).map(arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null);

  // Front-face hi/lo + 7-day stats are also rendered by the shared
  // GlucoseTrendFront, but we recompute them here for the BACK face's
  // "Trend Breakdown" tiles.
  type Pt = { i: number; v: number };
  const realPts: Pt[] = [];
  points.forEach((v, i) => { if (v != null) realPts.push({ i, v }); });
  const hiPt: Pt | null = realPts.length ? realPts.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const loPt: Pt | null = realPts.length ? realPts.reduce((a, b) => (b.v < a.v ? b : a)) : null;

  // Back: weekday averages + 7-day trend slope
  const weekdayBuckets: number[][] = Array.from({ length: 7 }, () => []);
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  meals.forEach(m => {
    if (!m.glucose_before) return;
    const ts = parseDbDate(m.created_at);
    if (now - ts.getTime() > 30 * 86400000) return;
    weekdayBuckets[ts.getDay()].push(m.glucose_before);
  });
  const weekdayAvgs = weekdayBuckets.map(arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null));
  const real = points.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  const last7 = real.slice(-7);
  let slope = 0;
  if (last7.length >= 2) {
    const xs = last7.map(p => p.i);
    const ys = last7.map(p => p.v);
    const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
    const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    for (let k = 0; k < xs.length; k++) { num += (xs[k] - xm) * (ys[k] - ym); den += (xs[k] - xm) ** 2; }
    slope = den ? num / den : 0;
  }
  const recentAvg = last7.length ? Math.round(last7.reduce((s, p) => s + p.v, 0) / last7.length) : null;
  const overallAvg = real.length ? Math.round(real.reduce((s, p) => s + p.v, 0) / real.length) : null;
  const inRange = real.filter(p => p.v >= 80 && p.v <= 180).length;
  const tirPct = real.length ? Math.round((inRange / real.length) * 100) : 0;

  // Card height: a bit taller on mobile so the chart stays comfortably
  // readable when stacked under the stat tiles.
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      className="glev-trend-card"
      style={{ position:"relative", perspective:1200, cursor:"pointer" }}
    >
      <style>{`
        .glev-trend-card { height: 240px; }
        @media (max-width: 768px) {
          .glev-trend-card { height: 220px; }
        }
      `}</style>
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.55s cubic-bezier(0.4,0,0.2,1)", transform:flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* FRONT */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px", boxSizing:"border-box", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <GlucoseTrendFront meals={meals} />
        </div>
        {/* BACK */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:`linear-gradient(145deg, ${ACCENT}10, ${SURFACE} 65%)`, border:`1px solid ${ACCENT}33`, borderRadius:16, padding:"20px 24px", boxSizing:"border-box", display:"flex", flexDirection:"column", gap:14, overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:11, color:ACCENT, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>Trend Breakdown</div>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)" }}>↺ back</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
            {[
              { l:"Overall avg", v: overallAvg ? `${overallAvg} mg/dL` : "—", c: overallAvg ? (overallAvg>140?ORANGE:overallAvg<80?PINK:GREEN) : undefined },
              { l:"7-day avg", v: recentAvg ? `${recentAvg} mg/dL` : "—", c: recentAvg ? (recentAvg>140?ORANGE:recentAvg<80?PINK:GREEN) : undefined },
              { l:"Time in range (80–180)", v: real.length ? `${tirPct}%` : "—", c: tirPct>=70?GREEN:tirPct>=50?ORANGE:PINK },
              { l:"Highest", v: hiPt ? `${Math.round(hiPt.v)} mg/dL` : "—", c: ORANGE },
              { l:"Lowest", v: loPt ? `${Math.round(loPt.v)} mg/dL` : "—", c: PINK },
              { l:"7-day slope", v: last7.length>=2 ? `${slope>0?"+":""}${slope.toFixed(1)}/day` : "—", c: Math.abs(slope)<2 ? GREEN : slope>0 ? ORANGE : ACCENT },
            ].map(s => (
              <div key={s.l} style={{ background:"rgba(255,255,255,0.025)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.07em", fontWeight:600, marginBottom:4, textTransform:"uppercase" }}>{s.l}</div>
                <div style={{ fontSize:14, fontWeight:700, color:s.c || "rgba(255,255,255,0.9)", letterSpacing:"-0.01em" }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.07em", fontWeight:600, marginBottom:8, textTransform:"uppercase" }}>By weekday (last 30 days)</div>
            <div style={{ display:"flex", gap:6, flex:1, alignItems:"flex-end" }}>
              {weekdayAvgs.map((v, i) => {
                const h = v == null ? 8 : Math.max(8, Math.min(100, ((v - 60) / (240 - 60)) * 100));
                const c = v == null ? "rgba(255,255,255,0.1)" : v > 140 ? ORANGE : v < 80 ? PINK : GREEN;
                return (
                  <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, height:"100%", justifyContent:"flex-end" }}>
                    <div style={{ fontSize:10, fontWeight:700, color: v == null ? "rgba(255,255,255,0.25)" : c }}>{v ?? "—"}</div>
                    <div style={{ width:"100%", maxWidth:32, height:`${h}%`, background:c, opacity: v == null ? 0.4 : 0.85, borderRadius:6, transition:"height 0.4s ease" }}/>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>{weekdayLabels[i]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutcomeChart({ meals }: { meals: Meal[] }) {
  const groups: Record<string, { color:string; label:string; count:number }> = {
    GOOD:     { color:GREEN,  label:"Good",       count:0 },
    LOW:      { color:ORANGE, label:"Under Dose",  count:0 },
    HIGH:     { color:PINK,   label:"Over Dose",   count:0 },
    SPIKE:    { color:"#FF9F0A", label:"Spike",    count:0 },
  };
  meals.forEach(m => {
    const ev = m.evaluation || "";
    if (ev === "OVERDOSE" || ev === "HIGH") groups.HIGH.count++;
    else if (ev === "UNDERDOSE" || ev === "LOW") groups.LOW.count++;
    else if (ev === "SPIKE") groups.SPIKE.count++;
    else if (ev === "GOOD") groups.GOOD.count++;
  });
  const total = meals.length || 1;
  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" }}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>Outcome Distribution</div>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:18 }}>All-time breakdown</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {Object.values(groups).map(g => {
          const pct = Math.round((g.count/total)*100);
          return (
            <div key={g.label}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)" }}>{g.label}</span>
                <span style={{ fontSize:12, fontWeight:600, color:g.color }}>{g.count} <span style={{ color:"rgba(255,255,255,0.3)", fontWeight:400 }}>({pct}%)</span></span>
              </div>
              <div style={{ height:6, borderRadius:99, background:"rgba(255,255,255,0.06)", overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${pct}%`, background:g.color, borderRadius:99, transition:"width 0.8s ease" }}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [insulin, setInsulin] = useState<InsulinLog[]>([]);
  const [exercise, setExercise] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-user macro goals powering the "Today's Macros" rings. Loaded once
  // on mount from user_settings; falls back to sensible Type-1 defaults so
  // the rings always render even before the row exists or for signed-out
  // SSR. Edited via Settings → "Daily Macro Targets".
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(DEFAULT_MACRO_TARGETS);

  useEffect(() => {
    fetchMacroTargets().then(setMacroTargets).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load(initial: boolean) {
      try {
        // Parallel fetch of all three log types so the "Recent Entries"
        // panel and the totals counter reflect every kind of entry.
        const [m, ins, ex] = await Promise.all([
          fetchMeals(),
          fetchRecentInsulinLogs(60).catch(() => []),
          fetchRecentExerciseLogs(60).catch(() => []),
        ]);
        if (!cancelled) {
          setMeals(m);
          setInsulin(ins);
          setExercise(ex);
        }
      } catch (e) { console.error(e); }
      finally { if (!cancelled && initial) setLoading(false); }
    }
    load(true);
    function onUpdated() { load(false); }
    window.addEventListener("glev:meals-updated",    onUpdated);
    window.addEventListener("glev:insulin-updated",  onUpdated);
    window.addEventListener("glev:exercise-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("glev:meals-updated",    onUpdated);
      window.removeEventListener("glev:insulin-updated",  onUpdated);
      window.removeEventListener("glev:exercise-updated", onUpdated);
    };
  }, []);

  // Build a unified, time-sorted row list across all log types so the
  // 6 most recent entries are *actually* the most recent regardless of
  // kind. Each row carries its discriminator + raw record.
  const recentRows: RecentRow[] = useMemo(() => {
    const rows: RecentRow[] = [
      ...meals.map<RecentRow>(m => ({ kind: "meal", id: m.id, ts: m.meal_time ?? m.created_at, meal: m })),
      ...insulin.map<RecentRow>(i => ({ kind: i.insulin_type, id: i.id, ts: i.created_at, insulin: i })),
      ...exercise.map<RecentRow>(x => ({ kind: "exercise", id: x.id, ts: x.created_at, exercise: x })),
    ];
    rows.sort((a, b) => parseDbTs(b.ts) - parseDbTs(a.ts));
    return rows.slice(0, 6);
  }, [meals, insulin, exercise]);

  const totalEntries = meals.length + insulin.length + exercise.length;

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", gap:12, color:"rgba(255,255,255,0.3)" }}>
      <div style={{ width:20, height:20, border:`2px solid ${ACCENT}`, borderTopColor:"transparent", borderRadius:99, animation:"spin 0.8s linear infinite" }}/>
      Loading dashboard…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const cards = buildCards(meals);

  // Each entry is one draggable section on the dashboard. Long-press any of
  // them to enter edit mode; drag to reorder; tap blank space to save.
  const items: SortableItem[] = [
    { id: "today-glucose", node: <CurrentDayGlucoseCard/> },
    { id: "today-macros",  node: <DailyMacrosCard meals={meals} targets={macroTargets}/> },
    {
      id: "stats",
      node: (
        // Hero ControlScoreCard sits on top; the legacy good/spike/hypo
        // FlipCards stay below as supporting detail. The "control" entry is
        // filtered out because the new hero card replaces it.
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <ControlScoreCard meals={meals}/>
          <div className="glev-dash-grid" style={{ display:"grid", gap:14 }}>
            {cards.filter(c => c.key !== "control").map(c => <FlipCard key={c.key} card={c}/>)}
          </div>
        </div>
      ),
    },
    {
      id: "charts",
      node: (
        <div className="glev-dash-charts" style={{ display:"grid", gap:14 }}>
          <TrendChart meals={meals}/>
          <OutcomeChart meals={meals}/>
        </div>
      ),
    },
    { id: "recent-entries", node: <RecentEntries rows={recentRows} onViewAll={() => router.push("/log")} onViewEntry={(id) => router.push(`/entries#${id}`)}/> },
  ];

  return (
    <div style={{ maxWidth:1480, margin:"0 auto", width:"100%", overflowX:"hidden", boxSizing:"border-box" }}>
      <style>{`
        html, body { overflow-x: hidden; }
        .glev-dash-head    { display: flex; }
        .glev-dash-grid    { grid-template-columns: repeat(3,1fr) !important; }
        .glev-dash-charts  { grid-template-columns: 3fr 2fr !important; }
        @media (max-width: 768px) {
          .glev-dash-head   { display: none !important; }
          .glev-dash-grid   { grid-template-columns: 1fr !important; gap: 12px !important; }
          .glev-dash-charts { grid-template-columns: 1fr !important; }
          .glev-dash-stack  { gap: 14px !important; }
        }
      `}</style>

      <div className="glev-dash-head" style={{ marginBottom:28, justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Dashboard</h1>
          <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>
            {totalEntries} entries logged. Hold any card to reorder · click to flip.
          </p>
        </div>
        <button onClick={() => router.push("/log")} style={{ padding:"10px 20px", borderRadius:10, border:"none", background:ACCENT, color:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, boxShadow:`0 4px 20px ${ACCENT}40` }}>
          + Mahlzeit loggen
        </button>
      </div>

      <DashboardSortable items={items}/>
    </div>
  );
}

/** Thin wrapper so we can call the useCardOrder hook without re-rendering
 *  the whole DashboardPage on every persisted change. */
function DashboardSortable({ items }: { items: SortableItem[] }) {
  const { order, setOrder } = useCardOrder("dashboard", DASHBOARD_DEFAULT_ORDER);
  return (
    <SortableCardGrid
      items={items}
      order={order}
      onOrderChange={setOrder}
      gridClassName="glev-dash-stack"
      gridStyle={{ display:"flex", flexDirection:"column", gap:22 }}
    />
  );
}

/**
 * Recent Entries renders a unified feed across meal / bolus / basal /
 * exercise rows. Tapping a row toggles an inline light-expansion (same
 * UX as the Entries page). The "View full →" link inside the expansion
 * navigates to `/entries#id` for the full two-stage detail view.
 */
function RecentEntries({
  rows,
  onViewAll,
  onViewEntry,
}: {
  rows: RecentRow[];
  onViewAll: () => void;
  onViewEntry: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded(prev => (prev === id ? null : id));

  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"16px 20px 8px" }}>
      {/* Header — RECENT label left, See all → ACCENT-coloured button right.
          Spec'd typography: 11px / 0.12em / rgba(255,255,255,0.45) for the
          label, 13px ACCENT for the link. */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)" }}>
          Recent
        </div>
        <button
          onClick={onViewAll}
          style={{ fontSize:13, color:ACCENT, background:"transparent", border:"none", cursor:"pointer", padding:0, fontWeight:500 }}
        >
          See all →
        </button>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding:"24px 0 16px", textAlign:"center", color:"rgba(255,255,255,0.25)", fontSize:13 }}>
          Noch keine Einträge. Logge deine erste Mahlzeit.
        </div>
      ) : (
        <div>
          {rows.map(r => {
            const isOpen = expanded === r.id;
            return (
              <div key={r.id}>
                <UnifiedRecentRow row={r} onClick={() => toggle(r.id)} />
                {isOpen && (
                  <div style={{ paddingBottom:8 }}>
                    {r.kind === "meal" ? (
                      <MealEntryLightExpand
                        meal={r.meal!}
                        onViewFull={() => onViewEntry(r.meal!.id)}
                      />
                    ) : r.kind === "exercise" ? (
                      <NonMealLightExpand
                        ts={r.ts}
                        stats={[
                          { label:"Duration",  value:`${r.exercise!.duration_minutes} min`, color:KIND_ACCENT.exercise.color },
                          { label:"Type",      value:r.exercise!.exercise_type === "cardio" ? "Cardio" : "Strength" },
                          { label:"Intensity", value:r.exercise!.intensity || "—" },
                          ...(r.exercise!.cgm_glucose_at_log != null ? [{ label:"CGM at log", value:`${r.exercise!.cgm_glucose_at_log} mg/dL` }] : []),
                        ]}
                        onViewFull={() => onViewEntry(r.id)}
                      />
                    ) : (
                      <NonMealLightExpand
                        ts={r.ts}
                        stats={[
                          { label:"Dose",    value:`${r.insulin!.units} u`, color:KIND_ACCENT[r.kind].color },
                          { label:"Insulin", value:r.insulin!.insulin_name || (r.kind === "bolus" ? "rapid-acting" : "long-acting") },
                          { label:"Kind",    value:r.kind === "bolus" ? "Bolus" : "Basal", color:KIND_ACCENT[r.kind].color },
                          ...(r.insulin!.cgm_glucose_at_log != null ? [{ label:"CGM at log", value:`${r.insulin!.cgm_glucose_at_log} mg/dL` }] : []),
                        ]}
                        onViewFull={() => onViewEntry(r.id)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Unified collapsed row used by RecentEntries for ALL kinds. Visual spec:
//   flex / gap 12 / padding 12px 0 / borderBottom rgba(255,255,255,0.06).
//   Left:  36px coloured circle with monogram letter (M / B / L / E).
//   Mid:   14px bold title + 12px muted "time · macro/dose info".
//   Right: meal → existing eval chip; non-meal → kind-coloured value chip.
function UnifiedRecentRow({ row, onClick }: { row: RecentRow; onClick: () => void }) {
  const accent = KIND_ACCENT[row.kind];
  const letter =
    row.kind === "meal"     ? "M"
    : row.kind === "bolus"  ? "B"
    : row.kind === "basal"  ? "L"   // Long-acting — disambiguates from bolus B
    :                         "E";

  const ts = parseDbDate(row.ts);
  const timeStr = ts.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });

  let title: string;
  let subtitle: string;
  let rightSlot: React.ReactNode;

  if (row.kind === "meal") {
    const m = row.meal!;
    title = (m.meal_type && TYPE_LABELS[m.meal_type]) || "Meal";
    const macroBits: string[] = [];
    if (m.carbs_grams   != null) macroBits.push(`${m.carbs_grams}g C`);
    if (m.protein_grams != null) macroBits.push(`${m.protein_grams}g P`);
    if (m.fat_grams     != null) macroBits.push(`${m.fat_grams}g F`);
    subtitle = macroBits.length ? `${timeStr} · ${macroBits.join(" · ")}` : timeStr;
    const evColor = getEvalColor(m.evaluation);
    rightSlot = (
      <span style={{
        padding:"5px 10px", borderRadius:99, fontSize:10, fontWeight:700,
        background:`${evColor}18`, color:evColor,
        border:`1px solid ${evColor}30`, whiteSpace:"nowrap",
        letterSpacing:"0.05em", textTransform:"uppercase",
      }}>
        {getEvalLabel(m.evaluation)}
      </span>
    );
  } else if (row.kind === "exercise") {
    const x = row.exercise!;
    title = x.exercise_type === "cardio" ? "Cardio" : "Strength";
    subtitle = `${timeStr} · ${x.duration_minutes}m`;
    rightSlot = (
      <span style={{
        padding:"5px 10px", borderRadius:99, fontSize:10, fontWeight:700,
        background:`${accent.color}18`, color:accent.color,
        border:`1px solid ${accent.color}30`, whiteSpace:"nowrap",
        letterSpacing:"0.05em", textTransform:"uppercase", fontFamily:"var(--font-mono)",
      }}>
        {`${x.duration_minutes}m`}
      </span>
    );
  } else {
    const i = row.insulin!;
    title = i.insulin_name || (row.kind === "bolus" ? "Bolus" : "Basal");
    subtitle = `${timeStr} · ${i.units}u`;
    rightSlot = (
      <span style={{
        padding:"5px 10px", borderRadius:99, fontSize:10, fontWeight:700,
        background:`${accent.color}18`, color:accent.color,
        border:`1px solid ${accent.color}30`, whiteSpace:"nowrap",
        letterSpacing:"0.05em", textTransform:"uppercase", fontFamily:"var(--font-mono)",
      }}>
        {`${i.units}u`}
      </span>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{
        display:"flex", gap:12, padding:"12px 0",
        borderBottom:"1px solid rgba(255,255,255,0.06)",
        alignItems:"center", cursor:"pointer",
      }}
    >
      {/* Left circle */}
      <div style={{
        width:36, height:36, borderRadius:"50%",
        background:`${accent.color}20`, color:accent.color,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontWeight:800, fontSize:14, flexShrink:0,
        border:`1px solid ${accent.color}40`, fontFamily:"var(--font-mono)",
      }}>
        {letter}
      </div>
      {/* Middle: title + subtitle */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"rgba(255,255,255,0.92)", letterSpacing:"-0.01em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {title}
        </div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", fontFamily:"var(--font-mono)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {subtitle}
        </div>
      </div>
      {/* Right slot */}
      {rightSlot}
    </div>
  );
}

/**
 * Light expand body for non-meal rows (bolus / basal / exercise) on the
 * dashboard. Mirrors the visual rhythm of MealEntryLightExpand: a small
 * label + value grid plus a "View full entry →" footer that navigates
 * to /entries#id.
 */
function NonMealLightExpand({
  ts,
  stats,
  onViewFull,
}: {
  ts: string;
  stats: Array<{ label: string; value: string; color?: string }>;
  onViewFull: () => void;
}) {
  const date = parseDbDate(ts);
  const fullTimestamp = date.toLocaleString("en", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  return (
    <div style={{ padding:"12px 16px 14px", display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>Details</div>
        <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
          {stats.map(s => (
            <div key={s.label} style={{ display:"flex", flexDirection:"column", minWidth:70, gap:3 }}>
              <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>{s.label}</span>
              <span style={{ fontSize:13, fontWeight:700, color: s.color || "rgba(255,255,255,0.85)", fontFamily:"var(--font-mono)" }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
        <span style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontFamily:"var(--font-mono)" }}>{fullTimestamp}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onViewFull(); }}
          style={{ background:"transparent", border:"none", color:ACCENT, fontSize:12, fontWeight:600, cursor:"pointer", padding:"4px 0", letterSpacing:"-0.01em" }}
        >
          View full entry →
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Control Score helpers + hero card.
//   Score formula matches the legacy `buildCards` math (Good% × 0.7 +
//   (100 − Spike% − Hypo%) × 0.3) but is windowable so the hero card can
//   render the rolling 7-day score and a delta vs the previous 7 days.
//   Badge thresholds are the user-facing 3-tier mapping spec'd by product
//   (STRONG ≥ 80 · GOOD ≥ 60 · POOR < 60), derived from the existing
//   "80+ Excellent / 60–79 Good / 40–59 Fair / <40 Needs attention" text.
// -----------------------------------------------------------------------------
function computeControlScore(meals: Meal[], sinceMs: number, untilMs: number = Infinity): { score: number; count: number } {
  const inWindow = meals.filter(m => {
    const t = parseDbDate(m.created_at).getTime();
    return t >= sinceMs && t < untilMs;
  });
  const total = inWindow.length;
  if (!total) return { score: 0, count: 0 };
  const good  = inWindow.filter(m => m.evaluation === "GOOD").length;
  const spike = inWindow.filter(m => m.evaluation === "SPIKE" || m.evaluation === "LOW"  || m.evaluation === "UNDERDOSE").length;
  const hypo  = inWindow.filter(m => m.evaluation === "HIGH"  || m.evaluation === "OVERDOSE").length;
  const goodRate  = (good  / total) * 100;
  const spikeRate = (spike / total) * 100;
  const hypoRate  = (hypo  / total) * 100;
  return { score: Math.round(goodRate * 0.7 + (100 - spikeRate - hypoRate) * 0.3), count: total };
}

function ControlScoreCard({ meals }: { meals: Meal[] }) {
  const [flipped, setFlipped] = useState(false);
  const { score, count, delta, badge } = useMemo(() => {
    const now = Date.now();
    const W = 7 * 86400000;
    const cur  = computeControlScore(meals, now - W, now);
    const prev = computeControlScore(meals, now - 2 * W, now - W);
    const delta = prev.count > 0 && cur.count > 0 ? cur.score - prev.score : null;
    const badge =
      cur.score >= 80 ? { text: "STRONG", color: GREEN }
      : cur.score >= 60 ? { text: "GOOD",   color: ACCENT }
      :                   { text: "POOR",   color: PINK };
    return { score: cur.score, count: cur.count, delta, badge };
  }, [meals]);

  const hasData = count > 0;
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{ position:"relative", cursor:"pointer", minHeight:158, perspective:1000 }}
    >
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* ────────── Front ────────── */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"18px 24px 22px", boxSizing:"border-box" }}>
          {/* Header — title left, badge right (hidden when no data). */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.6)" }}>
              Control Score · 7D
            </div>
            {hasData && (
              <div style={{
                fontSize:9, fontWeight:800, color:badge.color,
                padding:"4px 10px", borderRadius:99,
                border:`1px solid ${badge.color}55`, background:`${badge.color}18`,
                letterSpacing:"0.1em",
              }}>
                {badge.text}
              </div>
            )}
          </div>
          {/* Big score (56px ACCENT) + "/ 100" + right-aligned delta. */}
          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
            <span style={{ fontSize:56, fontWeight:800, color:ACCENT, letterSpacing:"-0.03em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
              {hasData ? score : "—"}
            </span>
            <span style={{ fontSize:13, color:"rgba(255,255,255,0.4)", fontWeight:500 }}>/ 100</span>
            <span style={{
              marginLeft:"auto",
              fontSize:10, fontWeight:600, fontFamily:"var(--font-mono)",
              color: delta == null ? "rgba(255,255,255,0.4)"
                   : delta > 0      ? GREEN
                   : delta < 0      ? PINK
                   :                  "rgba(255,255,255,0.5)",
            }}>
              {!hasData
                ? "no entries · 7d"
                : delta == null
                  ? `${count} entries · 7d`
                  : `${delta > 0 ? "+" : ""}${delta} vs last wk`}
            </span>
          </div>
          {/* Gradient progress bar — accent → green. */}
          <div style={{ height:6, marginTop:14, background:"rgba(255,255,255,0.06)", borderRadius:99, overflow:"hidden" }}>
            <div style={{
              height:"100%",
              width:`${hasData ? Math.max(0, Math.min(100, score)) : 0}%`,
              background:`linear-gradient(90deg, ${ACCENT}, ${GREEN})`,
              borderRadius:99,
              transition:"width 0.6s ease",
            }}/>
          </div>
          <span style={{ position:"absolute", bottom:8, right:14, fontSize:9, color:"rgba(255,255,255,0.18)" }}>↺</span>
        </div>
        {/* ────────── Back ────────── */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:`linear-gradient(145deg, ${ACCENT}12, ${SURFACE} 65%)`, border:`1px solid ${ACCENT}33`, borderRadius:16, padding:"18px 24px 22px", boxSizing:"border-box", display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:ACCENT }}>
              How it&apos;s scored
            </div>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)" }}>↺ back</span>
          </div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", lineHeight:1.5, fontFamily:"var(--font-mono)" }}>
            Score = Good% × 0.7 + (100 − Spike% − Hypo%) × 0.3, last 7 days.
          </div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", lineHeight:1.5 }}>
            Rewards correctly dosed meals, penalises over- and under-doses.
            Badges: STRONG ≥ 80 · GOOD ≥ 60 · POOR &lt; 60.
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Daily Macros card — sums today's carbs / protein / fat / fiber across all
// logged meals. Calories use the meal's stored value where present, falling
// back to the 4·carbs + 4·protein + 9·fat estimate for older rows.
// -----------------------------------------------------------------------------
function DailyMacrosCard({ meals, targets }: { meals: Meal[]; targets: MacroTargets }) {
  const [expanded, setExpanded] = useState(false);
  const today = useMemo(() => {
    const todayStr = new Date().toDateString();
    const todays = meals.filter(m => parseDbDate(m.meal_time ?? m.created_at).toDateString() === todayStr);

    let carbs = 0, protein = 0, fat = 0, fiber = 0, calories = 0;
    for (const m of todays) {
      const c = m.carbs_grams ?? 0;
      const p = m.protein_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s, f) => s + (f.protein || 0), 0) : 0);
      const f = m.fat_grams     ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s, x) => s + (x.fat     || 0), 0) : 0);
      const fb = m.fiber_grams  ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s, x) => s + (x.fiber   || 0), 0) : 0);
      carbs   += c;
      protein += p;
      fat     += f;
      fiber   += fb;
      calories += m.calories ?? computeCalories(c, p, f);
    }

    return { count: todays.length, carbs, protein, fat, fiber, calories };
  }, [meals]);

  // Collapsed view: 4 circular progress rings in a single row.
  // Color palette spec'd by product (Tailwind 500-shade reference):
  //   CARBS=#f97316, PROTEIN=#8b5cf6, FAT=#f59e0b, FIBER=#10b981.
  // Targets come from the per-user user_settings table (edited in
  // Settings → "Daily Macro Targets"); they fall back to sensible Type-1
  // defaults from DEFAULT_MACRO_TARGETS until the user saves their own.
  // `calories` is intentionally not shown here — it surfaces in the
  // expanded view.
  const rings: Array<{ label: string; value: number; target: number; color: string; unit: string }> = [
    { label: "CARBS",   value: Math.round(today.carbs),   target: targets.carbs,   color: "#f97316", unit: "g" },
    { label: "PROTEIN", value: Math.round(today.protein), target: targets.protein, color: "#8b5cf6", unit: "g" },
    { label: "FAT",     value: Math.round(today.fat),     target: targets.fat,     color: "#f59e0b", unit: "g" },
    { label: "FIBER",   value: Math.round(today.fiber),   target: targets.fiber,   color: "#10b981", unit: "g" },
  ];

  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
      {/* Header doubles as the tap-to-expand toggle. Whole row is a button so
          the click target is generous on touch devices; chevron rotates 180°
          when expanded as the visible affordance. */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls="glev-macros-expanded"
        style={{
          all:"unset",
          boxSizing:"border-box",
          width:"100%",
          padding:"18px 24px 14px",
          display:"flex", justifyContent:"space-between", alignItems:"center",
          borderBottom:`1px solid ${BORDER}`,
          cursor:"pointer",
        }}
      >
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.6)" }}>
          Today&apos;s Macros
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontWeight:500, fontFamily:"var(--font-mono)" }}>
            {today.count} {today.count === 1 ? "meal" : "meals"}
          </div>
          <svg
            width="11" height="11" viewBox="0 0 12 12"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition:"transform 200ms ease",
              color:"rgba(255,255,255,0.4)",
            }}
            aria-hidden="true"
          >
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
      {/* 4 rings always in a single row; each cell caps the ring at ~96px so it
          doesn't blow up on wide cards but still scales down cleanly on narrow
          phones via `width:100%` on the SVG (viewBox handles the rest). */}
      <div style={{ padding:"22px 16px 24px", display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
        {rings.map(r => (
          <div key={r.label} style={{ display:"flex", justifyContent:"center" }}>
            <MacroRing {...r} />
          </div>
        ))}
      </div>
      {/* Expanded section — three blocks per product spec:
            1. Calories total (prominent kcal)
            2. % of daily target per macro (mini progress bars)
            3. Tip box with contextual copy
          The tip copy is generated from the current day's data; swap to
          product-supplied strings when the editorial spec lands. */}
      {expanded && (() => {
        const pcts = rings.map(r => ({
          label: r.label,
          color: r.color,
          pct: r.target > 0 ? r.value / r.target : 0,
        }));
        let tip: string;
        if (today.count === 0) {
          tip = "No meals logged yet today — add your first meal to start tracking.";
        } else {
          const lowest = pcts.reduce((a, b) => (b.pct < a.pct ? b : a));
          const allOnTrack = pcts.every(p => p.pct >= 0.8);
          tip = allOnTrack
            ? "All macros tracking close to target today — nice work."
            : `${lowest.label} is at ${Math.round(lowest.pct * 100)}% of target — consider adding more in your next meal.`;
        }
        return (
          <div
            id="glev-macros-expanded"
            style={{ borderTop:`1px solid ${BORDER}`, padding:"18px 24px 22px", display:"flex", flexDirection:"column", gap:20 }}
          >
            {/* 1. Calories — prominent kcal total. */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700, textTransform:"uppercase" }}>
                Calories
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontSize:28, fontWeight:800, color:ACCENT, letterSpacing:"-0.02em", fontFamily:"var(--font-mono)" }}>
                  {Math.round(today.calories).toLocaleString()}
                </span>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:500 }}>kcal</span>
              </div>
            </div>

            {/* 2. % of daily target — one bar per macro, color-matched to its ring. */}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", letterSpacing:"0.1em", fontWeight:700, textTransform:"uppercase", marginBottom:2 }}>
                % of Daily Target
              </div>
              {pcts.map(p => (
                <div key={p.label} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:"0 0 60px", fontSize:10, color:"rgba(255,255,255,0.6)", letterSpacing:"0.06em", fontWeight:700 }}>
                    {p.label}
                  </div>
                  <div style={{ flex:1, height:5, background:"rgba(255,255,255,0.06)", borderRadius:99, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${(Math.min(1, p.pct) * 100).toFixed(1)}%`, background:p.color, borderRadius:99 }} />
                  </div>
                  <div style={{ flex:"0 0 40px", textAlign:"right", fontSize:10, color:"rgba(255,255,255,0.55)", fontFamily:"var(--font-mono)", fontWeight:600 }}>
                    {Math.round(p.pct * 100)}%
                  </div>
                </div>
              ))}
            </div>

            {/* 3. Tip — accent label + dynamic body copy. */}
            <div style={{ background:"rgba(255,255,255,0.025)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 14px" }}>
              <div style={{ fontSize:11, lineHeight:1.55, color:"rgba(255,255,255,0.7)" }}>
                <span style={{ color:ACCENT, fontWeight:800, letterSpacing:"0.08em", marginRight:8, fontSize:10 }}>TIP</span>
                {tip}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Single circular progress ring used by `DailyMacrosCard`. Big colored arc
// over a faint track, bold mono number in the centre, CAPS label below, and
// a small "/ {target}{unit}" hint underneath. The SVG renders at 100% of its
// (capped) container width so the rings stay legible across viewports.
function MacroRing({
  label,
  value,
  target,
  color,
  unit,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
  unit: string;
}) {
  const r = 32;                                     // SVG-unit radius
  const circ = 2 * Math.PI * r;                     // ring circumference
  const pct = target > 0 ? Math.min(1, value / target) : 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, width:"100%", maxWidth:96 }}>
      <svg width="100%" height="auto" viewBox="0 0 80 80" style={{ display:"block" }}>
        {/* Faint background track */}
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        {/* Progress arc — rotate -90deg so 0% sits at 12 o'clock and the arc
            grows clockwise; rounded cap so the leading edge looks polished. */}
        <circle
          cx="40" cy="40" r={r}
          fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(circ * pct).toFixed(2)} ${circ.toFixed(2)}`}
          transform="rotate(-90 40 40)"
        />
        {/* Centre value — bold mono, white regardless of macro color. */}
        <text
          x="40" y="46"
          textAnchor="middle"
          fontSize="20" fontWeight="800" fill="#fff"
          fontFamily="var(--font-mono)"
        >
          {value}
        </text>
      </svg>
      <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)", textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700 }}>
        {label}
      </div>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.32)", fontFamily:"var(--font-mono)" }}>
        / {target}{unit}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// RecentRow union + non-meal row renderer
// -----------------------------------------------------------------------------
type RecentRow =
  | { kind: "meal";     id: string; ts: string; meal: Meal;     insulin?: never;     exercise?: never }
  | { kind: "bolus";    id: string; ts: string; meal?: never;   insulin: InsulinLog; exercise?: never }
  | { kind: "basal";    id: string; ts: string; meal?: never;   insulin: InsulinLog; exercise?: never }
  | { kind: "exercise"; id: string; ts: string; meal?: never;   insulin?: never;     exercise: ExerciseLog };

const KIND_ACCENT: Record<"meal" | "bolus" | "basal" | "exercise", { color: string; label: string }> = {
  meal:     { color: "#f59e0b", label: "MEAL" },      // amber (matches FAT macro ring)
  bolus:    { color: "#4A90D9", label: "BOLUS" },     // blue
  basal:    { color: "#8B5CF6", label: "BASAL" },     // purple (no spec'd colour, kept)
  exercise: { color: "#10B981", label: "EXERCISE" },  // teal
};

