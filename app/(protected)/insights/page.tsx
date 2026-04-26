"use client";

import React, { useState, useEffect, useId } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import { useCardOrder } from "@/lib/cardOrder";
import { parseDbTs } from "@/lib/time";

/** Default top-to-bottom order — mirrors the homepage hero phone mockup
 *  (`InsightsScreen()` in `components/AppMockupPhone.tsx`) 1:1. */
const INSIGHTS_DEFAULT_ORDER = [
  "time-in-range",
  "gmi-a1c",
  "glucose-trend",
  "meal-evaluation",
];

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";
const HIGH_YELLOW = "#FFD166";

const WEEKDAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const EVAL_NORM = (ev: string|null) => {
  if (!ev) return "GOOD";
  if (ev==="OVERDOSE"||ev==="HIGH") return "HIGH";
  if (ev==="UNDERDOSE"||ev==="LOW") return "LOW";
  return ev;
};

export default function InsightsPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMeals().then(setMeals).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", gap:12, color:"rgba(255,255,255,0.3)" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:20, height:20, border:`2px solid ${ACCENT}`, borderTopColor:"transparent", borderRadius:99, animation:"spin 0.8s linear infinite" }}/>
      Loading insights…
    </div>
  );

  const total = meals.length;
  if (total === 0) return (
    <div style={{ maxWidth:480, margin:"0 auto" }}>
      <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:8 }}>Insights</h1>
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"48px", textAlign:"center", color:"rgba(255,255,255,0.25)", fontSize:14 }}>Log at least 5 meals to see insights.</div>
    </div>
  );

  const now = Date.now();
  const oneWeekMs = 7 * 86400000;
  const wkAgo  = now - oneWeekMs;
  const wk2Ago = now - 2 * oneWeekMs;
  const last7 = meals.filter(m => now - parseDbTs(m.created_at) <= oneWeekMs);

  // ── Time in Range buckets (consensus 70–180 mg/dL band) ──
  const last7Bg = last7.filter(m => m.glucose_before != null).map(m => m.glucose_before as number);
  const prev7Bg = meals.filter(m => {
    const t = parseDbTs(m.created_at);
    return t > wk2Ago && t <= wkAgo && m.glucose_before != null;
  }).map(m => m.glucose_before as number);

  const bucket = (arr: number[]) => {
    const t = arr.length || 1;
    return {
      vlow: Math.round((arr.filter(g => g < 54).length / t) * 100),
      lo:   Math.round((arr.filter(g => g >= 54 && g < 70).length / t) * 100),
      inR:  Math.round((arr.filter(g => g >= 70 && g <= 180).length / t) * 100),
      hi:   Math.round((arr.filter(g => g > 180).length / t) * 100),
      n: arr.length,
    };
  };
  const b7  = bucket(last7Bg);
  const bP7 = bucket(prev7Bg);
  const tirDelta = b7.inR - bP7.inR;

  // ── Avg BG + GMI (Bergenstal 2018: GMI% = 3.31 + 0.02392·avgBG) ──
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const last7Avg = avg(last7Bg);
  const prev7Avg = avg(prev7Bg);
  const bgDelta  = (last7Avg != null && prev7Avg != null) ? Math.round(last7Avg - prev7Avg) : null;
  const gmi      = last7Avg != null ? +(3.31 + 0.02392 * last7Avg).toFixed(1) : null;
  const prevGmi  = prev7Avg != null ? +(3.31 + 0.02392 * prev7Avg).toFixed(1) : null;
  const gmiDelta = (gmi != null && prevGmi != null) ? +(gmi - prevGmi).toFixed(1) : null;

  // ── 7-day trend: daily avg pre-meal glucose, oldest → newest ──
  const trendDays: { label: string; avg: number | null }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now - i * 86400000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = dayStart.getTime() + 86400000;
    const dayBgs = meals
      .filter(m => {
        const t = parseDbTs(m.created_at);
        return t >= dayStart.getTime() && t < dayEnd && m.glucose_before != null;
      })
      .map(m => m.glucose_before as number);
    trendDays.push({
      label: WEEKDAY_SHORT[dayStart.getDay()],
      avg: dayBgs.length ? dayBgs.reduce((a, b) => a + b, 0) / dayBgs.length : null,
    });
  }
  // Forward-fill missing days so the line stays continuous; if the very
  // first day has no data, fall back to the overall avg (or 100 mg/dL).
  let lastVal: number | null = null;
  const firstFallback = last7Avg ?? 100;
  const trendValues: number[] = trendDays.map(d => {
    if (d.avg != null) { lastVal = d.avg; return d.avg; }
    return lastVal ?? firstFallback;
  });

  // ── Meal evaluation distribution ──
  const evals = last7
    .map(m => EVAL_NORM(m.evaluation))
    .filter(e => e === "GOOD" || e === "SPIKE" || e === "HIGH" || e === "LOW");
  const goodN  = evals.filter(e => e === "GOOD").length;
  const spikeN = evals.filter(e => e === "SPIKE" || e === "HIGH").length;
  const lowN   = evals.filter(e => e === "LOW").length;
  const totalN = goodN + spikeN + lowN;
  const evalPct = (n: number) => totalN > 0 ? Math.round((n / totalN) * 100) : 0;
  const evalRows = [
    { label:"On target", count:goodN,  color:GREEN,  pct:evalPct(goodN)  },
    { label:"Spiked",    count:spikeN, color:ORANGE, pct:evalPct(spikeN) },
    { label:"Low risk",  count:lowN,   color:PINK,   pct:evalPct(lowN)   },
  ];

  // ─────────────────────────────────────────────────────────────────
  // Card definitions — each one matches the mockup phone's
  // `InsightsScreen()` proportions exactly (12px×14px padding, 9px
  // uppercase labels, 36px / 24px hero numbers, height-12 stacked bars,
  // height-36 sparkline, height-6 evaluation bars).
  // ─────────────────────────────────────────────────────────────────
  const items: SortableItem[] = [
    {
      id: "time-in-range",
      node: (
        <FlipCard
          accent={GREEN}
          back={
            <FlipBack
              title="Time in Range"
              accent={GREEN}
              paragraphs={[
                "Time in Range is the share of pre-meal glucose readings inside the 70–180 mg/dL consensus target band for adults with type 1 diabetes.",
                "Buckets follow the consensus recommendations: Very low (<54), Low (54–69), In range (70–180), High (>180). Spending more time in range is consistently linked to better long-term outcomes.",
                `Computed from ${b7.n} pre-meal reading${b7.n === 1 ? "" : "s"} in the last 7 days. The delta vs the prior 7 days reflects week-over-week movement.`,
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <CardLabel text="Time in range · 7d"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>70–180 mg/dL</div>
          </div>
          {b7.n === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:11 }}>
              Log meals with pre-meal glucose to see your time-in-range.
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
                <div style={{ fontSize:36, fontWeight:800, color:GREEN, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                  {b7.inR}
                </div>
                <div style={{ fontSize:14, color:GREEN, fontWeight:700 }}>%</div>
                {prev7Bg.length > 0 && (
                  <div style={{ marginLeft:"auto", fontSize:9, color: tirDelta >= 0 ? GREEN : ORANGE, fontWeight:600 }}>
                    {tirDelta >= 0 ? "+" : ""}{tirDelta} vs prev wk
                  </div>
                )}
              </div>
              <div style={{ display:"flex", height:12, borderRadius:99, overflow:"hidden", background:"rgba(255,255,255,0.04)" }}>
                {b7.vlow > 0 && <div style={{ width:`${b7.vlow}%`, background:PINK }}/>}
                {b7.lo   > 0 && <div style={{ width:`${b7.lo}%`,   background:ORANGE }}/>}
                {b7.inR  > 0 && <div style={{ width:`${b7.inR}%`,  background:GREEN }}/>}
                {b7.hi   > 0 && <div style={{ width:`${b7.hi}%`,   background:HIGH_YELLOW }}/>}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:8, color:"rgba(255,255,255,0.4)", flexWrap:"wrap", gap:4 }}>
                <span style={{ color:PINK }}>● V.low {b7.vlow}%</span>
                <span style={{ color:ORANGE }}>● Low {b7.lo}%</span>
                <span style={{ color:GREEN }}>● In {b7.inR}%</span>
                <span style={{ color:HIGH_YELLOW }}>● High {b7.hi}%</span>
              </div>
            </>
          )}
        </FlipCard>
      ),
    },
    {
      // Two side-by-side stat cards — kept under the legacy "gmi-a1c"
      // ID so persisted card-orders from earlier versions keep working.
      id: "gmi-a1c",
      node: (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          <FlipCard
            accent={ACCENT}
            back={
              <FlipBack
                title="Average Glucose"
                accent={ACCENT}
                paragraphs={[
                  "Mean pre-meal glucose across the last 7 days, calculated only from meals with a logged pre-meal reading.",
                  "Lower values reflect better fasting and overnight control. The delta vs the prior 7 days surfaces week-over-week movement.",
                  `Computed from ${last7Bg.length} reading${last7Bg.length === 1 ? "" : "s"} in the last 7 days.`,
                ]}
              />
            }
          >
            <CardLabel text="Avg BG"/>
            {last7Avg == null ? (
              <div style={{ fontSize:24, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
                  <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                    {Math.round(last7Avg)}
                  </div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>mg/dL</div>
                </div>
                {bgDelta != null && (
                  <div style={{ fontSize:9, color: bgDelta < 0 ? GREEN : bgDelta > 0 ? ORANGE : "rgba(255,255,255,0.4)", marginTop:2, fontWeight:600 }}>
                    {bgDelta > 0 ? "+" : bgDelta < 0 ? "−" : ""}{Math.abs(bgDelta)} vs prev
                  </div>
                )}
              </>
            )}
          </FlipCard>
          <FlipCard
            accent={ACCENT}
            back={
              <FlipBack
                title="GMI / Estimated A1C"
                accent={ACCENT}
                paragraphs={[
                  "GMI (Glucose Management Indicator) approximates lab A1C from your average glucose. Formula: GMI(%) = 3.31 + 0.02392 × avg BG (mg/dL) — Bergenstal et al., Diabetes Care 2018.",
                  "A useful interim signal between clinic A1C draws — but not a substitute. Real A1C captures longer-term glycation that GMI cannot, and individual differences in red-blood-cell turnover can shift the two apart.",
                  `Computed from your last 7 days of pre-meal readings${last7Avg != null ? ` (avg ${Math.round(last7Avg)} mg/dL across ${last7Bg.length})` : ""}.`,
                ]}
              />
            }
          >
            <CardLabel text="GMI / est. A1C"/>
            {gmi == null ? (
              <div style={{ fontSize:24, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"var(--font-mono)", marginTop:4 }}>—</div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
                  <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)", lineHeight:1 }}>
                    {gmi.toFixed(1)}
                  </div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>%</div>
                </div>
                {gmiDelta != null && (
                  <div style={{ fontSize:9, color: gmiDelta < 0 ? GREEN : gmiDelta > 0 ? ORANGE : "rgba(255,255,255,0.4)", marginTop:2, fontWeight:600 }}>
                    {gmiDelta > 0 ? "+" : gmiDelta < 0 ? "−" : ""}{Math.abs(gmiDelta).toFixed(1)} vs prev
                  </div>
                )}
              </>
            )}
          </FlipCard>
        </div>
      ),
    },
    {
      id: "glucose-trend",
      node: (
        <FlipCard
          accent={ACCENT}
          back={
            <FlipBack
              title="7-Day Trend"
              accent={ACCENT}
              paragraphs={[
                "Average pre-meal glucose for each of the last 7 days. Days without data inherit the previous day's value so the line stays continuous.",
                "Look for a flat line in your target range (70–180 mg/dL) and steady morning values. A rising slope over multiple days suggests it's time to revisit your basal or ICR.",
              ]}
            />
          }
        >
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <CardLabel text="7-day trend"/>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>avg per day</div>
          </div>
          <Sparkline values={trendValues} color={ACCENT}/>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:8, color:"rgba(255,255,255,0.35)" }}>
            {trendDays.map((d, i) => <span key={i}>{d.label}</span>)}
          </div>
        </FlipCard>
      ),
    },
    {
      id: "meal-evaluation",
      node: (
        <FlipCard
          accent={ORANGE}
          back={
            <FlipBack
              title="Meal Evaluation"
              accent={ORANGE}
              paragraphs={[
                "Each logged meal is bucketed into one of three outcome bands once the post-meal glucose lands: On target (within ±35% of the ICR estimate), Spiked (post-meal high), and Low risk (post-meal low).",
                "Spike-heavy weeks often signal under-dosing or pre-bolus timing issues. Low-risk-heavy weeks often signal over-dosing — review your correction factor with your clinician.",
                `Computed from ${totalN} evaluated meal${totalN === 1 ? "" : "s"} in the last 7 days.`,
              ]}
            />
          }
        >
          <CardLabel text="Meal evaluation · 7d"/>
          {totalN === 0 ? (
            <div style={{ padding:"18px 0", textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:11 }}>
              Log meals with post-meal glucose to see your distribution.
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
              {evalRows.map(r => (
                <div key={r.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:60, fontSize:10, color:r.color }}>{r.label}</div>
                  <div style={{ flex:1, height:6, background:"rgba(255,255,255,0.04)", borderRadius:99, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${r.pct}%`, background:r.color, borderRadius:99, transition:"width 0.3s" }}/>
                  </div>
                  <div
                    title={`${r.pct}%`}
                    style={{ width:24, textAlign:"right", fontSize:10, color:"#fff", fontFamily:"var(--font-mono)", fontWeight:600 }}
                  >
                    {r.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </FlipCard>
      ),
    },
  ];

  return (
    // 480px max-width keeps the cards in their natural mockup
    // proportions on tablet/desktop instead of stretching them out.
    <div style={{ maxWidth:480, margin:"0 auto" }}>
      <div style={{ marginBottom:18 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Insights</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:12 }}>Tap any card to flip · hold to reorder · {total} meals analyzed</p>
      </div>

      <InsightsSortable items={items}/>
    </div>
  );
}

/** Wrapper so we don't re-instantiate useCardOrder on every parent render. */
function InsightsSortable({ items }: { items: SortableItem[] }) {
  const { order, setOrder } = useCardOrder("insights", INSIGHTS_DEFAULT_ORDER);
  return (
    <SortableCardGrid
      items={items}
      order={order}
      onOrderChange={setOrder}
      gridStyle={{ display:"flex", flexDirection:"column", gap:10 }}
    />
  );
}

/** Mockup-spec card label: 9 px, 0.1em tracking, uppercase, dim white. */
function CardLabel({ text, color }: { text: string; color?: string }) {
  return (
    <div style={{
      fontSize:9, fontWeight:700, letterSpacing:"0.1em",
      color: color ?? "rgba(255,255,255,0.4)", textTransform:"uppercase",
    }}>{text}</div>
  );
}

/** Sparkline — ported 1:1 from `components/AppMockupPhone.tsx`. Renders
 *  a soft gradient fill plus a 1.8 px line through the supplied values
 *  in a 268×36 viewBox that scales to the parent width. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 268, H = 36;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop:8, display:"block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill={`url(#spark-${gradId})`} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/**
 * FlipCard — generic flip wrapper used by all four insight cards.
 * Front and back are stacked in the same CSS-grid cell so the parent's
 * height automatically equals max(front, back) without us needing to
 * hard-code it.  Padding/borderRadius defaults match the mockup's
 * `MockCard` (12 × 14, radius 14).
 */
function FlipCard({
  children, back, accent = ACCENT, padding = "12px 14px",
}: {
  children: React.ReactNode;
  back: React.ReactNode;
  accent?: string;
  padding?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{ position:"relative", cursor:"pointer", perspective:1400, height:"100%" }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); } }}
      aria-pressed={flipped}
    >
      <div style={{
        display:"grid",
        height:"100%",
        transformStyle:"preserve-3d",
        transition:"transform 0.55s cubic-bezier(0.4,0,0.2,1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          background:SURFACE,
          border:`1px solid ${BORDER}`,
          borderRadius:14,
          padding,
          boxSizing:"border-box",
          position:"relative",
          display:"flex",
          flexDirection:"column",
        }}>
          {children}
        </div>
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          transform:"rotateY(180deg)",
          background:`linear-gradient(145deg, ${accent}12, ${SURFACE} 65%)`,
          border:`1px solid ${accent}33`,
          borderRadius:14,
          padding,
          boxSizing:"border-box",
          overflow:"hidden",
        }}>
          {back}
        </div>
      </div>
    </div>
  );
}

function FlipBack({ title, accent, paragraphs }: { title: string; accent: string; paragraphs: string[] }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8, height:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:10, color:accent, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{title}</div>
        <span style={{ fontSize:9, color:"rgba(255,255,255,0.3)" }}>↺ tap to flip back</span>
      </div>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize:11, color:"rgba(255,255,255,0.65)", lineHeight:1.5 }}>{p}</div>
      ))}
    </div>
  );
}
