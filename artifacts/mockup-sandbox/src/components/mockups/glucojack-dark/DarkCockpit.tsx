import { useState, useEffect, useRef } from "react";
import React from "react";

// ─── Constants ───────────────────────────────────────────────────
const API = "/api";
const ACCENT = "#4F6EF7";
const PINK = "#FF2D78";
const GREEN = "#22D3A0";
const ORANGE = "#FF9500";
const BG = "#09090B";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";

// ─── Types ───────────────────────────────────────────────────────
type MealTypeKey = "FAST_CARBS" | "HIGH_FAT" | "HIGH_PROTEIN" | "BALANCED";
type Page = "dashboard" | "log" | "entries" | "insights" | "recommend" | "import" | "profile";

interface Entry {
  id: number;
  timestamp: string;
  glucoseBefore: number;
  glucoseAfter: number | null;
  carbsGrams: number;
  fiberGrams: number | null;
  insulinUnits: number;
  mealType: MealTypeKey | null;
  mealDescription: string | null;
  evaluation: string | null;
  delta: number | null;
  timeDifferenceMinutes: number | null;
}

interface DashboardStats {
  controlScore: number;
  hypoRate: number;
  spikeRate: number;
  totalEntries: number;
  goodRate: number;
  avgGlucoseBefore: number | null;
  recentEntries: Entry[];
  evaluationBreakdown: { GOOD: number; OVERDOSE: number; UNDERDOSE: number; CHECK_CONTEXT: number };
}

interface TrendPoint {
  timestamp: string;
  glucoseBefore: number;
  glucoseAfter: number | null;
  evaluation: string | null;
}

interface MealPattern {
  mealType: MealTypeKey;
  count: number;
  avgCarbsGrams: number;
  avgInsulinUnits: number;
  goodRate: number;
  insulinToCarb: number;
}

interface Recommendation {
  recommendedUnits: number;
  minUnits: number;
  maxUnits: number;
  reasoning: string;
  confidence: string;
  carbRatio: number | null;
  similarMealCount: number;
  cappedForSafety: boolean;
}

interface ParsedVoiceEntry {
  glucoseBefore: number | null;
  carbsGrams: number | null;
  fiberGrams: number | null;
  insulinUnits: number | null;
  mealDescription: string | null;
}

// ─── Logo ────────────────────────────────────────────────────────
const LOGO_NODES = [{cx:16,cy:7},{cx:25,cy:12},{cx:25,cy:20},{cx:18,cy:26},{cx:9,cy:22},{cx:7,cy:14},{cx:16,cy:16}];
const LOGO_EDGES = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[0,6],[1,6],[2,6],[3,6]];
function LogoCMark({ size = 32, style }: { size?: number; style?: React.CSSProperties }) {
  const b = "#4F6EF7";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={style}>
      <rect width="32" height="32" rx="9" fill="#0F0F14"/>
      {LOGO_EDGES.map(([a,b2],i)=>(
        <line key={i} x1={LOGO_NODES[a].cx} y1={LOGO_NODES[a].cy} x2={LOGO_NODES[b2].cx} y2={LOGO_NODES[b2].cy} stroke={b} strokeWidth="0.9" strokeOpacity="0.55"/>
      ))}
      {LOGO_NODES.map((n,i)=>(
        <circle key={i} cx={n.cx} cy={n.cy} r={i===6?3.5:2} fill={i===6?b:`${b}40`} stroke={b} strokeWidth={i===6?0:0.8}/>
      ))}
    </svg>
  );
}

// ─── Meal classifier ─────────────────────────────────────────────
const FAST_SUGAR_KW = ["granola","juice","dessert","cake","candy","soda","syrup","white bread","donut","cookie","muffin","pancake","waffle","cereal","jam","honey","ice cream","gelato"];
const MEAL_LABELS: Record<MealTypeKey,string> = { FAST_CARBS:"Fast Carbs", HIGH_FAT:"High Fat", HIGH_PROTEIN:"High Protein", BALANCED:"Balanced" };

function classifyMeal(carbs:number, protein:number, fat:number, desc?:string) {
  const matched = desc ? FAST_SUGAR_KW.find(k=>desc.toLowerCase().includes(k)) : null;
  if (matched) return { mealType:"FAST_CARBS" as MealTypeKey, reason:`Fast sugar ("${matched}") → FAST CARBS`, carbPct:0,fatPct:0,protPct:0,fastSugar:matched };
  const cc=carbs*4,pc=protein*4,fc=fat*9,tot=cc+pc+fc;
  const carbPct=tot>0?(cc/tot)*100:0, fatPct=tot>0?(fc/tot)*100:0, protPct=tot>0?(pc/tot)*100:0;
  if (fat>30||fatPct>40) return { mealType:"HIGH_FAT" as MealTypeKey, reason: fat>30?`Fat ${fat}g > 30g`:`Fat ${fatPct.toFixed(0)}% > 40%`, carbPct,fatPct,protPct,fastSugar:null };
  if (carbPct>60&&fat<20&&protein<25) return { mealType:"FAST_CARBS" as MealTypeKey, reason:`Carbs ${carbPct.toFixed(0)}% of cals`, carbPct,fatPct,protPct,fastSugar:null };
  if (protein>40&&carbs<40) return { mealType:"HIGH_PROTEIN" as MealTypeKey, reason:`Protein ${protein}g > 40g`, carbPct,fatPct,protPct,fastSugar:null };
  return { mealType:"BALANCED" as MealTypeKey, reason:`Mixed — carbs ${carbPct.toFixed(0)}%, protein ${protPct.toFixed(0)}%, fat ${fatPct.toFixed(0)}%`, carbPct,fatPct,protPct,fastSugar:null };
}

// ─── Voice Parser ────────────────────────────────────────────────
function parseVoiceInput(text: string): ParsedVoiceEntry {
  const t = text.toLowerCase();
  const num = (r: RegExp) => { const m = t.match(r); return m ? Number(m[1]) : null; };
  const glucoseBefore =
    num(/(\d{2,3})\s*(?:mg\/dl|glucose|blood sugar|bg)/) ??
    num(/(?:glucose|bg|blood sugar)\s+(?:is\s+)?(\d{2,3})/) ??
    num(/(\d{2,3})\s+mg/);
  const carbsGrams =
    num(/(\d+)\s*(?:g\s+)?(?:carbs?|carbohydrates?|kohlenhydrate)/) ??
    num(/(?:carbs?|carbohydrates?)\s+(?:are\s+)?(\d+)/);
  const fiberGrams =
    num(/(\d+)\s*(?:g\s+)?(?:fiber|fibre|ballaststoffe)/) ??
    num(/(?:fiber|fibre)\s+(\d+)/);
  const insulinUnits =
    num(/(\d+(?:\.\d+)?)\s*(?:units?|u\b|einheiten?)/) ??
    num(/(?:insulin|units?)\s+(?:is\s+)?(\d+(?:\.\d+)?)/);
  const cleaned = text
    .replace(/\d+(?:\.\d+)?\s*(?:mg\/dl|mg|g|units?|u\b)/gi, "")
    .replace(/\b(?:glucose|carbs?|fiber|insulin|blood sugar|bg)\b/gi, "")
    .replace(/\s+/g, " ").trim();
  return { glucoseBefore, carbsGrams, fiberGrams, insulinUnits, mealDescription: cleaned || null };
}

// ─── API helpers ─────────────────────────────────────────────────
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ─── Shared components ───────────────────────────────────────────
const pillColors: Record<MealTypeKey,[string,string]> = {
  FAST_CARBS: ["rgba(255,149,0,0.18)","#FF9500"],
  HIGH_FAT:   ["rgba(168,85,247,0.18)","#A855F7"],
  HIGH_PROTEIN:["rgba(59,130,246,0.18)","#3B82F6"],
  BALANCED:   ["rgba(34,211,160,0.18)","#22D3A0"],
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, ...style }}>{children}</div>;
}

function StatCard({ label, value, unit, sub, color, bar, onLearnMore }: { label:string; value:string; unit:string; sub:string; color:string; bar:number; onLearnMore?:()=>void }) {
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginBottom:8, letterSpacing:"0.06em" }}>{label.toUpperCase()}</div>
      <div style={{ display:"flex", alignItems:"flex-end", gap:4, marginBottom:10 }}>
        <span style={{ fontSize:28, fontWeight:800, color, letterSpacing:"-0.03em" }}>{value}</span>
        <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", paddingBottom:3 }}>{unit}</span>
      </div>
      <div style={{ height:3, background:"rgba(255,255,255,0.08)", borderRadius:99, overflow:"hidden" }}>
        <div style={{ width:`${Math.min(bar,100)}%`, height:"100%", background:color, borderRadius:99 }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>{sub}</div>
        {onLearnMore&&(
          <button onClick={onLearnMore} style={{fontSize:9,color,fontWeight:700,background:"none",border:"none",cursor:"pointer",padding:0,letterSpacing:"0.05em",opacity:0.75,transition:"opacity 0.15s",display:"flex",alignItems:"center",gap:3}}>
            <span style={{fontSize:9}}>◈</span> insights →
          </button>
        )}
      </div>
    </Card>
  );
}

function MacroWidget({ cl, active, overridden, onPick, onReset }: {
  cl: ReturnType<typeof classifyMeal>|null; active:MealTypeKey; overridden:boolean;
  onPick:(t:MealTypeKey)=>void; onReset:()=>void;
}) {
  if (!cl) return null;
  const barColors: Record<MealTypeKey,string> = { FAST_CARBS:"#FF9500", HIGH_FAT:"#A855F7", HIGH_PROTEIN:"#3B82F6", BALANCED:"#22D3A0" };
  const [sugBg,sugColor] = pillColors[cl.mealType];
  return (
    <div style={{borderRadius:10,border:`1px solid rgba(255,255,255,0.08)`,background:"rgba(255,255,255,0.03)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <span style={{fontSize:14,marginTop:1}}>{cl.fastSugar?"⚠️":"✦"}</span>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:"0.1em"}}>{cl.fastSugar?"FAST SUGAR DETECTED":"AUTO-CLASSIFIED"}</span>
            <span style={{fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:99,background:sugBg,color:sugColor}}>{MEAL_LABELS[cl.mealType]}</span>
            {overridden&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:99,background:"rgba(255,149,0,0.15)",color:"#FF9500",fontWeight:600}}>OVERRIDE</span>}
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.38)",lineHeight:1.55}}>{cl.reason}</div>
        </div>
      </div>
      {(cl.carbPct+cl.fatPct+cl.protPct)>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <div style={{height:4,borderRadius:99,overflow:"hidden",display:"flex",gap:1}}>
            <div style={{width:`${cl.carbPct}%`,background:"#FF9500"}}/><div style={{width:`${cl.protPct}%`,background:"#3B82F6"}}/><div style={{width:`${cl.fatPct}%`,background:"#A855F7"}}/>
          </div>
          <div style={{display:"flex",gap:12,fontSize:9,color:"rgba(255,255,255,0.3)"}}>
            <span><span style={{display:"inline-block",width:6,height:6,borderRadius:99,background:"#FF9500",verticalAlign:"middle",marginRight:3}}/> Carbs {cl.carbPct.toFixed(0)}%</span><span><span style={{display:"inline-block",width:6,height:6,borderRadius:99,background:"#3B82F6",verticalAlign:"middle",marginRight:3}}/> Protein {cl.protPct.toFixed(0)}%</span><span><span style={{display:"inline-block",width:6,height:6,borderRadius:99,background:"#A855F7",verticalAlign:"middle",marginRight:3}}/> Fat {cl.fatPct.toFixed(0)}%</span>
          </div>
        </div>
      )}
      <div>
        <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",marginBottom:6,letterSpacing:"0.08em"}}>OVERRIDE TYPE</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {(Object.keys(MEAL_LABELS) as MealTypeKey[]).map(t=>{
            const [bg,color]=pillColors[t];
            return <button key={t} onClick={()=>onPick(t)} style={{padding:"5px 12px",borderRadius:99,border:`1px solid ${active===t?color:"rgba(255,255,255,0.1)"}`,background:active===t?bg:"transparent",color:active===t?color:"rgba(255,255,255,0.45)",fontSize:10,fontWeight:600,cursor:"pointer"}}>{MEAL_LABELS[t]}</button>;
          })}
        </div>
        {overridden&&<button onClick={onReset} style={{marginTop:6,fontSize:9,color:"rgba(255,255,255,0.35)",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Reset to auto</button>}
      </div>
    </div>
  );
}

function evalStyle(e: string|null) {
  if (e==="GOOD") return { color:GREEN, label:"GOOD" };
  if (e==="UNDERDOSE") return { color:ORANGE, label:"LOW DOSE" };
  if (e==="OVERDOSE") return { color:PINK, label:"OVERDOSE" };
  return { color:"#8B8FA8", label:"CHECK" };
}

function Spinner() {
  return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:"rgba(255,255,255,0.2)",fontSize:13}}>Loading…</div>;
}

const inp: React.CSSProperties = { background:"rgba(255,255,255,0.05)", border:`1px solid rgba(255,255,255,0.1)`, borderRadius:10, padding:"9px 12px", color:"white", fontSize:14, fontWeight:600, width:"100%", boxSizing:"border-box", outline:"none", fontFamily:"inherit" };

// ─── DASHBOARD ───────────────────────────────────────────────────
function Dashboard({ onInsights }: { onInsights?: (stat: string) => void }) {
  const [stats, setStats] = useState<DashboardStats|null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<DashboardStats>("/insights/dashboard"),
      apiFetch<{points:TrendPoint[]}>("/insights/glucose-trend"),
    ]).then(([s, t]) => {
      setStats(s);
      setTrend(t.points.slice(0, 20).reverse());
    }).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!stats) return <div style={{color:"rgba(255,255,255,0.3)",padding:20}}>No data yet. Log your first meal to see stats.</div>;

  const trendPts = trend.map(p=>p.glucoseBefore).filter(Boolean) as number[];
  const maxG=220, minG=60, W=560, H=100;
  const toY=(g:number)=>H-((g-minG)/(maxG-minG))*H;
  const toX=(i:number)=>(i/(Math.max(trendPts.length-1,1)))*W;
  const pathD=trendPts.map((g,i)=>`${i===0?"M":"L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
  const areaD=pathD+` L ${W} ${H} L 0 ${H} Z`;
  const eb = stats.evaluationBreakdown;
  const total = stats.totalEntries || 1;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        <StatCard label="Control Score" value={stats.controlScore.toFixed(0)} unit="/100" sub={`${stats.totalEntries} entries`} color={ACCENT} bar={stats.controlScore} onLearnMore={onInsights?()=>onInsights("Control Score"):undefined}/>
        <StatCard label="Good Rate" value={(stats.goodRate*100).toFixed(1)} unit="%" sub={`${eb.GOOD} good outcomes`} color={GREEN} bar={stats.goodRate*100} onLearnMore={onInsights?()=>onInsights("Good Rate"):undefined}/>
        <StatCard label="Spike Rate" value={stats.spikeRate.toFixed(1)} unit="%" sub="Hyperglycemia" color={ORANGE} bar={stats.spikeRate} onLearnMore={onInsights?()=>onInsights("Spike Rate"):undefined}/>
        <StatCard label="Hypo Rate" value={stats.hypoRate.toFixed(1)} unit="%" sub="Hypoglycemia" color={PINK} bar={stats.hypoRate} onLearnMore={onInsights?()=>onInsights("Hypo Rate"):undefined}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1.8fr 1fr",gap:10}}>
        <Card style={{padding:"18px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>Glucose Trend</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>Pre-meal readings · {trend.length} entries</div>
            </div>
            <span style={{fontSize:11,padding:"4px 10px",background:`${ACCENT}22`,color:ACCENT,borderRadius:99,fontWeight:500}}>7d</span>
          </div>
          {trendPts.length > 0 ? (
            <div style={{position:"relative"}}>
              <div style={{position:"absolute",left:0,right:0,top:`${((maxG-140)/(maxG-minG))*100}%`,height:`${((140-80)/(maxG-minG))*100}%`,background:`${GREEN}0A`,borderTop:`1px dashed ${GREEN}50`,borderBottom:`1px dashed ${GREEN}50`}}/>
              <svg width="100%" height={H+10} viewBox={`0 0 ${W} ${H+10}`} preserveAspectRatio="none" style={{display:"block"}}>
                <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity="0.25"/><stop offset="100%" stopColor={ACCENT} stopOpacity="0"/></linearGradient></defs>
                <path d={areaD} fill="url(#dg)"/><path d={pathD} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                {trendPts.map((g,i)=>g>180?<circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={ORANGE}/>:g<70?<circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={PINK}/>:null)}
              </svg>
            </div>
          ) : <div style={{height:H,display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.2)",fontSize:12}}>No trend data yet</div>}
        </Card>

        <Card style={{padding:"18px 20px"}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Outcomes</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginBottom:14}}>Evaluation split</div>
          {[{label:"GOOD",count:eb.GOOD,color:GREEN},{label:"UNDERDOSE",count:eb.UNDERDOSE,color:ORANGE},{label:"OVERDOSE",count:eb.OVERDOSE,color:PINK},{label:"CHECK",count:eb.CHECK_CONTEXT,color:"#4B5070"}].map(r=>(
            <div key={r.label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{width:7,height:7,borderRadius:99,background:r.color,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:10,color:"rgba(255,255,255,0.45)",letterSpacing:"0.06em"}}>{r.label}</span>
                  <span style={{fontSize:10,color:r.color,fontWeight:600}}>{r.count}</span>
                </div>
                <div style={{height:3,background:"rgba(255,255,255,0.07)",borderRadius:99,overflow:"hidden"}}>
                  <div style={{width:`${(r.count/total)*100}%`,height:"100%",background:r.color,borderRadius:99}}/>
                </div>
              </div>
            </div>
          ))}
          {stats.avgGlucoseBefore && (
            <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${BORDER}`}}>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginBottom:3}}>AVG GLUCOSE BEFORE</div>
              <div style={{fontSize:18,fontWeight:700,color:ACCENT}}>{stats.avgGlucoseBefore.toFixed(0)} <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontWeight:400}}>mg/dL</span></div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px",borderBottom:`1px solid ${BORDER}`}}>
          <div style={{fontSize:13,fontWeight:600}}>Recent Entries</div>
          <span style={{fontSize:11,color:ACCENT}}>{stats.totalEntries} total</span>
        </div>
        {stats.recentEntries.length === 0 ? (
          <div style={{padding:24,textAlign:"center",color:"rgba(255,255,255,0.2)",fontSize:13}}>No entries yet</div>
        ) : (
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
              {["Time","Meal","BG Before","Carbs","Insulin","Result"].map(h=>(
                <th key={h} style={{padding:"7px 18px",textAlign:"left",fontSize:9,color:"rgba(255,255,255,0.3)",fontWeight:500,letterSpacing:"0.08em"}}>{h.toUpperCase()}</th>
              ))}
            </tr></thead>
            <tbody>
              {stats.recentEntries.slice(0,5).map((e,i)=>{
                const ev=evalStyle(e.evaluation);
                const ts=new Date(e.timestamp).toLocaleDateString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
                return (
                  <tr key={e.id} style={{borderBottom:i<4?`1px solid rgba(255,255,255,0.03)`:"none"}}>
                    <td style={{padding:"9px 18px",fontSize:11,color:"rgba(255,255,255,0.4)"}}>{ts}</td>
                    <td style={{padding:"9px 18px",fontSize:12,fontWeight:500}}>{e.mealDescription||e.mealType||"—"}</td>
                    <td style={{padding:"9px 18px",fontSize:12,fontWeight:600,color:e.glucoseBefore>140?ORANGE:e.glucoseBefore<80?PINK:"rgba(255,255,255,0.85)"}}>{e.glucoseBefore} <span style={{fontSize:10,fontWeight:400,color:"rgba(255,255,255,0.3)"}}>mg/dL</span></td>
                    <td style={{padding:"9px 18px",fontSize:12,color:"rgba(255,255,255,0.7)"}}>{e.carbsGrams}g</td>
                    <td style={{padding:"9px 18px",fontSize:12,color:"rgba(255,255,255,0.7)"}}>{e.insulinUnits}u</td>
                    <td style={{padding:"9px 18px"}}><span style={{fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,background:`${ev.color}18`,color:ev.color,letterSpacing:"0.06em"}}>{ev.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ─── LOG PAGE (Voice + Smart Macros + CGM, unified) ───────────────
type VoiceInputState = "idle"|"recording"|"processing";
type MacroStatus = "idle"|"loading"|"done"|"error";
interface FoodItem { name: string; portion: string; }
interface MacroResult { resolvedName:string; grams:number; carbs:number; fiber:number; protein:number; fat:number; calories:number; source:string; }
interface MacroResponse { items:MacroResult[]; totals:{carbs:number;fiber:number;protein:number;fat:number;calories:number;netCarbs:number}; hasEstimated:boolean; }

function parseFoodItems(text: string): FoodItem[] {
  const PORTIONS = ["handful","small","medium","large","tablespoon","tbsp","teaspoon","tsp","cup","slice","piece","bowl","portion","serving"];
  const parts = text.split(/,\s*|\s+and\s+/i).map(p=>p.trim()).filter(Boolean);
  const items: FoodItem[] = [];
  for (const part of parts) {
    const gMatch = part.match(/^(\d+(?:\.\d+)?)\s*(?:g|grams?|ml)\s+(?:of\s+)?(.+)$/i);
    if (gMatch) { items.push({name:gMatch[2].trim(), portion:`${gMatch[1]}g`}); continue; }
    let matched = false;
    for (const p of PORTIONS) {
      const re = new RegExp(`^(?:a\\s+|an?\\s+)?${p}\\s+(?:of\\s+)?(.+)$`,"i");
      const m = part.match(re);
      if (m) { items.push({name:m[1].trim(), portion:p}); matched=true; break; }
    }
    if (!matched && part.length>1 && !/^\d+$/.test(part)) {
      items.push({name:part, portion:"100g"});
    }
  }
  return items;
}

function LogPage({ onLogged }: { onLogged?: ()=>void }) {
  const [glucose,setGlucose]=useState("");
  const [carbs,setCarbs]=useState("");
  const [fiber,setFiber]=useState("");
  const [protein,setProtein]=useState("");
  const [fat,setFat]=useState("");
  const [desc,setDesc]=useState("");
  const [insulin,setInsulin]=useState("");
  const [mealType,setMealType]=useState<MealTypeKey>("BALANCED");
  const [overridden,setOverridden]=useState(false);
  const [cl,setCl]=useState<ReturnType<typeof classifyMeal>|null>(null);
  const [saving,setSaving]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState("");
  const [voiceStatus,setVoiceStatus]=useState<VoiceInputState>("idle");
  const [transcript,setTranscript]=useState("");
  const [macroStatus,setMacroStatus]=useState<MacroStatus>("idle");
  const [macroData,setMacroData]=useState<MacroResponse|null>(null);
  const [macroNote,setMacroNote]=useState("");
  const [cgmLoading,setCgmLoading]=useState(false);
  const [pfLoading,setPfLoading]=useState(false);
  const [pfRaw,setPfRaw]=useState<string|null>(null);
  const [pfParsed,setPfParsed]=useState<{name:string;grams:number}[]|null>(null);
  const [pfError,setPfError]=useState<string|null>(null);
  const recognitionRef=useRef<any>(null);

  const SR=typeof window!=="undefined"?((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition):null;
  const voiceSupported=!!SR;

  useEffect(()=>{
    const c=Number(carbs)||0,p=Number(protein)||0,f=Number(fat)||0;
    if(c+p+f===0&&!desc){setCl(null);return;}
    const r=classifyMeal(c,p,f,desc);
    setCl(r);
    if(!overridden) setMealType(r.mealType);
  },[carbs,protein,fat,desc,overridden]);

  async function fetchMacros(items: FoodItem[], fallbackDesc: string){
    if(items.length===0) return;
    setMacroStatus("loading");setMacroNote("");setMacroData(null);
    try{
      const data=await apiFetch<MacroResponse>("/food/macros",{method:"POST",body:JSON.stringify({foods:items})});
      setMacroData(data);
      setCarbs(String(data.totals.carbs));
      setFiber(String(data.totals.fiber));
      setProtein(String(data.totals.protein));
      setFat(String(data.totals.fat));
      if(!desc&&fallbackDesc) setDesc(items.map(i=>i.name).join(", "));
      if(data.hasEstimated) setMacroNote("Some items estimated — verify fields");
      setMacroStatus("done");
    }catch{
      setMacroStatus("error");
      setMacroNote("Food API unavailable — using estimated values");
    }
  }

  async function testFoodParser(customText?: string){
    const text = customText ?? "small banana and handful blueberries";
    setPfLoading(true); setPfRaw(null); setPfParsed(null); setPfError(null);
    try{
      const res = await apiFetch<{raw:string;parsed:{name:string;grams:number}[]}>("/parse-food",{
        method:"POST",
        body:JSON.stringify({text}),
      });
      setPfRaw(res.raw);
      setPfParsed(res.parsed);
    }catch(e:any){
      setPfError(e?.message ?? "Request failed");
    }finally{
      setPfLoading(false);
    }
  }

  async function pullCGM(){
    setCgmLoading(true);setError("");
    try{
      const r=await apiFetch<{glucose:number}>("/cgm/latest");
      setGlucose(String(r.glucose));
    }catch{setError("CGM unavailable");}
    finally{setCgmLoading(false);}
  }

  function startRecording(){
    if(!SR){setError("Requires Chrome or Edge.");return;}
    setError("");setMacroData(null);setMacroStatus("idle");
    const recognition=new SR();
    recognition.lang="en-US";recognition.continuous=false;recognition.interimResults=false;
    recognition.onstart=()=>setVoiceStatus("recording");
    recognition.onresult=(e:any)=>{
      const text=e.results[0][0].transcript;
      setTranscript(text);setVoiceStatus("processing");
      const p=parseVoiceInput(text);
      if(p.glucoseBefore) setGlucose(String(p.glucoseBefore));
      if(p.insulinUnits) setInsulin(String(p.insulinUnits));
      const items=parseFoodItems(text);
      if(items.length>0){
        fetchMacros(items,text);
        setDesc(items.map(i=>`${i.portion} ${i.name}`).join(", "));
      } else {
        if(p.carbsGrams) setCarbs(String(p.carbsGrams));
        if(p.fiberGrams!=null) setFiber(String(p.fiberGrams));
        if(p.mealDescription) setDesc(p.mealDescription);
      }
      const auto=classifyMeal(p.carbsGrams||0,0,0,p.mealDescription||"");
      setMealType(auto.mealType);setOverridden(false);
      setTimeout(()=>setVoiceStatus("idle"),700);
    };
    recognition.onerror=(e:any)=>{setError(e.error==="not-allowed"?"Microphone access denied.":e.error);setVoiceStatus("idle");};
    recognition.onend=()=>setVoiceStatus(s=>s==="recording"?"idle":s);
    recognitionRef.current=recognition;
    recognition.start();
  }

  function stopRecording(){recognitionRef.current?.stop();}

  async function confirmLog(){
    if(!glucose||!carbs||!insulin){setError("Glucose, carbs and insulin are required.");return;}
    setSaving(true);setError("");
    try{
      await apiFetch("/entries",{method:"POST",body:JSON.stringify({
        glucoseBefore:Number(glucose),carbsGrams:Number(carbs),
        fiberGrams:fiber?Number(fiber):undefined,
        insulinUnits:Number(insulin),mealType,
        mealDescription:desc||undefined,
      })});
      setDone(true);onLogged?.();
    }catch{setError("Failed to save. Check API.");}
    finally{setSaving(false);}
  }

  function resetForm(){setDone(false);setGlucose("");setCarbs("");setFiber("");setProtein("");setFat("");setDesc("");setInsulin("");setOverridden(false);setTranscript("");setVoiceStatus("idle");setMacroStatus("idle");setMacroData(null);setMacroNote("");}

  const isRec=voiceStatus==="recording";
  const voiceColor={idle:"rgba(255,255,255,0.3)",recording:ACCENT,processing:ORANGE}[voiceStatus];
  const voiceLabel={idle:voiceSupported?"Tap to speak":"Voice unavailable",recording:"Listening…",processing:"Parsing…"}[voiceStatus];
  const netCarbs=carbs&&fiber?Math.max(0,Number(carbs)-Number(fiber)):null;

  if(done) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:380,gap:16}}>
      <div style={{width:60,height:60,borderRadius:99,background:`${GREEN}22`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:28,color:GREEN}}>✓</span></div>
      <div style={{fontSize:18,fontWeight:700,color:GREEN}}>Entry confirmed</div>
      <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>BG {glucose} · {carbs}g carbs{fiber?` · ${fiber}g fiber`:""} · {MEAL_LABELS[mealType]} · {insulin}u</div>
      <button onClick={resetForm} style={{marginTop:8,padding:"10px 24px",background:ACCENT,border:"none",borderRadius:10,color:"white",fontSize:13,fontWeight:600,cursor:"pointer"}}>Log Another</button>
    </div>
  );

  return (
    <div style={{maxWidth:540,display:"flex",flexDirection:"column",gap:12}}>
      <style>{`@keyframes vPulse{0%,100%{opacity:0.35;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── 1. Voice Input ── */}
      <Card style={{padding:"20px 22px 18px"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
          <div style={{position:"relative",width:96,height:96,flexShrink:0}}>
            {isRec&&<div style={{position:"absolute",inset:-16,borderRadius:"50%",background:`radial-gradient(circle,${ACCENT}18 0%,transparent 70%)`,animation:"vPulse 2s ease-in-out infinite",pointerEvents:"none"}}/>}
            <svg width="96" height="96" viewBox="0 0 96 96" style={{position:"absolute",inset:0,overflow:"visible"}}>
              <circle cx="48" cy="48" r="44" fill="none" stroke={isRec?`${ACCENT}55`:"rgba(255,255,255,0.07)"} strokeWidth="1.5" style={{transition:"stroke 0.4s"}}/>
              {isRec&&<circle cx="48" cy="48" r="38" fill="none" stroke={ACCENT} strokeWidth="1.5" opacity="0.6"/>}
            </svg>
            <button
              onClick={voiceStatus==="idle"?startRecording:voiceStatus==="recording"?stopRecording:undefined}
              disabled={voiceStatus==="processing"||!voiceSupported}
              style={{position:"absolute",inset:8,borderRadius:"50%",border:"none",cursor:voiceStatus==="processing"||!voiceSupported?"default":"pointer",background:`radial-gradient(circle at 36% 32%,#1e1e2e 0%,#141420 45%,#09090B 100%)`,boxShadow:isRec?`0 0 0 1px ${ACCENT}55,0 0 30px ${ACCENT}44,inset 0 0 20px rgba(79,110,247,0.12)`:`0 0 0 1px rgba(255,255,255,0.08),0 6px 24px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.06)`,display:"flex",alignItems:"center",justifyContent:"center",transition:"box-shadow 0.4s,transform 0.2s",transform:isRec?"scale(1.04)":"scale(1)",outline:"none"}}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{transition:"all 0.3s"}}>
                {voiceStatus==="processing"
                  ?[0,60,120,180,240,300].map((deg,i)=><circle key={i} cx={12+7.5*Math.cos(deg*Math.PI/180)} cy={12+7.5*Math.sin(deg*Math.PI/180)} r="1.6" fill={ACCENT} opacity={0.3+i*0.12}/>)
                  :<><rect x="9" y="2" width="6" height="11" rx="3" fill={isRec?ACCENT:"rgba(255,255,255,0.88)"}/><path d="M5 10a7 7 0 0 0 14 0" stroke={isRec?ACCENT:"rgba(255,255,255,0.88)"} strokeWidth="1.8" strokeLinecap="round" fill="none"/><line x1="12" y1="19" x2="12" y2="22" stroke={isRec?ACCENT:"rgba(255,255,255,0.88)"} strokeWidth="1.8" strokeLinecap="round"/><line x1="9" y1="22" x2="15" y2="22" stroke={isRec?ACCENT:"rgba(255,255,255,0.88)"} strokeWidth="1.8" strokeLinecap="round"/></>
                }
              </svg>
            </button>
          </div>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.12em",color:voiceColor,transition:"color 0.3s"}}>{voiceLabel}</div>
          {transcript
            ?<div style={{fontSize:12,color:"rgba(255,255,255,0.5)",fontStyle:"italic",textAlign:"center",lineHeight:1.5,padding:"7px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:`1px solid rgba(255,255,255,0.06)`,maxWidth:400}}>"{transcript}"</div>
            :<div style={{fontSize:10,color:"rgba(255,255,255,0.15)",letterSpacing:"0.06em",textAlign:"center"}}>e.g. "handful blueberries, small banana, 200g yogurt"</div>
          }
        </div>
      </Card>

      {/* ── 2. AI Food Parser test panel ── */}
      <Card style={{padding:"14px 18px",border:`1px solid rgba(79,110,247,0.15)`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:pfRaw||pfError?10:0}}>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",color:"rgba(255,255,255,0.4)"}}>AI FOOD PARSER <span style={{fontSize:8,color:ACCENT,fontWeight:400,letterSpacing:"0.04em"}}>GPT-powered · test</span></div>
            {!pfRaw&&!pfError&&<div style={{fontSize:10,color:"rgba(255,255,255,0.2)"}}>Sends "small banana and handful blueberries"</div>}
          </div>
          <button
            onClick={()=>testFoodParser()}
            disabled={pfLoading}
            style={{padding:"6px 14px",background:pfLoading?"rgba(255,255,255,0.04)":`${ACCENT}22`,border:`1px solid ${ACCENT}44`,borderRadius:8,color:pfLoading?"rgba(255,255,255,0.3)":ACCENT,fontSize:11,fontWeight:700,cursor:pfLoading?"default":"pointer",letterSpacing:"0.04em",display:"flex",alignItems:"center",gap:6,flexShrink:0,whiteSpace:"nowrap"}}
          >
            {pfLoading
              ?<><div style={{width:10,height:10,border:`1.5px solid ${ACCENT}44`,borderTopColor:ACCENT,borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>Parsing…</>
              :<>Test Food Parser</>
            }
          </button>
        </div>

        {pfError&&(
          <div style={{fontSize:11,color:PINK,padding:"8px 10px",background:`${PINK}0D`,borderRadius:8,border:`1px solid ${PINK}22`}}>{pfError}</div>
        )}

        {pfRaw&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{padding:"8px 10px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.06em",marginBottom:4}}>RAW RESPONSE</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",wordBreak:"break-all",lineHeight:1.5}}>{pfRaw}</div>
            </div>
            {pfParsed&&pfParsed.length>0&&(
              <div style={{padding:"8px 10px",background:`${GREEN}08`,borderRadius:8,border:`1px solid ${GREEN}22`}}>
                <div style={{fontSize:9,color:GREEN,letterSpacing:"0.06em",fontWeight:700,marginBottom:6}}>PARSED FOODS</div>
                {pfParsed.map((item,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:i<pfParsed.length-1?"1px solid rgba(255,255,255,0.04)":"none"}}>
                    <span style={{fontSize:12,color:"rgba(255,255,255,0.75)"}}>{item.name}</span>
                    <span style={{fontSize:12,fontWeight:700,color:ACCENT}}>{item.grams}g</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── 3. Macro calculation status ── */}
      {macroStatus==="loading"&&(
        <Card style={{padding:"14px 18px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:16,height:16,border:`2px solid ${ACCENT}44`,borderTopColor:ACCENT,borderRadius:"50%",animation:"spin 0.7s linear infinite",flexShrink:0}}/>
            <span style={{fontSize:12,color:"rgba(255,255,255,0.5)"}}>Calculating macros via food database…</span>
          </div>
        </Card>
      )}
      {macroStatus==="done"&&macroData&&(
        <Card style={{padding:"14px 18px",border:`1px solid ${GREEN}22`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:10,color:GREEN,fontWeight:700,letterSpacing:"0.08em"}}>◈ MACROS CALCULATED</div>
            {macroNote&&<div style={{fontSize:9,color:ORANGE}}>{macroNote}</div>}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {macroData.items.map((item,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,0.04)",gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{item.resolvedName}</span>
                  <span style={{fontSize:9,color:"rgba(255,255,255,0.25)",marginLeft:5}}>{item.grams}g</span>
                  {item.source==="estimated"&&<span style={{fontSize:8,color:ORANGE,marginLeft:4}}>est.</span>}
                </div>
                <div style={{display:"flex",gap:8,flexShrink:0}}>
                  <span style={{fontSize:10,color:ACCENT}}>{item.carbs}g C</span>
                  <span style={{fontSize:10,color:GREEN}}>{item.protein}g P</span>
                  <span style={{fontSize:10,color:"#A855F7"}}>{item.fat}g F</span>
                </div>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:6}}>
              <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>TOTAL · {macroData.totals.calories} kcal</span>
              <div style={{display:"flex",gap:10}}>
                <span style={{fontSize:11,fontWeight:700,color:ACCENT}}>{macroData.totals.carbs}g carbs</span>
                <span style={{fontSize:11,color:GREEN}}>→ {macroData.totals.netCarbs}g net</span>
              </div>
            </div>
          </div>
        </Card>
      )}
      {macroStatus==="error"&&macroNote&&(
        <div style={{fontSize:10,color:ORANGE,padding:"6px 12px",background:`${ORANGE}10`,borderRadius:8,border:`1px solid ${ORANGE}30`}}>{macroNote}</div>
      )}

      {/* ── 3. Entry details form ── */}
      <Card style={{padding:20}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:"0.1em",marginBottom:14}}>ENTRY DETAILS — edit any field</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>GLUCOSE BEFORE (mg/dL)</div>
            <div style={{display:"flex",gap:8}}>
              <input value={glucose} onChange={e=>setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={{...inp,flex:1}}/>
              <button onClick={pullCGM} disabled={cgmLoading} style={{padding:"0 12px",background:cgmLoading?"rgba(255,255,255,0.05)":`${ACCENT}18`,border:`1px solid ${ACCENT}44`,borderRadius:10,color:ACCENT,fontSize:10,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}>
                {cgmLoading?<div style={{width:10,height:10,border:`1.5px solid ${ACCENT}44`,borderTopColor:ACCENT,borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>:<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M15 6l6 6-6 6"/></svg>}
                CGM
              </button>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>CARBS (g)</div><input value={carbs} onChange={e=>setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inp}/></div>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>FIBER (g) <span style={{opacity:0.5}}>opt.</span></div><input value={fiber} onChange={e=>setFiber(e.target.value)} placeholder="e.g. 8" type="number" style={inp}/></div>
          </div>
          {netCarbs!==null&&netCarbs>=0&&(
            <div style={{padding:"7px 12px",background:`${GREEN}0D`,border:`1px solid ${GREEN}33`,borderRadius:8,fontSize:11,color:GREEN,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontWeight:700,marginRight:2}}>◈</span>
              <span><b>{carbs}g</b> − <b>{fiber}g</b> fiber = <b style={{fontSize:13}}>{netCarbs}g net carbs</b></span>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>PROTEIN (g)</div><input value={protein} onChange={e=>setProtein(e.target.value)} placeholder="e.g. 30" type="number" style={inp}/></div>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>FAT (g)</div><input value={fat} onChange={e=>setFat(e.target.value)} placeholder="e.g. 15" type="number" style={inp}/></div>
          </div>
          <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>MEAL DESCRIPTION</div><input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. granola, banana, yogurt…" style={{...inp,fontSize:12,fontWeight:400}}/></div>
          <MacroWidget cl={cl} active={mealType} overridden={overridden} onPick={t=>{setMealType(t);setOverridden(t!==(cl?.mealType??"BALANCED"));}} onReset={()=>{setOverridden(false);if(cl)setMealType(cl.mealType);}}/>
          <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>INSULIN (u)</div><input value={insulin} onChange={e=>setInsulin(e.target.value)} placeholder="e.g. 1.5" type="number" style={inp}/></div>
          {error&&<div style={{fontSize:11,color:PINK}}>{error}</div>}
          <button onClick={confirmLog} disabled={saving||!glucose||!carbs||!insulin} style={{marginTop:4,padding:"14px",background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`,border:"none",borderRadius:12,color:"white",fontSize:14,fontWeight:700,cursor:"pointer",opacity:glucose&&carbs&&insulin&&!saving?1:0.4,letterSpacing:"-0.01em",transition:"opacity 0.2s"}}>
            {saving?"Saving…":"✓ Confirm Log"}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── ENTRY LOG ───────────────────────────────────────────────────
const MEAL_TYPE_META: Record<MealTypeKey,{label:string;color:string}> = {
  FAST_CARBS: {label:"Fast Carbs", color:ORANGE},
  HIGH_FAT:   {label:"High Fat",   color:"#A855F7"},
  HIGH_PROTEIN:{label:"High Protein",color:"#3B82F6"},
  BALANCED:   {label:"Balanced",   color:GREEN},
};

function EntryLog() {
  const [entries,setEntries]=useState<Entry[]>([]);
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState("ALL");
  const [expandedId,setExpandedId]=useState<number|null>(null);
  const [openMenu,setOpenMenu]=useState<number|null>(null);
  const [deleting,setDeleting]=useState<number|null>(null);
  const filters=["ALL","GOOD","UNDERDOSE","OVERDOSE"];

  useEffect(()=>{
    apiFetch<{entries:Entry[];total:number}>("/entries").then(d=>setEntries(d.entries||[])).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{
    if(openMenu===null) return;
    function onDown(ev:MouseEvent){ if(!(ev.target as HTMLElement).closest("[data-entry-menu]")) setOpenMenu(null); }
    document.addEventListener("mousedown",onDown);
    return ()=>document.removeEventListener("mousedown",onDown);
  },[openMenu]);

  async function deleteEntry(id:number){
    setDeleting(id);
    try{
      await apiFetch(`/entries/${id}`,{method:"DELETE"});
      setEntries(prev=>prev.filter(e=>e.id!==id));
      if(expandedId===id) setExpandedId(null);
    }catch{}
    setDeleting(null);
    setOpenMenu(null);
  }

  if(loading) return <Spinner/>;
  const filtered=filter==="ALL"?entries:entries.filter(e=>e.evaluation===filter);

  const Stat=({label,value,color}:{label:string;value:string;color?:string})=>(
    <div style={{display:"flex",flexDirection:"column",gap:2,minWidth:72}}>
      <span style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:"0.09em",fontWeight:500}}>{label}</span>
      <span style={{fontSize:13,fontWeight:700,color:color||"rgba(255,255,255,0.85)"}}>{value}</span>
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {filters.map(f=>{
          const colors: Record<string,string>={ALL:ACCENT,GOOD:GREEN,UNDERDOSE:ORANGE,OVERDOSE:PINK};
          return <button key={f} onClick={()=>setFilter(f)} style={{padding:"6px 14px",borderRadius:99,fontSize:11,fontWeight:600,border:`1px solid ${filter===f?colors[f]:"rgba(255,255,255,0.1)"}`,background:filter===f?`${colors[f]}18`:"transparent",color:filter===f?colors[f]:"rgba(255,255,255,0.45)",cursor:"pointer",letterSpacing:"0.04em"}}>{f}</button>;
        })}
        <span style={{marginLeft:"auto",fontSize:11,color:"rgba(255,255,255,0.3)",alignSelf:"center"}}>{filtered.length} entries</span>
      </div>
      <Card>
        {filtered.length===0?(
          <div style={{padding:32,textAlign:"center",color:"rgba(255,255,255,0.2)",fontSize:13}}>No entries</div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
              {["Time","Meal","BG Before","Carbs","Fiber","Insulin","Result",""].map((h,i)=>(
                <th key={i} style={{padding:"10px 18px",textAlign:"left",fontSize:9,color:"rgba(255,255,255,0.3)",fontWeight:500,letterSpacing:"0.08em",width:h===""?"36px":undefined}}>{h.toUpperCase()}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((e,i)=>{
                const ev=evalStyle(e.evaluation);
                const ts=new Date(e.timestamp).toLocaleDateString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
                const isMenuOpen=openMenu===e.id;
                const isExpanded=expandedId===e.id;
                const meta=e.mealType?MEAL_TYPE_META[e.mealType]:null;
                const netCarbs=e.fiberGrams!=null?Math.max(0,e.carbsGrams-e.fiberGrams):null;
                const icr=e.insulinUnits>0?(netCarbs??e.carbsGrams)/e.insulinUnits:null;
                const hasNextRow=i<filtered.length-1;

                return (
                  <React.Fragment key={e.id}>
                    {/* ── Main row ── */}
                    <tr
                      style={{
                        borderBottom:(!isExpanded&&hasNextRow)?`1px solid rgba(255,255,255,0.03)`:"none",
                        opacity:deleting===e.id?0.4:1,
                        transition:"opacity 0.2s",
                        background:isExpanded?"rgba(79,110,247,0.05)":"transparent",
                        cursor:"pointer",
                      }}
                    >
                      {/* clickable cells: Time → Result */}
                      {([
                        <td key="ts" onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"11px 18px",fontSize:11,color:"rgba(255,255,255,0.4)",userSelect:"none"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:10,color:"rgba(255,255,255,0.2)",transition:"transform 0.2s",display:"inline-block",transform:isExpanded?"rotate(90deg)":"rotate(0deg)"}}>›</span>
                            {ts}
                          </div>
                        </td>,
                        <td key="meal" onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"11px 18px",userSelect:"none"}}>
                          {meta
                            ? <span style={{fontSize:10,padding:"2px 9px",borderRadius:99,fontWeight:700,background:`${meta.color}18`,color:meta.color,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>{meta.label.toUpperCase()}</span>
                            : <span style={{fontSize:12,color:"rgba(255,255,255,0.25)"}}>—</span>
                          }
                        </td>,
                        <td key="bg" onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"11px 18px",fontSize:12,fontWeight:600,color:e.glucoseBefore>140?ORANGE:e.glucoseBefore<80?PINK:"rgba(255,255,255,0.85)",userSelect:"none"}}>{e.glucoseBefore}</td>,
                        <td key="carbs" onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"11px 18px",fontSize:12,color:"rgba(255,255,255,0.7)",userSelect:"none"}}>{e.carbsGrams}g</td>,
                        <td key="fiber" onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"11px 18px",fontSize:12,color:"rgba(255,255,255,0.5)",userSelect:"none"}}>{e.fiberGrams!=null?`${e.fiberGrams}g`:"—"}</td>,
                        <td key="ins" onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"11px 18px",fontSize:12,color:"rgba(255,255,255,0.7)",userSelect:"none"}}>{e.insulinUnits}u</td>,
                        <td key="res" onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"11px 18px",userSelect:"none"}}>
                          <span style={{fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,background:`${ev.color}18`,color:ev.color,letterSpacing:"0.06em"}}>{ev.label}</span>
                        </td>,
                      ])}
                      {/* ⋯ menu — not part of the expand click area */}
                      <td style={{padding:"11px 10px 11px 0",position:"relative",width:36}} data-entry-menu="">
                        <button
                          data-entry-menu=""
                          onClick={ev=>{ev.stopPropagation();setOpenMenu(isMenuOpen?null:e.id);}}
                          style={{width:28,height:28,borderRadius:7,border:"none",background:isMenuOpen?"rgba(255,255,255,0.1)":"transparent",color:"rgba(255,255,255,0.35)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,lineHeight:1,transition:"all 0.15s"}}
                          onMouseEnter={el=>(el.currentTarget.style.background="rgba(255,255,255,0.08)")}
                          onMouseLeave={el=>(el.currentTarget.style.background=isMenuOpen?"rgba(255,255,255,0.1)":"transparent")}
                        >⋯</button>
                        {isMenuOpen&&(
                          <div data-entry-menu="" style={{position:"absolute",right:0,top:"100%",zIndex:200,background:"#1A1A24",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",minWidth:170,padding:"6px",marginTop:4}}>
                            <div style={{padding:"6px 10px 4px",fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",fontWeight:600}}>ENTRY #{e.id}</div>
                            <div style={{height:1,background:"rgba(255,255,255,0.07)",margin:"4px 0"}}/>
                            <button
                              data-entry-menu=""
                              onClick={()=>deleteEntry(e.id)}
                              disabled={deleting===e.id}
                              style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"none",background:"transparent",color:PINK,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:8,transition:"background 0.12s"}}
                              onMouseEnter={el=>(el.currentTarget.style.background=`${PINK}15`)}
                              onMouseLeave={el=>(el.currentTarget.style.background="transparent")}
                            ><span style={{fontSize:13,fontWeight:300,letterSpacing:"-0.02em"}}>⊗</span> Delete entry</button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* ── Expansion rows ── */}
                    {isExpanded&&(
                      <>
                        {/* Row 1 — Macros */}
                        <tr style={{background:"rgba(79,110,247,0.03)"}}>
                          <td colSpan={8} style={{padding:"0 18px 0 42px"}}>
                            <div style={{borderLeft:`2px solid ${ACCENT}33`,paddingLeft:16,paddingTop:12,paddingBottom:10}}>
                              <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",fontWeight:600,marginBottom:10}}>MACROS & DOSING</div>
                              <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
                                <Stat label="TOTAL CARBS" value={`${e.carbsGrams}g`}/>
                                <Stat label="FIBER" value={e.fiberGrams!=null?`${e.fiberGrams}g`:"—"} color="rgba(255,255,255,0.5)"/>
                                <Stat label="NET CARBS" value={netCarbs!=null?`${netCarbs.toFixed(0)}g`:"—"} color={GREEN}/>
                                <Stat label="INSULIN DOSE" value={`${e.insulinUnits}u`} color={ACCENT}/>
                                <Stat label="CARB RATIO" value={icr!=null?`1u / ${icr.toFixed(0)}g`:"—"} color="rgba(255,255,255,0.6)"/>
                                {meta&&<Stat label="MEAL TYPE" value={meta.label} color={meta.color}/>}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {/* Row 2 — Glucose */}
                        <tr style={{background:"rgba(79,110,247,0.03)"}}>
                          <td colSpan={8} style={{padding:"0 18px 0 42px"}}>
                            <div style={{borderLeft:`2px solid ${GREEN}33`,paddingLeft:16,paddingTop:10,paddingBottom:10}}>
                              <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",fontWeight:600,marginBottom:10}}>GLUCOSE TRACKING</div>
                              <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
                                <Stat label="BG BEFORE" value={`${e.glucoseBefore} mg/dL`} color={e.glucoseBefore>140?ORANGE:e.glucoseBefore<80?PINK:GREEN}/>
                                <Stat label="BG AFTER" value={e.glucoseAfter!=null?`${e.glucoseAfter} mg/dL`:"not recorded"} color={e.glucoseAfter!=null?(e.glucoseAfter>180?PINK:e.glucoseAfter<70?PINK:GREEN):"rgba(255,255,255,0.3)"}/>
                                <Stat label="DELTA" value={e.delta!=null?`${e.delta>0?"+":""}${e.delta.toFixed(0)} mg/dL`:"—"} color={e.delta!=null?(Math.abs(e.delta)>60?PINK:Math.abs(e.delta)>30?ORANGE:GREEN):"rgba(255,255,255,0.3)"}/>
                                <Stat label="TIME GAP" value={e.timeDifferenceMinutes!=null?`${e.timeDifferenceMinutes.toFixed(0)} min`:"—"} color="rgba(255,255,255,0.6)"/>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {/* Row 3 — Context */}
                        <tr style={{background:"rgba(79,110,247,0.03)",borderBottom:hasNextRow?`1px solid rgba(255,255,255,0.06)`:"none"}}>
                          <td colSpan={8} style={{padding:"0 18px 0 42px"}}>
                            <div style={{borderLeft:`2px solid rgba(255,255,255,0.1)`,paddingLeft:16,paddingTop:10,paddingBottom:14}}>
                              <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",fontWeight:600,marginBottom:8}}>MEAL CONTEXT</div>
                              <div style={{fontSize:12,color:"rgba(255,255,255,0.55)",lineHeight:1.6,fontStyle:e.mealDescription?"normal":"italic"}}>
                                {e.mealDescription||"No meal description recorded."}
                              </div>
                              <div style={{marginTop:8,display:"flex",gap:8,alignItems:"center"}}>
                                {meta&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:99,fontWeight:700,background:`${meta.color}18`,color:meta.color,letterSpacing:"0.07em"}}>{meta.label.toUpperCase()}</span>}
                                <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>{new Date(e.timestamp).toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ─── INSIGHTS ────────────────────────────────────────────────────
const MEAL_TYPE_INFO: Record<MealTypeKey,{headline:string;examples:string[];timing:string;note:string}> = {
  FAST_CARBS: {
    headline:"Simple sugars, high glycemic impact",
    examples:["White rice","Fruit juice","White bread","Crackers","Sports drinks","Candy"],
    timing:"Pre-bolus 10–15 min before eating — glucose rises quickly.",
    note:"Absorption peaks within 30–45 min. Avoid stacking corrections.",
  },
  HIGH_FAT: {
    headline:"Slow absorption, prolonged glucose rise",
    examples:["Pizza","Pasta with cream","Cheese","Avocado","Nuts","Fried food"],
    timing:"Consider split dose or extended bolus over 2–3 h.",
    note:"Fat delays gastric emptying. The glucose peak may arrive 2–4 h post-meal.",
  },
  HIGH_PROTEIN: {
    headline:"Moderate late glucose rise via gluconeogenesis",
    examples:["Chicken / steak","Eggs","Protein shakes","Cottage cheese","Fish","Tofu"],
    timing:"Standard timing; consider a small correction at ~2–3 h.",
    note:"About 50–60% of excess protein converts to glucose slowly over several hours.",
  },
  BALANCED: {
    headline:"Mixed macros, moderate glycemic index",
    examples:["Salad with chicken","Stir-fry with brown rice","Oats with fruit","Lentils","Grain bowls"],
    timing:"Standard bolus 0–10 min before. Monitor 90 min post-meal.",
    note:"Predictable response. Good target for building reliable insulin ratios.",
  },
};

function InsightFlipCard({m,color,label}:{m:MealPattern;color:string;label:string}) {
  const [flipped,setFlipped]=useState(false);
  const info=MEAL_TYPE_INFO[m.mealType as MealTypeKey];
  const CARD_H=248;

  return (
    <div
      onClick={()=>setFlipped(f=>!f)}
      style={{perspective:"1000px",cursor:"pointer",height:CARD_H,position:"relative"}}
      title={flipped?"Click to see stats":"Click to learn about this category"}
    >
      <div style={{
        position:"relative",width:"100%",height:"100%",
        transformStyle:"preserve-3d",
        transition:"transform 0.52s cubic-bezier(0.4,0.2,0.2,1)",
        transform:flipped?"rotateY(180deg)":"rotateY(0deg)",
      }}>

        {/* ── FRONT ── */}
        <div style={{
          position:"absolute",inset:0,backfaceVisibility:"hidden",
          background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:14,
          padding:"18px 20px",boxSizing:"border-box",display:"flex",flexDirection:"column",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:8,height:8,borderRadius:99,background:color,flexShrink:0}}/>
            <div style={{fontSize:13,fontWeight:700}}>{label}</div>
            <span style={{marginLeft:"auto",fontSize:10,color:"rgba(255,255,255,0.35)"}}>{m.count} entries</span>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.18)",marginLeft:4}}>↺</span>
          </div>
          {m.count===0?(
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"rgba(255,255,255,0.18)"}}>No data yet</div>
          ):(
            <>
              <div style={{display:"flex",flexDirection:"column",gap:0,flex:1}}>
                {[
                  {label:"Avg Carbs",value:`${m.avgCarbsGrams.toFixed(0)}g`,color:"rgba(255,255,255,0.85)"},
                  {label:"Avg Insulin",value:`${m.avgInsulinUnits.toFixed(1)}u`,color:"rgba(255,255,255,0.85)"},
                  {label:"Good outcomes",value:`${(m.goodRate*100).toFixed(0)}%`,color:m.goodRate>0.6?GREEN:ORANGE},
                  {label:"Insulin ratio",value:`1u / ${(1/(m.insulinToCarb/10)).toFixed(0)}g`,color:ACCENT},
                ].map(row=>(
                  <div key={row.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
                    <span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{row.label}</span>
                    <span style={{fontSize:13,fontWeight:700,color:row.color}}>{row.value}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:"0.06em"}}>SUCCESS RATE</span>
                  <span style={{fontSize:10,color:m.goodRate>0.6?GREEN:ORANGE,fontWeight:700}}>{(m.goodRate*100).toFixed(0)}%</span>
                </div>
                <div style={{height:4,background:"rgba(255,255,255,0.07)",borderRadius:99,overflow:"hidden"}}>
                  <div style={{width:`${m.goodRate*100}%`,height:"100%",background:m.goodRate>0.6?GREEN:ORANGE,borderRadius:99}}/>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── BACK ── */}
        <div style={{
          position:"absolute",inset:0,backfaceVisibility:"hidden",
          transform:"rotateY(180deg)",
          background:`linear-gradient(145deg,${color}14,${SURFACE} 60%)`,
          border:`1px solid ${color}33`,borderRadius:14,
          padding:"18px 20px",boxSizing:"border-box",display:"flex",flexDirection:"column",gap:10,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
            <div style={{width:8,height:8,borderRadius:99,background:color,flexShrink:0}}/>
            <div style={{fontSize:13,fontWeight:700,color}}>{label}</div>
            <span style={{marginLeft:"auto",fontSize:10,color:"rgba(255,255,255,0.18)"}}>↺ back</span>
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.55)",lineHeight:1.5,fontStyle:"italic"}}>{info.headline}</div>
          <div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.09em",fontWeight:600,marginBottom:5}}>COMMON FOODS</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {info.examples.map(ex=>(
                <span key={ex} style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.6)",border:"1px solid rgba(255,255,255,0.08)"}}>{ex}</span>
              ))}
            </div>
          </div>
          <div style={{borderTop:`1px solid rgba(255,255,255,0.06)`,paddingTop:8,marginTop:"auto"}}>
            <div style={{fontSize:10,color:color,fontWeight:600,marginBottom:3}}>▸ {info.timing}</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",lineHeight:1.5}}>{info.note}</div>
          </div>
        </div>

      </div>
    </div>
  );
}

const STAT_COLORS: Record<string,string> = {
  "Control Score": ACCENT,
  "Good Rate": GREEN,
  "Spike Rate": ORANGE,
  "Hypo Rate": PINK,
};

function StatMetricFlipCard({ label, info, color, defaultFlipped }: {
  label: string;
  info: { headline: string; detail: string; formula: string };
  color: string;
  defaultFlipped?: boolean;
}) {
  const [flipped, setFlipped] = useState(defaultFlipped || false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if (defaultFlipped && ref.current) {
      setTimeout(()=>ref.current?.scrollIntoView({ behavior:"smooth", block:"center" }), 120);
    }
  },[defaultFlipped]);

  return (
    <div
      ref={ref}
      onClick={()=>setFlipped(f=>!f)}
      style={{perspective:"800px",cursor:"pointer",height:128,outline:defaultFlipped?`1px solid ${color}44`:"none",borderRadius:14,transition:"outline 0.3s"}}
    >
      <div style={{position:"relative",width:"100%",height:"100%",transformStyle:"preserve-3d",transition:"transform 0.52s cubic-bezier(0.4,0.2,0.2,1)",transform:flipped?"rotateY(180deg)":"rotateY(0deg)"}}>
        {/* front */}
        <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:14,padding:"14px 18px",boxSizing:"border-box",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:"0.08em"}}>{label.toUpperCase()}</div>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.22)"}}>↺ details</span>
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.65)",fontStyle:"italic",lineHeight:1.4}}>{info.headline}</div>
          <div style={{fontSize:9,color:color,fontFamily:"monospace",opacity:0.75}}>{info.formula}</div>
        </div>
        {/* back */}
        <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",transform:"rotateY(180deg)",background:`linear-gradient(145deg,${color}14,${SURFACE} 65%)`,border:`1px solid ${color}33`,borderRadius:14,padding:"14px 18px",boxSizing:"border-box",display:"flex",flexDirection:"column",gap:7,justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontSize:10,color,fontWeight:700,letterSpacing:"0.06em"}}>{label.toUpperCase()}</div>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.18)"}}>↺ back</span>
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.65)",lineHeight:1.5}}>{info.detail}</div>
          <div style={{fontSize:9,color:color,fontFamily:"monospace",opacity:0.8}}>{info.formula}</div>
        </div>
      </div>
    </div>
  );
}

function Insights({ focusedStat }: { focusedStat?: string | null }) {
  const [patterns,setPatterns]=useState<MealPattern[]>([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    apiFetch<{patterns:MealPattern[]}>("/insights/patterns").then(d=>setPatterns(d.patterns)).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  if(loading) return <Spinner/>;

  const mealTypeLabels: Record<MealTypeKey,string> = { FAST_CARBS:"Fast Carbs", HIGH_FAT:"High Fat", HIGH_PROTEIN:"High Protein", BALANCED:"Balanced" };
  const mealColors: Record<MealTypeKey,string> = { FAST_CARBS:ORANGE, HIGH_FAT:"#A855F7", HIGH_PROTEIN:"#3B82F6", BALANCED:GREEN };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* ── Performance Metrics section ── */}
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:700,letterSpacing:"-0.01em"}}>Performance Metrics</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",letterSpacing:"0.04em"}}>Tap a card to flip ↺</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {Object.entries(STAT_INFO).map(([label,info])=>(
            <StatMetricFlipCard
              key={label}
              label={label}
              info={info}
              color={STAT_COLORS[label]||ACCENT}
              defaultFlipped={focusedStat===label}
            />
          ))}
        </div>
      </div>

      {/* ── Meal Type Insights section ── */}
      <div>
        <div style={{fontSize:13,fontWeight:700,letterSpacing:"-0.01em",marginBottom:8}}>Meal Type Patterns</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {patterns.map(m=>(
            <InsightFlipCard
              key={m.mealType}
              m={m}
              color={mealColors[m.mealType as MealTypeKey]||"#888"}
              label={mealTypeLabels[m.mealType as MealTypeKey]||m.mealType}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── RECOMMEND ───────────────────────────────────────────────────
function Recommend({ prefill }: { prefill?: Partial<ParsedVoiceEntry> }) {
  const [glucose,setGlucose]=useState(prefill?.glucoseBefore?.toString()||"");
  const [carbs,setCarbs]=useState(prefill?.carbsGrams?.toString()||"");
  const [fiber,setFiber]=useState(prefill?.fiberGrams?.toString()||"");
  const [protein,setProtein]=useState("");
  const [fat,setFat]=useState("");
  const [desc,setDesc]=useState(prefill?.mealDescription||"");
  const [mealType,setMealType]=useState<MealTypeKey>("BALANCED");
  const [overridden,setOverridden]=useState(false);
  const [cl,setCl]=useState<ReturnType<typeof classifyMeal>|null>(null);
  const [result,setResult]=useState<Recommendation|null>(null);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    const c=Number(carbs)||0,p=Number(protein)||0,f=Number(fat)||0;
    if(c+p+f===0&&!desc){setCl(null);return;}
    const r=classifyMeal(c,p,f,desc);
    setCl(r);
    if(!overridden) setMealType(r.mealType);
  },[carbs,protein,fat,desc,overridden]);

  async function calc() {
    if(!glucose||!carbs) return;
    setLoading(true);
    try {
      const r=await apiFetch<Recommendation>("/recommendations",{method:"POST",body:JSON.stringify({
        glucoseBefore:Number(glucose),carbsGrams:Number(carbs),
        fiberGrams:fiber?Number(fiber):undefined,mealType,
      })});
      setResult(r);
    } catch { } finally { setLoading(false); }
  }

  const netCarbs = carbs&&fiber ? Math.max(0,Number(carbs)-Number(fiber)) : null;

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,alignItems:"start"}}>
      <Card style={{padding:22}}>
        <div style={{fontSize:15,fontWeight:700,marginBottom:18}}>Bolus Calculator</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>CURRENT GLUCOSE (mg/dL)</div><input value={glucose} onChange={e=>setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={inp}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>PLANNED CARBS (g)</div><input value={carbs} onChange={e=>setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inp}/></div>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>FIBER (g) <span style={{opacity:0.5}}>opt.</span></div><input value={fiber} onChange={e=>setFiber(e.target.value)} placeholder="e.g. 8" type="number" style={inp}/></div>
          </div>
          {netCarbs!==null&&(
            <div style={{padding:"7px 11px",background:`${GREEN}0D`,border:`1px solid ${GREEN}33`,borderRadius:8,fontSize:11,color:GREEN}}>
              <span style={{fontWeight:700,letterSpacing:"0.04em",marginRight:2}}>◈</span> Net carbs: <b style={{fontSize:13}}>{netCarbs}g</b> ({carbs}g − {fiber}g fiber)
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>PROTEIN (g)</div><input value={protein} onChange={e=>setProtein(e.target.value)} placeholder="e.g. 30" type="number" style={inp}/></div>
            <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>FAT (g)</div><input value={fat} onChange={e=>setFat(e.target.value)} placeholder="e.g. 15" type="number" style={inp}/></div>
          </div>
          <div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:5,letterSpacing:"0.08em"}}>DESCRIPTION</div><input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. granola, juice…" style={{...inp,fontSize:12,fontWeight:400}}/></div>
          <MacroWidget cl={cl} active={mealType} overridden={overridden} onPick={t=>{setMealType(t);setOverridden(t!==(cl?.mealType??"BALANCED"));}} onReset={()=>{setOverridden(false);if(cl)setMealType(cl.mealType);}}/>
          <button onClick={calc} disabled={loading||!glucose||!carbs} style={{padding:"13px",background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`,border:"none",borderRadius:10,color:"white",fontSize:14,fontWeight:700,cursor:"pointer",opacity:glucose&&carbs&&!loading?1:0.4}}>
            {loading?"Calculating…":"Calculate Bolus"}
          </button>
        </div>
      </Card>

      <Card style={{padding:22}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>Recommendation</div>
        {result ? (
          <div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 0",background:`${ACCENT}0D`,borderRadius:12,border:`1px solid ${ACCENT}22`,marginBottom:16}}>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:4}}>SUGGESTED DOSE</div>
              <div style={{display:"flex",alignItems:"flex-end",gap:6}}>
                <span style={{fontSize:56,fontWeight:900,color:"white",letterSpacing:"-0.03em"}}>{result.recommendedUnits.toFixed(1)}</span>
                <span style={{fontSize:22,color:"rgba(255,255,255,0.4)",paddingBottom:6}}>u</span>
              </div>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"monospace"}}>Range {result.minUnits.toFixed(1)} – {result.maxUnits.toFixed(1)} u</span>
              {result.cappedForSafety&&<span style={{fontSize:10,color:ORANGE,marginTop:6}}>⚠ Capped for safety</span>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[
                {label:"Confidence",value:result.confidence,color:result.confidence==="HIGH"?GREEN:ORANGE},
                ...(result.carbRatio?[{label:"Carb ratio",value:`1u per ${result.carbRatio.toFixed(0)}g`,color:ACCENT}]:[]),
                {label:"Similar meals",value:`${result.similarMealCount}`,color:"rgba(255,255,255,0.7)"},
                {label:"Timing",value:mealType==="HIGH_FAT"?"Split dose":"Before meal",color:"rgba(255,255,255,0.7)"},
              ].map(row=>(
                <div key={row.label} style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderRadius:8,fontSize:12}}>
                  <span style={{color:"rgba(255,255,255,0.4)"}}>{row.label}</span>
                  <span style={{fontWeight:700,color:row.color}}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop:12,padding:"10px 14px",background:`${ACCENT}10`,borderRadius:8,fontSize:11,color:"rgba(255,255,255,0.5)",lineHeight:1.6}}>
              {result.reasoning}
            </div>
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:280,color:"rgba(255,255,255,0.2)"}}>
            <div style={{marginBottom:14,opacity:0.35}}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 2L4.09 12.96A1 1 0 005 14.5h6.5L11 22l8.91-10.96A1 1 0 0019 9.5h-6.5L13 2z" fill="#4F6EF7" stroke="#4F6EF7" strokeWidth="1" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{fontSize:13}}>Enter parameters to calculate</div>
          </div>
        )}
      </Card>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type VoiceState = "idle" | "recording" | "processing" | "preview";

function VoicePage({ onLogged }: { onLogged?: ()=>void }) {
  const [status, setStatus] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [parsed, setParsed] = useState<ParsedVoiceEntry|null>(null);
  const [suggestion, setSuggestion] = useState<Recommendation|null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mealType, setMealType] = useState<MealTypeKey>("BALANCED");
  const recognitionRef = useRef<any>(null);

  const SR = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const voiceSupported = !!SR;

  function startRecording() {
    if (!SR) { setError("Web Speech API not supported in this browser. Use Chrome or Edge."); return; }
    setError(""); setSaved(false);
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setStatus("recording");
    recognition.onresult = async (e: any) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
      setStatus("processing");
      const p = parseVoiceInput(text);
      setParsed(p);

      // auto-classify
      const cl = classifyMeal(p.carbsGrams||0, 0, 0, p.mealDescription||"");
      setMealType(cl.mealType);

      // fetch recommendation if we have enough data
      if (p.glucoseBefore && p.carbsGrams) {
        try {
          const r = await apiFetch<Recommendation>("/recommendations", {
            method:"POST", body:JSON.stringify({ glucoseBefore:p.glucoseBefore, carbsGrams:p.carbsGrams, fiberGrams:p.fiberGrams??undefined, mealType:cl.mealType })
          });
          setSuggestion(r);
        } catch {}
      }
      setStatus("preview");
    };
    recognition.onerror = (e: any) => { setError(e.error); setStatus("idle"); };
    recognition.onend = () => setStatus(s => s === "recording" ? "idle" : s);
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopRecording() { recognitionRef.current?.stop(); }

  async function confirmEntry() {
    if (!parsed) return;
    setSaving(true);
    try {
      await apiFetch("/entries", { method:"POST", body:JSON.stringify({
        glucoseBefore: parsed.glucoseBefore,
        carbsGrams: parsed.carbsGrams,
        fiberGrams: parsed.fiberGrams??undefined,
        insulinUnits: parsed.insulinUnits ?? suggestion?.recommendedUnits,
        mealType,
        mealDescription: parsed.mealDescription??undefined,
      })});
      setSaved(true);
      onLogged?.();
      setTimeout(()=>{ setStatus("idle"); setParsed(null); setTranscript(""); setSuggestion(null); setSaved(false); }, 2000);
    } catch { setError("Failed to save entry."); }
    finally { setSaving(false); }
  }

  function reset() { setStatus("idle"); setParsed(null); setTranscript(""); setSuggestion(null); setError(""); setSaved(false); }

  const isRec = status === "recording";
  const statusLabel = { idle:"Tap to speak", recording:"Listening…", processing:"Processing…", preview:"Review entry" }[status];
  const statusColor = { idle:"rgba(255,255,255,0.45)", recording:ACCENT, processing:ORANGE, preview:GREEN }[status];

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:16}}>
      <style>{`
        @keyframes arcRotate{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        @keyframes vPulse{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
        @keyframes vFade{0%{opacity:0;transform:scale(0.94)}100%{opacity:1;transform:scale(1)}}
      `}</style>

      {/* Status header */}
      <div style={{textAlign:"center",marginBottom:36}}>
        <div style={{fontSize:10,letterSpacing:"0.2em",color:"rgba(255,255,255,0.22)",marginBottom:10,fontWeight:500}}>VOICE LOG</div>
        <div style={{fontSize:17,fontWeight:600,letterSpacing:"-0.01em",color:statusColor,transition:"color 0.4s",minHeight:26}}>{statusLabel}</div>
      </div>

      {/* ── The big button ─────────────────────────────── */}
      <div style={{position:"relative",width:252,height:252,flexShrink:0}}>

        {/* Outer ambient bloom when recording */}
        {isRec&&<div style={{position:"absolute",inset:-28,borderRadius:"50%",background:`radial-gradient(circle,${ACCENT}18 0%,transparent 70%)`,animation:"vPulse 2s ease-in-out infinite",pointerEvents:"none"}}/>}

        {/* SVG rings */}
        <svg width="252" height="252" viewBox="0 0 252 252" style={{position:"absolute",inset:0,overflow:"visible"}}>
          <defs>
            <filter id="vglow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <path id="vArcTop" d="M 14,126 a 112,112 0 1,1 224,0 a 112,112 0 1,1 -224,0"/>
          </defs>

          {/* Outermost dashed ring — recording only */}
          <circle cx="126" cy="126" r="122" fill="none"
            stroke="rgba(79,110,247,0.25)"
            strokeWidth="1" strokeDasharray="2 6"
            style={{transition:"opacity 0.5s",opacity:isRec?1:0}}/>

          {/* Second ring — recording only */}
          <circle cx="126" cy="126" r="112" fill="none"
            stroke="rgba(79,110,247,0.55)"
            strokeWidth="1.5"
            filter="url(#vglow)"
            style={{transition:"opacity 0.5s",opacity:isRec?1:0}}/>

          {/* Inner bright ring — recording only */}
          <circle cx="126" cy="126" r="101" fill="none"
            stroke={ACCENT}
            strokeWidth="2"
            filter="url(#vglow)"
            style={{transition:"opacity 0.5s",opacity:isRec?1:0}}/>

          {/* Rotating arc text — recording only */}
          {isRec&&(
            <g style={{transformOrigin:"126px 126px",animation:"arcRotate 8s linear infinite"}}>
              <text fill={`rgba(79,110,247,0.65)`} fontSize="8" letterSpacing="5.5" fontFamily="'Courier New',monospace" fontWeight="700">
                <textPath href="#vArcTop">RECORDING · RECORDING · RECORDING ·&nbsp;&nbsp;</textPath>
              </text>
            </g>
          )}
        </svg>

        {/* Metallic outer bezel */}
        <div style={{
          position:"absolute",inset:20,borderRadius:"50%",
          background:`conic-gradient(from 200deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02),rgba(255,255,255,0.07),rgba(255,255,255,0.01))`,
          transition:"box-shadow 0.5s",
          boxShadow: isRec
            ? `0 0 0 1.5px ${ACCENT}99, 0 0 60px ${ACCENT}44, 0 0 120px ${ACCENT}18`
            : `0 0 0 1px rgba(255,255,255,0.1)`,
        }}/>

        {/* The actual pressable button */}
        <button
          onClick={status==="idle"?startRecording:status==="recording"?stopRecording:reset}
          disabled={status==="processing"||saving}
          style={{
            position:"absolute",inset:26,borderRadius:"50%",border:"none",
            cursor:status==="processing"||saving?"default":"pointer",
            background:`radial-gradient(circle at 36% 32%, #1e1e2e 0%, #141420 45%, #09090B 100%)`,
            boxShadow: isRec
              ? `0 0 0 1px ${ACCENT}55, 0 0 50px ${ACCENT}44, 0 0 25px ${ACCENT}33, inset 0 0 40px rgba(79,110,247,0.12), inset 0 2px 0 rgba(255,255,255,0.07)`
              : status==="preview"
              ? `0 0 0 1px ${GREEN}44, 0 0 30px ${GREEN}22, inset 0 2px 0 rgba(255,255,255,0.06)`
              : `0 0 0 1px rgba(255,255,255,0.08), 0 8px 40px rgba(0,0,0,0.7), inset 0 2px 0 rgba(255,255,255,0.06), inset 0 -2px 0 rgba(0,0,0,0.4)`,
            display:"flex",alignItems:"center",justifyContent:"center",
            transition:"box-shadow 0.5s, transform 0.2s",
            transform:isRec?"scale(1.025)":"scale(1)",
            outline:"none",
          }}
        >
          {/* Icon */}
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" style={{transition:"all 0.3s"}}>
            {status==="preview" ? (
              <><path d="M1 4v6h6" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.51 15a9 9 0 1 0 .49-4.63" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></>
            ) : status==="processing" ? (
              [0,60,120,180,240,300].map((deg,i)=>(
                <circle key={i} cx={12+7.5*Math.cos(deg*Math.PI/180)} cy={12+7.5*Math.sin(deg*Math.PI/180)} r="1.6" fill={ACCENT} opacity={0.3+i*0.12}/>
              ))
            ) : (
              <>
                <rect x="9" y="2" width="6" height="11" rx="3" fill={isRec?"#C03535":"rgba(255,255,255,0.88)"}/>
                <path d="M5 10a7 7 0 0 0 14 0" stroke={isRec?"#C03535":"rgba(255,255,255,0.88)"} strokeWidth="1.8" strokeLinecap="round" fill="none"/>
                <line x1="12" y1="19" x2="12" y2="22" stroke={isRec?"#C03535":"rgba(255,255,255,0.88)"} strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="9" y1="22" x2="15" y2="22" stroke={isRec?"#C03535":"rgba(255,255,255,0.88)"} strokeWidth="1.8" strokeLinecap="round"/>
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Subline */}
      <div style={{marginTop:22,height:18,textAlign:"center"}}>
        {!voiceSupported
          ? <div style={{fontSize:11,color:ORANGE,letterSpacing:"0.04em"}}>Requires Chrome or Edge</div>
          : error
          ? <div style={{fontSize:11,color:PINK}}>{error}</div>
          : status==="idle"
          ? <div style={{fontSize:11,color:"rgba(255,255,255,0.16)",letterSpacing:"0.08em"}}>Click to begin</div>
          : null}
      </div>

      {/* Transcript */}
      {transcript&&(
        <div style={{marginTop:28,width:"100%",maxWidth:520,padding:"12px 18px",background:"rgba(255,255,255,0.04)",border:`1px solid rgba(255,255,255,0.07)`,borderRadius:12,fontSize:13,color:"rgba(255,255,255,0.55)",fontStyle:"italic",textAlign:"center",lineHeight:1.6,animation:"vFade 0.3s ease-out"}}>
          "{transcript}"
        </div>
      )}

      {/* Preview card */}
      {status==="preview"&&parsed&&(
        <div style={{marginTop:24,width:"100%",maxWidth:520,display:"flex",flexDirection:"column",gap:12,animation:"vFade 0.35s ease-out"}}>
          <Card style={{padding:20}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:14,color:GREEN}}>Detected Entry</div>
            <div style={{display:"flex",flexDirection:"column",gap:0}}>
              {[
                {label:"Glucose Before",value:parsed.glucoseBefore?`${parsed.glucoseBefore} mg/dL`:"—",color:parsed.glucoseBefore&&parsed.glucoseBefore>140?ORANGE:parsed.glucoseBefore&&parsed.glucoseBefore<80?PINK:"rgba(255,255,255,0.85)"},
                {label:"Carbs",value:parsed.carbsGrams?`${parsed.carbsGrams}g`:"—",color:"rgba(255,255,255,0.85)"},
                ...(parsed.fiberGrams!=null?[{label:"Fiber",value:`${parsed.fiberGrams}g`,color:GREEN}]:[]),
                {label:"Insulin",value:parsed.insulinUnits?`${parsed.insulinUnits}u`:"—",color:"rgba(255,255,255,0.85)"},
                {label:"Description",value:parsed.mealDescription||"—",color:"rgba(255,255,255,0.55)"},
              ].map(row=>(
                <div key={row.label} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
                  <span style={{fontSize:12,color:"rgba(255,255,255,0.38)"}}>{row.label}</span>
                  <span style={{fontSize:13,fontWeight:600,color:row.color}}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop:14}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.28)",marginBottom:8,letterSpacing:"0.1em"}}>MEAL TYPE</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {(Object.keys(MEAL_LABELS) as MealTypeKey[]).map(t=>{
                  const [bg,color]=pillColors[t];
                  return <button key={t} onClick={()=>setMealType(t)} style={{padding:"5px 12px",borderRadius:99,border:`1px solid ${mealType===t?color:"rgba(255,255,255,0.1)"}`,background:mealType===t?bg:"transparent",color:mealType===t?color:"rgba(255,255,255,0.4)",fontSize:10,fontWeight:600,cursor:"pointer"}}>{MEAL_LABELS[t]}</button>;
                })}
              </div>
            </div>
          </Card>

          {suggestion&&(
            <Card style={{padding:"14px 18px"}}>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:"0.08em",marginBottom:2}}>SUGGESTED DOSE</div>
                  <div style={{fontSize:30,fontWeight:800,color:ACCENT,letterSpacing:"-0.03em"}}>{suggestion.recommendedUnits.toFixed(1)}<span style={{fontSize:13,color:"rgba(255,255,255,0.3)",fontWeight:400}}> u</span></div>
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",maxWidth:200,lineHeight:1.55}}>{suggestion.reasoning.split(".")[0]}.</div>
              </div>
            </Card>
          )}

          <div style={{display:"flex",gap:10}}>
            {saved ? (
              <div style={{flex:1,padding:"13px",background:`${GREEN}18`,border:`1px solid ${GREEN}44`,borderRadius:10,textAlign:"center",fontSize:14,fontWeight:700,color:GREEN}}>✓ Saved</div>
            ) : (
              <>
                <button onClick={reset} style={{flex:1,padding:"13px",background:"rgba(255,255,255,0.05)",border:"none",borderRadius:10,color:"rgba(255,255,255,0.6)",fontSize:13,fontWeight:600,cursor:"pointer"}}>Discard</button>
                <button onClick={confirmEntry} disabled={saving} style={{flex:2,padding:"13px",background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`,border:"none",borderRadius:10,color:"white",fontSize:14,fontWeight:700,cursor:"pointer",opacity:saving?0.6:1}}>
                  {saving?"Saving…":"Confirm & Save"}
                </button>
              </>
            )}
          </div>
          <div style={{textAlign:"center",fontSize:11,color:"rgba(255,255,255,0.16)"}}>
            e.g. "120 glucose 60 carbs 8g fiber 2 units pasta"
          </div>
        </div>
      )}
    </div>
  );
}

// ─── IMPORT ──────────────────────────────────────────────────────
function ImportPage({ onLogged }: { onLogged?: ()=>void }) {
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{imported:number}|null>(null);
  const [error, setError] = useState("");

  const COLS = ["glucoseBefore","glucoseAfter","carbsGrams","fiberGrams","insulinUnits","mealType","mealDescription","timeDifferenceMinutes","notes","timestamp"];

  function parseCSV() {
    setError(""); setResult(null);
    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) { setError("Paste some data first."); return; }

    // Detect if first row is headers
    const firstRow = lines[0].split(/[\t,]/);
    const hasHeader = isNaN(Number(firstRow[0]));
    const headers = hasHeader ? firstRow.map(h=>h.trim().toLowerCase().replace(/\s+/g,"")) : COLS;
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const parsed = dataLines.map(line=>{
      const vals = line.split(/[\t,]/);
      const obj: any = {};
      headers.forEach((h, i) => {
        const v = vals[i]?.trim();
        if (!v || v === "" || v === "null") return;
        const numFields = ["glucosebefore","glucoseafter","carbsgrams","fibergrams","insulinunits","timedifferenceminutes"];
        const key = COLS.find(c=>c.toLowerCase()===h)||h;
        obj[key] = numFields.includes(h) ? Number(v) : v;
      });
      // Validate required fields
      if (!obj.glucoseBefore||!obj.carbsGrams||!obj.insulinUnits) return null;
      if (!obj.mealType||!["FAST_CARBS","HIGH_FAT","HIGH_PROTEIN","BALANCED"].includes(obj.mealType)) obj.mealType="BALANCED";
      return obj;
    }).filter(Boolean);

    setPreview(parsed);
  }

  async function importEntries() {
    if (preview.length === 0) { setError("Nothing to import."); return; }
    setLoading(true); setError("");
    try {
      const r = await apiFetch<{imported:number}>("/entries/batch", { method:"POST", body:JSON.stringify({entries:preview}) });
      setResult(r);
      setRaw(""); setPreview([]);
      onLogged?.();
    } catch { setError("Import failed. Check data format."); }
    finally { setLoading(false); }
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16,maxWidth:800}}>
      <Card style={{padding:22}}>
        <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Import Data</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginBottom:16}}>
          Paste CSV or tab-separated data. Columns: <span style={{fontFamily:"monospace",fontSize:11,color:ACCENT}}>{COLS.slice(0,6).join(", ")}…</span>
        </div>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginBottom:8,letterSpacing:"0.08em"}}>REQUIRED: glucoseBefore, carbsGrams, insulinUnits</div>
        <textarea
          value={raw}
          onChange={e=>setRaw(e.target.value)}
          placeholder={"glucoseBefore\tcarbsGrams\tinsulinUnits\tmealType\n110\t60\t2\tBALANCED\n95\t45\t1.5\tFAST_CARBS"}
          style={{...inp,height:140,fontFamily:"monospace",fontSize:12,fontWeight:400,resize:"vertical",lineHeight:1.6}}
        />
        <div style={{display:"flex",gap:10,marginTop:12}}>
          <button onClick={parseCSV} style={{padding:"10px 22px",background:"rgba(255,255,255,0.08)",border:"none",borderRadius:10,color:"white",fontSize:13,fontWeight:600,cursor:"pointer"}}>Parse & Preview</button>
          {preview.length>0&&(
            <button onClick={importEntries} disabled={loading} style={{padding:"10px 22px",background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`,border:"none",borderRadius:10,color:"white",fontSize:13,fontWeight:700,cursor:"pointer",opacity:loading?0.6:1}}>
              {loading?`Importing…`:`Import ${preview.length} entries`}
            </button>
          )}
        </div>
        {error&&<div style={{marginTop:10,fontSize:12,color:PINK}}>{error}</div>}
        {result&&<div style={{marginTop:10,fontSize:13,color:GREEN,fontWeight:600}}>✓ Imported {result.imported} entries successfully</div>}
      </Card>

      {preview.length>0&&(
        <Card>
          <div style={{padding:"12px 18px",borderBottom:`1px solid ${BORDER}`,fontSize:13,fontWeight:600}}>Preview — {preview.length} entries</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
              {["BG","Carbs","Fiber","Insulin","Type","Description"].map(h=>(
                <th key={h} style={{padding:"8px 16px",textAlign:"left",fontSize:9,color:"rgba(255,255,255,0.3)",fontWeight:500,letterSpacing:"0.08em"}}>{h.toUpperCase()}</th>
              ))}
            </tr></thead>
            <tbody>
              {preview.slice(0,8).map((e,i)=>(
                <tr key={i} style={{borderBottom:i<Math.min(preview.length,8)-1?`1px solid rgba(255,255,255,0.03)`:"none"}}>
                  <td style={{padding:"9px 16px",fontSize:12,fontWeight:600,color:e.glucoseBefore>140?ORANGE:e.glucoseBefore<80?PINK:"rgba(255,255,255,0.85)"}}>{e.glucoseBefore}</td>
                  <td style={{padding:"9px 16px",fontSize:12,color:"rgba(255,255,255,0.7)"}}>{e.carbsGrams}g</td>
                  <td style={{padding:"9px 16px",fontSize:12,color:"rgba(255,255,255,0.5)"}}>{e.fiberGrams!=null?`${e.fiberGrams}g`:"—"}</td>
                  <td style={{padding:"9px 16px",fontSize:12,color:"rgba(255,255,255,0.7)"}}>{e.insulinUnits}u</td>
                  <td style={{padding:"9px 16px"}}><span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:`${pillColors[e.mealType as MealTypeKey]?.[0]||"rgba(255,255,255,0.1)"}`,color:pillColors[e.mealType as MealTypeKey]?.[1]||"white",fontWeight:600}}>{e.mealType}</span></td>
                  <td style={{padding:"9px 16px",fontSize:11,color:"rgba(255,255,255,0.4)",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.mealDescription||"—"}</td>
                </tr>
              ))}
              {preview.length>8&&<tr><td colSpan={6} style={{padding:"8px 16px",fontSize:11,color:"rgba(255,255,255,0.3)",textAlign:"center"}}>…and {preview.length-8} more</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ─── MOBILE DASHBOARD ────────────────────────────────────────────
// ─── MOBILE ENTRY LOG ─────────────────────────────────────────────
function MobileEntryLog() {
  const [entries,setEntries]=useState<Entry[]>([]);
  const [loading,setLoading]=useState(true);
  const [expandedId,setExpandedId]=useState<number|null>(null);
  const [deleting,setDeleting]=useState<number|null>(null);

  useEffect(()=>{
    apiFetch<{entries:Entry[],total:number}>("/entries?limit=60").then(d=>setEntries(d.entries)).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  async function deleteEntry(id:number){
    setDeleting(id);
    try{
      await apiFetch(`/entries/${id}`,{method:"DELETE"});
      setEntries(prev=>prev.filter(e=>e.id!==id));
      setExpandedId(null);
    }catch{}
    setDeleting(null);
  }

  if(loading) return <Spinner/>;
  if(!entries.length) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:180,color:"rgba(255,255,255,0.2)",fontSize:13}}>No entries yet</div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {entries.map(e=>{
        const meta=e.mealType?MEAL_TYPE_META[e.mealType as MealTypeKey]:null;
        const ev=evalStyle(e.evaluation);
        const isExpanded=expandedId===e.id;
        const netCarbs=e.fiberGrams!=null?Math.max(0,e.carbsGrams-e.fiberGrams):null;
        const icr=e.insulinUnits>0?((netCarbs??e.carbsGrams)/e.insulinUnits):null;
        const ts=new Date(e.timestamp).toLocaleDateString(undefined,{month:"short",day:"numeric"});
        return (
          <div key={e.id} style={{background:SURFACE,border:`1px solid ${isExpanded?ACCENT+"33":BORDER}`,borderRadius:14,overflow:"hidden",transition:"border-color 0.2s"}}>
            {/* collapsed header */}
            <div onClick={()=>setExpandedId(isExpanded?null:e.id)} style={{padding:"13px 16px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  {meta&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:99,fontWeight:700,background:`${meta.color}18`,color:meta.color,letterSpacing:"0.07em",flexShrink:0}}>{meta.label.toUpperCase()}</span>}
                  <span style={{fontSize:10,color:"rgba(255,255,255,0.28)"}}>{ts}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:15,fontWeight:700,color:e.glucoseBefore>140?ORANGE:e.glucoseBefore<80?PINK:"rgba(255,255,255,0.9)"}}>{e.glucoseBefore}<span style={{fontSize:9,fontWeight:400,color:"rgba(255,255,255,0.3)",marginLeft:2}}>mg/dL</span></span>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{e.carbsGrams}g</span>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.4)"}}>{e.insulinUnits}u</span>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                <span style={{fontSize:10,padding:"3px 9px",borderRadius:99,fontWeight:700,background:`${ev.color}18`,color:ev.color}}>{ev.label}</span>
                <span style={{fontSize:13,color:"rgba(255,255,255,0.18)",display:"inline-block",transition:"transform 0.2s",transform:isExpanded?"rotate(90deg)":"rotate(0deg)"}}>›</span>
              </div>
            </div>
            {/* expanded details */}
            {isExpanded&&(
              <div style={{borderTop:`1px solid ${ACCENT}1A`,padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
                <div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",fontWeight:600,marginBottom:6}}>MEAL</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",lineHeight:1.55,fontStyle:e.mealDescription?"normal":"italic"}}>{e.mealDescription||"No description recorded."}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",fontWeight:600,marginBottom:8}}>MACROS & DOSING</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
                    {[
                      {l:"CARBS",v:`${e.carbsGrams}g`},
                      {l:"FIBER",v:e.fiberGrams!=null?`${e.fiberGrams}g`:"—"},
                      {l:"NET CARBS",v:netCarbs!=null?`${netCarbs}g`:"—"},
                      {l:"INSULIN",v:`${e.insulinUnits}u`,c:ACCENT},
                      {l:"RATIO",v:icr!=null?`1u/${icr.toFixed(0)}g`:"—",c:ACCENT},
                      {l:"CATEGORY",v:meta?.label||"—"},
                    ].map(s=>(
                      <div key={s.l} style={{background:"rgba(255,255,255,0.03)",borderRadius:9,padding:"8px 10px"}}>
                        <div style={{fontSize:8,color:"rgba(255,255,255,0.28)",letterSpacing:"0.08em",marginBottom:3}}>{s.l}</div>
                        <div style={{fontSize:13,fontWeight:700,color:s.c||"rgba(255,255,255,0.8)"}}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",fontWeight:600,marginBottom:8}}>GLUCOSE</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                    {[
                      {l:"BG BEFORE",v:`${e.glucoseBefore}`,u:"mg/dL",c:e.glucoseBefore>140?ORANGE:e.glucoseBefore<80?PINK:GREEN},
                      {l:"BG AFTER",v:e.glucoseAfter!=null?`${e.glucoseAfter}`:"—",u:e.glucoseAfter!=null?"mg/dL":"",c:e.glucoseAfter!=null?(e.glucoseAfter>180?PINK:e.glucoseAfter<70?PINK:GREEN):"rgba(255,255,255,0.3)"},
                      {l:"DELTA",v:e.delta!=null?`${e.delta>0?"+":""}${e.delta.toFixed(0)}`:"—",u:e.delta!=null?"mg/dL":"",c:e.delta!=null?(Math.abs(e.delta)>60?PINK:Math.abs(e.delta)>30?ORANGE:GREEN):"rgba(255,255,255,0.3)"},
                      {l:"TIME GAP",v:e.timeDifferenceMinutes!=null?`${e.timeDifferenceMinutes.toFixed(0)}`:"—",u:e.timeDifferenceMinutes!=null?"min":"",c:"rgba(255,255,255,0.7)"},
                    ].map(s=>(
                      <div key={s.l} style={{background:"rgba(255,255,255,0.03)",borderRadius:9,padding:"9px 10px"}}>
                        <div style={{fontSize:8,color:"rgba(255,255,255,0.28)",letterSpacing:"0.08em",marginBottom:3}}>{s.l}</div>
                        <div style={{fontSize:16,fontWeight:700,color:s.c}}>{s.v}<span style={{fontSize:9,fontWeight:400,color:"rgba(255,255,255,0.3)",marginLeft:2}}>{s.u}</span></div>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={ev2=>{ev2.stopPropagation();deleteEntry(e.id);}}
                  disabled={deleting===e.id}
                  style={{width:"100%",padding:"10px",borderRadius:10,border:`1px solid ${PINK}22`,background:`${PINK}0A`,color:PINK,fontSize:12,fontWeight:600,cursor:"pointer",transition:"background 0.15s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}
                >
                  <span style={{fontSize:13}}>⊗</span>{deleting===e.id?"Deleting…":"Delete entry"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── MOBILE DASHBOARD STAT CARD INFO ──────────────────────────────
const STAT_INFO: Record<string,{headline:string;detail:string;formula:string}> = {
  "Control Score":{headline:"Composite insulin control metric",detail:"Rewards GOOD outcomes and penalises OVERDOSE / UNDERDOSE equally. Ranges 0–100 — higher means more consistent glycemic control across all entries.",formula:"(GOOD − 0.5 × spike − 0.5 × hypo) / total × 100"},
  "Good Rate":{headline:"Post-meal BG in target range",detail:"Share of entries where blood glucose outcome was flagged GOOD. Aim for above 60% to establish a reliable dosing baseline.",formula:"GOOD entries ÷ total entries"},
  "Spike Rate":{headline:"Post-meal glucose too high",detail:"Entries where blood sugar spiked above the upper target. Often signals insufficient insulin dose or too-late injection timing.",formula:"OVERDOSE entries ÷ total entries"},
  "Hypo Rate":{headline:"Post-meal glucose too low",detail:"Entries where blood sugar dropped below the lower target. May indicate excess insulin, incorrect meal estimation, or poor meal timing.",formula:"UNDERDOSE entries ÷ total entries"},
};

function MobileDashboard({email,name:memberName,onSignOut}:{email?:string;name?:string;onSignOut?:()=>void}) {
  const [mobilePage, setMobilePage] = useState<"dashboard"|"log"|"entries"|"recommend"|"settings"|"insights">("dashboard");
  const [stats, setStats] = useState<DashboardStats|null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [flippedStat,setFlippedStat]=useState<string|null>(null);
  const [insightFocus,setInsightFocus]=useState<string|null>(null);
  const [expandedRecentId,setExpandedRecentId]=useState<number|null>(null);

  useEffect(()=>{
    apiFetch<DashboardStats>("/insights/dashboard").then(s=>{setStats(s);}).catch(()=>{});
    apiFetch<{points:TrendPoint[]}>("/insights/glucose-trend").then(d=>setTrend(d.points.slice(0,16).reverse())).catch(()=>{});
  },[]);

  const trendPts = trend.map(p=>p.glucoseBefore).filter(Boolean) as number[];
  const maxG=220, minG=60, W=560, H=90;
  const toY=(g:number)=>H-((g-minG)/(maxG-minG))*H;
  const toX=(i:number)=>(i/(Math.max(trendPts.length-1,1)))*W;
  const pathD=trendPts.map((g,i)=>`${i===0?"M":"L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
  const areaD=pathD+` L ${W} ${H} L 0 ${H} Z`;

  const mobileNavItems = [
    { id:"dashboard" as const, icon:"⊞", label:"Dashboard" },
    { id:"entries" as const, icon:"≡", label:"Entries" },
    { id:"insights" as const, icon:"◈", label:"Insights" },
    { id:"recommend" as const, icon:"⟲", label:"Engine" },
  ];

  const eb = stats?.evaluationBreakdown;
  const total = stats?.totalEntries || 1;

  return (
    <div style={{display:"flex",flexDirection:"column",width:"100%",height:"100%",background:BG,color:"white",fontFamily:"'Inter',system-ui,sans-serif",position:"relative",overflow:"hidden"}}>
      <div
        onClick={()=>setMobilePage(p=>p==="settings"?"dashboard":"settings")}
        style={{padding:"16px 20px 12px",background:mobilePage==="settings"?`rgba(79,110,247,0.08)`:SURFACE,borderBottom:`1px solid ${mobilePage==="settings"?`rgba(79,110,247,0.25)`:BORDER}`,flexShrink:0,cursor:"pointer",transition:"background 0.2s,border-color 0.2s"}}
      >
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <LogoCMark size={30}/>
            <div>
              <div style={{fontSize:17,fontWeight:800,letterSpacing:"-0.02em"}}>Glev</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:1}}>Smart insulin decisions</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontSize:11,padding:"5px 12px",borderRadius:99,background:`${GREEN}18`,color:GREEN,fontWeight:600}}>Live</div>
            <IconProfile active={mobilePage==="settings"}/>
          </div>
        </div>
      </div>

      <div style={{flex:1,overflow:"auto",padding:"16px 16px 90px"}}>
        {mobilePage==="dashboard"&&(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {stats?[
              {label:"Control Score",value:stats.controlScore.toFixed(0),unit:"/100",color:ACCENT,bar:stats.controlScore,sub:`${stats.totalEntries} entries`},
              {label:"Good Rate",value:(stats.goodRate*100).toFixed(1),unit:"%",color:GREEN,bar:stats.goodRate*100,sub:`${eb?.GOOD||0} good`},
              {label:"Spike Rate",value:stats.spikeRate.toFixed(1),unit:"%",color:ORANGE,bar:stats.spikeRate,sub:"Hyperglycemia"},
              {label:"Hypo Rate",value:stats.hypoRate.toFixed(1),unit:"%",color:PINK,bar:stats.hypoRate,sub:"Hypoglycemia"},
            ].map(sc=>{
              const info=STAT_INFO[sc.label];
              const isFlipped=flippedStat===sc.label;
              return (
                <div key={sc.label} onClick={()=>setFlippedStat(f=>f===sc.label?null:sc.label)} style={{perspective:"800px",cursor:"pointer",height:116}}>
                  <div style={{position:"relative",width:"100%",height:"100%",transformStyle:"preserve-3d",transition:"transform 0.5s cubic-bezier(0.4,0.2,0.2,1)",transform:isFlipped?"rotateY(180deg)":"rotateY(0deg)"}}>
                    {/* front */}
                    <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:14,padding:"14px 18px",boxSizing:"border-box",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                        <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",letterSpacing:"0.08em"}}>{sc.label.toUpperCase()}</div>
                        <span style={{fontSize:9,color:"rgba(255,255,255,0.18)"}}>↺</span>
                      </div>
                      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
                        <div style={{display:"flex",alignItems:"flex-end",gap:4}}>
                          <span style={{fontSize:32,fontWeight:800,color:sc.color,letterSpacing:"-0.03em"}}>{sc.value}</span>
                          <span style={{fontSize:13,color:"rgba(255,255,255,0.3)",paddingBottom:3}}>{sc.unit}</span>
                        </div>
                        <span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>{sc.sub}</span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,0.07)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{width:`${Math.min(sc.bar,100)}%`,height:"100%",background:sc.color,borderRadius:99}}/>
                      </div>
                    </div>
                    {/* back */}
                    <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",transform:"rotateY(180deg)",background:`linear-gradient(145deg,${sc.color}12,${SURFACE} 65%)`,border:`1px solid ${sc.color}33`,borderRadius:14,padding:"14px 18px",boxSizing:"border-box",display:"flex",flexDirection:"column",gap:5,justifyContent:"space-between"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{fontSize:10,color:sc.color,fontWeight:700,letterSpacing:"0.06em"}}>{sc.label.toUpperCase()}</div>
                        <span style={{fontSize:9,color:"rgba(255,255,255,0.18)"}}>↺ back</span>
                      </div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.6)",lineHeight:1.45,fontStyle:"italic"}}>{info.headline}</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,0.4)",lineHeight:1.4}}>{info.detail.slice(0,90)}…</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{fontSize:9,color:sc.color,opacity:0.8,fontFamily:"monospace"}}>{info.formula}</div>
                        <button
                          onClick={(e)=>{e.stopPropagation();setInsightFocus(sc.label);setMobilePage("insights");}}
                          style={{fontSize:9,color:sc.color,fontWeight:700,background:"none",border:`1px solid ${sc.color}44`,borderRadius:99,padding:"2px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:3,letterSpacing:"0.04em",flexShrink:0}}
                        >
                          <span>◈</span> full analysis →
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }):(
              <div style={{height:200,display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.2)"}}>Loading…</div>
            )}

            {trendPts.length>0&&(
              <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:14,padding:"16px 18px"}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Glucose Trend</div>
                <svg width="100%" height={H+10} viewBox={`0 0 ${W} ${H+10}`} preserveAspectRatio="none" style={{display:"block"}}>
                  <defs><linearGradient id="mdg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity="0.25"/><stop offset="100%" stopColor={ACCENT} stopOpacity="0"/></linearGradient></defs>
                  <path d={areaD} fill="url(#mdg)"/><path d={pathD} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  {trendPts.map((g,i)=>g>180?<circle key={i} cx={toX(i)} cy={toY(g)} r={4} fill={ORANGE}/>:g<70?<circle key={i} cx={toX(i)} cy={toY(g)} r={4} fill={PINK}/>:null)}
                </svg>
              </div>
            )}

            {eb&&(
              <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:14,padding:"16px 18px"}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Outcomes</div>
                {[{label:"GOOD",count:eb.GOOD,color:GREEN},{label:"UNDERDOSE",count:eb.UNDERDOSE,color:ORANGE},{label:"OVERDOSE",count:eb.OVERDOSE,color:PINK},{label:"CHECK",count:eb.CHECK_CONTEXT,color:"#4B5070"}].map(r=>(
                  <div key={r.label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                    <div style={{width:8,height:8,borderRadius:99,background:r.color,flexShrink:0}}/>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontSize:11,color:"rgba(255,255,255,0.5)",letterSpacing:"0.06em"}}>{r.label}</span>
                        <span style={{fontSize:12,color:r.color,fontWeight:700}}>{r.count}</span>
                      </div>
                      <div style={{height:4,background:"rgba(255,255,255,0.07)",borderRadius:99,overflow:"hidden"}}>
                        <div style={{width:`${(r.count/total)*100}%`,height:"100%",background:r.color,borderRadius:99}}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stats?.recentEntries&&stats.recentEntries.length>0&&(
              <div style={{background:SURFACE,border:`1px solid ${BORDER}`,borderRadius:14,overflow:"hidden"}}>
                <div style={{padding:"14px 18px 12px",borderBottom:`1px solid ${BORDER}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:14,fontWeight:600}}>Recent Entries</div>
                  <span onClick={()=>setMobilePage("entries")} style={{fontSize:11,color:ACCENT,cursor:"pointer"}}>View all →</span>
                </div>
                {stats.recentEntries.slice(0,4).map((e,i)=>{
                  const ev=evalStyle(e.evaluation);
                  const meta=e.mealType?MEAL_TYPE_META[e.mealType as MealTypeKey]:null;
                  const isExp=expandedRecentId===e.id;
                  return (
                    <div key={e.id} style={{borderBottom:i<3?`1px solid rgba(255,255,255,0.04)`:"none"}}>
                      <div onClick={()=>setExpandedRecentId(isExp?null:e.id)} style={{padding:"13px 18px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                            {meta&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:99,fontWeight:700,background:`${meta.color}18`,color:meta.color,letterSpacing:"0.07em",flexShrink:0}}>{meta.label.toUpperCase()}</span>}
                            <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>{new Date(e.timestamp).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:13,fontWeight:700,color:e.glucoseBefore>140?ORANGE:e.glucoseBefore<80?PINK:"rgba(255,255,255,0.85)"}}>{e.glucoseBefore}</span>
                            <span style={{fontSize:10,color:"rgba(255,255,255,0.3)"}}>mg/dL</span>
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                          <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,fontWeight:700,background:`${ev.color}18`,color:ev.color}}>{ev.label}</span>
                          <span style={{fontSize:12,color:"rgba(255,255,255,0.18)",display:"inline-block",transition:"transform 0.2s",transform:isExp?"rotate(90deg)":"rotate(0deg)"}}>›</span>
                        </div>
                      </div>
                      {isExp&&(
                        <div style={{padding:"0 18px 13px",fontSize:12,color:"rgba(255,255,255,0.55)",lineHeight:1.55,fontStyle:e.mealDescription?"normal":"italic",borderTop:`1px solid rgba(255,255,255,0.04)`}}>
                          <div style={{paddingTop:10}}>{e.mealDescription||"No description recorded."}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {mobilePage==="log"&&<LogPage onLogged={()=>setMobilePage("dashboard")}/>}
        {mobilePage==="entries"&&<MobileEntryLog/>}
        {mobilePage==="insights"&&<Insights focusedStat={insightFocus}/>}
        {mobilePage==="recommend"&&<Recommend/>}
        {mobilePage==="settings"&&<ProfilePage email={email} initialName={memberName} onSignOut={()=>{onSignOut?.();}}/>}
      </div>

      <div style={{position:"absolute",bottom:0,left:0,right:0,background:SURFACE,borderTop:`1px solid ${BORDER}`,display:"flex",alignItems:"center",justifyContent:"space-around",padding:"10px 24px 20px",zIndex:10}}>
        {mobileNavItems.map(item=>(
          <button key={item.id} onClick={()=>{setMobilePage(item.id);setInsightFocus(null);}} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",color:mobilePage===item.id?ACCENT:"rgba(255,255,255,0.3)",padding:"4px 12px",borderRadius:10,transition:"all 0.15s",fontSize:20}}>
            <span>{item.icon}</span>
            <span style={{fontSize:9,fontWeight:600,letterSpacing:"0.04em"}}>{item.label.toUpperCase()}</span>
          </button>
        ))}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,marginTop:-20}}>
          <button onClick={()=>setMobilePage("log")} style={{width:56,height:56,borderRadius:99,background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 0 ${mobilePage==="log"?"32px":"20px"} ${ACCENT}${mobilePage==="log"?"88":"55"}`,animation:"micPulse 2.5s ease-in-out infinite",transition:"transform 0.15s"}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="2" width="6" height="11" rx="3" fill="rgba(255,255,255,0.95)"/>
              <path d="M5 10a7 7 0 0 0 14 0" stroke="rgba(255,255,255,0.95)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
              <line x1="12" y1="19" x2="12" y2="22" stroke="rgba(255,255,255,0.95)" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="9" y1="22" x2="15" y2="22" stroke="rgba(255,255,255,0.95)" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
          <span style={{fontSize:9,color:mobilePage==="log"?ACCENT:"rgba(255,255,255,0.3)",fontWeight:600,letterSpacing:"0.04em"}}>LOG</span>
          <style>{`@keyframes micPulse{0%,100%{box-shadow:0 0 20px ${ACCENT}55}50%{box-shadow:0 0 32px ${ACCENT}88,0 0 60px ${ACCENT}33}}`}</style>
        </div>
      </div>
    </div>
  );
}

// ─── Nav SVG Icons ────────────────────────────────────────────────
function IconDashboard({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
}
function IconPlus({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}
function IconList({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2" fill={c} stroke="none"/><circle cx="3.5" cy="12" r="1.2" fill={c} stroke="none"/><circle cx="3.5" cy="18" r="1.2" fill={c} stroke="none"/></svg>;
}
function IconInsights({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 1 4 12.8V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.2A7 7 0 0 1 12 2z"/><path d="M9 21h6"/><path d="M9 18h6"/></svg>;
}
function IconBolt({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
}
function IconMic({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>;
}
function IconUpload({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}

function IconProfile({ active }: { active: boolean }) {
  const c = active ? ACCENT : "rgba(255,255,255,0.45)";
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>;
}

// ─── LAYOUT ──────────────────────────────────────────────────────
const NAV: { id: Page; label: string; Icon: React.ComponentType<{active:boolean}> }[] = [
  { id: "dashboard", label: "Dashboard",  Icon: IconDashboard },
  { id: "log",       label: "Log",        Icon: IconPlus },
  { id: "entries",   label: "Entry Log",  Icon: IconList },
  { id: "insights",  label: "Insights",   Icon: IconInsights },
  { id: "recommend", label: "Glev Engine",Icon: IconBolt },
  { id: "import",    label: "Import Data",Icon: IconUpload },
];

const PAGE_TITLES: Record<Page,string> = {
  dashboard:"Dashboard", log:"Log", entries:"Entry Log",
  insights:"Insights", recommend:"Glev Engine", import:"Import Center", profile:"My Profile",
};

// ─── Profile Page ───────────────────────────────────────────────
function ProfilePage({email,initialName,onSignOut}:{email?:string;initialName?:string;onSignOut:()=>void}) {
  const [name,setName]=useState(initialName||"Member");
  const [notif,setNotif]=useState(true);
  const [targetLow,setTargetLow]=useState("80");
  const [targetHigh,setTargetHigh]=useState("140");
  const [saved,setSaved]=useState(false);
  function save(){setSaved(true);setTimeout(()=>setSaved(false),2000);}
  const Row=({label,children}:{label:string;children:React.ReactNode})=>(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderBottom:`1px solid ${BORDER}`}}>
      <span style={{fontSize:13,color:"rgba(255,255,255,0.5)",fontWeight:500}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:8}}>{children}</div>
    </div>
  );
  const inputStyle:React.CSSProperties={width:80,background:"rgba(255,255,255,0.05)",border:`1px solid rgba(255,255,255,0.1)`,borderRadius:8,padding:"6px 10px",color:"white",fontSize:13,outline:"none",textAlign:"center"};
  return (
    <div style={{maxWidth:560}}>
      {/* Avatar card */}
      <div style={{display:"flex",alignItems:"center",gap:18,padding:"24px",background:SURFACE,borderRadius:16,border:`1px solid ${BORDER}`,marginBottom:24}}>
        <div style={{width:60,height:60,borderRadius:18,background:`linear-gradient(135deg,${ACCENT},#7B93FF)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:700,flexShrink:0,boxShadow:`0 0 20px ${ACCENT}33`}}>
          {name.trim()[0]?.toUpperCase()||"M"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:17,fontWeight:700,marginBottom:3,letterSpacing:"-0.01em"}}>{name||"Member"}</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>{email||"member@glev.app"}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(79,110,247,0.1)",border:"1px solid rgba(79,110,247,0.25)",borderRadius:99,padding:"4px 12px",flexShrink:0}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:ACCENT}}/>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:ACCENT}}>MEMBER</span>
        </div>
      </div>

      {/* Settings card */}
      <div style={{background:SURFACE,borderRadius:16,border:`1px solid ${BORDER}`,padding:"0 20px",marginBottom:20}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",color:"rgba(255,255,255,0.3)",padding:"16px 0 2px"}}>PROFILE</div>
        <Row label="Display name">
          <input value={name} onChange={e=>setName(e.target.value)} style={{...inputStyle,width:160,textAlign:"left"}}/>
        </Row>
        <Row label="Email">
          <span style={{fontSize:13,color:"rgba(255,255,255,0.35)"}}>{email||"member@glev.app"}</span>
        </Row>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",color:"rgba(255,255,255,0.3)",padding:"18px 0 2px"}}>GLUCOSE TARGETS</div>
        <Row label="Target range (mg/dL)">
          <input value={targetLow} onChange={e=>setTargetLow(e.target.value)} style={inputStyle} placeholder="Low"/>
          <span style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>—</span>
          <input value={targetHigh} onChange={e=>setTargetHigh(e.target.value)} style={inputStyle} placeholder="High"/>
        </Row>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",color:"rgba(255,255,255,0.3)",padding:"18px 0 2px"}}>NOTIFICATIONS</div>
        <Row label="Spike & hypo alerts">
          <button onClick={()=>setNotif(v=>!v)} style={{width:44,height:24,borderRadius:99,background:notif?ACCENT:"rgba(255,255,255,0.1)",border:"none",cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:notif?22:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left 0.2s",boxShadow:"0 1px 4px rgba(0,0,0,0.4)"}}/>
          </button>
        </Row>
      </div>

      {/* Actions */}
      <div style={{display:"flex",gap:10}}>
        <button onClick={save} style={{flex:1,padding:"12px",borderRadius:11,background:saved?`${GREEN}22`:`linear-gradient(135deg,${ACCENT},#7B93FF)`,border:saved?`1px solid ${GREEN}44`:"none",color:saved?GREEN:"white",fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.2s",boxShadow:saved?"none":`0 4px 16px ${ACCENT}33`}}>
          {saved?"Saved ✓":"Save Changes"}
        </button>
        <button onClick={onSignOut} style={{padding:"12px 20px",borderRadius:11,background:"rgba(255,45,120,0.08)",border:"1px solid rgba(255,45,120,0.2)",color:PINK,fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

// ─── Login Gate ─────────────────────────────────────────────────
function LoginGate({onEnter,contained}:{onEnter:(email:string,name?:string)=>void;contained?:boolean}) {
  const [mode,setMode]=useState<"signup"|"login">("signup");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [confirm,setConfirm]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setVisible(true),40);return()=>clearTimeout(t);},[]);

  function switchMode(m:"signup"|"login"){setMode(m);setErr("");setPass("");setConfirm("");}

  async function submit(e:React.FormEvent){
    e.preventDefault();
    setErr("");
    if(!email.trim()){setErr("Email is required.");return;}
    if(!pass){setErr("Password is required.");return;}
    if(mode==="signup"){
      if(pass.length<6){setErr("Password must be at least 6 characters.");return;}
      if(pass!==confirm){setErr("Passwords do not match.");return;}
    }
    setLoading(true);
    try{
      const endpoint=mode==="signup"?"/api/auth/signup":"/api/auth/login";
      const body:Record<string,string>={email:email.trim(),password:pass};
      if(mode==="signup"&&name.trim()) body.name=name.trim();
      const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json();
      if(!res.ok){
        if(res.status===409){
          setErr("This email is already registered.");
          // offer switch to login after a moment
          setTimeout(()=>setErr("Email already registered — switch to Sign In below."),0);
        } else {
          setErr(data.error||"Something went wrong.");
        }
        setLoading(false);
        return;
      }
      onEnter(data.member.email, data.member.name||undefined);
    }catch{
      setErr("Network error. Please try again.");
      setLoading(false);
    }
  }

  const inputStyle=(hasErr:boolean):React.CSSProperties=>({
    width:"100%",boxSizing:"border-box",
    background:"rgba(255,255,255,0.04)",
    border:`1px solid ${hasErr?"rgba(255,45,120,0.5)":"rgba(255,255,255,0.1)"}`,
    borderRadius:10,padding:"11px 14px",
    color:"white",fontSize:14,outline:"none",
    marginBottom:14,transition:"border-color 0.2s",
  });

  return (
    <div style={{
      position:contained?"absolute":"fixed",inset:0,zIndex:9999,
      background:"rgba(9,9,11,0.92)",
      backdropFilter:"blur(18px)",
      display:"flex",alignItems:"center",justifyContent:"center",
      opacity:visible?1:0,transition:"opacity 0.35s ease",
      overflowY:contained?"auto":"visible",
    }}>
      <div style={{position:"absolute",width:520,height:520,borderRadius:"50%",background:`radial-gradient(circle,${ACCENT}12 0%,transparent 70%)`,pointerEvents:"none",top:"50%",left:"50%",transform:"translate(-50%,-50%)"}}/>

      <form onSubmit={submit} style={{
        position:"relative",width:contained?340:400,
        background:"#111117",
        border:"1px solid rgba(79,110,247,0.18)",
        borderRadius:22,
        padding:"36px 36px 32px",
        boxShadow:`0 0 0 1px rgba(255,255,255,0.04), 0 32px 80px rgba(0,0,0,0.85), 0 0 60px ${ACCENT}10`,
        display:"flex",flexDirection:"column",
      }}>
        {/* Logo */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:24}}>
          <div style={{marginBottom:12,boxShadow:`0 0 28px ${ACCENT}44`,borderRadius:14}}>
            <LogoCMark size={52}/>
          </div>
          <div style={{fontSize:20,fontWeight:700,letterSpacing:"-0.02em",color:"white",marginBottom:6}}>Glev</div>
          <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(79,110,247,0.1)",border:"1px solid rgba(79,110,247,0.25)",borderRadius:99,padding:"3px 12px"}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:ACCENT}}/>
            <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:ACCENT}}>MEMBERS ONLY</span>
          </div>
        </div>

        {/* Mode toggle tabs */}
        <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:10,padding:3,marginBottom:24,gap:3}}>
          {(["signup","login"] as const).map(m=>(
            <button key={m} type="button" onClick={()=>switchMode(m)} style={{
              flex:1,padding:"8px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,
              background:mode===m?ACCENT:"transparent",
              color:mode===m?"white":"rgba(255,255,255,0.4)",
              transition:"all 0.18s",letterSpacing:"0.01em",
            }}>
              {m==="signup"?"Create Account":"Sign In"}
            </button>
          ))}
        </div>

        {/* Name — signup only */}
        {mode==="signup"&&(
          <>
            <label style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"rgba(255,255,255,0.35)",marginBottom:6}}>NAME (optional)</label>
            <input type="text" value={name} onChange={e=>{setName(e.target.value);setErr("");}} placeholder="Your name" autoFocus style={inputStyle(false)}
              onFocus={e=>(e.target.style.borderColor=`${ACCENT}88`)}
              onBlur={e=>(e.target.style.borderColor="rgba(255,255,255,0.1)")}/>
          </>
        )}

        {/* Email */}
        <label style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"rgba(255,255,255,0.35)",marginBottom:6}}>EMAIL</label>
        <input type="email" value={email} onChange={e=>{setEmail(e.target.value);setErr("");}} placeholder="you@example.com"
          autoFocus={mode==="login"}
          style={inputStyle(!!err&&!email)}
          onFocus={e=>(e.target.style.borderColor=`${ACCENT}88`)}
          onBlur={e=>(e.target.style.borderColor=err&&!email?"rgba(255,45,120,0.5)":"rgba(255,255,255,0.1)")}/>

        {/* Password */}
        <label style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"rgba(255,255,255,0.35)",marginBottom:6}}>PASSWORD{mode==="signup"&&<span style={{color:"rgba(255,255,255,0.2)",fontWeight:400}}> (min 6 chars)</span>}</label>
        <input type="password" value={pass} onChange={e=>{setPass(e.target.value);setErr("");}} placeholder="••••••••"
          style={inputStyle(!!err&&!pass)}
          onFocus={e=>(e.target.style.borderColor=`${ACCENT}88`)}
          onBlur={e=>(e.target.style.borderColor=err&&!pass?"rgba(255,45,120,0.5)":"rgba(255,255,255,0.1)")}/>

        {/* Confirm — signup only */}
        {mode==="signup"&&(
          <>
            <label style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"rgba(255,255,255,0.35)",marginBottom:6}}>CONFIRM PASSWORD</label>
            <input type="password" value={confirm} onChange={e=>{setConfirm(e.target.value);setErr("");}} placeholder="••••••••"
              style={{...inputStyle(!!err&&pass!==confirm&&!!confirm),marginBottom:err?8:20}}
              onFocus={e=>(e.target.style.borderColor=`${ACCENT}88`)}
              onBlur={e=>(e.target.style.borderColor="rgba(255,255,255,0.1)")}/>
          </>
        )}

        {!mode&&<div style={{height:8}}/>}
        {mode==="login"&&<div style={{height:6}}/>}

        {err&&<div style={{fontSize:12,color:PINK,marginBottom:14,textAlign:"center",lineHeight:1.4}}>{err}</div>}

        <button type="submit" disabled={loading} style={{
          width:"100%",padding:"13px",borderRadius:11,
          background:loading?`rgba(79,110,247,0.45)`:`linear-gradient(135deg,${ACCENT},#7B93FF)`,
          border:"none",color:"white",fontSize:14,fontWeight:700,
          cursor:loading?"default":"pointer",letterSpacing:"0.02em",
          boxShadow:loading?"none":`0 4px 20px ${ACCENT}44`,
          transition:"all 0.2s",
        }}>
          {loading?(mode==="signup"?"Creating account…":"Signing in…"):(mode==="signup"?"Create Account":"Sign In")}
        </button>

        <div style={{marginTop:16,fontSize:11,color:"rgba(255,255,255,0.2)",textAlign:"center"}}>
          Access restricted to registered members
        </div>
      </form>
    </div>
  );
}

export function DarkCockpit() {
  const [loggedIn,setLoggedIn]=useState(false);
  const [userEmail,setUserEmail]=useState("");
  const [userName,setUserName]=useState("");
  const [page, setPage] = useState<Page>("dashboard");
  const [view, setView] = useState<"desktop"|"mobile">("desktop");
  const [refresh, setRefresh] = useState(0);
  const [insightFocus, setInsightFocus] = useState<string|null>(null);

  function onLogged() { setRefresh(r=>r+1); setPage("dashboard"); }
  function signOut() { setLoggedIn(false); setUserEmail(""); setUserName(""); setPage("dashboard"); }
  function goInsights(stat: string) { setInsightFocus(stat); setPage("insights"); }

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh",background:BG,color:"white",fontFamily:"'Inter',system-ui,sans-serif"}}>
      {/* View Toggle */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"10px 0",background:"#0C0C10",borderBottom:`1px solid ${BORDER}`,gap:0}}>
        <button onClick={()=>setView("desktop")} style={{padding:"6px 22px",borderRadius:"8px 0 0 8px",background:view==="desktop"?`${ACCENT}22`:"transparent",border:`1px solid ${view==="desktop"?ACCENT:"rgba(255,255,255,0.12)"}`,color:view==="desktop"?ACCENT:"rgba(255,255,255,0.4)",fontSize:12,fontWeight:600,cursor:"pointer",letterSpacing:"0.04em",borderRight:"none",transition:"all 0.15s"}}>▭ Desktop</button>
        <button onClick={()=>setView("mobile")} style={{padding:"6px 22px",borderRadius:"0 8px 8px 0",background:view==="mobile"?`${ACCENT}22`:"transparent",border:`1px solid ${view==="mobile"?ACCENT:"rgba(255,255,255,0.12)"}`,color:view==="mobile"?ACCENT:"rgba(255,255,255,0.4)",fontSize:12,fontWeight:600,cursor:"pointer",letterSpacing:"0.04em",transition:"all 0.15s"}}>▯ Mobile</button>
      </div>

      {view==="desktop" ? (
        <div style={{display:"flex",flex:1,overflow:"hidden",position:"relative"}}>
          {!loggedIn&&<LoginGate onEnter={(e,n)=>{setUserEmail(e);setUserName(n||"");setLoggedIn(true);}}/>}
          {/* Sidebar */}
          <div style={{width:220,background:SURFACE,borderRight:`1px solid ${BORDER}`,display:"flex",flexDirection:"column",padding:"20px 12px",gap:2,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 10px",marginBottom:18}}>
              <LogoCMark size={32}/>
              <div>
                <div style={{fontSize:14,fontWeight:800,letterSpacing:"-0.02em"}}>Glev</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:1}}>Insulin decisions</div>
              </div>
            </div>
            {NAV.map(({ id, label, Icon })=>{
              const active = page === id;
              return (
                <button key={id} onClick={()=>{setPage(id);setInsightFocus(null);}} style={{
                  display:"flex",alignItems:"center",gap:12,
                  padding:"10px 12px",borderRadius:10,border:"none",
                  background: active ? `rgba(79,110,247,0.12)` : "transparent",
                  cursor:"pointer",width:"100%",textAlign:"left",
                  transition:"background 0.15s",
                }}>
                  <Icon active={active}/>
                  <span style={{
                    fontSize:14,fontWeight: active ? 700 : 400,
                    color: active ? "white" : "rgba(255,255,255,0.5)",
                    letterSpacing:"-0.01em",
                  }}>{label}</span>
                  {active && <div style={{marginLeft:"auto",width:3,height:3,borderRadius:99,background:ACCENT}}/>}
                </button>
              );
            })}
            {/* Profile pinned at bottom */}
            <div style={{marginTop:"auto",paddingTop:12,borderTop:`1px solid ${BORDER}`}}>
              {(()=>{const active=page==="profile";return(
                <button onClick={()=>setPage("profile")} style={{
                  display:"flex",alignItems:"center",gap:12,
                  padding:"10px 12px",borderRadius:10,border:"none",
                  background: active?`rgba(79,110,247,0.12)`:"transparent",
                  cursor:"pointer",width:"100%",textAlign:"left",transition:"background 0.15s",
                }}>
                  <IconProfile active={active}/>
                  <span style={{fontSize:14,fontWeight:active?700:400,color:active?"white":"rgba(255,255,255,0.5)",letterSpacing:"-0.01em"}}>My Profile</span>
                  {active&&<div style={{marginLeft:"auto",width:3,height:3,borderRadius:99,background:ACCENT}}/>}
                </button>
              );})()}
            </div>
          </div>

          {/* Main */}
          <div style={{flex:1,padding:"24px 28px",overflow:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
              <div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",letterSpacing:"0.12em",marginBottom:3}}>GLEV — SMART INSULIN DECISIONS</div>
                <h1 style={{fontSize:20,fontWeight:700,margin:0,letterSpacing:"-0.02em"}}>{PAGE_TITLES[page]}</h1>
              </div>
            </div>

            {page==="dashboard"&&<Dashboard key={`dash-${refresh}`} onInsights={goInsights}/>}
            {page==="log"&&<LogPage onLogged={onLogged}/>}
            {page==="entries"&&<EntryLog key={`entries-${refresh}`}/>}
            {page==="insights"&&<Insights key={`insights-${refresh}`} focusedStat={insightFocus}/>}
            {page==="recommend"&&<Recommend/>}
            {page==="import"&&<ImportPage onLogged={onLogged}/>}
            {page==="profile"&&<ProfilePage email={userEmail} initialName={userName} onSignOut={signOut}/>}
          </div>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",alignItems:"flex-start",justifyContent:"center",background:"#050508",padding:"32px 24px 40px"}}>
          <div style={{width:390,height:844,borderRadius:44,overflow:"hidden",position:"relative",boxShadow:`0 0 0 1px rgba(255,255,255,0.12),0 32px 80px rgba(0,0,0,0.8),inset 0 0 0 1px rgba(255,255,255,0.06)`,background:BG,flexShrink:0}}>
            <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:120,height:32,background:"#000",borderRadius:"0 0 18px 18px",zIndex:20}}/>
            {!loggedIn&&<LoginGate contained onEnter={(e,n)=>{setUserEmail(e);setUserName(n||"");setLoggedIn(true);}}/>}
            <div style={{height:44}}/>
            <div style={{height:800,overflow:"hidden"}}>
              <MobileDashboard key={`mobile-${refresh}`} email={userEmail} name={userName} onSignOut={signOut}/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
