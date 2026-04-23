"use client";

import { useState, useEffect } from "react";
import { fetchMeals, deleteMeal, seedMealsIfEmpty, type Meal } from "@/lib/meals";

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
  const [deleting, setDeleting] = useState<string|null>(null);

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

  async function handleDelete(id: string) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteMeal(id);
      setMeals(ms => ms.filter(m => m.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally {
      setDeleting(null);
    }
  }

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
      <style>{`
        .entry-header { grid-template-columns: minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,1.1fr) auto auto; }
        @media (max-width: 640px) {
          .entry-header { grid-template-columns: minmax(0,1.5fr) minmax(0,0.7fr) auto auto; gap: 10px; padding: 12px 14px !important; }
          .entry-cat-cell { display: none !important; }
        }
      `}</style>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Entry Log</h1>
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

      {/* CARD STACK */}
      {filtered.length === 0 ? (
        <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"48px", textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:14 }}>No entries match this filter.</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {filtered.map(m => {
            const isOpen = expanded === m.id;
            const ev = m.evaluation;
            const date = new Date(m.created_at);
            const dateStr = date.toLocaleDateString("en", { month:"short", day:"numeric" }).replace(/^(\w+) (\d+)$/, "$2. $1.");
            const totalProt = m.protein_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.protein||0),0) : 0);
            const totalFat  = m.fat_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fat||0),0) : 0);
            const totalFiber = m.fiber_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fiber||0),0) : 0);
            const carbs = m.carbs_grams ?? 0;
            const netCarbs = Math.max(0, carbs - totalFiber);
            const icr = m.insulin_units && m.insulin_units > 0 ? netCarbs / m.insulin_units : null;
            const glucDelta = (m.glucose_after && m.glucose_before) ? m.glucose_after - m.glucose_before : null;
            const bgC = m.glucose_before ? (m.glucose_before > 140 ? ORANGE : m.glucose_before < 80 ? PINK : GREEN) : "rgba(255,255,255,0.7)";
            const afterC = m.glucose_after ? (m.glucose_after > 180 || m.glucose_after < 70 ? PINK : GREEN) : "rgba(255,255,255,0.3)";
            const deltaC = glucDelta !== null ? (Math.abs(glucDelta) < 50 ? GREEN : glucDelta > 0 ? ORANGE : PINK) : "rgba(255,255,255,0.3)";
            const evColor = evC(ev);

            const MiniCard = ({ l, v, c }: { l: string; v: string; c?: string }) => (
              <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:14, fontWeight:700, color:c || "rgba(255,255,255,0.9)", letterSpacing:"-0.01em" }}>{v}</div>
              </div>
            );

            const catColor = m.meal_type ? (TYPE_COLORS[m.meal_type] || GREEN) : null;
            const catLabel = m.meal_type ? m.meal_type.replace("_"," ").toLowerCase() : null;

            return (
              <div key={m.id} className="entry-row" style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
                {/* Collapsed header */}
                <div onClick={() => setExpanded(isOpen ? null : m.id)} className="entry-header" style={{ padding:"14px 16px", cursor:"pointer", display:"grid", gap:14, alignItems:"center" }}>
                  {/* Col 1: date + BG + insulin */}
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:4 }}>{dateStr}</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
                      <span style={{ fontSize:18, fontWeight:800, color:bgC, letterSpacing:"-0.02em" }}>{m.glucose_before ?? "—"}<span style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:500, marginLeft:3 }}>mg/dL</span></span>
                      <span style={{ fontSize:12, fontWeight:700, color: m.insulin_units ? ACCENT : "rgba(255,255,255,0.3)" }}>{m.insulin_units ? `${m.insulin_units}u` : "—"}</span>
                    </div>
                  </div>
                  {/* Col 2: carbs */}
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>CARBS</div>
                    <div style={{ fontSize:14, fontWeight:700, color:m.carbs_grams ? ORANGE : "rgba(255,255,255,0.3)", letterSpacing:"-0.01em" }}>
                      {m.carbs_grams ? `${m.carbs_grams}g` : "—"}
                    </div>
                  </div>
                  {/* Col 3: classification chip — desktop only (hidden on mobile via CSS) */}
                  <div className="entry-cat-cell" style={{ minWidth:0, display:"flex", justifyContent:"center" }}>
                    {catLabel && catColor ? (
                      <span style={{ padding:"5px 12px", borderRadius:99, fontSize:10, fontWeight:700, background:`${catColor}18`, color:catColor, border:`1px solid ${catColor}30`, whiteSpace:"nowrap", letterSpacing:"0.05em", textTransform:"uppercase" }}>
                        {catLabel}
                      </span>
                    ) : (
                      <span style={{ fontSize:11, color:"rgba(255,255,255,0.25)" }}>—</span>
                    )}
                  </div>
                  {/* Col 4: evaluation badge */}
                  <span style={{ padding:"5px 12px", borderRadius:99, fontSize:10, fontWeight:700, background:`${evColor}18`, color:evColor, border:`1px solid ${evColor}30`, whiteSpace:"nowrap", letterSpacing:"0.05em", textTransform:"uppercase" }}>
                    {evL(ev)}
                  </span>
                  {/* Col 5: chevron */}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:isOpen?"rotate(90deg)":"rotate(0deg)", transition:"transform 0.2s", flexShrink:0 }}>
                    <polyline points="9 6 15 12 9 18"/>
                  </svg>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div style={{ padding:"4px 16px 16px", borderTop:`1px solid rgba(255,255,255,0.04)`, display:"flex", flexDirection:"column", gap:14 }}>
                    {/* CLASSIFICATION — highlighted chip card */}
                    {catLabel && catColor && (
                      <div style={{ marginTop:14, background:`${catColor}10`, border:`1px solid ${catColor}40`, borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                        <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>MEAL CLASSIFICATION</div>
                        <span style={{ padding:"6px 14px", borderRadius:99, fontSize:11, fontWeight:700, background:catColor, color:"#0A0A0F", whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                          {catLabel}
                        </span>
                      </div>
                    )}

                    {/* MEAL */}
                    {m.input_text && (
                      <div>
                        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, margin:"4px 0 6px" }}>MEAL</div>
                        <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.55 }}>{m.input_text}</div>
                      </div>
                    )}

                    {/* MACROS & DOSING — 3-col grid of mini-cards */}
                    <div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>MACROS &amp; DOSING</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                        <MiniCard l="CARBS" v={`${carbs}g`} c={ORANGE}/>
                        <MiniCard l="PROTEIN" v={totalProt > 0 ? `${totalProt}g` : "—"} c="#3B82F6"/>
                        <MiniCard l="FAT" v={totalFat > 0 ? `${totalFat}g` : "—"} c="#A855F7"/>
                        <MiniCard l="FIBER" v={totalFiber > 0 ? `${totalFiber}g` : "—"}/>
                        <MiniCard l="NET CARBS" v={netCarbs > 0 ? `${netCarbs}g` : "—"} c={GREEN}/>
                        <MiniCard l="CALORIES" v={(() => { const cals = m.calories ?? Math.round(carbs*4 + totalProt*4 + totalFat*9); return cals > 0 ? `${cals} kcal` : "—"; })()} c="#A78BFA"/>
                        <MiniCard l="INSULIN" v={`${m.insulin_units ?? 0}u`} c={ACCENT}/>
                        <MiniCard l="RATIO" v={icr ? `1u/${icr.toFixed(0)}g` : "—"} c={ACCENT}/>
                        <MiniCard l="CATEGORY" v={m.meal_type ? m.meal_type.replace("_"," ").toLowerCase() : "—"} c={m.meal_type ? (TYPE_COLORS[m.meal_type] || GREEN) : undefined}/>
                      </div>
                    </div>

                    {/* GLUCOSE — 2-col grid of mini-cards */}
                    <div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>GLUCOSE</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
                        <MiniCard l="BG BEFORE" v={m.glucose_before ? `${m.glucose_before} mg/dL` : "—"} c={bgC}/>
                        <MiniCard l="BG AFTER" v={m.glucose_after ? `${m.glucose_after} mg/dL` : "—"} c={afterC}/>
                        <MiniCard l="DELTA" v={glucDelta !== null ? `${glucDelta > 0 ? "+" : ""}${glucDelta} mg/dL` : "—"} c={deltaC}/>
                        <MiniCard l="TIME GAP" v="—"/>
                      </div>
                    </div>

                    {/* DELETE */}
                    <button onClick={() => handleDelete(m.id)} disabled={deleting === m.id} style={{ marginTop:4, padding:"12px", borderRadius:10, border:`1px solid ${PINK}40`, background:`${PINK}08`, color:PINK, fontSize:13, fontWeight:600, cursor:deleting === m.id ? "wait" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, letterSpacing:"0.02em" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                      {deleting === m.id ? "Deleting…" : "Delete entry"}
                    </button>
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

function Stat({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between" }}>
      <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>{label}</span>
      <span style={{ fontSize:12, fontWeight:500, color:color||"rgba(255,255,255,0.75)" }}>{val}</span>
    </div>
  );
}
