"use client";

import { useState, useEffect } from "react";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";

interface DashboardStats {
  controlScore: number;
  hypoRate: number;
  spikeRate: number;
  totalEntries: number;
  goodRate: number;
  avgGlucoseBefore: number | null;
  recentEntries: RecentEntry[];
  evaluationBreakdown: { GOOD: number; OVERDOSE: number; UNDERDOSE: number; CHECK_CONTEXT: number };
}

interface RecentEntry {
  id: number;
  timestamp: string;
  glucoseBefore: number;
  carbsGrams: number;
  insulinUnits: number;
  mealType: string | null;
  mealDescription: string | null;
  evaluation: string | null;
}

interface TrendPoint { glucoseBefore: number; }

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, ...style }}>{children}</div>;
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
      <div style={{ height: 28, background: "rgba(255,255,255,0.06)", borderRadius: 6, width: "40%", marginBottom: 10 }}/>
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 99 }}/>
    </Card>
  );
}

function evalStyle(e: string | null) {
  if (e === "GOOD") return { color: GREEN, label: "GOOD" };
  if (e === "UNDERDOSE") return { color: ORANGE, label: "LOW DOSE" };
  if (e === "OVERDOSE") return { color: PINK, label: "OVERDOSE" };
  return { color: "#8B8FA8", label: "CHECK" };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
    if (!apiUrl) { setLoading(false); return; }
    Promise.all([
      fetch(`${apiUrl}/api/insights/dashboard`).then(r => r.json()),
      fetch(`${apiUrl}/api/insights/glucose-trend`).then(r => r.json()),
    ]).then(([s, t]) => {
      setStats(s);
      setTrend((t.points ?? []).slice(0, 20).reverse());
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const trendPts = trend.map(p => p.glucoseBefore).filter(Boolean) as number[];
  const maxG = 220, minG = 60, W = 560, H = 90;
  const toY = (g: number) => H - ((g - minG) / (maxG - minG)) * H;
  const toX = (i: number) => (i / Math.max(trendPts.length - 1, 1)) * W;
  const pathD = trendPts.map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
  const areaD = pathD + ` L ${W} ${H} L 0 ${H} Z`;
  const eb = stats?.evaluationBreakdown ?? { GOOD: 0, OVERDOSE: 0, UNDERDOSE: 0, CHECK_CONTEXT: 0 };
  const total = stats?.totalEntries || 1;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Your insulin control overview</p>
      </div>

      {loading ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
            {[0,1,2,3].map(i => <SkeletonCard key={i} />)}
          </div>
          <Card style={{ padding: 24, marginBottom: 12 }}>
            <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12 }}>Loading trend data…</div>
          </Card>
        </>
      ) : !stats ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
            <StatCard label="Control Score" value="—" unit="/100" sub="No data yet" color={ACCENT} bar={0}/>
            <StatCard label="Good Rate"     value="—" unit="%"    sub="Log meals to start" color={GREEN}  bar={0}/>
            <StatCard label="Spike Rate"    value="—" unit="%"    sub="Hyperglycemia" color={ORANGE} bar={0}/>
            <StatCard label="Hypo Rate"     value="—" unit="%"    sub="Hypoglycemia"  color={PINK}   bar={0}/>
          </div>
          <Card style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No data yet</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>Log your first meal to see your glucose control stats here.</div>
          </Card>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <StatCard label="Control Score" value={stats.controlScore.toFixed(0)} unit="/100" sub={`${stats.totalEntries} entries`} color={ACCENT} bar={stats.controlScore}/>
            <StatCard label="Good Rate"     value={(stats.goodRate * 100).toFixed(1)} unit="%" sub={`${eb.GOOD} good outcomes`} color={GREEN}  bar={stats.goodRate * 100}/>
            <StatCard label="Spike Rate"    value={stats.spikeRate.toFixed(1)} unit="%" sub="Hyperglycemia" color={ORANGE} bar={stats.spikeRate}/>
            <StatCard label="Hypo Rate"     value={stats.hypoRate.toFixed(1)} unit="%" sub="Hypoglycemia"  color={PINK}   bar={stats.hypoRate}/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr", gap: 10 }}>
            <Card style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Glucose Trend</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Pre-meal readings · {trend.length} entries</div>
                </div>
                <span style={{ fontSize: 11, padding: "4px 10px", background: `${ACCENT}22`, color: ACCENT, borderRadius: 99, fontWeight: 500 }}>7d</span>
              </div>
              {trendPts.length > 0 ? (
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: `${((maxG - 140) / (maxG - minG)) * 100}%`, height: `${((140 - 80) / (maxG - minG)) * 100}%`, background: `${GREEN}0A`, borderTop: `1px dashed ${GREEN}50`, borderBottom: `1px dashed ${GREEN}50` }}/>
                  <svg width="100%" height={H + 10} viewBox={`0 0 ${W} ${H + 10}`} preserveAspectRatio="none" style={{ display: "block" }}>
                    <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity="0.25"/><stop offset="100%" stopColor={ACCENT} stopOpacity="0"/></linearGradient></defs>
                    <path d={areaD} fill="url(#dg)"/>
                    <path d={pathD} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    {trendPts.map((g, i) => g > 180 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={ORANGE}/> : g < 70 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={PINK}/> : null)}
                  </svg>
                </div>
              ) : (
                <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>No trend data yet</div>
              )}
            </Card>

            <Card style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Outcomes</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>Evaluation split</div>
              {[{label:"GOOD",count:eb.GOOD,color:GREEN},{label:"UNDERDOSE",count:eb.UNDERDOSE,color:ORANGE},{label:"OVERDOSE",count:eb.OVERDOSE,color:PINK},{label:"CHECK",count:eb.CHECK_CONTEXT,color:"#4B5070"}].map(r => (
                <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 99, background: r.color, flexShrink: 0 }}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em" }}>{r.label}</span>
                      <span style={{ fontSize: 10, color: r.color, fontWeight: 600 }}>{r.count}</span>
                    </div>
                    <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${(r.count / total) * 100}%`, height: "100%", background: r.color, borderRadius: 99 }}/>
                    </div>
                  </div>
                </div>
              ))}
              {stats.avgGlucoseBefore && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>AVG GLUCOSE BEFORE</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: ACCENT }}>{stats.avgGlucoseBefore.toFixed(0)} <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>mg/dL</span></div>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Recent Entries</div>
              <span style={{ fontSize: 11, color: ACCENT }}>{stats.totalEntries} total</span>
            </div>
            {stats.recentEntries.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>No entries yet</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {["Time","Meal","BG Before","Carbs","Insulin","Result"].map(h => (
                    <th key={h} style={{ padding: "7px 18px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em" }}>{h.toUpperCase()}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {stats.recentEntries.slice(0, 5).map((e, i) => {
                    const ev = evalStyle(e.evaluation);
                    const ts = new Date(e.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                    return (
                      <tr key={e.id} style={{ borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                        <td style={{ padding: "9px 18px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{ts}</td>
                        <td style={{ padding: "9px 18px", fontSize: 12, fontWeight: 500 }}>{e.mealDescription || e.mealType || "—"}</td>
                        <td style={{ padding: "9px 18px", fontSize: 12, fontWeight: 600, color: e.glucoseBefore > 140 ? ORANGE : e.glucoseBefore < 80 ? PINK : "rgba(255,255,255,0.85)" }}>{e.glucoseBefore} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>mg/dL</span></td>
                        <td style={{ padding: "9px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.carbsGrams}g</td>
                        <td style={{ padding: "9px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.insulinUnits}u</td>
                        <td style={{ padding: "9px 18px" }}><span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em" }}>{ev.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
