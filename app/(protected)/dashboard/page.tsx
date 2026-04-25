"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchMeals, type Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS, TYPE_EXPLAIN, getEvalColor, getEvalLabel, getEvalExplain } from "@/lib/mealTypes";
import MealEntryCardCollapsed from "@/components/MealEntryCardCollapsed";
import CurrentDayGlucoseCard from "@/components/CurrentDayGlucoseCard";
import GlucoseTrendFront from "@/components/GlucoseTrendChart";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import { useCardOrder } from "@/lib/cardOrder";

/** Default top-to-bottom order of dashboard sections. Each ID also appears
 *  as a key in the items array below — keep them in sync. */
const DASHBOARD_DEFAULT_ORDER = ["today-glucose", "stats", "charts", "recent-entries"];

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
              <span style={{ fontSize:32, fontWeight:800, color:card.color, letterSpacing:"-0.03em", lineHeight:1, fontFamily:"var(--font-mono)" }}>{card.value}</span>
              <span style={{ fontSize:13, color:"rgba(255,255,255,0.3)", paddingBottom:3, fontFamily:"var(--font-mono)" }}>{card.unit}</span>
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
    const d = new Date(m.created_at).toDateString();
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
    const ts = new Date(m.created_at);
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
                <div style={{ fontSize:14, fontWeight:700, color:s.c || "rgba(255,255,255,0.9)", letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{s.v}</div>
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
                    <div style={{ fontSize:10, fontWeight:700, color: v == null ? "rgba(255,255,255,0.25)" : c, fontFamily:"var(--font-mono)" }}>{v ?? "—"}</div>
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
                <span style={{ fontSize:12, fontWeight:600, color:g.color, fontFamily:"var(--font-mono)" }}>{g.count} <span style={{ color:"rgba(255,255,255,0.3)", fontWeight:400 }}>({pct}%)</span></span>
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
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(initial: boolean) {
      try {
        const data = await fetchMeals();
        if (!cancelled) setMeals(data);
      } catch (e) { console.error(e); }
      finally { if (!cancelled && initial) setLoading(false); }
    }
    load(true);
    function onUpdated() { load(false); }
    window.addEventListener("glev:meals-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("glev:meals-updated", onUpdated);
    };
  }, []);

  const recent = meals.slice(0, 6);

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
    { id: "recent-entries", node: <RecentEntries meals={recent} expanded={expanded} setExpanded={setExpanded} onViewAll={() => router.push("/entries")}/> },
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
            {meals.length} meals logged. Hold any card to reorder · click to flip.
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

function RecentEntries({
  meals: recent,
  expanded,
  setExpanded,
  onViewAll,
}: {
  meals: Meal[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onViewAll: () => void;
}) {
  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
        <div style={{ padding:"18px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${BORDER}` }}>
          <div style={{ fontSize:14, fontWeight:600 }}>Recent Entries</div>
          <button onClick={onViewAll} style={{ fontSize:12, color:ACCENT, background:"transparent", border:"none", cursor:"pointer" }}>View all →</button>
        </div>
        {recent.length === 0 ? (
          <div style={{ padding:"32px", textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:14 }}>No entries yet. Log your first meal.</div>
        ) : (
          <div>
            {recent.map(m => {
              const isOpen = expanded === m.id;
              const ev = m.evaluation;
              const time = new Date(m.meal_time ?? m.created_at).toLocaleString("en", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
              return (
                <div key={m.id} style={{ borderBottom:`1px solid ${BORDER}` }}>
                  {isOpen ? (
                    <div onClick={() => setExpanded(null)} style={{ padding:"14px 24px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
                      <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", letterSpacing:"0.02em", fontFamily:"var(--font-mono)" }}>{time}</div>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:"rotate(90deg)", flexShrink:0 }}>
                        <polyline points="9 6 15 12 9 18"/>
                      </svg>
                    </div>
                  ) : (
                    <MealEntryCardCollapsed meal={m} onClick={() => setExpanded(m.id)}/>
                  )}
                  {isOpen && (() => {
                    const protein = m.protein_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.protein||0),0) : 0);
                    const fat     = m.fat_grams     ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fat||0),0) : 0);
                    const fiber   = m.fiber_grams   ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fiber||0),0) : 0);
                    const carbs   = m.carbs_grams ?? 0;
                    const cals    = m.calories ?? Math.round(carbs*4 + protein*4 + fat*9);
                    const netCarbs = Math.max(0, carbs - fiber);
                    const icr     = m.insulin_units && m.insulin_units > 0 ? netCarbs / m.insulin_units : null;
                    const delta   = (m.glucose_after && m.glucose_before) ? m.glucose_after - m.glucose_before : null;
                    const Cell = ({ l, v, c }: { l: string; v: string; c?: string }) => (
                      <div style={{ display:"inline-flex", flexDirection:"column", minWidth:80 }}>
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em", textTransform:"uppercase" }}>{l}</span>
                        <span style={{ fontSize:13, fontWeight:600, color:c || "rgba(255,255,255,0.85)", fontFamily:"var(--font-mono)" }}>{v}</span>
                      </div>
                    );
                    return (
                      <div style={{ padding:"0 24px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                        {/* Outcome — highlighted block, same weight as classification */}
                        {ev && (() => {
                          const c = evalColor(ev);
                          return (
                            <div style={{ marginTop:4, background:`${c}12`, border:`1px solid ${c}40`, borderRadius:10, padding:"10px 14px" }}>
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom: getEvalExplain(ev) ? 6 : 0 }}>
                                <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em", fontWeight:700 }}>OUTCOME</div>
                                <span style={{ padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:700, background:`${c}22`, color:c, border:`1px solid ${c}40`, whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                                  {evalLabel(ev)}
                                </span>
                              </div>
                              {getEvalExplain(ev) && (
                                <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.5 }}>{getEvalExplain(ev)}</div>
                              )}
                            </div>
                          );
                        })()}
                        {/* Meal classification — highlighted block */}
                        {m.meal_type && (() => {
                          const c = TYPE_COLORS[m.meal_type] || "rgba(255,255,255,0.5)";
                          return (
                            <div style={{ background:`${c}12`, border:`1px solid ${c}30`, borderRadius:10, padding:"10px 14px" }}>
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:6 }}>
                                <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em", fontWeight:700 }}>MEAL CLASSIFICATION</div>
                                <span style={{ padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:700, background:`${c}22`, color:c, border:`1px solid ${c}40`, whiteSpace:"nowrap", letterSpacing:"0.04em" }}>
                                  {TYPE_LABELS[m.meal_type]}
                                </span>
                              </div>
                              <span style={{ fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.5 }}>{TYPE_EXPLAIN[m.meal_type]}</span>
                            </div>
                          );
                        })()}
                        {/* Row 0 — Meal description (food + grams) */}
                        {m.input_text && (
                          <div style={{ borderLeft:`2px solid rgba(255,255,255,0.15)`, paddingLeft:14, paddingTop:10 }}>
                            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em", fontWeight:700, marginBottom:6 }}>MEAL</div>
                            <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.55 }}>{m.input_text}</div>
                          </div>
                        )}
                        {/* Row 1 — Macros & Dosing */}
                        <div style={{ borderLeft:`2px solid ${ACCENT}55`, paddingLeft:14, paddingTop:10 }}>
                          <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>MACROS &amp; DOSING</div>
                          <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
                            <Cell l="Carbs"    v={`${carbs}g`}   c={ORANGE}/>
                            <Cell l="Fiber"    v={`${fiber}g`}/>
                            <Cell l="Net"      v={`${netCarbs}g`} c={GREEN}/>
                            <Cell l="Protein"  v={`${protein}g`} c="#3B82F6"/>
                            <Cell l="Fat"      v={`${fat}g`}     c="#A855F7"/>
                            <Cell l="Calories" v={`${cals} kcal`} c="#A78BFA"/>
                            <Cell l="Insulin"  v={`${m.insulin_units ?? 0}u`} c={ACCENT}/>
                            <Cell l="Carb ratio" v={icr ? `1u / ${icr.toFixed(0)}g` : "—"}/>
                          </div>
                        </div>
                        {/* Row 2 — Glucose */}
                        <div style={{ borderLeft:`2px solid ${GREEN}55`, paddingLeft:14, paddingTop:6 }}>
                          <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>GLUCOSE</div>
                          <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
                            <Cell l="Before" v={m.glucose_before ? `${m.glucose_before} mg/dL` : "—"} c={m.glucose_before ? (m.glucose_before>140?ORANGE:m.glucose_before<80?PINK:GREEN) : undefined}/>
                            <Cell l="After"  v={m.glucose_after  ? `${m.glucose_after} mg/dL`  : "not recorded"} c={m.glucose_after ? (m.glucose_after>180||m.glucose_after<70?PINK:GREEN) : "rgba(255,255,255,0.3)"}/>
                            <Cell l="Delta"  v={delta!=null ? `${delta>0?"+":""}${delta} mg/dL` : "—"} c={delta!=null ? (Math.abs(delta)>60?PINK:Math.abs(delta)>30?ORANGE:GREEN) : undefined}/>
                            <Cell l="Time"   v={time}/>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
