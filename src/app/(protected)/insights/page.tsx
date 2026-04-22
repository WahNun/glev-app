"use client";

import { useState, useEffect } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const ORANGE  = "#FF9500";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, ...style }}>{children}</div>;
}

function StatTile({ label, value, unit, color = "white" }: { label: string; value: string; unit: string; color?: string }) {
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", marginBottom: 8 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: "-0.03em" }}>
        {value}
        <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)", marginLeft: 4 }}>{unit}</span>
      </div>
    </Card>
  );
}

function HBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.5s ease" }}/>
    </div>
  );
}

function computeInsights(meals: Meal[]) {
  const withGlucose  = meals.filter(m => m.glucose_before && m.glucose_before > 0);
  const withCarbs    = meals.filter(m => m.carbs_grams && m.carbs_grams > 0);
  const withInsulin  = meals.filter(m => m.insulin_units && m.insulin_units > 0);
  const withEval     = meals.filter(m => m.evaluation);

  const avgGlucose = withGlucose.length > 0
    ? withGlucose.reduce((s, m) => s + (m.glucose_before ?? 0), 0) / withGlucose.length : null;
  const avgCarbs = withCarbs.length > 0
    ? withCarbs.reduce((s, m) => s + (m.carbs_grams ?? 0), 0) / withCarbs.length : null;
  const avgInsulin = withInsulin.length > 0
    ? withInsulin.reduce((s, m) => s + (m.insulin_units ?? 0), 0) / withInsulin.length : null;

  const good      = withEval.filter(m => m.evaluation === "GOOD").length;
  const overdose  = withEval.filter(m => m.evaluation === "OVERDOSE").length;
  const underdose = withEval.filter(m => m.evaluation === "UNDERDOSE").length;
  const total     = withEval.length;

  const timeSlots = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
  meals.forEach(m => {
    const h = new Date(m.created_at).getHours();
    if (h >= 6  && h < 12) timeSlots.Morning++;
    else if (h >= 12 && h < 18) timeSlots.Afternoon++;
    else if (h >= 18 && h < 22) timeSlots.Evening++;
    else timeSlots.Night++;
  });
  const maxSlot = Math.max(...Object.values(timeSlots));

  const glucoseVals = withGlucose.map(m => m.glucose_before as number);
  const inRange  = glucoseVals.filter(g => g >= 70 && g <= 180).length;
  const low      = glucoseVals.filter(g => g < 70).length;
  const high     = glucoseVals.filter(g => g > 180).length;

  const last30Days = meals.filter(m => Date.now() - new Date(m.created_at).getTime() < 30 * 86400000);
  const mealsPerDay = last30Days.length > 0 ? (last30Days.length / 30).toFixed(1) : null;

  const glucoseTrend = withGlucose.slice().reverse().slice(-14);

  return { avgGlucose, avgCarbs, avgInsulin, good, overdose, underdose, total, timeSlots, maxSlot, inRange, low, high, glucoseVals, mealsPerDay, glucoseTrend };
}

export default function InsightsPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    fetchMeals()
      .then(setMeals)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Insights</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Loading your analytics…</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {[0,1,2].map(i => (
            <Card key={i} style={{ padding: "18px 20px" }}>
              <div style={{ height: 10, width: "60%", background: "rgba(255,255,255,0.06)", borderRadius: 6, marginBottom: 12 }}/>
              <div style={{ height: 28, width: "40%", background: "rgba(255,255,255,0.06)", borderRadius: 6 }}/>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Insights</h1>
        </div>
        <Card style={{ padding: "40px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 28, color: PINK, marginBottom: 12 }}>⚠</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Could not load data</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{error}</div>
        </Card>
      </div>
    );
  }

  if (meals.length < 2) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Insights</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Log at least 2 meals to see analytics</p>
        </div>
        <Card style={{ padding: "60px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>◈</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>Not enough data yet</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
            Log more meals with blood glucose readings to unlock your personalized insights.
          </div>
        </Card>
      </div>
    );
  }

  const ins = computeInsights(meals);
  const { avgGlucose, avgCarbs, avgInsulin, good, overdose, underdose, total, timeSlots, maxSlot, inRange, low, high, glucoseVals, mealsPerDay, glucoseTrend } = ins;

  const glucoseTrendPts = glucoseTrend.map(m => m.glucose_before as number);
  const W = 560, H = 72, maxG = 220, minG = 60;
  const toY = (g: number) => H - ((g - minG) / (maxG - minG)) * H;
  const toX = (i: number) => (i / Math.max(glucoseTrendPts.length - 1, 1)) * W;
  const pathD = glucoseTrendPts.map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
  const areaD = glucoseTrendPts.length > 1 ? pathD + ` L ${W} ${H} L 0 ${H} Z` : "";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Insights</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Analytics from {meals.length} logged meals</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          <StatTile label="Avg Glucose Before" value={avgGlucose ? avgGlucose.toFixed(0) : "—"} unit="mg/dL" color={avgGlucose ? (avgGlucose > 180 ? ORANGE : avgGlucose < 70 ? PINK : GREEN) : "white"}/>
          <StatTile label="Avg Carb Load"      value={avgCarbs ? avgCarbs.toFixed(0) : "—"} unit="g" color={ACCENT}/>
          <StatTile label="Avg Insulin Dose"   value={avgInsulin ? avgInsulin.toFixed(1) : "—"} unit="u" color="rgba(255,255,255,0.85)"/>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          <StatTile label="Total Meals Logged" value={String(meals.length)} unit="meals" color="rgba(255,255,255,0.85)"/>
          <StatTile label="Avg Meals / Day"    value={mealsPerDay ?? "—"} unit="/day" color="rgba(255,255,255,0.85)"/>
          <StatTile label="Good Outcomes"      value={total > 0 ? `${((good/total)*100).toFixed(0)}%` : "—"} unit="good rate" color={GREEN}/>
        </div>

        {glucoseTrendPts.length > 1 && (
          <Card style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Glucose Trend</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Last {glucoseTrendPts.length} readings</div>
              </div>
              {avgGlucose && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Average</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: avgGlucose > 180 ? ORANGE : avgGlucose < 70 ? PINK : GREEN }}>{avgGlucose.toFixed(0)} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>mg/dL</span></div>
                </div>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <div style={{
                position: "absolute", left: 0, right: 0,
                top: `${((maxG - 140) / (maxG - minG)) * 100}%`,
                height: `${((140 - 80) / (maxG - minG)) * 100}%`,
                background: `${GREEN}06`, borderTop: `1px dashed ${GREEN}35`, borderBottom: `1px dashed ${GREEN}35`,
              }}/>
              <svg width="100%" height={H + 6} viewBox={`0 0 ${W} ${H + 6}`} preserveAspectRatio="none" style={{ display: "block" }}>
                <defs>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={ACCENT} stopOpacity="0.18"/>
                    <stop offset="100%" stopColor={ACCENT} stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <path d={areaD} fill="url(#g2)"/>
                <path d={pathD} fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                {glucoseTrendPts.map((g, i) =>
                  g > 180 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3} fill={ORANGE}/> :
                  g < 70  ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3} fill={PINK}/> : null
                )}
              </svg>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 99, background: GREEN }}/>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>In range (70–180): {glucoseVals.filter(g => g>=70 && g<=180).length}</span>
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 99, background: ORANGE }}/>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>High: {high}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 99, background: PINK }}/>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Low: {low}</span>
                </div>
              </div>
            </div>
          </Card>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Card style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Outcome Breakdown</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>{total} evaluated entries</div>
            {total === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "12px 0" }}>No evaluated entries yet — enter insulin when logging</div>
            ) : (
              <>
                {[
                  { label: "Good",      count: good,      color: GREEN,  pct: (good/total)*100 },
                  { label: "Low Dose",  count: underdose, color: ORANGE, pct: (underdose/total)*100 },
                  { label: "Overdose",  count: overdose,  color: PINK,   pct: (overdose/total)*100 },
                ].map(r => (
                  <div key={r.label} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 99, background: r.color }}/>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{r.label}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.count}</span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{r.pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <HBar value={r.count} max={total} color={r.color}/>
                  </div>
                ))}
              </>
            )}
          </Card>

          <Card style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Meal Timing</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>When you eat</div>
            {[
              { label: "Morning",   range: "06–12", count: timeSlots.Morning,   icon: "🌅" },
              { label: "Afternoon", range: "12–18", count: timeSlots.Afternoon, icon: "☀️" },
              { label: "Evening",   range: "18–22", count: timeSlots.Evening,   icon: "🌆" },
              { label: "Night",     range: "22–06", count: timeSlots.Night,     icon: "🌙" },
            ].map(r => (
              <div key={r.label} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 13 }}>{r.icon}</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{r.label}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{r.range}h</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{r.count}</span>
                </div>
                <HBar value={r.count} max={maxSlot} color={ACCENT}/>
              </div>
            ))}
          </Card>
        </div>

        {glucoseVals.length >= 3 && (
          <Card style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Glucose Distribution</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>{glucoseVals.length} pre-meal readings</div>
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { label: "Low",     range: "< 70",     count: low,     color: PINK,    bg: `${PINK}10`   },
                { label: "In Range",range: "70–180",   count: inRange, color: GREEN,   bg: `${GREEN}10`  },
                { label: "High",    range: "> 180",    count: high,    color: ORANGE,  bg: `${ORANGE}10` },
              ].map(r => (
                <div key={r.label} style={{ flex: 1, background: r.bg, borderRadius: 12, padding: "14px 16px", border: `1px solid ${r.color}20` }}>
                  <div style={{ fontSize: 10, color: r.color, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 6 }}>{r.label.toUpperCase()}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: r.color, lineHeight: 1 }}>{r.count}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{r.range} mg/dL</div>
                  <div style={{ fontSize: 11, color: r.color, marginTop: 6, fontWeight: 600 }}>
                    {glucoseVals.length > 0 ? `${((r.count / glucoseVals.length) * 100).toFixed(0)}%` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

      </div>
    </div>
  );
}
