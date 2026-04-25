"use client";

import { useState, useEffect } from "react";
import { fetchMeals, classifyMeal, type Meal } from "@/lib/meals";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { logDebug } from "@/lib/debug";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import EngineLogTab from "@/components/EngineLogTab";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

interface Recommendation {
  dose: number;
  confidence: "HIGH"|"MEDIUM"|"LOW";
  source: string;
  reasoning: string;
  carbDose: number;
  correctionDose: number;
  similarMeals: Meal[];
}

/**
 * Append safety / context notes derived from recent insulin & exercise logs.
 * Pure documentation — does not change the dose.
 *  - Basal logged in the last 24h is mentioned for context.
 *  - More than 2 boluses in the last 6h triggers a stacking-risk warning.
 *  - Exercise (cardio or any high-intensity) in the last 4h is flagged.
 */
function safetyNotesFromLogs(
  insulinLogs: InsulinLog[],
  exerciseLogs: ExerciseLog[],
): string[] {
  const now = Date.now();
  const sixHoursAgo  = now - 6  * 3600_000;
  const fourHoursAgo = now - 4  * 3600_000;
  const dayAgo       = now - 24 * 3600_000;
  const notes: string[] = [];

  const recentBolus = insulinLogs.filter(l =>
    l.insulin_type === "bolus" && new Date(l.created_at).getTime() >= sixHoursAgo,
  );
  if (recentBolus.length > 2) {
    const total = Math.round(recentBolus.reduce((s, l) => s + (l.units || 0), 0) * 10) / 10;
    notes.push(`⚠ Stacking-Risiko: ${recentBolus.length} Bolus-Gaben in den letzten 6h (Σ ${total}u). Aktives Insulin könnte sich überlagern — vorsichtig dosieren.`);
  }

  const recentBasal = insulinLogs.filter(l =>
    l.insulin_type === "basal" && new Date(l.created_at).getTime() >= dayAgo,
  );
  if (recentBasal.length > 0) {
    const last = recentBasal[0];
    const hoursAgo = Math.max(0, Math.round((now - new Date(last.created_at).getTime()) / 3600_000));
    notes.push(`Basal-Kontext: zuletzt ${last.units}u ${last.insulin_name || "Basal"} vor ${hoursAgo}h.`);
  }

  const recentExercise = exerciseLogs.filter(l =>
    new Date(l.created_at).getTime() >= fourHoursAgo,
  );
  if (recentExercise.length > 0) {
    const e = recentExercise[0];
    notes.push(`Bewegung: ${e.duration_minutes} min ${e.exercise_type} (${e.intensity}) in den letzten 4h — erhöhte Insulin-Empfindlichkeit möglich.`);
  }

  return notes;
}

function runGlevEngine(
  meals: Meal[],
  currentGlucose: number,
  carbs: number,
  insulinLogs: InsulinLog[] = [],
  exerciseLogs: ExerciseLog[] = [],
): Recommendation {
  const icr = 15, cf = 50, target = 110;
  const carbDose = carbs / icr;
  const correctionDose = Math.max(0, (currentGlucose - target) / cf);
  const formulaDose = Math.round((carbDose + correctionDose) * 10) / 10;

  const similar = meals.filter(m =>
    m.carbs_grams !== null && Math.abs((m.carbs_grams||0) - carbs) <= 12 &&
    m.glucose_before !== null && Math.abs((m.glucose_before||0) - currentGlucose) <= 35 &&
    (m.evaluation === "GOOD") && m.insulin_units
  );

  const safetyNotes = safetyNotesFromLogs(insulinLogs, exerciseLogs);
  const safetySuffix = safetyNotes.length > 0 ? " " + safetyNotes.join(" ") : "";

  if (similar.length >= 3) {
    const avg = Math.round(similar.reduce((s,m)=>s+(m.insulin_units||0),0)/similar.length * 10)/10;
    return {
      dose: avg, confidence:"HIGH", source:"historical",
      reasoning: `Based on ${similar.length} similar past meals with GOOD outcomes (±12g carbs, ±35 mg/dL glucose). Historical average insulin: ${avg}u.${safetySuffix}`,
      carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
      similarMeals: similar.slice(0,5),
    };
  }

  if (similar.length >= 1) {
    const histAvg = similar.reduce((s,m)=>s+(m.insulin_units||0),0)/similar.length;
    const blended = Math.round(((histAvg + formulaDose)/2)*10)/10;
    return {
      dose: blended, confidence:"MEDIUM", source:"blended",
      reasoning: `Blended from ${similar.length} similar meal(s) + ICR formula. Limited historical data — log more meals for higher confidence.${safetySuffix}`,
      carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
      similarMeals: similar,
    };
  }

  return {
    dose: formulaDose, confidence:"LOW", source:"formula",
    reasoning: `No similar historical meals found. Using standard ICR formula: ${carbs}g ÷ ${icr} + ${Math.round(correctionDose*10)/10}u correction.${safetySuffix}`,
    carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
    similarMeals:[],
  };
}

const CONF_COLOR: Record<string, string> = { HIGH:GREEN, MEDIUM:ORANGE, LOW:PINK };

export default function EnginePage() {
  const [tab, setTab]         = useState<"engine"|"log">("engine");
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [insulinLogs, setInsulinLogs] = useState<InsulinLog[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [glucose, setGlucose] = useState("");
  const [carbs, setCarbs]     = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat]         = useState("");
  const [fiber, setFiber]     = useState("");
  const [desc, setDesc]       = useState("");
  const [result, setResult]   = useState<Recommendation|null>(null);
  const [running, setRunning] = useState(false);
  const [cgmPulling, setCgmPulling] = useState(false);

  function handlePullCgm() {
    setCgmPulling(true);
    setTimeout(() => {
      const reading = Math.round(85 + Math.random() * 70);
      setGlucose(String(reading));
      setCgmPulling(false);
      logDebug("ENGINE.CGM_PULL", { reading });
    }, 700);
  }

  useEffect(() => {
    fetchMeals().then(setMeals).catch(console.error).finally(() => setLoading(false));
    // Recent insulin & exercise logs feed the safety-context notes in the
    // Engine recommendation. Failure here is non-fatal — the engine still
    // runs without log context.
    fetchRecentInsulinLogs(7).then(setInsulinLogs).catch(() => setInsulinLogs([]));
    fetchRecentExerciseLogs(7).then(setExerciseLogs).catch(() => setExerciseLogs([]));
  }, []);

  function handleRun() {
    const g = parseFloat(glucose)||110, c = parseFloat(carbs)||0;
    if (!c) return;
    setRunning(true);
    setTimeout(() => {
      const rec = runGlevEngine(meals, g, c, insulinLogs, exerciseLogs);
      setResult(rec);
      setRunning(false);
      logDebug("ENGINE", { input: { glucose: g, carbs: c }, matchedMeals: rec.similarMeals.map(m => ({ id: m.id, carbs: m.carbs_grams, glucose: m.glucose_before, insulin: m.insulin_units })), suggestedDose: rec.dose, confidence: rec.confidence, recentInsulin: insulinLogs.length, recentExercise: exerciseLogs.length });
    }, 600);
  }

  const inp: React.CSSProperties = { background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:10, padding:"11px 14px", color:"#fff", fontSize:14, outline:"none", width:"100%" };
  const card: React.CSSProperties = { background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" };

  return (
    <div style={{ maxWidth:800, margin:"0 auto" }}>
      <div style={{ marginBottom:28 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <div style={{ width:32, height:32, borderRadius:10, background:`${ACCENT}20`, border:`1px solid ${ACCENT}40`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em" }}>Glev Engine</h1>
        </div>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>
          {tab === "engine"
            ? "AI-powered insulin recommendations from your personal dosing history."
            : "Log standalone insulin doses and exercise sessions. Pure documentation — no calculations."}
        </p>
      </div>

      {/* TABS */}
      <div style={{
        display:"inline-flex", gap:4, marginBottom:24,
        background:"#0D0D12", border:`1px solid ${BORDER}`,
        borderRadius:12, padding:4,
      }}>
        {([
          { id:"engine" as const, label:"Engine" },
          { id:"log"    as const, label:"Log" },
        ]).map(t => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding:"8px 18px", borderRadius:8, border:"none",
                background: on ? `${ACCENT}22` : "transparent",
                color:    on ? ACCENT : "rgba(255,255,255,0.55)",
                fontSize:13, fontWeight:700, letterSpacing:"-0.01em",
                cursor:"pointer", transition:"all 0.15s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "engine" && (<>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>
        <div style={card}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Current Conditions</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)" }}>Glucose Before (mg/dL)</label>
                <button onClick={handlePullCgm} disabled={cgmPulling} style={{
                  display:"flex", alignItems:"center", gap:6,
                  padding:"4px 10px", borderRadius:99, border:`1px solid ${ACCENT}40`,
                  background:`${ACCENT}15`, color:ACCENT, fontSize:11, fontWeight:600,
                  cursor: cgmPulling ? "wait" : "pointer",
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {cgmPulling ? "Pulling…" : "Pull CGM"}
                </button>
              </div>
              <input style={inp} type="number" placeholder="e.g. 115" value={glucose} onChange={e => setGlucose(e.target.value)}/>
            </div>
            <div>
              <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Planned Carbs (g)</label>
              <input style={inp} type="number" placeholder="e.g. 60" value={carbs} onChange={e => setCarbs(e.target.value)}/>
            </div>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Meal Details (optional)</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Protein (g)</label>
                <input style={inp} type="number" placeholder="0" value={protein} onChange={e => setProtein(e.target.value)}/>
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Fat (g)</label>
                <input style={inp} type="number" placeholder="0" value={fat} onChange={e => setFat(e.target.value)}/>
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Fiber (g)</label>
                <input style={inp} type="number" placeholder="0" value={fiber} onChange={e => setFiber(e.target.value)}/>
              </div>
            </div>
            <div>
              <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Description</label>
              <input style={inp} placeholder="e.g. pasta with tomato sauce" value={desc} onChange={e => setDesc(e.target.value)}/>
            </div>
          </div>
        </div>
      </div>

      {(() => {
        const gNum = parseFloat(glucose), cNum = parseFloat(carbs), pNum = parseFloat(protein), fNum = parseFloat(fat), fbNum = parseFloat(fiber);
        const allFilled = [gNum, cNum, pNum, fNum, fbNum].every(v => !isNaN(v) && v >= 0) && cNum > 0;
        if (!allFilled) return null;
        const TYPE_DESC: Record<string,string> = {
          FAST_CARBS: "High glycemic load — expect a sharp glucose rise. Consider pre-bolusing 15–20 min before eating.",
          HIGH_PROTEIN: "Protein-dominant — slower digestion, lower spike risk. Watch for delayed glucose rise.",
          HIGH_FAT: "Fat-dominant — significantly delayed absorption. Split-bolus or extended-bolus often appropriate.",
          BALANCED: "Macros are well-balanced — predictable absorption curve. Standard ICR usually works.",
        };
        const cls = classifyMeal(cNum, pNum, fNum);
        const color = TYPE_COLORS[cls as string] || ACCENT;
        return (
          <div style={{
            background:`linear-gradient(135deg, ${color}10, ${color}04)`,
            border:`1px solid ${color}35`, borderRadius:16,
            padding:"18px 22px", marginBottom:20,
            display:"flex", gap:18, alignItems:"flex-start",
          }}>
            <div style={{
              width:42, height:42, borderRadius:12, flexShrink:0,
              background:`${color}20`, border:`1px solid ${color}40`,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v6"/><path d="M5 8h14"/><path d="M5 8l2 13h10l2-13"/>
              </svg>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:6 }}>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:600 }}>Meal Classification</span>
                <span style={{ padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:700, background:`${color}25`, color, border:`1px solid ${color}45`, letterSpacing:"0.04em", textTransform:"uppercase" }}>
                  {TYPE_LABELS[cls]}
                </span>
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)", lineHeight:1.55 }}>{TYPE_DESC[cls]}</div>
              <div style={{ marginTop:10, display:"flex", gap:14, flexWrap:"wrap", fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                <span>Carbs <strong style={{ color:"rgba(255,255,255,0.75)" }}>{cNum}g</strong></span>
                <span>Protein <strong style={{ color:"rgba(255,255,255,0.75)" }}>{pNum}g</strong></span>
                <span>Fat <strong style={{ color:"rgba(255,255,255,0.75)" }}>{fNum}g</strong></span>
                <span>Fiber <strong style={{ color:"rgba(255,255,255,0.75)" }}>{fbNum}g</strong></span>
                <span>Net carbs <strong style={{ color:"rgba(255,255,255,0.75)" }}>{Math.max(0, cNum - fbNum)}g</strong></span>
              </div>
            </div>
          </div>
        );
      })()}

      <button onClick={handleRun} disabled={!carbs || running || loading} style={{
        width:"100%", padding:"16px", borderRadius:14, border:"none",
        background: carbs ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)` : "rgba(255,255,255,0.05)",
        color: carbs ? "#fff" : "rgba(255,255,255,0.2)",
        fontSize:16, fontWeight:700, cursor:carbs?"pointer":"not-allowed",
        boxShadow:carbs?`0 4px 24px ${ACCENT}40`:"none",
        transition:"all 0.2s", marginBottom:24,
      }}>
        {loading ? "Loading data…" : running ? "Analyzing history…" : "Get Recommendation"}
      </button>

      {result && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {/* INPUT SUMMARY */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:6 }}>Input Glucose</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontSize:28, fontWeight:800, color:"#60A5FA", letterSpacing:"-0.02em" }}>{parseFloat(glucose)||110}</span>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>mg/dL</span>
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:4 }}>
                {(parseFloat(glucose)||110) > 140 ? "elevated" : (parseFloat(glucose)||110) < 80 ? "low" : "in target"}
              </div>
            </div>
            <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:6 }}>Input Carbs</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontSize:28, fontWeight:800, color:ORANGE, letterSpacing:"-0.02em" }}>{parseFloat(carbs)||0}</span>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>g</span>
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:4 }}>
                {(parseFloat(carbs)||0) >= 60 ? "high-carb meal" : (parseFloat(carbs)||0) >= 30 ? "moderate" : "light"}
              </div>
            </div>
          </div>

          {/* MAIN RESULT */}
          <div style={{ background:SURFACE, border:`1px solid ${CONF_COLOR[result.confidence]}30`, borderRadius:16, padding:"28px 28px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
              <div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>Recommended Dose</div>
                <div style={{ fontSize:60, fontWeight:900, letterSpacing:"-0.04em", lineHeight:1, color:"#fff" }}>
                  {result.dose}
                  <span style={{ fontSize:20, fontWeight:400, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>units</span>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:8 }}>Confidence</div>
                <span style={{ padding:"8px 20px", borderRadius:99, fontSize:14, fontWeight:700, background:`${CONF_COLOR[result.confidence]}18`, color:CONF_COLOR[result.confidence], border:`1px solid ${CONF_COLOR[result.confidence]}40` }}>
                  {result.confidence}
                </span>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6 }}>
                  {result.source === "historical" ? "Historical data" : result.source === "blended" ? "Blended model" : "ICR formula"}
                </div>
              </div>
            </div>

            <div style={{ marginTop:20, padding:"14px 16px", background:"rgba(0,0,0,0.3)", borderRadius:10 }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:4, letterSpacing:"0.05em", textTransform:"uppercase" }}>Reasoning</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.65)", lineHeight:1.6 }}>{result.reasoning}</div>
            </div>

            <div style={{ marginTop:16, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              {[
                { label:"Carb Dose", val:`${result.carbDose}u`, sub:`${carbs}g ÷ 15 ICR`, color:ORANGE },
                { label:"Correction", val:`+${result.correctionDose}u`, sub:`(BG - 110) ÷ 50`, color:ACCENT },
                { label:"Total", val:`${result.dose}u`, sub:"recommended", color:GREEN },
              ].map(d => (
                <div key={d.label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"12px 14px", textAlign:"center" }}>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:4 }}>{d.label}</div>
                  <div style={{ fontSize:22, fontWeight:800, color:d.color }}>{d.val}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginTop:2 }}>{d.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* SIMILAR MEALS */}
          {result.similarMeals.length > 0 && (
            <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
              <div style={{ padding:"16px 20px", borderBottom:`1px solid ${BORDER}` }}>
                <div style={{ fontSize:13, fontWeight:600 }}>Reference Meals ({result.similarMeals.length})</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:2 }}>Historical meals used in this recommendation</div>
              </div>
              {result.similarMeals.map(m => {
                const date = new Date(m.created_at).toLocaleDateString("en",{month:"short",day:"numeric"});
                return (
                  <div key={m.id} style={{ padding:"12px 20px", borderBottom:`1px solid ${BORDER}`, display:"grid", gridTemplateColumns:"1fr 60px 60px 70px 80px", gap:12, alignItems:"center", fontSize:12 }}>
                    <div style={{ color:"rgba(255,255,255,0.65)" }}>{m.input_text.length>45?m.input_text.slice(0,45)+"…":m.input_text}</div>
                    <div style={{ color:"rgba(255,255,255,0.35)", textAlign:"right" }}>{m.glucose_before}</div>
                    <div style={{ color:"rgba(255,255,255,0.35)", textAlign:"right" }}>{m.carbs_grams}g</div>
                    <div style={{ textAlign:"right" }}>{m.insulin_units}u</div>
                    <div style={{ textAlign:"right" }}><span style={{ padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:700, background:`${GREEN}18`, color:GREEN, border:`1px solid ${GREEN}30` }}>{date}</span></div>
                  </div>
                );
              })}
            </div>
          )}

          {loading && <div style={{ color:"rgba(255,255,255,0.3)", fontSize:12, textAlign:"center" }}>Loading historical data…</div>}

          <div style={{ padding:"14px 18px", background:"rgba(255,255,255,0.03)", borderRadius:12, border:`1px solid ${BORDER}` }}>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", lineHeight:1.6 }}>
              <strong style={{ color:"rgba(255,255,255,0.4)" }}>Important:</strong> Glev Engine provides decision support only. Always consult your endocrinologist before adjusting insulin doses. This tool is not a medical device.
            </div>
          </div>
        </div>
      )}
      </>)}

      {tab === "log" && <EngineLogTab />}
    </div>
  );
}
