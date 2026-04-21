import { useState, useEffect } from "react";

type Page = "dashboard" | "log" | "entries" | "insights" | "recommend" | "import";
type MealTypeKey = "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";

// ─── Meal classifier ─────────────────────────────────────────────
const FAST_SUGAR_KW = ["granola","juice","dessert","cake","candy","soda","syrup","white bread","donut","cookie","muffin","pancake","waffle","cereal","jam","honey","ice cream","gelato"];
const MEAL_LABELS: Record<MealTypeKey,string> = { FAST_CARBS:"Fast Carbs", HIGH_FAT:"High Fat", HIGH_PROTEIN:"High Protein", BALANCED:"Balanced" };

function classifyMeal(carbs:number, protein:number, fat:number, desc?:string) {
  const matched = desc ? FAST_SUGAR_KW.find(k=>desc.toLowerCase().includes(k)) : null;
  if (matched) return { mealType:"FAST_CARBS" as MealTypeKey, reason:`Fast sugar detected ("${matched}") → FAST CARBS`, carbPct:0,fatPct:0,protPct:0,fastSugar:matched };
  const cc=carbs*4,pc=protein*4,fc=fat*9,tot=cc+pc+fc;
  const carbPct=tot>0?(cc/tot)*100:0, fatPct=tot>0?(fc/tot)*100:0, protPct=tot>0?(pc/tot)*100:0;
  if (fat>30||fatPct>40) return { mealType:"HIGH_FAT" as MealTypeKey, reason: fat>30?`Fat ${fat}g > 30g threshold`:`Fat ${fatPct.toFixed(0)}% of cals > 40%`, carbPct,fatPct,protPct,fastSugar:null };
  if (carbPct>60&&fat<20&&protein<25) return { mealType:"FAST_CARBS" as MealTypeKey, reason:`Carbs ${carbPct.toFixed(0)}% of cals, fat ${fat}g, protein ${protein}g`, carbPct,fatPct,protPct,fastSugar:null };
  if (protein>40&&carbs<40) return { mealType:"HIGH_PROTEIN" as MealTypeKey, reason:`Protein ${protein}g > 40g with carbs ${carbs}g < 40g`, carbPct,fatPct,protPct,fastSugar:null };
  return { mealType:"BALANCED" as MealTypeKey, reason:`Mixed macros — carbs ${carbPct.toFixed(0)}%, protein ${protPct.toFixed(0)}%, fat ${fatPct.toFixed(0)}%`, carbPct,fatPct,protPct,fastSugar:null };
}

// ─── Inline classifier widget ─────────────────────────────────────
function MacroWidget({ cl, active, overridden, onPick, onReset }: {
  cl: ReturnType<typeof classifyMeal> | null;
  active: MealTypeKey; overridden: boolean;
  onPick: (t:MealTypeKey)=>void; onReset: ()=>void;
}) {
  if (!cl) return null;
  const barColors: Record<MealTypeKey,string> = { FAST_CARBS:"#FF9500", HIGH_FAT:"#A855F7", HIGH_PROTEIN:"#3B82F6", BALANCED:"#22D3A0" };
  const pillColors: Record<MealTypeKey,[string,string]> = {
    FAST_CARBS: ["rgba(255,149,0,0.18)","#FF9500"],
    HIGH_FAT:   ["rgba(168,85,247,0.18)","#A855F7"],
    HIGH_PROTEIN:["rgba(59,130,246,0.18)","#3B82F6"],
    BALANCED:   ["rgba(34,211,160,0.18)","#22D3A0"],
  };
  const [sugBg, sugColor] = pillColors[cl.mealType];
  return (
    <div style={{borderRadius:10,border:`1px solid rgba(255,255,255,0.08)`,background:"rgba(255,255,255,0.03)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <span style={{fontSize:14,marginTop:1}}>{cl.fastSugar?"⚠️":"✦"}</span>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:"0.1em"}}>{cl.fastSugar?"FAST SUGAR DETECTED":"AUTO-CLASSIFIED"}</span>
            <span style={{fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:99,background:sugBg,color:sugColor}}>{MEAL_LABELS[cl.mealType]}</span>
            {overridden && <span style={{fontSize:9,padding:"2px 8px",borderRadius:99,background:"rgba(255,149,0,0.15)",color:"#FF9500",fontWeight:600}}>OVERRIDE</span>}
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.38)",lineHeight:1.55}}>{cl.reason}</div>
        </div>
      </div>
      {(cl.carbPct+cl.fatPct+cl.protPct)>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <div style={{height:4,borderRadius:99,overflow:"hidden",display:"flex",gap:1}}>
            <div style={{width:`${cl.carbPct}%`,background:"#FF9500"}}/>
            <div style={{width:`${cl.protPct}%`,background:"#3B82F6"}}/>
            <div style={{width:`${cl.fatPct}%`,background:"#A855F7"}}/>
          </div>
          <div style={{display:"flex",gap:12,fontSize:9,color:"rgba(255,255,255,0.3)"}}>
            <span>🟠 Carbs {cl.carbPct.toFixed(0)}%</span>
            <span>🔵 Protein {cl.protPct.toFixed(0)}%</span>
            <span>🟣 Fat {cl.fatPct.toFixed(0)}%</span>
          </div>
        </div>
      )}
      <div>
        <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",marginBottom:6,letterSpacing:"0.08em"}}>OVERRIDE TYPE</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {(Object.keys(MEAL_LABELS) as MealTypeKey[]).map(t=>{
            const [bg,color]=pillColors[t];
            return (
              <button key={t} onClick={()=>onPick(t)} style={{padding:"5px 12px",borderRadius:99,border:`1px solid ${active===t?color:"rgba(255,255,255,0.1)"}`,background:active===t?bg:"transparent",color:active===t?color:"rgba(255,255,255,0.45)",fontSize:10,fontWeight:600,cursor:"pointer"}}>
                {MEAL_LABELS[t]}
              </button>
            );
          })}
        </div>
        {overridden&&<button onClick={onReset} style={{marginTop:6,fontSize:9,color:"rgba(255,255,255,0.35)",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Reset to auto-detect</button>}
      </div>
    </div>
  );
}

const ACCENT = "#4F6EF7";
const PINK = "#FF2D78";
const GREEN = "#22D3A0";
const ORANGE = "#FF9500";
const BG = "#09090B";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";

const glucosePoints = [112, 128, 95, 185, 130, 105, 105, 138, 88, 210, 120, 92, 99, 125, 108, 140];
const maxG = 220; const minG = 60; const W = 560; const H = 120;
const toY = (g: number) => H - ((g - minG) / (maxG - minG)) * H;
const toX = (i: number) => (i / (glucosePoints.length - 1)) * W;
const pathD = glucosePoints.map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
const areaD = pathD + ` L ${W} ${H} L 0 ${H} Z`;

const entries = [
  { time: "Today 12:30", meal: "Quinoa bowl", type: "BALANCED", bg: 108, carbs: 55, insulin: 5.5, eval: "GOOD" },
  { time: "Yesterday 19:15", meal: "Pizza night", type: "FAST_CARBS", bg: 88, carbs: 80, insulin: 5.0, eval: "UNDERDOSE" },
  { time: "Yesterday 12:00", meal: "Avocado eggs", type: "HIGH_FAT", bg: 120, carbs: 25, insulin: 4.0, eval: "GOOD" },
  { time: "Apr 19 19:00", meal: "Brown rice bowl", type: "BALANCED", bg: 105, carbs: 50, insulin: 5.5, eval: "GOOD" },
  { time: "Apr 18 20:00", meal: "Grilled chicken", type: "HIGH_PROTEIN", bg: 130, carbs: 30, insulin: 6.0, eval: "OVERDOSE" },
  { time: "Apr 17 08:30", meal: "Pancakes + syrup", type: "FAST_CARBS", bg: 95, carbs: 85, insulin: 4.5, eval: "UNDERDOSE" },
  { time: "Apr 16 13:00", meal: "Salmon & rice", type: "BALANCED", bg: 115, carbs: 55, insulin: 3.5, eval: "GOOD" },
];

function evalStyle(e: string) {
  if (e === "GOOD") return { color: GREEN, label: "GOOD" };
  if (e === "UNDERDOSE") return { color: ORANGE, label: "LOW DOSE" };
  if (e === "OVERDOSE") return { color: PINK, label: "OVERDOSE" };
  return { color: "#8B8FA8", label: "CHECK" };
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, ...style }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, unit, sub, color, bar }: { label: string; value: string; unit: string; sub: string; color: string; bar: number }) {
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.06em" }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: "-0.03em" }}>{value}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", paddingBottom: 3 }}>{unit}</span>
      </div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${bar}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>{sub}</div>
    </Card>
  );
}

// ─── PAGES ───────────────────────────────────────────────────────

function Dashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        <StatCard label="Control Score" value="75" unit="/100" sub="Last 8 entries" color={ACCENT} bar={75} />
        <StatCard label="Time in Range" value="62.5" unit="%" sub="5 of 8 entries" color={GREEN} bar={62.5} />
        <StatCard label="Spike Rate" value="25.0" unit="%" sub="Hyperglycemia" color={ORANGE} bar={25} />
        <StatCard label="Hypo Rate" value="0.0" unit="%" sub="Hypoglycemia" color={PINK} bar={0} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr", gap: 10 }}>
        <Card style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Glucose Trend</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Pre-meal readings · 7 days</div>
            </div>
            <span style={{ fontSize: 11, padding: "4px 10px", background: `${ACCENT}22`, color: ACCENT, borderRadius: 99, fontWeight: 500 }}>7d</span>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: `${((maxG - 140) / (maxG - minG)) * 100}%`, height: `${((140 - 80) / (maxG - minG)) * 100}%`, background: `${GREEN}0A`, borderTop: `1px dashed ${GREEN}50`, borderBottom: `1px dashed ${GREEN}50` }} />
            <svg width="100%" height={H + 10} viewBox={`0 0 ${W} ${H + 10}`} preserveAspectRatio="none" style={{ display: "block" }}>
              <defs>
                <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#dg)" />
              <path d={pathD} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {glucosePoints.map((g, i) => g > 180 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={ORANGE} /> : g < 70 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={PINK} /> : null)}
            </svg>
          </div>
        </Card>

        <Card style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Outcomes</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>Evaluation split</div>
          {[
            { label: "GOOD", count: 5, pct: 62.5, color: GREEN },
            { label: "UNDERDOSE", count: 2, pct: 25, color: ORANGE },
            { label: "OVERDOSE", count: 1, pct: 12.5, color: PINK },
            { label: "CHECK", count: 0, pct: 0, color: "#4B5070" },
          ].map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: 99, background: r.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em" }}>{r.label}</span>
                  <span style={{ fontSize: 10, color: r.color, fontWeight: 600 }}>{r.count}</span>
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${r.pct}%`, height: "100%", background: r.color, borderRadius: 99 }} />
                </div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>AVG CARB RATIO</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: ACCENT }}>1u <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>per</span> 33g</div>
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Recent Entries</div>
          <span style={{ fontSize: 11, color: ACCENT, cursor: "pointer" }}>View all →</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
              {["Time", "Meal", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                <th key={h} style={{ padding: "7px 18px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em" }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 4).map((e, i) => {
              const ev = evalStyle(e.eval);
              return (
                <tr key={i} style={{ borderBottom: i < 3 ? `1px solid rgba(255,255,255,0.03)` : "none" }}>
                  <td style={{ padding: "9px 18px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{e.time}</td>
                  <td style={{ padding: "9px 18px", fontSize: 12, fontWeight: 500 }}>{e.meal}</td>
                  <td style={{ padding: "9px 18px", fontSize: 12, fontWeight: 600, color: e.bg > 140 ? ORANGE : e.bg < 80 ? PINK : "rgba(255,255,255,0.85)" }}>{e.bg} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>mg/dL</span></td>
                  <td style={{ padding: "9px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.carbs}g</td>
                  <td style={{ padding: "9px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.insulin}u</td>
                  <td style={{ padding: "9px 18px" }}>
                    <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em" }}>{ev.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function QuickLog() {
  const [glucose, setGlucose] = useState("");
  const [carbs, setCarbs] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [desc, setDesc] = useState("");
  const [insulin, setInsulin] = useState("");
  const [mealType, setMealType] = useState<MealTypeKey>("BALANCED");
  const [overridden, setOverridden] = useState(false);
  const [cl, setCl] = useState<ReturnType<typeof classifyMeal>|null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const c=Number(carbs)||0,p=Number(protein)||0,f=Number(fat)||0;
    if(c+p+f===0&&!desc){setCl(null);return;}
    const r=classifyMeal(c,p,f,desc);
    setCl(r);
    if(!overridden) setMealType(r.mealType);
  },[carbs,protein,fat,desc,overridden]);

  const inp: React.CSSProperties = { background:"rgba(255,255,255,0.05)", border:`1px solid rgba(255,255,255,0.1)`, borderRadius:10, padding:"9px 12px", color:"white", fontSize:14, fontWeight:600, width:"100%", boxSizing:"border-box", outline:"none", fontFamily:"inherit" };

  if (submitted) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:380,gap:16}}>
      <div style={{width:60,height:60,borderRadius:99,background:`${GREEN}22`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:28,color:GREEN}}>✓</span></div>
      <div style={{fontSize:18,fontWeight:700,color:GREEN}}>Entry logged</div>
      <div style={{fontSize:13,color:"rgba(255,255,255,0.4)"}}>BG {glucose} · {carbs}g carbs · {MEAL_LABELS[mealType]} · {insulin}u</div>
      <button onClick={()=>{setSubmitted(false);setGlucose("");setCarbs("");setProtein("");setFat("");setDesc("");setInsulin("");setOverridden(false);}} style={{marginTop:8,padding:"10px 24px",background:ACCENT,border:"none",borderRadius:10,color:"white",fontSize:13,fontWeight:600,cursor:"pointer"}}>Log Another</button>
    </div>
  );

  return (
    <div style={{maxWidth:520}}>
      <Card style={{padding:22}}>
        <div style={{fontSize:15,fontWeight:700,marginBottom:18}}>Log a Meal</div>
        <div style={{display:"flex",flexDirection:"column",gap:13}}>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>GLUCOSE BEFORE (mg/dL)</div>
            <input value={glucose} onChange={e=>setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={inp} />
          </div>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>CARBS (g)</div>
            <input value={carbs} onChange={e=>setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inp} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>PROTEIN (g)</div>
              <input value={protein} onChange={e=>setProtein(e.target.value)} placeholder="e.g. 30" type="number" style={inp} />
            </div>
            <div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>FAT (g)</div>
              <input value={fat} onChange={e=>setFat(e.target.value)} placeholder="e.g. 15" type="number" style={inp} />
            </div>
          </div>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>MEAL DESCRIPTION <span style={{opacity:0.5}}>(optional — detects fast sugars)</span></div>
            <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. granola, juice, pizza…" style={{...inp,fontSize:12,fontWeight:400}} />
          </div>
          <MacroWidget cl={cl} active={mealType} overridden={overridden}
            onPick={t=>{setMealType(t);setOverridden(t!==(cl?.mealType??"BALANCED"));}}
            onReset={()=>{setOverridden(false);if(cl)setMealType(cl.mealType);}} />
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>INSULIN (u)</div>
            <input value={insulin} onChange={e=>setInsulin(e.target.value)} placeholder="e.g. 1.5" type="number" style={inp} />
          </div>
          <button onClick={()=>{if(glucose&&carbs&&insulin)setSubmitted(true);}} style={{marginTop:2,padding:"13px",background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`,border:"none",borderRadius:10,color:"white",fontSize:14,fontWeight:700,cursor:"pointer",opacity:glucose&&carbs&&insulin?1:0.4}}>
            Log Entry
          </button>
        </div>
      </Card>
    </div>
  );
}

function EntryLog() {
  const [filter, setFilter] = useState("ALL");
  const filters = ["ALL", "GOOD", "UNDERDOSE", "OVERDOSE"];
  const filtered = filter === "ALL" ? entries : entries.filter((e) => e.eval === filter);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {filters.map((f) => {
          const colors: Record<string, string> = { ALL: ACCENT, GOOD: GREEN, UNDERDOSE: ORANGE, OVERDOSE: PINK };
          return (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 99, fontSize: 11, fontWeight: 600, border: `1px solid ${filter === f ? colors[f] : "rgba(255,255,255,0.1)"}`, background: filter === f ? `${colors[f]}18` : "transparent", color: filter === f ? colors[f] : "rgba(255,255,255,0.45)", cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.04em" }}>
              {f}
            </button>
          );
        })}
      </div>
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
              {["Time", "Meal", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em" }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const ev = evalStyle(e.eval);
              return (
                <tr key={i} style={{ borderBottom: i < filtered.length - 1 ? `1px solid rgba(255,255,255,0.03)` : "none", cursor: "pointer" }}>
                  <td style={{ padding: "11px 18px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{e.time}</td>
                  <td style={{ padding: "11px 18px", fontSize: 12, fontWeight: 500 }}>{e.meal}</td>
                  <td style={{ padding: "11px 18px", fontSize: 12, fontWeight: 600, color: e.bg > 140 ? ORANGE : e.bg < 80 ? PINK : "rgba(255,255,255,0.85)" }}>{e.bg} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>mg/dL</span></td>
                  <td style={{ padding: "11px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.carbs}g</td>
                  <td style={{ padding: "11px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.insulin}u</td>
                  <td style={{ padding: "11px 18px" }}>
                    <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em" }}>{ev.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Insights() {
  const meals = [
    { type: "Balanced", avg_bg: 112, good: 71, insulin: 3.6, count: 7 },
    { type: "Fast Carbs", avg_bg: 142, good: 33, insulin: 4.8, count: 6 },
    { type: "High Fat", avg_bg: 108, good: 75, insulin: 2.1, count: 4 },
    { type: "High Protein", avg_bg: 118, good: 50, insulin: 3.0, count: 2 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
        {meals.map((m) => (
          <Card key={m.type} style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{m.type}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Avg BG Before", value: `${m.avg_bg} mg/dL`, color: m.avg_bg > 130 ? ORANGE : GREEN },
                { label: "Good outcomes", value: `${m.good}%`, color: m.good > 60 ? GREEN : ORANGE },
                { label: "Avg insulin", value: `${m.insulin}u`, color: "rgba(255,255,255,0.85)" },
                { label: "Total entries", value: `${m.count}`, color: "rgba(255,255,255,0.6)" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>SUCCESS RATE</span>
                <span style={{ fontSize: 10, color: m.good > 60 ? GREEN : ORANGE, fontWeight: 700 }}>{m.good}%</span>
              </div>
              <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${m.good}%`, height: "100%", background: m.good > 60 ? GREEN : ORANGE, borderRadius: 99 }} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Recommend() {
  const [glucose, setGlucose] = useState("");
  const [carbs, setCarbs] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [desc, setDesc] = useState("");
  const [mealType, setMealType] = useState<MealTypeKey>("BALANCED");
  const [overridden, setOverridden] = useState(false);
  const [cl, setCl] = useState<ReturnType<typeof classifyMeal>|null>(null);
  const [result, setResult] = useState<null|{units:number;ratio:number;confidence:string}>(null);

  const inp: React.CSSProperties = { background:"rgba(255,255,255,0.05)", border:`1px solid rgba(255,255,255,0.1)`, borderRadius:10, padding:"9px 12px", color:"white", fontSize:14, fontWeight:600, width:"100%", boxSizing:"border-box", outline:"none", fontFamily:"inherit" };

  useEffect(()=>{
    const c=Number(carbs)||0,p=Number(protein)||0,f=Number(fat)||0;
    if(c+p+f===0&&!desc){setCl(null);return;}
    const r=classifyMeal(c,p,f,desc);
    setCl(r);
    if(!overridden) setMealType(r.mealType);
  },[carbs,protein,fat,desc,overridden]);

  const calc=()=>{
    const g=Number(glucose),c=Number(carbs);
    if(!g||!c)return;
    const ratio=33;
    let units=c/ratio;
    if(g>140)units+=0.5; if(g<90)units-=0.5;
    if(mealType==="FAST_CARBS")units+=0.5; if(mealType==="HIGH_FAT")units-=0.5;
    if(g<=180&&units>3)units=3;
    setResult({units:Math.max(0.5,Math.round(units*2)/2),ratio,confidence:"HIGH"});
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
      <Card style={{ padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Bolus Calculator</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>CURRENT GLUCOSE (mg/dL)</div>
            <input value={glucose} onChange={e=>setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={inp} />
          </div>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>PLANNED CARBS (g)</div>
            <input value={carbs} onChange={e=>setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inp} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>PROTEIN (g)</div>
              <input value={protein} onChange={e=>setProtein(e.target.value)} placeholder="e.g. 30" type="number" style={inp} />
            </div>
            <div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>FAT (g)</div>
              <input value={fat} onChange={e=>setFat(e.target.value)} placeholder="e.g. 15" type="number" style={inp} />
            </div>
          </div>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>DESCRIPTION <span style={{opacity:0.5}}>(fast sugar detect)</span></div>
            <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. granola, juice…" style={{...inp,fontSize:12,fontWeight:400}} />
          </div>
          <MacroWidget cl={cl} active={mealType} overridden={overridden}
            onPick={t=>{setMealType(t);setOverridden(t!==(cl?.mealType??"BALANCED"));}}
            onReset={()=>{setOverridden(false);if(cl)setMealType(cl.mealType);}} />
          <button onClick={calc} style={{padding:"13px",background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`,border:"none",borderRadius:10,color:"white",fontSize:14,fontWeight:700,cursor:"pointer",opacity:glucose&&carbs?1:0.4}}>
            Calculate Bolus
          </button>
        </div>
      </Card>

      <Card style={{ padding: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Recommendation</div>
        {result ? (
          <div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0", background: `${ACCENT}0D`, borderRadius: 12, border: `1px solid ${ACCENT}22`, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>SUGGESTED DOSE</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                <span style={{ fontSize: 56, fontWeight: 900, color: "white", letterSpacing: "-0.03em" }}>{result.units.toFixed(1)}</span>
                <span style={{ fontSize: 22, color: "rgba(255,255,255,0.4)", paddingBottom: 6 }}>u</span>
              </div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>Range {(result.units * 0.9).toFixed(1)} – {(result.units * 1.1).toFixed(1)} u</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Confidence", value: result.confidence, color: GREEN },
                { label: "Carb ratio", value: `1u per ${result.ratio}g`, color: ACCENT },
                { label: "Timing", value: mealType === "HIGH_FAT" ? "Split dose" : "Before meal", color: "rgba(255,255,255,0.7)" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8, fontSize: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{row.label}</span>
                  <span style={{ fontWeight: 700, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: `${ACCENT}10`, borderRadius: 8, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
              Based on 8 similar balanced meals. Personal ratio 1u per {result.ratio}g (stable meals only — hypo/spike entries excluded).
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 280, color: "rgba(255,255,255,0.2)" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 13 }}>Enter parameters to calculate</div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── LAYOUT ──────────────────────────────────────────────────────

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: "dashboard", icon: "⊞", label: "Dashboard" },
  { id: "log", icon: "✦", label: "Quick Log" },
  { id: "entries", icon: "≡", label: "Entry Log" },
  { id: "insights", icon: "◈", label: "Insights" },
  { id: "recommend", icon: "⟲", label: "Glev Engine" },
  { id: "import", icon: "⬆", label: "Import" },
];

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  log: "Quick Log",
  entries: "Entry Log",
  insights: "Insights",
  recommend: "Glev Engine",
  import: "Import Center",
};

export function DarkCockpit() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG, color: "white", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Sidebar */}
      <div style={{ width: 56, background: SURFACE, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", padding: "20px 10px", gap: 4, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${ACCENT}, ${PINK})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, marginBottom: 20, cursor: "pointer" }}>G</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            title={item.label}
            style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: page === item.id ? `${ACCENT}22` : "transparent", color: page === item.id ? ACCENT : "rgba(255,255,255,0.28)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
          >
            {item.icon}
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: "24px 28px", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", marginBottom: 3 }}>GLEV — SMART INSULIN DECISIONS</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{PAGE_TITLES[page]}</h1>
          </div>
          {page !== "log" && page !== "recommend" && (
            <button onClick={() => setPage("log")} style={{ fontSize: 12, fontWeight: 600, padding: "8px 16px", borderRadius: 20, background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, border: "none", color: "white", cursor: "pointer", letterSpacing: "0.01em" }}>
              + Quick Log
            </button>
          )}
        </div>

        {page === "dashboard" && <Dashboard />}
        {page === "log" && <QuickLog />}
        {page === "entries" && <EntryLog />}
        {page === "insights" && <Insights />}
        {page === "recommend" && <Recommend />}
        {page === "import" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16, color: "rgba(255,255,255,0.3)" }}>
            <div style={{ fontSize: 48, opacity: 0.4 }}>⬆</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Import Center</div>
            <div style={{ fontSize: 13 }}>Paste tab-separated data or upload a CSV file.</div>
            <button style={{ padding: "10px 24px", background: ACCENT, border: "none", borderRadius: 10, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Upload CSV</button>
          </div>
        )}
      </div>
    </div>
  );
}
