"use client";

import { useState, useEffect, useMemo } from "react";
import { fetchMeals, deleteMeal, updateMealReadings, type Meal } from "@/lib/meals";
import { fetchRecentInsulinLogs, deleteInsulinLog, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, deleteExerciseLog, type ExerciseLog } from "@/lib/exercise";
import { evaluateExercise, exerciseTypeLabel, patternNote, interimMessage, finalMessage, deltaColor } from "@/lib/exerciseEval";
import { TYPE_COLORS, TYPE_LABELS, TYPE_EXPLAIN, getEvalColor, getEvalLabel, getEvalExplain } from "@/lib/mealTypes";
import { lifecycleFor, STATE_LABELS, type OutcomeState } from "@/lib/engine/lifecycle";
import MealEntryCardCollapsed from "@/components/MealEntryCardCollapsed";
import ManualEntryModal from "@/components/ManualEntryModal";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const PURPLE="#A78BFA", BLUE="#3B82F6";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

function evC(ev: string|null) { return getEvalColor(ev); }
function evL(ev: string|null) { return getEvalLabel(ev); }

const FILTERS = ["All","Bolus","Basal","Exercise","GOOD","UNDERDOSE","OVERDOSE","SPIKE"] as const;
type FilterKey = typeof FILTERS[number];

type Row =
  | { kind: "meal"; id: string; ts: string; data: Meal }
  | { kind: "bolus"; id: string; ts: string; data: InsulinLog }
  | { kind: "basal"; id: string; ts: string; data: InsulinLog }
  | { kind: "exercise"; id: string; ts: string; data: ExerciseLog };

export default function EntriesPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [insulin, setInsulin] = useState<InsulinLog[]>([]);
  const [exercise, setExercise] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<FilterKey>("All");
  const [search, setSearch]   = useState("");
  const [expanded, setExpanded] = useState<string|null>(null);
  const [deleting, setDeleting] = useState<string|null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  // Restore filter from sessionStorage (per-tab persistence) on first mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem("glev:entries-filter");
    if (saved && (FILTERS as readonly string[]).includes(saved)) {
      setFilter(saved as FilterKey);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("glev:entries-filter", filter);
  }, [filter]);

  // Meal rows expand directly into the full detail body (no intermediate
  // "light" summary). Bolus / basal / exercise rows have their own
  // collapsed→expanded body rendered by their respective row components.
  function expandRow(id: string | null) {
    setExpanded(id);
  }

  useEffect(() => {
    let cancelled = false;
    async function load(initial: boolean) {
      try {
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
    window.addEventListener("glev:meals-updated", onUpdated);
    window.addEventListener("glev:insulin-updated", onUpdated);
    window.addEventListener("glev:exercise-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("glev:meals-updated", onUpdated);
      window.removeEventListener("glev:insulin-updated", onUpdated);
      window.removeEventListener("glev:exercise-updated", onUpdated);
    };
  }, []);

  // Deep-link via URL hash: /entries#<id> auto-expands to the full view so
  // "View full entry →" from the dashboard lands the user on the right row.
  useEffect(() => {
    const id = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!id || meals.length === 0) return;
    if (meals.some(m => m.id === id)) {
      setExpanded(id);
      requestAnimationFrame(() => {
        document.getElementById(`entry-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [meals]);

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

  async function handleDeleteInsulin(id: string) {
    if (!confirm("Delete this insulin entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteInsulinLog(id);
      setInsulin(xs => xs.filter(x => x.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally { setDeleting(null); }
  }

  async function handleDeleteExercise(id: string) {
    if (!confirm("Delete this exercise entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteExerciseLog(id);
      setExercise(xs => xs.filter(x => x.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally { setDeleting(null); }
  }

  // Merge meal/bolus/basal/exercise into a single timeline (newest first).
  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      ...meals.map<Row>(m => ({ kind: "meal", id: m.id, ts: m.meal_time ?? m.created_at, data: m })),
      ...insulin.map<Row>(i => ({ kind: i.insulin_type, id: i.id, ts: i.created_at, data: i })),
      ...exercise.map<Row>(x => ({ kind: "exercise", id: x.id, ts: x.created_at, data: x })),
    ];
    all.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return all;
  }, [meals, insulin, exercise]);

  const isOutcomeFilter = filter === "GOOD" || filter === "UNDERDOSE" || filter === "OVERDOSE" || filter === "SPIKE";

  const filtered = rows.filter(r => {
    // Type filters
    if (filter === "Bolus" && r.kind !== "bolus") return false;
    if (filter === "Basal" && r.kind !== "basal") return false;
    if (filter === "Exercise" && r.kind !== "exercise") return false;
    // Outcome filters — only meal rows carry outcomes
    if (isOutcomeFilter) {
      if (r.kind !== "meal") return false;
      const ev = r.data.evaluation;
      const ok = ev === filter
        || (filter === "OVERDOSE" && ev === "HIGH")
        || (filter === "UNDERDOSE" && ev === "LOW");
      if (!ok) return false;
    }
    // Search across whatever text the row carries
    if (search) {
      const q = search.toLowerCase();
      let txt = "";
      if (r.kind === "meal") txt = r.data.input_text ?? "";
      else if (r.kind === "bolus" || r.kind === "basal") txt = `${r.data.insulin_name} ${r.data.notes ?? ""}`;
      else if (r.kind === "exercise") txt = `${r.data.exercise_type} ${r.data.notes ?? ""}`;
      if (!txt.toLowerCase().includes(q)) return false;
    }
    return true;
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
      <style>{``}</style>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Entry Log</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>{filtered.length} of {rows.length} logged entries. Click a row to expand.</p>
      </div>

      {/* MANUAL ENTRY CTA */}
      <div style={{ marginBottom:14 }}>
        <button
          onClick={() => setManualOpen(true)}
          style={{
            width:"100%",
            padding:"12px 16px",
            borderRadius:12,
            border:`1px dashed ${ACCENT}55`,
            background:`${ACCENT}10`,
            color:ACCENT,
            fontSize:13, fontWeight:700, letterSpacing:"-0.01em",
            cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            transition:"all 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${ACCENT}1f`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = `${ACCENT}10`; }}
        >
          <span style={{ fontSize:18, lineHeight:1, marginTop:-1 }}>+</span>
          Mahlzeit
        </button>
      </div>

      {/* FILTERS + SEARCH */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
        <style>{`
          .glev-filter-bar { display:flex; gap:6px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; padding-bottom:2px; }
          .glev-filter-bar::-webkit-scrollbar { display:none; }
          .glev-filter-bar > button { flex-shrink:0; }
        `}</style>
        <div className="glev-filter-bar">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:"7px 14px", borderRadius:99, border:`1px solid ${filter===f ? ACCENT+"60" : BORDER}`,
              background:filter===f ? `${ACCENT}18` : "transparent",
              color:filter===f ? ACCENT : "rgba(255,255,255,0.4)",
              fontSize:12, fontWeight:filter===f?600:400, cursor:"pointer", whiteSpace:"nowrap",
            }}>{f}</button>
          ))}
        </div>
        <input style={{ ...inp, width:"100%", boxSizing:"border-box" }} placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      {/* CARD STACK */}
      {filtered.length === 0 ? (
        <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"48px", textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:14 }}>No entries match this filter.</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {filtered.map(r => {
            // BOLUS / BASAL row — insulin event (no outcome).
            if (r.kind === "bolus" || r.kind === "basal") {
              const i = r.data;
              const isOpen = expanded === i.id;
              return (
                <InsulinRowCard
                  key={i.id}
                  log={i}
                  kind={r.kind}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : i.id)}
                  onDelete={() => handleDeleteInsulin(i.id)}
                  deleting={deleting === i.id}
                />
              );
            }
            // EXERCISE row.
            if (r.kind === "exercise") {
              const x = r.data;
              const isOpen = expanded === x.id;
              return (
                <ExerciseRowCard
                  key={x.id}
                  log={x}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : x.id)}
                  onDelete={() => handleDeleteExercise(x.id)}
                  deleting={deleting === x.id}
                />
              );
            }
            // MEAL row — original rendering preserved below.
            const m = r.data;
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
            const catLabel = m.meal_type ? (TYPE_LABELS[m.meal_type] || m.meal_type.replace("_"," ")) : null;
            const catExplain = m.meal_type ? (TYPE_EXPLAIN[m.meal_type] || "") : "";

            return (
              <div key={m.id} id={`entry-${m.id}`} className="entry-row" style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
                {/* Header — collapsed shows summary; expanded shows only date + time */}
                {!isOpen ? (
                  <MealEntryCardCollapsed meal={m} onClick={() => expandRow(m.id)}/>
                ) : (
                  <div onClick={() => expandRow(null)} style={{ padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", letterSpacing:"0.02em" }}>
                      {dateStr}
                      <span style={{ color:"rgba(255,255,255,0.25)", margin:"0 8px" }}>·</span>
                      {date.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" })}
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:"rotate(90deg)", transition:"transform 0.2s", flexShrink:0 }}>
                      <polyline points="9 6 15 12 9 18"/>
                    </svg>
                  </div>
                )}

                {/* Full entry body — shown directly on expand (no light intermediate). */}
                {isOpen && (
                  <div style={{ padding:"4px 16px 16px", borderTop:`1px solid rgba(255,255,255,0.04)`, display:"flex", flexDirection:"column", gap:14 }}>
                    {/* LIFECYCLE — pending / provisional / final */}
                    <LifecycleBlock
                      meal={m}
                      onUpdated={(patch) => setMeals(ms => ms.map(x => x.id === m.id ? { ...x, ...patch } : x))}
                    />
                    {/* OUTCOME — highlighted card */}
                    {ev && (
                      <div style={{ marginTop:14, background:`${evColor}10`, border:`1px solid ${evColor}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                          <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>OUTCOME</div>
                          <span style={{ padding:"6px 14px", borderRadius:99, fontSize:11, fontWeight:700, background:evColor, color:"#0A0A0F", whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                            {evL(ev)}
                          </span>
                        </div>
                        {getEvalExplain(ev) && (
                          <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.5 }}>{getEvalExplain(ev)}</div>
                        )}
                      </div>
                    )}

                    {/* CLASSIFICATION — highlighted card with explanation */}
                    {catLabel && catColor && (
                      <div style={{ background:`${catColor}10`, border:`1px solid ${catColor}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                          <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>MEAL CLASSIFICATION</div>
                          <span style={{ padding:"6px 14px", borderRadius:99, fontSize:11, fontWeight:700, background:catColor, color:"#0A0A0F", whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                            {catLabel}
                          </span>
                        </div>
                        {catExplain && (
                          <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.5 }}>{catExplain}</div>
                        )}
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

      <ManualEntryModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={(meal) => {
          // Insert into the visible list and respect the user's chosen meal
          // time when sorting (most recent first by created_at).
          setMeals((prev) => {
            const next = [meal, ...prev];
            next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            return next;
          });
        }}
      />
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

function stateColor(s: OutcomeState) {
  if (s === "pending")     return "#A78BFA";
  if (s === "provisional") return ORANGE;
  return GREEN;
}

function LifecycleBlock({ meal, onUpdated }: { meal: Meal; onUpdated: (patch: Partial<Meal>) => void }) {
  const lc = lifecycleFor(meal);
  const c = stateColor(lc.state);
  const [bg1h, setBg1h] = useState<string>(meal.bg_1h?.toString() ?? "");
  const [bg2h, setBg2h] = useState<string>(meal.bg_2h?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  // Show 1h input from 30 min onwards (so user can record an early reading);
  // show 2h input from 90 min onwards.
  const show1h = lc.ageMinutes >= 30;
  const show2h = lc.ageMinutes >= 90;

  async function save(field: "bg1h" | "bg2h") {
    const raw = (field === "bg1h" ? bg1h : bg2h).trim();
    const n = raw === "" ? null : Number(raw);
    if (n != null && (!Number.isFinite(n) || n < 30 || n > 600)) {
      setErr("Enter a glucose value between 30 and 600 mg/dL.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const result = await updateMealReadings(meal.id, { [field]: n } as { bg1h?: number | null; bg2h?: number | null });
      const now = new Date().toISOString();
      // Optimistic local update — applies even when the column fell back to
      // glucose_after, so the UI reflects the new value immediately.
      if (field === "bg1h") {
        // Only persist locally if the new column was actually written.
        if (result.applied.includes("bg_1h")) {
          onUpdated({ bg_1h: n, bg_1h_at: n != null ? now : null });
        }
      } else {
        onUpdated(
          result.applied.includes("bg_2h")
            ? { bg_2h: n, bg_2h_at: n != null ? now : null }
            : { bg_2h: n, bg_2h_at: n != null ? now : null, glucose_after: n }
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save reading.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop:14, background:`${c}10`, border:`1px solid ${c}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>OUTCOME STATE</div>
        <span style={{ padding:"6px 14px", borderRadius:99, fontSize:11, fontWeight:700, background:c, color:"#0A0A0F", letterSpacing:"0.04em", textTransform:"uppercase" }}>
          {STATE_LABELS[lc.state]}
        </span>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.65)", lineHeight:1.5 }}>{lc.reasoning}</div>
      {(lc.delta1 != null || lc.delta2 != null) && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:2 }}>
          <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600 }}>Δ 1H</div>
            <div style={{ fontSize:13, fontWeight:700, color: lc.delta1 != null ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)" }}>
              {lc.delta1 != null ? `${lc.delta1 > 0 ? "+" : ""}${lc.delta1} mg/dL` : "—"}
              {lc.speed1 != null && <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>({lc.speed1.toFixed(2)}/min)</span>}
            </div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600 }}>Δ 2H</div>
            <div style={{ fontSize:13, fontWeight:700, color: lc.delta2 != null ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)" }}>
              {lc.delta2 != null ? `${lc.delta2 > 0 ? "+" : ""}${lc.delta2} mg/dL` : "—"}
              {lc.speed2 != null && <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>({lc.speed2.toFixed(2)}/min)</span>}
            </div>
          </div>
        </div>
      )}
      {(show1h || show2h) && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:4 }}>
          {show1h && (
            <ReadingInput label="1h reading" value={bg1h} onChange={setBg1h} onSave={() => save("bg1h")} busy={busy} placeholder={meal.bg_1h?.toString() ?? "mg/dL"} />
          )}
          {show2h && (
            <ReadingInput label="2h reading" value={bg2h} onChange={setBg2h} onSave={() => save("bg2h")} busy={busy} placeholder={meal.bg_2h?.toString() ?? "mg/dL"} />
          )}
        </div>
      )}
      {err && <div style={{ fontSize:11, color:PINK }}>{err}</div>}
    </div>
  );
}

function ReadingInput({ label, value, onChange, onSave, busy, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; onSave: () => void; busy: boolean; placeholder: string;
}) {
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600 }}>{label.toUpperCase()}</div>
      <div style={{ display:"flex", gap:6 }}>
        <input
          type="number" inputMode="numeric" min={30} max={600}
          value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSave(); } }}
          style={{ flex:1, minWidth:0, padding:"6px 8px", borderRadius:6, border:`1px solid ${BORDER}`, background:"rgba(0,0,0,0.3)", color:"rgba(255,255,255,0.9)", fontSize:13, fontWeight:600 }}
        />
        <button
          onClick={onSave} disabled={busy}
          style={{ padding:"6px 10px", borderRadius:6, border:`1px solid ${ACCENT}40`, background:`${ACCENT}18`, color:ACCENT, fontSize:11, fontWeight:700, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Non-meal row cards. Layout mirrors MealEntryCardCollapsed
// (When · Type · Dose|Duration · TypeName) but without an outcome pill,
// and with a small inline expansion showing notes + delete.
// ─────────────────────────────────────────────────────────────────────────

const INSULIN_ACCENT = ACCENT;
const BASAL_ACCENT   = "#A78BFA";
const EXERCISE_ACCENT = "#22C55E";

function NonMealRow({
  isOpen, onToggle, onDelete, deleting, accent, badge, dateStr, timeStr,
  primaryLabel, primaryValue, primaryColor,
  secondaryLabel, secondaryValue, secondaryColor, secondaryMono,
  expandedDetails,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  accent: string;
  badge: string;
  dateStr: string;
  timeStr: string;
  primaryLabel: string;
  primaryValue: string;
  primaryColor: string;
  secondaryLabel: string;
  secondaryValue: string;
  /** Optional override — defaults to neutral white. Used by the bolus/basal
   *  rows where the secondary column carries the DOSE and should keep its
   *  accent + mono treatment after the BRAND/DOSE swap. */
  secondaryColor?: string;
  secondaryMono?: boolean;
  expandedDetails: React.ReactNode;
}) {
  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
      {!isOpen ? (
        <div onClick={onToggle} className="glev-mec" style={{
          padding:"14px 16px", cursor:"pointer", alignItems:"center",
          display:"grid", gap:14,
          gridTemplateColumns:"1fr 1fr 1fr 1fr 96px",
        }}>
          <style>{`
            @media (max-width: 720px) {
              .glev-mec { grid-template-columns: 1fr 1fr 1fr 1fr !important; gap: 10px !important; }
              .glev-mec .glev-mec-eval { display:none !important; }
            }
            @media (max-width: 380px) {
              .glev-mec { gap: 8px !important; }
            }
          `}</style>
          {/* Col 1: Date + Time */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>When</div>
            <div style={{ fontSize:13, fontWeight:600, color:"rgba(255,255,255,0.85)", letterSpacing:"-0.01em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", fontFamily:"var(--font-mono)" }}>
              {dateStr}
              <span style={{ color:"rgba(255,255,255,0.35)", fontWeight:400, marginLeft:6 }}>{timeStr}</span>
            </div>
          </div>
          {/* Col 2: Kind badge */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>Type</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
              <span style={{ width:7, height:7, borderRadius:99, background:accent, opacity:0.85, flexShrink:0 }}/>
              <span style={{ fontSize:12, fontWeight:700, color:accent, letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{badge}</span>
            </div>
          </div>
          {/* Col 3: Primary metric (Dose / Duration) */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{primaryLabel}</div>
            <div style={{ fontSize:14, fontWeight:700, color:primaryColor, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{primaryValue}</div>
          </div>
          {/* Col 4: Secondary — neutral by default; bolus/basal pass an
              accent + mono override so DOSE keeps its prominent styling. */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{secondaryLabel}</div>
            <div
              title={secondaryValue}
              style={{
                fontSize: secondaryMono ? 14 : 13,
                fontWeight: secondaryMono ? 700 : 600,
                color: secondaryColor || "rgba(255,255,255,0.8)",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontFamily: secondaryMono ? "var(--font-mono)" : undefined,
              }}
            >
              {secondaryValue}
            </div>
          </div>
          {/* Col 5: chevron */}
          <span className="glev-mec-eval" style={{
            justifySelf:"end", padding:"5px 10px", borderRadius:99, fontSize:10, fontWeight:700,
            background:`${accent}18`, color:accent, border:`1px solid ${accent}30`,
            whiteSpace:"nowrap", letterSpacing:"0.05em", textTransform:"uppercase",
          }}>{badge}</span>
        </div>
      ) : (
        <div onClick={onToggle} style={{ padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", letterSpacing:"0.02em" }}>
            {dateStr}
            <span style={{ color:"rgba(255,255,255,0.25)", margin:"0 8px" }}>·</span>
            {timeStr}
            <span style={{ color:accent, fontWeight:700, marginLeft:10, letterSpacing:"0.04em" }}>{badge}</span>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:"rotate(90deg)", flexShrink:0 }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        </div>
      )}

      {isOpen && (
        <div style={{ padding:"4px 16px 16px", borderTop:`1px solid rgba(255,255,255,0.04)`, display:"flex", flexDirection:"column", gap:12 }}>
          {expandedDetails}
          <button onClick={onDelete} disabled={deleting} style={{
            marginTop:4, padding:"12px", borderRadius:10, border:`1px solid ${PINK}40`,
            background:`${PINK}08`, color:PINK, fontSize:13, fontWeight:600,
            cursor:deleting ? "wait" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, letterSpacing:"0.02em",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            {deleting ? "Deleting…" : "Delete entry"}
          </button>
        </div>
      )}
    </div>
  );
}

function InsulinRowCard({ log, kind, isOpen, onToggle, onDelete, deleting }: {
  log: InsulinLog; kind: "bolus" | "basal";
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
}) {
  const d = new Date(log.created_at);
  const dateStr = d.toLocaleDateString("en", { month:"short", day:"numeric" });
  const timeStr = d.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });
  const accent = kind === "bolus" ? INSULIN_ACCENT : BASAL_ACCENT;
  const badge  = kind === "bolus" ? "BOLUS" : "BASAL";
  return (
    <NonMealRow
      isOpen={isOpen}
      onToggle={onToggle}
      onDelete={onDelete}
      deleting={deleting}
      accent={accent}
      badge={badge}
      dateStr={dateStr}
      timeStr={timeStr}
      // Order requested by the user: WHEN · TYPE(dot) · BRAND · DOSE · badge.
      // → BRAND occupies the primary slot (col 3, neutral text), DOSE occupies
      //   the secondary slot (col 4) with an accent + mono override so it
      //   stays visually prominent.
      primaryLabel="Brand"
      primaryValue={log.insulin_name || (kind === "bolus" ? "rapid-acting" : "long-acting")}
      primaryColor="rgba(255,255,255,0.85)"
      secondaryLabel="Dose"
      secondaryValue={`${log.units}u`}
      secondaryColor={accent}
      secondaryMono
      expandedDetails={
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
          <Detail label="DOSE" value={`${log.units} u`} color={accent}/>
          <Detail label="INSULIN" value={log.insulin_name || "—"}/>
          <Detail label="GLUCOSE AT LOG" value={log.cgm_glucose_at_log != null ? `${log.cgm_glucose_at_log} mg/dL` : "—"}/>
          <Detail label="WHEN" value={`${dateStr} · ${timeStr}`}/>
          {/* Post-fetch glucose values — bolus shows 1h/2h, basal shows 12h/24h.
              Null until the CGM job ticker resolves them; "Pending" until then. */}
          {kind === "bolus" ? (
            <>
              <Detail label="1H POST" value={log.glucose_after_1h != null ? `${log.glucose_after_1h} mg/dL` : "Pending"} color={log.glucose_after_1h != null ? undefined : "rgba(255,255,255,0.4)"}/>
              <Detail label="2H POST" value={log.glucose_after_2h != null ? `${log.glucose_after_2h} mg/dL` : "Pending"} color={log.glucose_after_2h != null ? undefined : "rgba(255,255,255,0.4)"}/>
            </>
          ) : (
            <>
              <Detail label="12H POST" value={log.glucose_after_12h != null ? `${log.glucose_after_12h} mg/dL` : "Pending"} color={log.glucose_after_12h != null ? undefined : "rgba(255,255,255,0.4)"}/>
              <Detail label="24H POST" value={log.glucose_after_24h != null ? `${log.glucose_after_24h} mg/dL` : "Pending"} color={log.glucose_after_24h != null ? undefined : "rgba(255,255,255,0.4)"}/>
            </>
          )}
          {log.notes && (
            <div style={{ gridColumn:"1 / -1", background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>NOTES</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}
        </div>
      }
    />
  );
}

function ExerciseRowCard({ log, isOpen, onToggle, onDelete, deleting }: {
  log: ExerciseLog;
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
}) {
  const start = new Date(log.created_at);
  const end   = new Date(start.getTime() + log.duration_minutes * 60_000);
  const dateStr = start.toLocaleDateString("en", { month:"short", day:"numeric" });
  const timeStr = start.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });
  // End-side date is computed independently so workouts that cross
  // midnight (e.g. start 23:50, run 30 min) display the next day's
  // date for ENDED instead of duplicating the start date.
  const endDateStr = end.toLocaleDateString("en", { month:"short", day:"numeric" });
  const endTimeStr = end.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });

  const accent  = EXERCISE_ACCENT;
  const typeLbl = exerciseTypeLabel(log.exercise_type);
  const evalInfo = evaluateExercise(log);
  const badgeColor = evalInfo.color;

  // Glucose deltas (Before → AtEnd, Before → +1h).
  const before  = numOrNull(log.cgm_glucose_at_log);
  const atEnd   = numOrNull(log.glucose_at_end);
  const after1h = numOrNull(log.glucose_after_1h);
  const dEnd    = before != null && atEnd   != null ? Math.round(atEnd   - before) : null;
  const d1h     = before != null && after1h != null ? Math.round(after1h - before) : null;

  // Expected fetch times for "Pending · expected hh:mm".
  const expectAtEnd = end;
  const expect1h    = new Date(end.getTime() + 60 * 60_000);

  return (
    <NonMealRow
      isOpen={isOpen}
      onToggle={onToggle}
      onDelete={onDelete}
      deleting={deleting}
      accent={badgeColor}
      badge={evalInfo.label}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel="Duration"
      primaryValue={`${log.duration_minutes}m`}
      primaryColor={accent}
      secondaryLabel="Type"
      secondaryValue={typeLbl}
      expandedDetails={
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* 1) Session details ------------------------------------ */}
          <ExPanel title="SESSION DETAILS">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label="TYPE" value={typeLbl}/>
              <Detail label="DURATION" value={`${log.duration_minutes} min`} color={accent}/>
              <Detail label="INTENSITY" value={intensityLabel(log.intensity)}/>
              <Detail label="STARTED" value={`${dateStr} · ${timeStr}`}/>
              <Detail label="ENDED" value={`${endDateStr} · ${endTimeStr}`}/>
            </div>
          </ExPanel>

          {/* 2) Glucose tracking ----------------------------------- */}
          <ExPanel title="GLUCOSE TRACKING">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              <Detail
                label="BG BEFORE"
                value={before != null ? `${Math.round(before)} mg/dL` : "—"}
              />
              <Detail
                label="BG AT END"
                value={atEnd != null ? `${Math.round(atEnd)} mg/dL` : pendingLabel(expectAtEnd)}
                color={atEnd != null ? undefined : "rgba(255,255,255,0.4)"}
              />
              <Detail
                label="BG +1H"
                value={after1h != null ? `${Math.round(after1h)} mg/dL` : pendingLabel(expect1h)}
                color={after1h != null ? undefined : "rgba(255,255,255,0.4)"}
              />
            </div>
            {/* Coloured deltas — only show once both endpoints exist. */}
            {(dEnd != null || d1h != null) && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:8 }}>
                <DeltaPill label="Δ BEFORE → AT END" delta={dEnd}/>
                <DeltaPill label="Δ BEFORE → +1H"    delta={d1h}/>
              </div>
            )}
          </ExPanel>

          {/* 3) Evaluation panel ----------------------------------- */}
          <ExPanel title="EVALUATION">
            <EvalBlock
              heading="POST-WORKOUT CHECK"
              unlocked={atEnd != null}
              body={interimMessage(log) || "Waiting for the at-end glucose reading…"}
              color={evalInfo.color}
              outcomeLabel={atEnd != null ? evalInfo.label : null}
            />
            <div style={{ height:8 }}/>
            <EvalBlock
              heading="1H OUTCOME"
              unlocked={after1h != null}
              body={finalMessage(log) || "Waiting for the +1h glucose reading…"}
              color={evalInfo.color}
              outcomeLabel={after1h != null ? evalInfo.label : null}
            />
          </ExPanel>

          {/* 4) Pattern note --------------------------------------- */}
          <ExPanel title="PATTERN NOTE">
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.78)", lineHeight:1.55 }}>
              {patternNote(log.exercise_type)}
            </div>
          </ExPanel>

          {log.notes && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>NOTES</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}

          {/* Disclaimer — last item before the inherited Delete button. */}
          <div style={{
            fontSize:11, color:"rgba(255,255,255,0.35)",
            textAlign:"center", letterSpacing:"0.02em", lineHeight:1.5,
            paddingTop:2,
          }}>
            For reference only — always consult your care team.
          </div>
        </div>
      }
    />
  );
}

// ──────────────── helpers used by the exercise expanded view ────────────────

function numOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// 3 h matches EXERCISE_NO_DATA_AFTER_MS / EXERCISE_ABANDON_AFTER_MS.
const EXERCISE_NO_DATA_AFTER_MS = 3 * 60 * 60 * 1000;

/** Map the stored intensity token to the spec's display wording.
 *  DB column still stores "medium" (legacy CHECK constraint), but the
 *  spec calls for "moderate" in user-facing copy. */
function intensityLabel(v: string): string {
  if (v === "medium") return "Moderate";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function pendingLabel(expectedAt: Date): string {
  // Once the CGM job's 3 h window has elapsed, the job is finalised
  // as 'skipped' server-side. Mirror that exact wording in the UI
  // so the displayed state matches the backend job status.
  if (Date.now() - expectedAt.getTime() > EXERCISE_NO_DATA_AFTER_MS) {
    return "Skipped";
  }
  const hh = expectedAt.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });
  return `Pending · expected ${hh}`;
}

/** Section wrapper used inside the exercise expanded view. */
function ExPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background:"rgba(255,255,255,0.015)",
      border:`1px solid ${BORDER}`,
      borderRadius:12,
      padding:"12px 14px",
    }}>
      <div style={{
        fontSize:10, fontWeight:700, letterSpacing:"0.1em",
        color:"rgba(255,255,255,0.45)", marginBottom:10,
      }}>{title}</div>
      {children}
    </div>
  );
}

function DeltaPill({ label, delta }: { label: string; delta: number | null }) {
  const color = deltaColor(delta);
  const text  = delta == null
    ? "—"
    : delta === 0
      ? "0 mg/dL"
      : `${delta > 0 ? "+" : ""}${delta} mg/dL`;
  return (
    <div style={{
      background:"rgba(255,255,255,0.02)",
      border:`1px solid ${BORDER}`,
      borderRadius:10, padding:"10px 12px",
    }}>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{text}</div>
    </div>
  );
}

function EvalBlock({ heading, unlocked, body, color, outcomeLabel }: {
  heading: string;
  unlocked: boolean;
  body: string;
  color: string;
  outcomeLabel: string | null;
}) {
  const border = unlocked ? `${color}40` : BORDER;
  const bg     = unlocked ? `${color}10` : "rgba(255,255,255,0.02)";
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: "10px 12px",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{
          fontSize:9, fontWeight:700, letterSpacing:"0.1em",
          color: unlocked ? color : "rgba(255,255,255,0.35)",
        }}>{heading}</span>
        {unlocked && outcomeLabel && (
          <span style={{
            fontSize:9, fontWeight:700, letterSpacing:"0.08em",
            color, padding:"2px 8px", borderRadius:99,
            border:`1px solid ${color}40`, background:`${color}15`,
          }}>{outcomeLabel}</span>
        )}
      </div>
      <div style={{
        fontSize:13, lineHeight:1.5,
        color: unlocked ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
      }}>{body}</div>
    </div>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color: color || "rgba(255,255,255,0.9)", letterSpacing:"-0.01em" }}>{value}</div>
    </div>
  );
}
