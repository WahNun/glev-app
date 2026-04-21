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

// ─── Inline classifier widget (light style) ───────────────────────
function MacroWidget({ cl, active, overridden, onPick, onReset }: {
  cl: ReturnType<typeof classifyMeal>|null;
  active: MealTypeKey; overridden: boolean;
  onPick:(t:MealTypeKey)=>void; onReset:()=>void;
}) {
  if (!cl) return null;
  const pillStyles: Record<MealTypeKey,[string,string,string]> = {
    FAST_CARBS:   ["#FFF4E3","#C06000","#FFDEAA"],
    HIGH_FAT:     ["#F5F0FF","#6B2D9A","#DDD0F0"],
    HIGH_PROTEIN: ["#EBF3FF","#1A4CA0","#C5D9F8"],
    BALANCED:     ["#E8FBF4","#0D6B4B","#AEECD8"],
  };
  const [sugBg, sugColor, sugBorder] = pillStyles[cl.mealType];
  return (
    <div style={{borderRadius:12,border:"1.5px solid rgba(0,0,0,0.07)",background:"#FAFAFA",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <span style={{fontSize:13,marginTop:1}}>{cl.fastSugar?"⚠️":"✦"}</span>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
            <span style={{fontSize:9,color:"#8E8E93",letterSpacing:"0.1em",fontWeight:600}}>{cl.fastSugar?"FAST SUGAR DETECTED":"AUTO-CLASSIFIED"}</span>
            <span style={{fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:99,background:sugBg,color:sugColor,border:`1px solid ${sugBorder}`}}>{MEAL_LABELS[cl.mealType]}</span>
            {overridden&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:99,background:"#FFF4E3",color:"#C06000",fontWeight:600,border:"1px solid #FFDEAA"}}>OVERRIDE</span>}
          </div>
          <div style={{fontSize:10,color:"#8E8E93",lineHeight:1.55}}>{cl.reason}</div>
        </div>
      </div>
      {(cl.carbPct+cl.fatPct+cl.protPct)>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <div style={{height:6,borderRadius:99,overflow:"hidden",display:"flex",gap:1,background:"#F0F0F0"}}>
            <div style={{width:`${cl.carbPct}%`,background:"#E88600",borderRadius:"99px 0 0 99px"}}/>
            <div style={{width:`${cl.protPct}%`,background:"#3B82F6"}}/>
            <div style={{width:`${cl.fatPct}%`,background:"#9333EA",borderRadius:"0 99px 99px 0"}}/>
          </div>
          <div style={{display:"flex",gap:12,fontSize:9,color:"#8E8E93"}}>
            <span>🟠 Carbs {cl.carbPct.toFixed(0)}%</span>
            <span>🔵 Protein {cl.protPct.toFixed(0)}%</span>
            <span>🟣 Fat {cl.fatPct.toFixed(0)}%</span>
          </div>
        </div>
      )}
      <div>
        <div style={{fontSize:9,color:"#8E8E93",marginBottom:6,letterSpacing:"0.08em",fontWeight:600}}>OVERRIDE TYPE</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {(Object.keys(MEAL_LABELS) as MealTypeKey[]).map(t=>{
            const [bg,color,border]=pillStyles[t];
            return (
              <button key={t} onClick={()=>onPick(t)} style={{padding:"5px 12px",borderRadius:99,border:`1.5px solid ${active===t?border:"rgba(0,0,0,0.1)"}`,background:active===t?bg:"white",color:active===t?color:"#8E8E93",fontSize:10,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
                {MEAL_LABELS[t]}
              </button>
            );
          })}
        </div>
        {overridden&&<button onClick={onReset} style={{marginTop:6,fontSize:9,color:"#8E8E93",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Reset to auto-detect</button>}
      </div>
    </div>
  );
}

const BLUE = "#3B5BFF";
const PINK = "#C8004A";
const GREEN = "#0D9467";
const AMBER = "#C06000";
const BG = "#F2F2F7";
const WHITE = "#FFFFFF";
const TEXT = "#1D1D1F";
const MUTED = "#8E8E93";
const BORDER = "rgba(0,0,0,0.07)";

const glucosePoints = [112, 128, 95, 185, 130, 105, 105, 138, 88, 210, 120, 92, 99, 125, 108, 140];
const maxG = 220; const minG = 60; const W = 560; const H = 110;
const toY = (g: number) => H - ((g - minG) / (maxG - minG)) * H;
const toX = (i: number) => (i / (glucosePoints.length - 1)) * W;
const pathD = glucosePoints.map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
const areaD = pathD + ` L ${W} ${H} L 0 ${H} Z`;

const entries = [
  { time: "12:30", meal: "Quinoa bowl", type: "BALANCED", bg: 108, carbs: 55, insulin: 5.5, eval: "GOOD" },
  { time: "Yesterday", meal: "Pizza night", type: "FAST_CARBS", bg: 88, carbs: 80, insulin: 5.0, eval: "UNDERDOSE" },
  { time: "Yesterday", meal: "Avocado eggs", type: "HIGH_FAT", bg: 120, carbs: 25, insulin: 4.0, eval: "GOOD" },
  { time: "Apr 19", meal: "Brown rice bowl", type: "BALANCED", bg: 105, carbs: 50, insulin: 5.5, eval: "GOOD" },
  { time: "Apr 18", meal: "Grilled chicken", type: "HIGH_PROTEIN", bg: 130, carbs: 30, insulin: 6.0, eval: "OVERDOSE" },
  { time: "Apr 17", meal: "Pancakes", type: "FAST_CARBS", bg: 95, carbs: 85, insulin: 4.5, eval: "UNDERDOSE" },
  { time: "Apr 16", meal: "Salmon rice", type: "BALANCED", bg: 115, carbs: 55, insulin: 3.5, eval: "GOOD" },
];

function evalBadge(e: string) {
  if (e === "GOOD") return { bg: "#E8FBF4", text: GREEN, label: "Good" };
  if (e === "UNDERDOSE") return { bg: "#FFF4E3", text: AMBER, label: "Low dose" };
  if (e === "OVERDOSE") return { bg: "#FFECF1", text: PINK, label: "Overdose" };
  return { bg: "#F2F2F7", text: MUTED, label: "Review" };
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", ...style }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, trend, trendUp, accent }: { label: string; value: string; trend: string; trendUp: boolean | null; accent: string }) {
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", color: TEXT, marginBottom: 6 }}>{value}</div>
      <div style={{ fontSize: 11, color: trendUp === true ? GREEN : trendUp === false ? AMBER : MUTED }}>{trend}</div>
    </Card>
  );
}

// ─── PAGES ────────────────────────────────────────────────────────

function Dashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        <StatCard label="Control Score" value="75 / 100" trend="+3 vs last week" trendUp={true} accent={BLUE} />
        <StatCard label="Time in Range" value="62.5%" trend="5 of 8 entries" trendUp={null} accent={GREEN} />
        <StatCard label="Spike Rate" value="25.0%" trend="2 events" trendUp={false} accent={AMBER} />
        <StatCard label="Hypo Rate" value="0.0%" trend="No hypoglycemia" trendUp={true} accent={PINK} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Card style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Glucose Trend</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Pre-meal readings · 7 days</div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {["7d", "14d", "30d"].map((t, i) => (
                <span key={t} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, cursor: "pointer", background: i === 0 ? BLUE : "rgba(0,0,0,0.05)", color: i === 0 ? "white" : MUTED, fontWeight: i === 0 ? 600 : 400 }}>{t}</span>
              ))}
            </div>
          </div>
          <div style={{ position: "relative", height: 130 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: `${((maxG - 140) / (maxG - minG)) * 100}%`, height: `${((140 - 80) / (maxG - minG)) * 100}%`, background: `${GREEN}08`, borderTop: `1px solid ${GREEN}30`, borderBottom: `1px solid ${GREEN}30` }} />
            <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BLUE} stopOpacity="0.15" />
                  <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#lg)" />
              <path d={pathD} fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {glucosePoints.map((g, i) => g > 180 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={4} fill="white" stroke={AMBER} strokeWidth="2" /> : null)}
            </svg>
          </div>
        </Card>

        <Card style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 2 }}>Outcomes</div>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>8 total entries</div>
          {[
            { label: "Good", count: 5, pct: 62.5, color: GREEN, bg: "#E8FBF4" },
            { label: "Underdose", count: 2, pct: 25, color: AMBER, bg: "#FFF4E3" },
            { label: "Overdose", count: 1, pct: 12.5, color: PINK, bg: "#FFECF1" },
            { label: "Review", count: 0, pct: 0, color: MUTED, bg: "#F2F2F7" },
          ].map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: r.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.color }}>{r.count}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{r.label}</span>
                  <span style={{ fontSize: 11, color: MUTED }}>{r.pct}%</span>
                </div>
                <div style={{ height: 4, background: "#F2F2F7", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${r.pct}%`, height: "100%", background: r.color, borderRadius: 99 }} />
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 22px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Recent Entries</div>
          <span style={{ fontSize: 13, color: BLUE, fontWeight: 500, cursor: "pointer" }}>View all →</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#FAFAFA" }}>
              {["Time", "Meal", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                <th key={h} style={{ padding: "9px 22px", textAlign: "left", fontSize: 11, color: MUTED, fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 4).map((e, i) => {
              const ev = evalBadge(e.eval);
              return (
                <tr key={i} style={{ borderTop: `1px solid rgba(0,0,0,0.04)` }}>
                  <td style={{ padding: "11px 22px", fontSize: 12, color: MUTED }}>{e.time}</td>
                  <td style={{ padding: "11px 22px", fontSize: 13, fontWeight: 500, color: TEXT }}>{e.meal}</td>
                  <td style={{ padding: "11px 22px", fontSize: 13, fontWeight: 600, color: e.bg > 140 ? AMBER : e.bg < 80 ? PINK : TEXT }}>{e.bg} <span style={{ fontSize: 11, fontWeight: 400, color: MUTED }}>mg/dL</span></td>
                  <td style={{ padding: "11px 22px", fontSize: 13, color: TEXT }}>{e.carbs}g</td>
                  <td style={{ padding: "11px 22px", fontSize: 13, color: TEXT }}>{e.insulin}u</td>
                  <td style={{ padding: "11px 22px" }}>
                    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: ev.bg, color: ev.text, fontWeight: 600 }}>{ev.label}</span>
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

  const inp: React.CSSProperties = { background:"#F2F2F7", border:"1px solid rgba(0,0,0,0.1)", borderRadius:12, padding:"10px 13px", color:TEXT, fontSize:14, fontWeight:600, width:"100%", boxSizing:"border-box", outline:"none", fontFamily:"inherit" };

  useEffect(()=>{
    const c=Number(carbs)||0,p=Number(protein)||0,f=Number(fat)||0;
    if(c+p+f===0&&!desc){setCl(null);return;}
    const r=classifyMeal(c,p,f,desc);
    setCl(r);
    if(!overridden) setMealType(r.mealType);
  },[carbs,protein,fat,desc,overridden]);

  if (submitted) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:380,gap:14}}>
      <div style={{width:64,height:64,borderRadius:99,background:"#E8FBF4",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:30,color:GREEN}}>✓</span></div>
      <div style={{fontSize:18,fontWeight:700,color:GREEN}}>Entry logged</div>
      <div style={{fontSize:13,color:MUTED}}>BG {glucose} · {carbs}g carbs · {MEAL_LABELS[mealType]} · {insulin}u</div>
      <button onClick={()=>{setSubmitted(false);setGlucose("");setCarbs("");setProtein("");setFat("");setDesc("");setInsulin("");setOverridden(false);}} style={{marginTop:8,padding:"10px 24px",background:BLUE,border:"none",borderRadius:20,color:"white",fontSize:13,fontWeight:600,cursor:"pointer",boxShadow:`0 4px 14px ${BLUE}40`}}>Log Another</button>
    </div>
  );

  return (
    <div style={{maxWidth:480}}>
      <Card style={{padding:24}}>
        <div style={{fontSize:16,fontWeight:700,color:TEXT,marginBottom:20}}>Log a Meal</div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Glucose before (mg/dL)</div>
            <input value={glucose} onChange={e=>setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={inp} />
          </div>
          <div>
            <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Carbs (g)</div>
            <input value={carbs} onChange={e=>setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inp} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Protein (g)</div>
              <input value={protein} onChange={e=>setProtein(e.target.value)} placeholder="e.g. 30" type="number" style={inp} />
            </div>
            <div>
              <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Fat (g)</div>
              <input value={fat} onChange={e=>setFat(e.target.value)} placeholder="e.g. 15" type="number" style={inp} />
            </div>
          </div>
          <div>
            <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Meal description <span style={{fontWeight:400,fontSize:11}}>(optional — detects fast sugars)</span></div>
            <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. granola, juice, pizza…" style={{...inp,fontWeight:400,fontSize:12}} />
          </div>
          <MacroWidget cl={cl} active={mealType} overridden={overridden}
            onPick={t=>{setMealType(t);setOverridden(t!==(cl?.mealType??"BALANCED"));}}
            onReset={()=>{setOverridden(false);if(cl)setMealType(cl.mealType);}} />
          <div>
            <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Insulin units</div>
            <input value={insulin} onChange={e=>setInsulin(e.target.value)} placeholder="e.g. 1.5" type="number" style={inp} />
          </div>
          <button onClick={()=>{if(glucose&&carbs&&insulin)setSubmitted(true);}} style={{marginTop:2,padding:"13px",background:BLUE,border:"none",borderRadius:14,color:"white",fontSize:14,fontWeight:600,cursor:"pointer",opacity:glucose&&carbs&&insulin?1:0.4,boxShadow:`0 4px 14px ${BLUE}35`}}>
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
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {filters.map((f) => {
          const colors: Record<string, string> = { ALL: BLUE, GOOD: GREEN, UNDERDOSE: AMBER, OVERDOSE: PINK };
          const bgs: Record<string, string> = { ALL: `${BLUE}12`, GOOD: "#E8FBF4", UNDERDOSE: "#FFF4E3", OVERDOSE: "#FFECF1" };
          return (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1.5px solid ${filter === f ? colors[f] : "rgba(0,0,0,0.08)"}`, background: filter === f ? bgs[f] : "white", color: filter === f ? colors[f] : MUTED, cursor: "pointer", transition: "all 0.15s" }}>
              {f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>
      <Card style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#FAFAFA" }}>
              {["Time", "Meal", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                <th key={h} style={{ padding: "10px 22px", textAlign: "left", fontSize: 11, color: MUTED, fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const ev = evalBadge(e.eval);
              return (
                <tr key={i} style={{ borderTop: `1px solid rgba(0,0,0,0.04)`, cursor: "pointer" }}>
                  <td style={{ padding: "12px 22px", fontSize: 12, color: MUTED }}>{e.time}</td>
                  <td style={{ padding: "12px 22px", fontSize: 13, fontWeight: 500, color: TEXT }}>{e.meal}</td>
                  <td style={{ padding: "12px 22px", fontSize: 13, fontWeight: 600, color: e.bg > 140 ? AMBER : e.bg < 80 ? PINK : TEXT }}>{e.bg} <span style={{ fontSize: 11, fontWeight: 400, color: MUTED }}>mg/dL</span></td>
                  <td style={{ padding: "12px 22px", fontSize: 13, color: TEXT }}>{e.carbs}g</td>
                  <td style={{ padding: "12px 22px", fontSize: 13, color: TEXT }}>{e.insulin}u</td>
                  <td style={{ padding: "12px 22px" }}>
                    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: ev.bg, color: ev.text, fontWeight: 600 }}>{ev.label}</span>
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
      {meals.map((m) => (
        <Card key={m.type} style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 16 }}>{m.type}</div>
          {[
            { label: "Avg glucose before", value: `${m.avg_bg} mg/dL`, color: m.avg_bg > 130 ? AMBER : GREEN },
            { label: "Good outcomes", value: `${m.good}%`, color: m.good > 60 ? GREEN : AMBER },
            { label: "Avg insulin", value: `${m.insulin}u`, color: TEXT },
            { label: "Total logged", value: `${m.count} meals`, color: MUTED },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid rgba(0,0,0,0.05)` }}>
              <span style={{ fontSize: 12, color: MUTED }}>{row.label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: row.color }}>{row.value}</span>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: MUTED }}>Success rate</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: m.good > 60 ? GREEN : AMBER }}>{m.good}%</span>
            </div>
            <div style={{ height: 6, background: "#F2F2F7", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${m.good}%`, height: "100%", background: m.good > 60 ? GREEN : AMBER, borderRadius: 99 }} />
            </div>
          </div>
        </Card>
      ))}
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
  const [result, setResult] = useState<null|{units:number;ratio:number}>(null);

  const inp: React.CSSProperties = { background:"#F2F2F7", border:"1px solid rgba(0,0,0,0.1)", borderRadius:12, padding:"10px 13px", color:TEXT, fontSize:14, fontWeight:600, width:"100%", boxSizing:"border-box", outline:"none", fontFamily:"inherit" };

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
    setResult({units:Math.max(0.5,Math.round(units*2)/2),ratio});
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
      <Card style={{ padding: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 18 }}>Bolus Calculator</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Current glucose (mg/dL)</div>
            <input value={glucose} onChange={e=>setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={inp} />
          </div>
          <div>
            <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Planned carbs (g)</div>
            <input value={carbs} onChange={e=>setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inp} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Protein (g)</div>
              <input value={protein} onChange={e=>setProtein(e.target.value)} placeholder="e.g. 30" type="number" style={inp} />
            </div>
            <div>
              <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Fat (g)</div>
              <input value={fat} onChange={e=>setFat(e.target.value)} placeholder="e.g. 15" type="number" style={inp} />
            </div>
          </div>
          <div>
            <div style={{fontSize:12,color:MUTED,marginBottom:5,fontWeight:500}}>Description <span style={{fontWeight:400,fontSize:11}}>(fast sugar detect)</span></div>
            <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. granola, juice…" style={{...inp,fontWeight:400,fontSize:12}} />
          </div>
          <MacroWidget cl={cl} active={mealType} overridden={overridden}
            onPick={t=>{setMealType(t);setOverridden(t!==(cl?.mealType??"BALANCED"));}}
            onReset={()=>{setOverridden(false);if(cl)setMealType(cl.mealType);}} />
          <button onClick={calc} style={{padding:"12px",background:BLUE,border:"none",borderRadius:14,color:"white",fontSize:14,fontWeight:600,cursor:"pointer",opacity:glucose&&carbs?1:0.4,boxShadow:`0 4px 12px ${BLUE}35`}}>
            Calculate Bolus
          </button>
        </div>
      </Card>

      <Card style={{ padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Recommendation</div>
        {result ? (
          <div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 0", background: `${BLUE}08`, borderRadius: 16, border: `1px solid ${BLUE}20`, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Suggested dose</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                <span style={{ fontSize: 52, fontWeight: 800, color: TEXT, letterSpacing: "-0.03em" }}>{result.units.toFixed(1)}</span>
                <span style={{ fontSize: 20, color: MUTED, paddingBottom: 5 }}>u</span>
              </div>
              <span style={{ fontSize: 11, color: MUTED, fontFamily: "monospace" }}>Range {(result.units * 0.9).toFixed(1)} – {(result.units * 1.1).toFixed(1)} u</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Confidence", value: "High", color: GREEN },
                { label: "Carb ratio", value: `1u per ${result.ratio}g`, color: BLUE },
                { label: "Timing", value: mealType === "HIGH_FAT" ? "Split dose" : "Before meal", color: TEXT },
                { label: "Based on", value: "14 similar meals", color: MUTED },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F2F2F7", borderRadius: 10, fontSize: 12 }}>
                  <span style={{ color: MUTED }}>{row.label}</span>
                  <span style={{ fontWeight: 600, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 280, color: MUTED }}>
            <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.3 }}>⚡</div>
            <div style={{ fontSize: 13 }}>Enter parameters to calculate</div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── LAYOUT ───────────────────────────────────────────────────────

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: "dashboard", icon: "⊞", label: "Dashboard" },
  { id: "log", icon: "✦", label: "Quick Log" },
  { id: "entries", icon: "≡", label: "Entry Log" },
  { id: "insights", icon: "◈", label: "Insights" },
  { id: "recommend", icon: "⟲", label: "Recommend" },
  { id: "import", icon: "⬆", label: "Import" },
];

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  log: "Quick Log",
  entries: "Entry Log",
  insights: "Insights",
  recommend: "Decision Support",
  import: "Import Center",
};

export function LightPremium() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG, fontFamily: "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif", color: TEXT }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", padding: "20px 12px", gap: 2, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px", marginBottom: 18 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(135deg, ${BLUE}, ${PINK})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
            <span style={{ color: "white", fontSize: 13, fontWeight: 800 }}>G</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: "-0.02em" }}>GlucoJack</span>
        </div>
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, border: "none", background: page === item.id ? `${BLUE}12` : "transparent", color: page === item.id ? BLUE : MUTED, fontSize: 13, fontWeight: page === item.id ? 600 : 400, cursor: "pointer", transition: "all 0.15s", textAlign: "left", width: "100%" }}
          >
            <span style={{ width: 18, textAlign: "center", fontSize: 14 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: "28px 32px", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", margin: 0, color: TEXT }}>{PAGE_TITLES[page]}</h1>
            <p style={{ fontSize: 13, color: MUTED, marginTop: 4, marginBottom: 0 }}>Tuesday, April 21 — metabolic performance summary</p>
          </div>
          {page !== "log" && page !== "recommend" && (
            <button onClick={() => setPage("log")} style={{ fontSize: 13, fontWeight: 600, padding: "9px 18px", borderRadius: 20, background: BLUE, color: "white", border: "none", cursor: "pointer", boxShadow: `0 4px 14px ${BLUE}35` }}>
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
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 14 }}>
            <div style={{ fontSize: 48, opacity: 0.2 }}>⬆</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: TEXT }}>Import Center</div>
            <div style={{ fontSize: 13, color: MUTED }}>Paste tab-separated data or upload a CSV file.</div>
            <button style={{ padding: "10px 24px", background: BLUE, border: "none", borderRadius: 20, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: `0 4px 12px ${BLUE}35` }}>Upload CSV</button>
          </div>
        )}
      </div>
    </div>
  );
}
