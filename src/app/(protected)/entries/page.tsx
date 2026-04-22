"use client";

import { useState, useEffect } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

const EVAL_COLORS: Record<string, string> = { GOOD:GREEN, LOW:ORANGE, HIGH:PINK, SPIKE:"#FF9F0A", OVERDOSE:PINK, UNDERDOSE:ORANGE, CHECK_CONTEXT:ORANGE };
const EVAL_LABELS: Record<string, string> = { GOOD:"Good", LOW:"Under Dose", HIGH:"Over Dose", SPIKE:"Spike", OVERDOSE:"Over Dose", UNDERDOSE:"Under Dose", CHECK_CONTEXT:"Review" };
const TYPE_COLORS: Record<string, string> = { FAST_CARBS:ORANGE, HIGH_PROTEIN:ACCENT, HIGH_FAT:"#FF6B6B", BALANCED:GREEN };

function evC(ev: string|null) { return EVAL_COLORS[ev||""] || "rgba(255,255,255,0.3)"; }
function evL(ev: string|null) { return EVAL_LABELS[ev||""] || ev || "—"; }

const FILTERS = ["All","GOOD","UNDERDOSE","OVERDOSE","SPIKE"];

export default function EntriesPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("All");
  const [search, setSearch]   = useState("");
  const [expanded, setExpanded] = useState<string|null>(null);

  useEffect(() => {
    fetchMeals().then(setMeals).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = meals.filter(m => {
    const matchEval = filter === "All" || m.evaluation === filter
      || (filter==="OVERDOSE" && (m.evaluation==="OVERDOSE"||m.evaluation==="HIGH"))
      || (filter==="UNDERDOSE"  && (m.evaluation==="UNDERDOSE"||m.evaluation==="LOW"));
    const matchSearch = !search || m.input_text.toLowerCase().includes(search.toLowerCase());
    return matchEval && matchSearch;
  });

  const inp: React.CSSProperties = { background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:10, padding:"9px 14px", color:"#fff", fontSize:13, outline:"none" };

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", gap:12, color:"rgba(255,255,255,0.3)" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:20, height:20, border:`2px solid ${ACCENT}`, borderTopColor:"transparent", borderRadius:99, animation:"spin 0.8s linear infinite" }}/>
      Loading entries…
    </div>
  );

  return (
    <div style={{ maxWidth:960, margin:"0 auto" }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Entries</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>{filtered.length} of {meals.length} logged meals. Click a row to expand.</p>
      </div>

      {/* FILTERS + SEARCH */}
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ display:"flex", gap:6 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:"7px 14px", borderRadius:99, border:`1px solid ${filter===f ? ACCENT+"60" : BORDER}`,
              background:filter===f ? `${ACCENT}18` : "transparent",
              color:filter===f ? ACCENT : "rgba(255,255,255,0.4)",
              fontSize:12, fontWeight:filter===f?600:400, cursor:"pointer",
            }}>{f}</button>
          ))}
        </div>
        <input style={{ ...inp, flex:1, minWidth:200 }} placeholder="Search meals…" value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      {/* TABLE */}
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
        {/* Header */}
        <div style={{ display:"grid", gridTemplateColumns:"2fr 70px 70px 70px 100px 16px", gap:12, padding:"12px 20px", borderBottom:`1px solid ${BORDER}`, color:"rgba(255,255,255,0.3)", fontSize:11, letterSpacing:"0.07em", textTransform:"uppercase" }}>
          <span>Meal</span><span style={{textAlign:"right"}}>Glucose</span><span style={{textAlign:"right"}}>Carbs</span><span style={{textAlign:"right"}}>Insulin</span><span style={{textAlign:"center"}}>Result</span><span/>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding:"48px", textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:14 }}>No entries match this filter.</div>
        ) : (
          filtered.map(m => {
            const isOpen = expanded === m.id;
            const ev = m.evaluation;
            const date = new Date(m.created_at);
            const dateStr = date.toLocaleDateString("en", { month:"short", day:"numeric" });
            const timeStr = date.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });
            const totalProt = Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.protein||0),0) : 0;
            const totalFat  = Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fat||0),0) : 0;
            const glucDelta = (m.glucose_after && m.glucose_before) ? m.glucose_after - m.glucose_before : null;
            return (
              <div key={m.id} style={{ borderBottom:`1px solid ${BORDER}` }}>
                {/* Row */}
                <div onClick={() => setExpanded(isOpen ? null : m.id)} style={{ display:"grid", gridTemplateColumns:"2fr 70px 70px 70px 100px 16px", gap:12, padding:"14px 20px", cursor:"pointer", alignItems:"center", transition:"background 0.1s" }}
                  onMouseEnter={e => (e.currentTarget.style.background="rgba(255,255,255,0.02)")}
                  onMouseLeave={e => (e.currentTarget.style.background="transparent")}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, marginBottom:2 }}>{m.input_text.length>50 ? m.input_text.slice(0,50)+"…" : m.input_text}</div>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.28)" }}>{dateStr} · {timeStr}</div>
                  </div>
                  <div style={{ fontSize:13, textAlign:"right" }}>{m.glucose_before ?? "—"}</div>
                  <div style={{ fontSize:13, textAlign:"right" }}>{m.carbs_grams ? `${m.carbs_grams}g` : "—"}</div>
                  <div style={{ fontSize:13, textAlign:"right" }}>{m.insulin_units ? `${m.insulin_units}u` : "—"}</div>
                  <div style={{ textAlign:"center" }}>
                    <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:`${evC(ev)}15`, color:evC(ev), border:`1px solid ${evC(ev)}30`, whiteSpace:"nowrap" }}>
                      {evL(ev)}
                    </span>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" style={{ transform:isOpen?"rotate(180deg)":"rotate(0deg)", transition:"transform 0.2s" }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>

                {/* Expanded panel */}
                {isOpen && (
                  <div style={{ padding:"0 20px 20px", background:"rgba(255,255,255,0.01)" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:10, marginBottom:16 }}>
                      {/* Food breakdown */}
                      <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:12, padding:"14px 16px" }}>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>Food Breakdown</div>
                        {Array.isArray(m.parsed_json) && m.parsed_json.length > 0 ? m.parsed_json.map((f,i) => (
                          <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                            <span style={{ fontSize:12 }}>{f.name}</span>
                            <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)" }}>{f.grams}g · {f.carbs ?? 0}c</span>
                          </div>
                        )) : <div style={{ fontSize:12, color:"rgba(255,255,255,0.2)" }}>No food data</div>}
                      </div>

                      {/* Stats */}
                      <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:12, padding:"14px 16px" }}>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>Glucose & Timing</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          <Stat label="Before" val={m.glucose_before ? `${m.glucose_before} mg/dL` : "—"}/>
                          <Stat label="After"  val={m.glucose_after  ? `${m.glucose_after} mg/dL`  : "—"}/>
                          <Stat label="Delta"  val={glucDelta !== null ? `${glucDelta > 0 ? "+" : ""}${glucDelta} mg/dL` : "—"} color={glucDelta !== null ? (Math.abs(glucDelta) < 50 ? GREEN : glucDelta > 0 ? ORANGE : PINK) : undefined}/>
                          <Stat label="Time"   val={timeStr}/>
                        </div>
                      </div>

                      {/* Macros & Classification */}
                      <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:12, padding:"14px 16px" }}>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>Macros & Class.</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          <Stat label="Carbs"    val={`${m.carbs_grams ?? 0}g`}/>
                          <Stat label="Protein"  val={`${totalProt}g`}/>
                          <Stat label="Fat"      val={`${totalFat}g`}/>
                          {m.meal_type && (
                            <div style={{ marginTop:4 }}>
                              <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:`${TYPE_COLORS[m.meal_type]||GREEN}18`, color:TYPE_COLORS[m.meal_type]||GREEN, border:`1px solid ${TYPE_COLORS[m.meal_type]||GREEN}30` }}>
                                {m.meal_type.replace("_"," ")}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Stat({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between" }}>
      <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>{label}</span>
      <span style={{ fontSize:12, fontWeight:500, color:color||"rgba(255,255,255,0.75)" }}>{val}</span>
    </div>
  );
}
