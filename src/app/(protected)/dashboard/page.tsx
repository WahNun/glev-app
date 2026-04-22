"use client";

import { useState, useEffect } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";
import { useRouter } from "next/navigation";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const ORANGE  = "#FF9500";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, ...style }}>{children}</div>;
}

function StatCard({ label, value, unit, sub, color, bar }: {
  label: string; value: string; unit: string; sub: string; color: string; bar: number;
}) {
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.06em" }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: "-0.03em" }}>{value}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", paddingBottom: 3 }}>{unit}</span>
      </div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(bar, 100)}%`, height: "100%", background: color, borderRadius: 99 }}/>
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>{sub}</div>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 6, width: "60%", marginBottom: 12 }}/>
      <div style={{ height: 26, background: "rgba(255,255,255,0.06)", borderRadius: 6, width: "40%", marginBottom: 10 }}/>
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 99 }}/>
    </Card>
  );
}

function evalStyle(e: string | null) {
  if (e === "GOOD")      return { color: GREEN,  label: "GOOD" };
  if (e === "UNDERDOSE") return { color: ORANGE, label: "LOW DOSE" };
  if (e === "OVERDOSE")  return { color: PINK,   label: "OVERDOSE" };
  return { color: "#8B8FA8", label: "CHECK" };
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function computeStats(meals: Meal[]) {
  const withEval  = meals.filter(m => m.evaluation);
  const total     = withEval.length;
  const good      = withEval.filter(m => m.evaluation === "GOOD").length;
  const overdose  = withEval.filter(m => m.evaluation === "OVERDOSE").length;
  const underdose = withEval.filter(m => m.evaluation === "UNDERDOSE").length;
  const check     = withEval.filter(m => !["GOOD","OVERDOSE","UNDERDOSE"].includes(m.evaluation!)).length;
  const goodRate  = total > 0 ? good / total : 0;
  const spikeRate = total > 0 ? (overdose / total) * 100 : 0;
  const hypoRate  = total > 0 ? (underdose / total) * 100 : 0;
  const controlScore = goodRate * 100;
  const glucoseReadings = meals.filter(m => m.glucose_before).map(m => m.glucose_before as number);
  const avgGlucose = glucoseReadings.length > 0
    ? glucoseReadings.reduce((s, g) => s + g, 0) / glucoseReadings.length
    : null;
  return { controlScore, goodRate, spikeRate, hypoRate, total, good, overdose, underdose, check, avgGlucose };
}

export default function DashboardPage() {
  const router  = useRouter();
  const [meals, setMeals]   = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetchMeals()
      .then(setMeals)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const trendMeals = [...meals].filter(m => m.glucose_before).reverse().slice(-20);
  const trendPts   = trendMeals.map(m => m.glucose_before as number);
  const maxG = 220, minG = 60, W = 560, H = 90;
  const toY  = (g: number) => H - ((g - minG) / (maxG - minG)) * H;
  const toX  = (i: number) => (i / Math.max(trendPts.length - 1, 1)) * W;
  const pathD = trendPts.map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
  const areaD = trendPts.length > 0 ? pathD + ` L ${W} ${H} L 0 ${H} Z` : "";

  const stats     = computeStats(meals);
  const recent    = meals.slice(0, 5);
  const hasData   = meals.length > 0;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Your insulin control overview</p>
      </div>

      {loading ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
            {[0,1,2,3].map(i => <SkeletonCard key={i}/>)}
          </div>
          <Card style={{ padding: 24, marginBottom: 12 }}>
            <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12 }}>Loading…</div>
          </Card>
        </>
      ) : error ? (
        <Card style={{ padding: "40px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 28, color: PINK, marginBottom: 12 }}>⚠</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Could not load data</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{error}</div>
        </Card>
      ) : !hasData ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
            <StatCard label="Control Score" value="—" unit="/100" sub="No data yet"       color={ACCENT}  bar={0}/>
            <StatCard label="Good Rate"     value="—" unit="%"    sub="Log meals to start" color={GREEN}   bar={0}/>
            <StatCard label="Spike Rate"    value="—" unit="%"    sub="Hyperglycemia"      color={ORANGE}  bar={0}/>
            <StatCard label="Hypo Rate"     value="—" unit="%"    sub="Hypoglycemia"       color={PINK}    bar={0}/>
          </div>
          <Card style={{ padding: "60px 40px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>◈</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>No entries yet</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 24, lineHeight: 1.6 }}>
              Log your first meal to see your glucose control stats here.
            </div>
            <button onClick={() => router.push("/log")} style={{
              padding: "11px 24px", background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
              border: "none", borderRadius: 10, color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
              Log a Meal
            </button>
          </Card>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            <StatCard label="Control Score" value={stats.controlScore.toFixed(0)} unit="/100" sub={`${meals.length} entries`}         color={ACCENT}  bar={stats.controlScore}/>
            <StatCard label="Good Rate"     value={(stats.goodRate*100).toFixed(1)} unit="%"  sub={`${stats.good} good outcomes`}      color={GREEN}   bar={stats.goodRate*100}/>
            <StatCard label="Spike Rate"    value={stats.spikeRate.toFixed(1)}     unit="%"  sub="Possible overdose"                  color={ORANGE}  bar={stats.spikeRate}/>
            <StatCard label="Hypo Rate"     value={stats.hypoRate.toFixed(1)}      unit="%"  sub="Possible underdose"                 color={PINK}    bar={stats.hypoRate}/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr", gap: 10 }}>
            <Card style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Glucose Trend</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Pre-meal readings · {trendPts.length} entries</div>
                </div>
                <span style={{ fontSize: 11, padding: "4px 10px", background: `${ACCENT}22`, color: ACCENT, borderRadius: 99, fontWeight: 500 }}>7d</span>
              </div>
              {trendPts.length > 1 ? (
                <div style={{ position: "relative" }}>
                  <div style={{
                    position: "absolute", left: 0, right: 0,
                    top: `${((maxG - 140) / (maxG - minG)) * 100}%`,
                    height: `${((140 - 80) / (maxG - minG)) * 100}%`,
                    background: `${GREEN}08`, borderTop: `1px dashed ${GREEN}40`, borderBottom: `1px dashed ${GREEN}40`,
                  }}/>
                  <svg width="100%" height={H + 8} viewBox={`0 0 ${W} ${H + 8}`} preserveAspectRatio="none" style={{ display: "block" }}>
                    <defs>
                      <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={ACCENT} stopOpacity="0.2"/>
                        <stop offset="100%" stopColor={ACCENT} stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                    <path d={areaD} fill="url(#dg)"/>
                    <path d={pathD} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    {trendPts.map((g, i) =>
                      g > 180 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={ORANGE}/> :
                      g < 70  ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={PINK}/> : null
                    )}
                  </svg>
                </div>
              ) : (
                <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
                  Log meals with blood glucose readings to see trend
                </div>
              )}
            </Card>

            <Card style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Outcomes</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>Evaluation split</div>
              {[
                { label: "GOOD",      count: stats.good,      color: GREEN  },
                { label: "UNDERDOSE", count: stats.underdose, color: ORANGE },
                { label: "OVERDOSE",  count: stats.overdose,  color: PINK   },
                { label: "CHECK",     count: stats.check,     color: "#4B5070" },
              ].map(r => (
                <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 99, background: r.color, flexShrink: 0 }}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em" }}>{r.label}</span>
                      <span style={{ fontSize: 10, color: r.color, fontWeight: 600 }}>{r.count}</span>
                    </div>
                    <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${stats.total > 0 ? (r.count / stats.total) * 100 : 0}%`, height: "100%", background: r.color, borderRadius: 99 }}/>
                    </div>
                  </div>
                </div>
              ))}
              {stats.avgGlucose && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>AVG GLUCOSE BEFORE</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: ACCENT }}>
                    {stats.avgGlucose.toFixed(0)}
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 400, marginLeft: 4 }}>mg/dL</span>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Recent Entries</div>
              <button onClick={() => router.push("/entries")} style={{ fontSize: 11, color: ACCENT, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                View all →
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    {["Time","Meal","BG Before","Carbs","Insulin","Result"].map(h => (
                      <th key={h} style={{ padding: "7px 16px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                        {h.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((meal, i) => {
                    const ev = evalStyle(meal.evaluation);
                    return (
                      <tr key={meal.id} style={{ borderBottom: i < recent.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                        <td style={{ padding: "9px 16px", fontSize: 11, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>{fmtDate(meal.created_at)}</td>
                        <td style={{ padding: "9px 16px", fontSize: 12, fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={meal.input_text}>{meal.input_text}</td>
                        <td style={{ padding: "9px 16px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                          color: !meal.glucose_before ? "rgba(255,255,255,0.25)" : meal.glucose_before > 180 ? ORANGE : meal.glucose_before < 70 ? PINK : "rgba(255,255,255,0.85)"
                        }}>
                          {meal.glucose_before ? `${meal.glucose_before}` : "—"}<span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>{meal.glucose_before ? " mg/dL" : ""}</span>
                        </td>
                        <td style={{ padding: "9px 16px", fontSize: 12, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>
                          {meal.carbs_grams ? `${meal.carbs_grams}g` : "—"}
                        </td>
                        <td style={{ padding: "9px 16px", fontSize: 12, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>
                          {meal.insulin_units ? `${meal.insulin_units}u` : "—"}
                        </td>
                        <td style={{ padding: "9px 16px" }}>
                          <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                            {ev.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

        </div>
      )}
    </div>
  );
}
