"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchMeals, seedMealsIfEmpty, type Meal } from "@/lib/meals";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

const EVAL_COLORS: Record<string, string> = { GOOD:GREEN, LOW:ORANGE, HIGH:PINK, SPIKE:"#FF9F0A", OVERDOSE:PINK, UNDERDOSE:ORANGE, CHECK_CONTEXT:ORANGE };
const EVAL_LABELS: Record<string, string> = { GOOD:"Good", LOW:"Under Dose", HIGH:"Over Dose", SPIKE:"Spike", OVERDOSE:"Over Dose", UNDERDOSE:"Under Dose", CHECK_CONTEXT:"Review" };

function evalColor(ev: string | null) { return EVAL_COLORS[ev ?? ""] || "rgba(255,255,255,0.3)"; }
function evalLabel(ev: string | null) { return EVAL_LABELS[ev ?? ""] || ev || "—"; }

interface CardDef {
  key: string; label: string; color: string;
  getValue: (meals: Meal[]) => string;
  sub: string;
  formula: string; explanation: string; interpretation: string;
}

const CARDS: CardDef[] = [
  {
    key: "control", label: "Control Score", color: ACCENT,
    getValue: (meals) => {
      if (!meals.length) return "—";
      const good=meals.filter(m=>m.evaluation==="GOOD").length;
      const total=meals.length;
      const score=Math.round((good/total)*70 + (1-(meals.filter(m=>m.evaluation==="SPIKE"||m.evaluation==="HIGH").length/total))*30);
      return score.toString();
    },
    sub: "out of 100",
    formula: "Score = (Good% × 70) + (Non-extreme% × 30)",
    explanation: "Control Score measures overall insulin decision quality. It rewards correct dosing and penalizes overdoses and spikes.",
    interpretation: "80+ = Excellent, 60–79 = Good, 40–59 = Fair, <40 = Needs attention",
  },
  {
    key: "good", label: "Good Rate", color: GREEN,
    getValue: (meals) => {
      if (!meals.length) return "—";
      return Math.round(meals.filter(m=>m.evaluation==="GOOD").length / meals.length * 100) + "%";
    },
    sub: "of logged meals",
    formula: "Good Rate = (GOOD outcomes / Total meals) × 100",
    explanation: "The percentage of meals where your insulin dose was in the optimal range — neither too high nor too low.",
    interpretation: "Target >70%. Each GOOD outcome means your dose was within ±35% of the ICR-calculated ideal.",
  },
  {
    key: "spike", label: "Spike Rate", color: ORANGE,
    getValue: (meals) => {
      if (!meals.length) return "—";
      return Math.round(meals.filter(m=>m.evaluation==="SPIKE"||m.evaluation==="LOW"||m.evaluation==="UNDERDOSE").length / meals.length * 100) + "%";
    },
    sub: "under-dosed meals",
    formula: "Spike Rate = (LOW outcomes / Total) × 100",
    explanation: "Meals where insulin was insufficient. Under-dosing leads to glucose spikes, which increase HbA1c long-term.",
    interpretation: "Target <15%. Consistent under-dosing suggests your ICR or correction factor needs adjustment.",
  },
  {
    key: "hypo", label: "Hypo Risk", color: PINK,
    getValue: (meals) => {
      if (!meals.length) return "—";
      return Math.round(meals.filter(m=>m.evaluation==="HIGH"||m.evaluation==="OVERDOSE").length / meals.length * 100) + "%";
    },
    sub: "over-dosed meals",
    formula: "Hypo Risk = (HIGH outcomes / Total) × 100",
    explanation: "Meals where insulin exceeded requirements. Over-dosing risks hypoglycemia, which can be dangerous.",
    interpretation: "Target <10%. If rising, reduce correction factor or ICR temporarily.",
  },
];

function FlipCard({ card, meals }: { card: CardDef; meals: Meal[] }) {
  const [flipped, setFlipped] = useState(false);
  const val = card.getValue(meals);
  return (
    <div onClick={() => setFlipped(f => !f)} style={{ position:"relative", cursor:"pointer", height:160, perspective:1000 }}>
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)", transform:flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* Front */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"24px 20px", display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", letterSpacing:"0.06em", textTransform:"uppercase" }}>{card.label}</div>
          <div>
            <div style={{ fontSize:44, fontWeight:900, letterSpacing:"-0.04em", color:card.color, lineHeight:1 }}>{val}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginTop:4 }}>{card.sub}</div>
          </div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.15)", letterSpacing:"0.05em" }}>TAP FOR FORMULA →</div>
        </div>
        {/* Back */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:`${card.color}0A`, border:`1px solid ${card.color}25`, borderRadius:16, padding:"16px 18px", overflow:"hidden" }}>
          <div style={{ fontSize:11, color:card.color, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>Formula</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)", marginBottom:10, fontFamily:"monospace", background:"rgba(0,0,0,0.3)", padding:"6px 8px", borderRadius:6 }}>{card.formula}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", lineHeight:1.5, marginBottom:8 }}>{card.explanation}</div>
          <div style={{ fontSize:10, color:card.color, opacity:0.7, lineHeight:1.5 }}>{card.interpretation}</div>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ meals }: { meals: Meal[] }) {
  const DAYS = 14;
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
  const filled: number[] = [];
  let last = 110;
  points.forEach(v => { if (v !== null) last = v; filled.push(last); });

  const W=480, H=90, pad=20;
  const mn=70, mx=230;
  const toY=(v:number) => H - ((v-mn)/(mx-mn))*(H-pad)-pad/2;
  const toX=(i:number) => (i/(DAYS-1))*(W-2*pad)+pad;
  const path = filled.map((v,i) => `${i===0?"M":"L"}${toX(i)},${toY(v)}`).join(" ");
  const area = path + ` L${toX(DAYS-1)},${H} L${toX(0)},${H} Z`;

  const dateLabels = Object.keys(buckets);
  const showIdx = [0, Math.floor(DAYS/4), Math.floor(DAYS/2), Math.floor(3*DAYS/4), DAYS-1];

  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" }}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>Glucose Trend</div>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:14 }}>Average glucose before meals — last 14 days</div>
      <svg viewBox={`0 0 ${W} ${H+8}`} style={{ width:"100%", overflow:"visible" }}>
        {[80,110,140,180].map(v => (
          <g key={v}>
            <line x1={pad} y1={toY(v)} x2={W-pad} y2={toY(v)} stroke="rgba(255,255,255,0.05)" strokeDasharray="4"/>
            <text x={pad-4} y={toY(v)+4} textAnchor="end" fontSize="8" fill="rgba(255,255,255,0.2)">{v}</text>
          </g>
        ))}
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trendGrad)"/>
        <path d={path} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {filled.map((v,i) => points[i] !== null ? (
          <circle key={i} cx={toX(i)} cy={toY(v)} r="3" fill={ACCENT} stroke={SURFACE} strokeWidth="1.5"/>
        ) : null)}
        {showIdx.map(i => (
          <text key={i} x={toX(i)} y={H+20} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.2)">
            {new Date(dateLabels[i]).toLocaleDateString("en",{month:"short",day:"numeric"})}
          </text>
        ))}
      </svg>
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
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await seedMealsIfEmpty();
        const data = await fetchMeals();
        setMeals(data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const recent = meals.slice(0, 6);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", gap:12, color:"rgba(255,255,255,0.3)" }}>
      <div style={{ width:20, height:20, border:`2px solid ${ACCENT}`, borderTopColor:"transparent", borderRadius:99, animation:"spin 0.8s linear infinite" }}/>
      Loading dashboard…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ maxWidth:1000, margin:"0 auto" }}>
      <div style={{ marginBottom:28, display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Dashboard</h1>
          <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>
            {meals.length} meals logged. Click any card to see formula.
          </p>
        </div>
        <button onClick={() => router.push("/log")} style={{ padding:"10px 20px", borderRadius:10, border:"none", background:ACCENT, color:"#fff", cursor:"pointer", fontSize:14, fontWeight:600, boxShadow:`0 4px 20px ${ACCENT}40` }}>
          + Log Meal
        </button>
      </div>

      {/* FLIP CARDS */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:22 }}>
        {CARDS.map(c => <FlipCard key={c.key} card={c} meals={meals}/>)}
      </div>

      {/* CHARTS */}
      <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:14, marginBottom:22 }}>
        <TrendChart meals={meals}/>
        <OutcomeChart meals={meals}/>
      </div>

      {/* RECENT ENTRIES */}
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
        <div style={{ padding:"18px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${BORDER}` }}>
          <div style={{ fontSize:14, fontWeight:600 }}>Recent Entries</div>
          <button onClick={() => router.push("/entries")} style={{ fontSize:12, color:ACCENT, background:"transparent", border:"none", cursor:"pointer" }}>View all →</button>
        </div>
        {recent.length === 0 ? (
          <div style={{ padding:"32px", textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:14 }}>No entries yet. Log your first meal.</div>
        ) : (
          <div>
            {recent.map(m => {
              const isOpen = expanded === m.id;
              const ev = m.evaluation;
              const time = new Date(m.created_at).toLocaleString("en", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
              return (
                <div key={m.id} style={{ borderBottom:`1px solid ${BORDER}` }}>
                  <div onClick={() => setExpanded(isOpen ? null : m.id)} style={{ padding:"14px 24px", cursor:"pointer", display:"grid", gridTemplateColumns:"1fr auto auto auto auto", gap:16, alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:500, marginBottom:2 }}>{m.input_text.length > 45 ? m.input_text.slice(0,45)+"…" : m.input_text}</div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>{time}</div>
                    </div>
                    <div style={{ fontSize:13, textAlign:"right" }}><span style={{ color:"rgba(255,255,255,0.35)", fontSize:11 }}>BG </span>{m.glucose_before ?? "—"}</div>
                    <div style={{ fontSize:13, textAlign:"right" }}><span style={{ color:"rgba(255,255,255,0.35)", fontSize:11 }}>Carbs </span>{m.carbs_grams ?? "—"}g</div>
                    <div style={{ fontSize:13, textAlign:"right" }}><span style={{ color:"rgba(255,255,255,0.35)", fontSize:11 }}>Insulin </span>{m.insulin_units ?? "—"}u</div>
                    <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:`${evalColor(ev)}18`, color:evalColor(ev), border:`1px solid ${evalColor(ev)}30`, whiteSpace:"nowrap" }}>
                      {evalLabel(ev)}
                    </span>
                  </div>
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
                        <span style={{ fontSize:13, fontWeight:600, color:c || "rgba(255,255,255,0.85)" }}>{v}</span>
                      </div>
                    );
                    return (
                      <div style={{ padding:"0 24px 16px", display:"flex", flexDirection:"column", gap:10 }}>
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
    </div>
  );
}
