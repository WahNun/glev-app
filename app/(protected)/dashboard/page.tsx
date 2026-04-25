"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { fetchMeals, computeCalories, type Meal } from "@/lib/meals";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
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
    <div onClick={() => setFlipped(f => !f)} className="glev-stat-card" style={{ position:"relative", cursor:"pointer", height:120, perspective:1000 }}>
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)", transform:flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* Front */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"14px 18px", boxSizing:"border-box", display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600, textTransform:"uppercase" }}>{card.label}</div>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.18)" }}>↺</span>
          </div>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:8 }}>
            <div style={{ display:"flex", alignItems:"flex-end", gap:4 }}>
              <span style={{ fontSize:32, fontWeight:800, color:card.color, letterSpacing:"-0.03em", lineHeight:1 }}>{card.value}</span>
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
        .glev-trend-card { height: 380px; }
        @media (max-width: 768px) {
          .glev-trend-card { height: 420px; }
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
    { id: "today-macros",  node: <DailyMacrosCard meals={meals}/> },
    {
      id: "stats",
      node: (
        <div className="glev-dash-grid" style={{ display:"grid", gap:14 }}>
          {cards.map(c => <FlipCard key={c.key} card={c}/>)}
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
    { id: "recent-entries", node: <RecentEntries rows={recentRows} onViewAll={() => router.push("/entries")} onViewEntry={(id) => router.push(`/entries#${id}`)}/> },
  ];

  return (
    <div style={{ maxWidth:1480, margin:"0 auto", width:"100%", overflowX:"hidden", boxSizing:"border-box" }}>
      <style>{`
        html, body { overflow-x: hidden; }
        .glev-dash-head    { display: flex; }
        .glev-dash-grid    { grid-template-columns: repeat(4,1fr) !important; }
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
          + Log Meal
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
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
        <div style={{ padding:"18px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${BORDER}` }}>
          <div style={{ fontSize:14, fontWeight:600 }}>Recent Entries</div>
          <button onClick={onViewAll} style={{ fontSize:12, color:ACCENT, background:"transparent", border:"none", cursor:"pointer" }}>View all →</button>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding:"32px", textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:14 }}>No entries yet. Log your first meal.</div>
        ) : (
          <div>
            {rows.map(r => {
              const isOpen = expanded === r.id;

              if (r.kind === "meal") {
                const m = r.meal!;
                return (
                  <div key={r.id} style={{ borderBottom:`1px solid ${BORDER}`, background: isOpen ? "rgba(255,255,255,0.015)" : undefined, transition:"background 0.15s ease" }}>
                    <MealEntryCardCollapsed meal={m} onClick={() => toggle(r.id)}/>
                    {isOpen && (
                      <div style={{ borderTop:`1px solid ${BORDER}` }}>
                        <MealEntryLightExpand
                          meal={m}
                          onViewFull={() => onViewEntry(m.id)}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              if (r.kind === "exercise") {
                const x = r.exercise!;
                return (
                  <div key={r.id} style={{ borderBottom:`1px solid ${BORDER}`, background: isOpen ? "rgba(255,255,255,0.015)" : undefined, transition:"background 0.15s ease" }}>
                    <NonMealRecentRow
                      kind="exercise"
                      ts={r.ts}
                      primaryLabel="Duration"
                      primaryValue={`${x.duration_minutes}m`}
                      secondaryLabel="Type"
                      secondaryValue={x.exercise_type === "cardio" ? "cardio" : "strength"}
                      onClick={() => toggle(r.id)}
                    />
                    {isOpen && (
                      <div style={{ borderTop:`1px solid ${BORDER}` }}>
                        <NonMealLightExpand
                          ts={r.ts}
                          stats={[
                            { label:"Duration",  value:`${x.duration_minutes} min`, color:KIND_ACCENT.exercise.color },
                            { label:"Type",      value:x.exercise_type === "cardio" ? "Cardio" : "Strength" },
                            { label:"Intensity", value:x.intensity || "—" },
                            ...(x.cgm_glucose_at_log != null ? [{ label:"CGM at log", value:`${x.cgm_glucose_at_log} mg/dL` }] : []),
                          ]}
                          onViewFull={() => onViewEntry(r.id)}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              // bolus | basal
              const i = r.insulin!;
              return (
                <div key={r.id} style={{ borderBottom:`1px solid ${BORDER}`, background: isOpen ? "rgba(255,255,255,0.015)" : undefined, transition:"background 0.15s ease" }}>
                  <NonMealRecentRow
                    kind={r.kind}
                    ts={r.ts}
                    primaryLabel="Dose"
                    primaryValue={`${i.units}u`}
                    secondaryLabel="Type"
                    secondaryValue={i.insulin_name || (r.kind === "bolus" ? "rapid-acting" : "long-acting")}
                    onClick={() => toggle(r.id)}
                  />
                  {isOpen && (
                    <div style={{ borderTop:`1px solid ${BORDER}` }}>
                      <NonMealLightExpand
                        ts={r.ts}
                        stats={[
                          { label:"Dose",   value:`${i.units} u`, color:KIND_ACCENT[r.kind].color },
                          { label:"Insulin", value:i.insulin_name || (r.kind === "bolus" ? "rapid-acting" : "long-acting") },
                          { label:"Kind",   value:r.kind === "bolus" ? "Bolus" : "Basal", color:KIND_ACCENT[r.kind].color },
                          ...(i.cgm_glucose_at_log != null ? [{ label:"CGM at log", value:`${i.cgm_glucose_at_log} mg/dL` }] : []),
                        ]}
                        onViewFull={() => onViewEntry(r.id)}
                      />
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
// Daily Macros card — sums today's carbs / protein / fat / fiber across all
// logged meals. Calories use the meal's stored value where present, falling
// back to the 4·carbs + 4·protein + 9·fat estimate for older rows.
// -----------------------------------------------------------------------------
function DailyMacrosCard({ meals }: { meals: Meal[] }) {
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
  // Targets are sensible Type-1 daily defaults; will become user-configurable
  // when the prefs UI for macro goals lands. `calories` is intentionally not
  // shown here — it surfaces in the expanded view.
  const rings: Array<{ label: string; value: number; target: number; color: string; unit: string }> = [
    { label: "CARBS",   value: Math.round(today.carbs),   target: 250, color: "#f97316", unit: "g" },
    { label: "PROTEIN", value: Math.round(today.protein), target: 120, color: "#8b5cf6", unit: "g" },
    { label: "FAT",     value: Math.round(today.fat),     target: 80,  color: "#f59e0b", unit: "g" },
    { label: "FIBER",   value: Math.round(today.fiber),   target: 30,  color: "#10b981", unit: "g" },
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
      {/* Expanded section — minimal default: surfaces calories (the macro that
          was dropped from the collapsed view). Real expanded-view spec still
          pending from product; replace this block when it lands. */}
      {expanded && (
        <div
          id="glev-macros-expanded"
          style={{ padding:"16px 24px 20px", borderTop:`1px solid ${BORDER}`, display:"flex", justifyContent:"space-between", alignItems:"baseline" }}
        >
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", letterSpacing:"0.1em", fontWeight:700, textTransform:"uppercase" }}>
            Calories
          </div>
          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
            <span style={{ fontSize:22, fontWeight:800, color:ACCENT, letterSpacing:"-0.02em", fontFamily:"var(--font-mono)" }}>
              {Math.round(today.calories)}
            </span>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:500 }}>
              kcal
            </span>
          </div>
        </div>
      )}
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

const KIND_ACCENT: Record<"bolus" | "basal" | "exercise", { color: string; label: string }> = {
  bolus:    { color: "#4A90D9", label: "BOLUS" },     // blue
  basal:    { color: "#8B5CF6", label: "BASAL" },     // purple
  exercise: { color: "#10B981", label: "EXERCISE" },  // green
};

/**
 * Compact 4-column row matching MealEntryCardCollapsed's grid so meal
 * and non-meal rows align visually. Right-side eval pill is a neutral
 * "LOGGED" badge since these don't have under/over-dose evaluation.
 */
function NonMealRecentRow({
  kind, ts, primaryLabel, primaryValue, secondaryLabel, secondaryValue, onClick,
}: {
  kind: "bolus" | "basal" | "exercise";
  ts: string;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  onClick: () => void;
}) {
  const accent = KIND_ACCENT[kind];
  const d = new Date(ts);
  const dateStr = d.toLocaleDateString("en", { month: "short", day: "numeric" });
  const timeStr = d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });

  return (
    <div
      className="glev-mec glev-mec--with-eval"
      onClick={onClick}
      style={{ padding: "14px 16px", cursor: "pointer", alignItems: "center" }}
    >
      {/* Col 1: When */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">When</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-mono)" }}>
          {dateStr}
          <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 400, marginLeft: 6 }}>{timeStr}</span>
        </div>
      </div>

      {/* Col 2: Type with coloured dot */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">Type</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: accent.color, opacity: 0.85, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: accent.color, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {accent.label}
          </span>
        </div>
      </div>

      {/* Col 3: primary metric (dose / duration) */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">{primaryLabel}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: accent.color, letterSpacing: "-0.01em", fontFamily: "var(--font-mono)" }}>
          {primaryValue}
        </div>
      </div>

      {/* Col 4: secondary (brand / activity type) */}
      <div style={{ minWidth: 0 }}>
        <div className="glev-mec-cell-label">{secondaryLabel}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {secondaryValue}
        </div>
      </div>

      {/* Col 5: neutral LOGGED pill (matches meal eval column for alignment) */}
      <span
        className="glev-mec-eval"
        style={{
          padding: "5px 10px",
          borderRadius: 99,
          fontSize: 10,
          fontWeight: 700,
          background: `${accent.color}18`,
          color: accent.color,
          border: `1px solid ${accent.color}30`,
          whiteSpace: "nowrap",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        LOGGED
      </span>
    </div>
  );
}
