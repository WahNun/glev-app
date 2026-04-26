"use client";

import React, { useState, useEffect, useId } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";
import GlucoseTrendFront from "@/components/GlucoseTrendChart";
import SortableCardGrid, { type SortableItem } from "@/components/SortableCardGrid";
import { useCardOrder } from "@/lib/cardOrder";
import { parseDbTs } from "@/lib/time";

/** Default top-to-bottom order — matches the dark-cockpit hero reference 1:1.
 *  Only the four cards in the reference are rendered; deeper analysis cards
 *  (overview tiles, adaptive engine, meal-type, patterns, insulin/exercise
 *  logs) live elsewhere in the app (Engine, Dashboard) and have been
 *  removed from this view per design feedback. */
const INSIGHTS_DEFAULT_ORDER = [
  "time-in-range",
  "gmi-a1c",
  "glucose-trend",
  "meal-evaluation",
];

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

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
    <div style={{ maxWidth:960, margin:"0 auto" }}>
      <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:8 }}>Insights</h1>
      <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"48px", textAlign:"center", color:"rgba(255,255,255,0.25)", fontSize:14 }}>Log at least 5 meals to see insights.</div>
    </div>
  );

  const now = Date.now();
  const oneWeekMs = 7 * 86400000;
  const last7 = meals.filter(m => now - parseDbTs(m.created_at) <= oneWeekMs);

  // Each entry is one draggable card. Long-press to enter reorder mode;
  // tap blank space to save the new order.
  const items: SortableItem[] = [
    {
      id: "time-in-range",
      node: (() => {
        // Bucket pre-meal glucose into the standard CGM consensus bands.
        // V.low <54, Low 54–69, In 70–180, High >180. Compare last 7 days
        // to the prior 7 to surface a week-over-week delta.
        const wkAgo  = now - oneWeekMs;
        const wk2Ago = now - 2 * oneWeekMs;
        const last7Bg = last7
          .filter(m => m.glucose_before != null)
          .map(m => m.glucose_before as number);
        const prev7Bg = meals.filter(m => {
          const t = parseDbTs(m.created_at);
          return t > wk2Ago && t <= wkAgo && m.glucose_before != null;
        }).map(m => m.glucose_before as number);

        const bucket = (arr: number[]) => {
          const total = arr.length || 1;
          const vlow = arr.filter(g => g < 54).length;
          const lo   = arr.filter(g => g >= 54 && g < 70).length;
          const inR  = arr.filter(g => g >= 70 && g <= 180).length;
          const hi   = arr.filter(g => g > 180).length;
          return {
            vlow: Math.round((vlow / total) * 100),
            lo:   Math.round((lo   / total) * 100),
            inR:  Math.round((inR  / total) * 100),
            hi:   Math.round((hi   / total) * 100),
            n: arr.length,
          };
        };
        const b7  = bucket(last7Bg);
        const bP7 = bucket(prev7Bg);
        const delta = b7.inR - bP7.inR;
        const hasData = b7.n > 0;

        return (
          <FlipCard
            accent={GREEN}
            padding="22px 26px"
            back={
              <FlipBack
                title="Time in Range"
                accent={GREEN}
                paragraphs={[
                  "Time in Range is the share of your pre-meal glucose readings that fall in the 70–180 mg/dL target band — the international consensus target for adults with type 1 diabetes.",
                  "The four buckets follow the consensus recommendations: Very low (<54), Low (54–69), In range (70–180), High (>180). Spending more time in range is consistently linked to better long-term outcomes.",
                  `Computed from ${b7.n} pre-meal reading${b7.n === 1 ? "" : "s"} in the last 7 days. The delta vs the prior 7 days reflects week-over-week movement.`,
                ]}
              />
            }
          >
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18, gap:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.5)", letterSpacing:"0.12em", textTransform:"uppercase" }}>
                Time in Range · 7D
              </div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", whiteSpace:"nowrap" }}>
                70–180 mg/dL
              </div>
            </div>
            {!hasData ? (
              <div style={{ padding:"22px 0", textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>
                Log meals with pre-meal glucose to see your time-in-range.
              </div>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:18 }}>
                  <div style={{ fontSize:56, fontWeight:800, color:GREEN, letterSpacing:"-0.04em", lineHeight:1, fontFamily:"var(--font-mono)" }}>
                    {b7.inR}
                  </div>
                  <div style={{ fontSize:20, color:GREEN, fontWeight:700, letterSpacing:"-0.02em" }}>%</div>
                  {prev7Bg.length > 0 && (
                    <div style={{ marginLeft:"auto", fontSize:12, color: delta >= 0 ? GREEN : ORANGE, fontWeight:600 }}>
                      {delta >= 0 ? "+" : ""}{delta} vs prev wk
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", height:10, borderRadius:99, overflow:"hidden", background:"rgba(255,255,255,0.04)" }}>
                  {b7.vlow > 0 && <div style={{ width:`${b7.vlow}%`, background:PINK }}/>}
                  {b7.lo   > 0 && <div style={{ width:`${b7.lo}%`,   background:ORANGE }}/>}
                  {b7.inR  > 0 && <div style={{ width:`${b7.inR}%`,  background:GREEN }}/>}
                  {b7.hi   > 0 && <div style={{ width:`${b7.hi}%`,   background:"#FFD166" }}/>}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, fontSize:11, color:"rgba(255,255,255,0.55)", flexWrap:"wrap", gap:8 }}>
                  <span style={{ color:PINK }}>● V.low {b7.vlow}%</span>
                  <span style={{ color:ORANGE }}>● Low {b7.lo}%</span>
                  <span style={{ color:GREEN }}>● In {b7.inR}%</span>
                  <span style={{ color:"#FFD166" }}>● High {b7.hi}%</span>
                </div>
              </>
            )}
          </FlipCard>
        );
      })(),
    },
    {
      // ID kept as "gmi-a1c" for backwards compat with persisted card-order.
      // Renders TWO half-width cards side-by-side: AVG BG + GMI / Est. A1C.
      // GMI(%) = 3.31 + 0.02392 × avgBG (Bergenstal et al. 2018, Diabetes Care).
      id: "gmi-a1c",
      node: (() => {
        const last7Bg = last7
          .filter(m => m.glucose_before != null)
          .map(m => m.glucose_before as number);
        const prev7Bg = meals.filter(m => {
          const t = parseDbTs(m.created_at);
          return t > now - 2 * oneWeekMs && t <= now - oneWeekMs && m.glucose_before != null;
        }).map(m => m.glucose_before as number);

        const avg = (arr: number[]) =>
          arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        const last7Avg = avg(last7Bg);
        const prev7Avg = avg(prev7Bg);
        const bgDelta  = (last7Avg != null && prev7Avg != null) ? Math.round(last7Avg - prev7Avg) : null;
        const gmi      = last7Avg != null ? +(3.31 + 0.02392 * last7Avg).toFixed(1) : null;
        const prevGmi  = prev7Avg != null ? +(3.31 + 0.02392 * prev7Avg).toFixed(1) : null;
        const gmiDelta = (gmi != null && prevGmi != null) ? +(gmi - prevGmi).toFixed(1) : null;

        return (
          <div className="glev-vital-grid" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            {/* AVG BG — left half */}
            <FlipCard
              accent={ACCENT}
              padding="22px 26px"
              back={
                <FlipBack
                  title="Average Glucose"
                  accent={ACCENT}
                  paragraphs={[
                    "Mean pre-meal glucose across the last 7 days, calculated only from meals where you logged a pre-meal reading.",
                    "Lower values reflect better fasting and overnight control. The delta vs the prior 7 days surfaces week-over-week movement.",
                    `Computed from ${last7Bg.length} reading${last7Bg.length === 1 ? "" : "s"} in the last 7 days.`,
                  ]}
                />
              }
            >
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.5)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>
                Avg BG
              </div>
              {last7Avg == null ? (
                <div style={{ fontSize:32, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"var(--font-mono)" }}>—</div>
              ) : (
                <>
                  <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                    <div style={{ fontSize:46, fontWeight:800, color:"#fff", letterSpacing:"-0.04em", lineHeight:1, fontFamily:"var(--font-mono)" }}>
                      {Math.round(last7Avg)}
                    </div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)" }}>mg/dL</div>
                  </div>
                  {bgDelta != null && (
                    <div style={{ marginTop:10, fontSize:12, color: bgDelta < 0 ? GREEN : bgDelta > 0 ? ORANGE : "rgba(255,255,255,0.4)", fontWeight:600 }}>
                      {bgDelta > 0 ? "+" : ""}{bgDelta} vs prev
                    </div>
                  )}
                </>
              )}
            </FlipCard>

            {/* GMI / EST. A1C — right half */}
            <FlipCard
              accent={ACCENT}
              padding="22px 26px"
              back={
                <FlipBack
                  title="GMI / Estimated A1C"
                  accent={ACCENT}
                  paragraphs={[
                    "GMI (Glucose Management Indicator) approximates your laboratory A1C from your average sensor or pre-meal glucose. The formula is GMI(%) = 3.31 + 0.02392 × avg glucose (mg/dL) — Bergenstal et al., Diabetes Care 2018.",
                    "It's a useful interim signal between clinic A1C draws — but it's not a substitute. Real A1C captures longer-term glycation that GMI cannot, and individual differences in red-blood-cell turnover can shift the two apart.",
                    `Computed from your last 7 days of pre-meal glucose readings${last7Avg != null ? ` (avg ${Math.round(last7Avg)} mg/dL across ${last7Bg.length} reading${last7Bg.length === 1 ? "" : "s"})` : ""}.`,
                  ]}
                />
              }
            >
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.5)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>
                GMI / Est. A1C
              </div>
              {gmi == null ? (
                <div style={{ fontSize:32, fontWeight:800, color:"rgba(255,255,255,0.25)", fontFamily:"var(--font-mono)" }}>—</div>
              ) : (
                <>
                  <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                    <div style={{ fontSize:46, fontWeight:800, color:"#fff", letterSpacing:"-0.04em", lineHeight:1, fontFamily:"var(--font-mono)" }}>
                      {gmi.toFixed(1)}
                    </div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)" }}>%</div>
                  </div>
                  {gmiDelta != null && (
                    <div style={{ marginTop:10, fontSize:12, color: gmiDelta < 0 ? GREEN : gmiDelta > 0 ? ORANGE : "rgba(255,255,255,0.4)", fontWeight:600 }}>
                      {gmiDelta > 0 ? "+" : ""}{gmiDelta.toFixed(1)} vs prev
                    </div>
                  )}
                </>
              )}
            </FlipCard>
          </div>
        );
      })(),
    },
    {
      id: "glucose-trend",
      node: (
        <FlipCard
          accent={ACCENT}
          padding="20px 24px"
          minHeight={380}
          mobileMinHeight={420}
          back={
            <FlipBack
              title="Glucose Trend"
              accent={ACCENT}
              paragraphs={[
                "Each dot is the average pre-meal glucose for that day across all logged meals. Days without data inherit the previous day's value so the line stays continuous.",
                "Look for a flat line in your target range (70–180 mg/dL) and steady morning values. A rising slope over multiple days suggests it's time to revisit your basal or ICR.",
              ]}
            />
          }
        >
          <GlucoseTrendFront meals={meals} />
        </FlipCard>
      ),
    },
    {
      id: "meal-evaluation",
      node: (() => {
        // Distribution of meal outcomes in the last 7 days. EVAL_NORM
        // collapses OVERDOSE/HIGH/SPIKE → SPIKE bucket, UNDERDOSE/LOW → LOW
        // bucket, GOOD stays GOOD.
        const evals = last7
          .map(m => EVAL_NORM(m.evaluation))
          .filter(e => e === "GOOD" || e === "SPIKE" || e === "HIGH" || e === "LOW");
        const goodN  = evals.filter(e => e === "GOOD").length;
        const spikeN = evals.filter(e => e === "SPIKE" || e === "HIGH").length;
        const lowN   = evals.filter(e => e === "LOW").length;
        const totalN = goodN + spikeN + lowN;
        const pct = (n: number) =>
          totalN > 0 ? Math.round((n / totalN) * 100) : 0;
        const rows = [
          { label:"On target", count:goodN,  color:GREEN,  pct:pct(goodN)  },
          { label:"Spiked",    count:spikeN, color:ORANGE, pct:pct(spikeN) },
          { label:"Low risk",  count:lowN,   color:PINK,   pct:pct(lowN)   },
        ];

        return (
          <FlipCard
            accent={ORANGE}
            padding="22px 26px"
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
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18, gap:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.5)", letterSpacing:"0.12em", textTransform:"uppercase" }}>
                Meal Evaluation · 7D
              </div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", whiteSpace:"nowrap" }}>
                {totalN} meal{totalN === 1 ? "" : "s"}
              </div>
            </div>
            {totalN === 0 ? (
              <div style={{ padding:"22px 0", textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:12 }}>
                Log meals with post-meal glucose to see your evaluation distribution.
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {rows.map(r => (
                  <div key={r.label} style={{ display:"grid", gridTemplateColumns:"110px 1fr 36px", gap:14, alignItems:"center" }}>
                    <div style={{ fontSize:13, color:r.color, fontWeight:600 }}>{r.label}</div>
                    <div style={{ height:6, borderRadius:99, background:"rgba(255,255,255,0.05)", overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${r.pct}%`, background:r.color, borderRadius:99, transition:"width 0.3s" }}/>
                    </div>
                    <div
                      title={`${r.pct}% · ${r.count} meal${r.count === 1 ? "" : "s"}`}
                      style={{ fontSize:18, fontWeight:800, color:"#fff", textAlign:"right", letterSpacing:"-0.02em", fontFamily:"var(--font-mono)" }}
                    >
                      {r.count}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FlipCard>
        );
      })(),
    },
  ];

  return (
    <div style={{ maxWidth:960, margin:"0 auto" }}>
      <style>{`
        @media (max-width: 720px) {
          .glev-vital-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Insights</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:13 }}>Tap any card to flip · hold to reorder · {total} meals analyzed</p>
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
      gridStyle={{ display:"flex", flexDirection:"column", gap:20 }}
    />
  );
}

/**
 * FlipCard — generic flip wrapper used by all four insight cards.
 * Front and back are stacked in the same CSS-grid cell so the parent's height
 * automatically equals max(front, back) without us needing to hard-code it.
 */
function FlipCard({
  children, back, accent = ACCENT, padding = "20px 24px", marginBottom,
  minHeight, mobileMinHeight,
}: {
  children: React.ReactNode;
  back: React.ReactNode;
  accent?: string;
  padding?: string;
  marginBottom?: number;
  /** Pin the grid cell (and therefore the card) to a fixed desktop height. */
  minHeight?: number;
  /** Optional override for screens ≤768px wide. */
  mobileMinHeight?: number;
}) {
  const [flipped, setFlipped] = useState(false);
  const rawId = useId();
  const sizingClass = (minHeight || mobileMinHeight)
    ? `glev-flip-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`
    : "";
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{ position:"relative", cursor:"pointer", perspective:1400, marginBottom }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); } }}
      aria-pressed={flipped}
    >
      {sizingClass && (
        <style>{`
          ${minHeight ? `.${sizingClass} { grid-template-rows: minmax(${minHeight}px, auto); }` : ""}
          ${mobileMinHeight ? `@media (max-width: 768px) { .${sizingClass} { grid-template-rows: minmax(${mobileMinHeight}px, auto); } }` : ""}
        `}</style>
      )}
      <div className={sizingClass} style={{
        display:"grid",
        transformStyle:"preserve-3d",
        transition:"transform 0.55s cubic-bezier(0.4,0,0.2,1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          background:SURFACE,
          border:`1px solid ${BORDER}`,
          borderRadius:16,
          padding,
          boxSizing:"border-box",
          position:"relative",
          // Lay out children in a column so a child can use `flex:1` to
          // soak up any extra height when the back face is taller than
          // the front (e.g. the chart card with long copy on the back).
          display:"flex",
          flexDirection:"column",
        }}>
          <span style={{ position:"absolute", top:10, right:14, fontSize:10, color:"rgba(255,255,255,0.18)" }}>↺</span>
          {children}
        </div>
        <div style={{
          gridArea:"1 / 1",
          backfaceVisibility:"hidden",
          transform:"rotateY(180deg)",
          background:`linear-gradient(145deg, ${accent}12, ${SURFACE} 65%)`,
          border:`1px solid ${accent}33`,
          borderRadius:16,
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
    <div style={{ display:"flex", flexDirection:"column", gap:10, height:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:11, color:accent, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{title}</div>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>↺ tap to flip back</span>
      </div>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ fontSize:12, color:"rgba(255,255,255,0.65)", lineHeight:1.55 }}>{p}</div>
      ))}
    </div>
  );
}
