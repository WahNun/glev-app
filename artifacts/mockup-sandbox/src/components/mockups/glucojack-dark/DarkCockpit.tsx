import { useState } from "react";

type Page = "dashboard" | "log" | "entries" | "insights" | "recommend" | "import";

const ACCENT = "#4F6EF7";
const PINK = "#FF2D78";
const GREEN = "#22D3A0";
const ORANGE = "#FF9500";
const BG = "#09090B";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";

const glucosePoints = [112, 128, 95, 185, 130, 105, 105, 138, 88, 210, 120, 92, 99, 125, 108, 140];
const maxG = 220; const minG = 60; const W = 560; const H = 120;
const toY = (g: number) => H - ((g - minG) / (maxG - minG)) * H;
const toX = (i: number) => (i / (glucosePoints.length - 1)) * W;
const pathD = glucosePoints.map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`).join(" ");
const areaD = pathD + ` L ${W} ${H} L 0 ${H} Z`;

const entries = [
  { time: "Today 12:30", meal: "Quinoa bowl", type: "BALANCED", bg: 108, carbs: 55, insulin: 5.5, eval: "GOOD" },
  { time: "Yesterday 19:15", meal: "Pizza night", type: "FAST_CARBS", bg: 88, carbs: 80, insulin: 5.0, eval: "UNDERDOSE" },
  { time: "Yesterday 12:00", meal: "Avocado eggs", type: "HIGH_FAT", bg: 120, carbs: 25, insulin: 4.0, eval: "GOOD" },
  { time: "Apr 19 19:00", meal: "Brown rice bowl", type: "BALANCED", bg: 105, carbs: 50, insulin: 5.5, eval: "GOOD" },
  { time: "Apr 18 20:00", meal: "Grilled chicken", type: "HIGH_PROTEIN", bg: 130, carbs: 30, insulin: 6.0, eval: "OVERDOSE" },
  { time: "Apr 17 08:30", meal: "Pancakes + syrup", type: "FAST_CARBS", bg: 95, carbs: 85, insulin: 4.5, eval: "UNDERDOSE" },
  { time: "Apr 16 13:00", meal: "Salmon & rice", type: "BALANCED", bg: 115, carbs: 55, insulin: 3.5, eval: "GOOD" },
];

function evalStyle(e: string) {
  if (e === "GOOD") return { color: GREEN, label: "GOOD" };
  if (e === "UNDERDOSE") return { color: ORANGE, label: "LOW DOSE" };
  if (e === "OVERDOSE") return { color: PINK, label: "OVERDOSE" };
  return { color: "#8B8FA8", label: "CHECK" };
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, ...style }}>
      {children}
    </div>
  );
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
        <div style={{ width: `${bar}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>{sub}</div>
    </Card>
  );
}

// ─── PAGES ───────────────────────────────────────────────────────

function Dashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        <StatCard label="Control Score" value="75" unit="/100" sub="Last 8 entries" color={ACCENT} bar={75} />
        <StatCard label="Time in Range" value="62.5" unit="%" sub="5 of 8 entries" color={GREEN} bar={62.5} />
        <StatCard label="Spike Rate" value="25.0" unit="%" sub="Hyperglycemia" color={ORANGE} bar={25} />
        <StatCard label="Hypo Rate" value="0.0" unit="%" sub="Hypoglycemia" color={PINK} bar={0} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr", gap: 10 }}>
        <Card style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Glucose Trend</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Pre-meal readings · 7 days</div>
            </div>
            <span style={{ fontSize: 11, padding: "4px 10px", background: `${ACCENT}22`, color: ACCENT, borderRadius: 99, fontWeight: 500 }}>7d</span>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: `${((maxG - 140) / (maxG - minG)) * 100}%`, height: `${((140 - 80) / (maxG - minG)) * 100}%`, background: `${GREEN}0A`, borderTop: `1px dashed ${GREEN}50`, borderBottom: `1px dashed ${GREEN}50` }} />
            <svg width="100%" height={H + 10} viewBox={`0 0 ${W} ${H + 10}`} preserveAspectRatio="none" style={{ display: "block" }}>
              <defs>
                <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaD} fill="url(#dg)" />
              <path d={pathD} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {glucosePoints.map((g, i) => g > 180 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={ORANGE} /> : g < 70 ? <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill={PINK} /> : null)}
            </svg>
          </div>
        </Card>

        <Card style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Outcomes</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>Evaluation split</div>
          {[
            { label: "GOOD", count: 5, pct: 62.5, color: GREEN },
            { label: "UNDERDOSE", count: 2, pct: 25, color: ORANGE },
            { label: "OVERDOSE", count: 1, pct: 12.5, color: PINK },
            { label: "CHECK", count: 0, pct: 0, color: "#4B5070" },
          ].map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: 99, background: r.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em" }}>{r.label}</span>
                  <span style={{ fontSize: 10, color: r.color, fontWeight: 600 }}>{r.count}</span>
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${r.pct}%`, height: "100%", background: r.color, borderRadius: 99 }} />
                </div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>AVG CARB RATIO</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: ACCENT }}>1u <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>per</span> 13.4g</div>
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Recent Entries</div>
          <span style={{ fontSize: 11, color: ACCENT, cursor: "pointer" }}>View all →</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
              {["Time", "Meal", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                <th key={h} style={{ padding: "7px 18px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em" }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 4).map((e, i) => {
              const ev = evalStyle(e.eval);
              return (
                <tr key={i} style={{ borderBottom: i < 3 ? `1px solid rgba(255,255,255,0.03)` : "none" }}>
                  <td style={{ padding: "9px 18px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{e.time}</td>
                  <td style={{ padding: "9px 18px", fontSize: 12, fontWeight: 500 }}>{e.meal}</td>
                  <td style={{ padding: "9px 18px", fontSize: 12, fontWeight: 600, color: e.bg > 140 ? ORANGE : e.bg < 80 ? PINK : "rgba(255,255,255,0.85)" }}>{e.bg} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>mg/dL</span></td>
                  <td style={{ padding: "9px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.carbs}g</td>
                  <td style={{ padding: "9px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.insulin}u</td>
                  <td style={{ padding: "9px 18px" }}>
                    <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em" }}>{ev.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function QuickLog() {
  const [glucose, setGlucose] = useState("");
  const [carbs, setCarbs] = useState("");
  const [insulin, setInsulin] = useState("");
  const [mealType, setMealType] = useState("BALANCED");
  const [submitted, setSubmitted] = useState(false);

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)", border: `1px solid rgba(255,255,255,0.1)`,
    borderRadius: 10, padding: "10px 14px", color: "white", fontSize: 15, fontWeight: 600,
    width: "100%", boxSizing: "border-box", outline: "none", fontFamily: "inherit",
  };

  if (submitted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16 }}>
        <div style={{ width: 60, height: 60, borderRadius: 99, background: `${GREEN}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 28, color: GREEN }}>✓</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>Entry logged</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>BG {glucose} mg/dL · {carbs}g carbs · {insulin}u</div>
        <button onClick={() => { setSubmitted(false); setGlucose(""); setCarbs(""); setInsulin(""); }} style={{ marginTop: 8, padding: "10px 24px", background: ACCENT, border: "none", borderRadius: 10, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Log Another</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 500 }}>
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Log a Meal</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.06em" }}>GLUCOSE BEFORE (mg/dL)</div>
            <input value={glucose} onChange={(e) => setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.06em" }}>CARBS (g)</div>
            <input value={carbs} onChange={(e) => setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.06em" }}>INSULIN (u)</div>
            <input value={insulin} onChange={(e) => setInsulin(e.target.value)} placeholder="e.g. 4.0" type="number" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.06em" }}>MEAL TYPE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {["BALANCED", "FAST_CARBS", "HIGH_FAT", "HIGH_PROTEIN"].map((t) => {
                const labels: Record<string, string> = { BALANCED: "Balanced", FAST_CARBS: "Fast Carbs", HIGH_FAT: "High Fat", HIGH_PROTEIN: "High Protein" };
                return (
                  <button key={t} onClick={() => setMealType(t)} style={{ padding: "10px", borderRadius: 10, border: `1px solid ${mealType === t ? ACCENT : "rgba(255,255,255,0.1)"}`, background: mealType === t ? `${ACCENT}20` : "rgba(255,255,255,0.03)", color: mealType === t ? ACCENT : "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                    {labels[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={() => { if (glucose && carbs && insulin) setSubmitted(true); }}
            style={{ marginTop: 4, padding: "14px", background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, border: "none", borderRadius: 10, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: glucose && carbs && insulin ? 1 : 0.4 }}
          >
            Log Entry
          </button>
        </div>
      </Card>
    </div>
  );
}

function EntryLog() {
  const [filter, setFilter] = useState("ALL");
  const filters = ["ALL", "GOOD", "UNDERDOSE", "OVERDOSE"];
  const filtered = filter === "ALL" ? entries : entries.filter((e) => e.eval === filter);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {filters.map((f) => {
          const colors: Record<string, string> = { ALL: ACCENT, GOOD: GREEN, UNDERDOSE: ORANGE, OVERDOSE: PINK };
          return (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 99, fontSize: 11, fontWeight: 600, border: `1px solid ${filter === f ? colors[f] : "rgba(255,255,255,0.1)"}`, background: filter === f ? `${colors[f]}18` : "transparent", color: filter === f ? colors[f] : "rgba(255,255,255,0.45)", cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.04em" }}>
              {f}
            </button>
          );
        })}
      </div>
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
              {["Time", "Meal", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em" }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const ev = evalStyle(e.eval);
              return (
                <tr key={i} style={{ borderBottom: i < filtered.length - 1 ? `1px solid rgba(255,255,255,0.03)` : "none", cursor: "pointer" }}>
                  <td style={{ padding: "11px 18px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{e.time}</td>
                  <td style={{ padding: "11px 18px", fontSize: 12, fontWeight: 500 }}>{e.meal}</td>
                  <td style={{ padding: "11px 18px", fontSize: 12, fontWeight: 600, color: e.bg > 140 ? ORANGE : e.bg < 80 ? PINK : "rgba(255,255,255,0.85)" }}>{e.bg} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>mg/dL</span></td>
                  <td style={{ padding: "11px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.carbs}g</td>
                  <td style={{ padding: "11px 18px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.insulin}u</td>
                  <td style={{ padding: "11px 18px" }}>
                    <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em" }}>{ev.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Insights() {
  const meals = [
    { type: "Balanced", avg_bg: 112, good: 71, insulin: 3.6, count: 7 },
    { type: "Fast Carbs", avg_bg: 142, good: 33, insulin: 4.8, count: 6 },
    { type: "High Fat", avg_bg: 108, good: 75, insulin: 2.1, count: 4 },
    { type: "High Protein", avg_bg: 118, good: 50, insulin: 3.0, count: 2 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
        {meals.map((m) => (
          <Card key={m.type} style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{m.type}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Avg BG Before", value: `${m.avg_bg} mg/dL`, color: m.avg_bg > 130 ? ORANGE : GREEN },
                { label: "Good outcomes", value: `${m.good}%`, color: m.good > 60 ? GREEN : ORANGE },
                { label: "Avg insulin", value: `${m.insulin}u`, color: "rgba(255,255,255,0.85)" },
                { label: "Total entries", value: `${m.count}`, color: "rgba(255,255,255,0.6)" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>SUCCESS RATE</span>
                <span style={{ fontSize: 10, color: m.good > 60 ? GREEN : ORANGE, fontWeight: 700 }}>{m.good}%</span>
              </div>
              <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${m.good}%`, height: "100%", background: m.good > 60 ? GREEN : ORANGE, borderRadius: 99 }} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Recommend() {
  const [glucose, setGlucose] = useState("");
  const [carbs, setCarbs] = useState("");
  const [mealType, setMealType] = useState("BALANCED");
  const [result, setResult] = useState<null | { units: number; ratio: number; confidence: string }>(null);

  const calc = () => {
    const g = Number(glucose); const c = Number(carbs);
    if (!g || !c) return;
    const ratio = 13.4;
    let units = c / ratio;
    if (g > 140) units += 0.5;
    if (g < 90) units -= 0.5;
    if (mealType === "FAST_CARBS") units += 0.5;
    if (mealType === "HIGH_FAT") units -= 0.5;
    units = Math.max(0.5, units);
    setResult({ units: Math.round(units * 2) / 2, ratio, confidence: "HIGH" });
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)", border: `1px solid rgba(255,255,255,0.1)`,
    borderRadius: 10, padding: "10px 14px", color: "white", fontSize: 15, fontWeight: 600,
    width: "100%", boxSizing: "border-box", outline: "none", fontFamily: "inherit",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
      <Card style={{ padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Bolus Calculator</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>CURRENT GLUCOSE (mg/dL)</div>
            <input value={glucose} onChange={(e) => setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>PLANNED CARBS (g)</div>
            <input value={carbs} onChange={(e) => setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em" }}>MEAL TYPE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {["BALANCED", "FAST_CARBS", "HIGH_FAT", "HIGH_PROTEIN"].map((t) => {
                const labels: Record<string, string> = { BALANCED: "Balanced", FAST_CARBS: "Fast Carbs", HIGH_FAT: "High Fat", HIGH_PROTEIN: "High Protein" };
                return (
                  <button key={t} onClick={() => setMealType(t)} style={{ padding: "8px", borderRadius: 8, border: `1px solid ${mealType === t ? ACCENT : "rgba(255,255,255,0.08)"}`, background: mealType === t ? `${ACCENT}20` : "transparent", color: mealType === t ? ACCENT : "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    {labels[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={calc} style={{ padding: "13px", background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, border: "none", borderRadius: 10, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: glucose && carbs ? 1 : 0.4 }}>
            Calculate Bolus
          </button>
        </div>
      </Card>

      <Card style={{ padding: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Recommendation</div>
        {result ? (
          <div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0", background: `${ACCENT}0D`, borderRadius: 12, border: `1px solid ${ACCENT}22`, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>SUGGESTED DOSE</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                <span style={{ fontSize: 56, fontWeight: 900, color: "white", letterSpacing: "-0.03em" }}>{result.units.toFixed(1)}</span>
                <span style={{ fontSize: 22, color: "rgba(255,255,255,0.4)", paddingBottom: 6 }}>u</span>
              </div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>Range {(result.units * 0.9).toFixed(1)} – {(result.units * 1.1).toFixed(1)} u</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Confidence", value: result.confidence, color: GREEN },
                { label: "Carb ratio", value: `1u per ${result.ratio}g`, color: ACCENT },
                { label: "Timing", value: mealType === "HIGH_FAT" ? "Split dose" : "Before meal", color: "rgba(255,255,255,0.7)" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8, fontSize: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>{row.label}</span>
                  <span style={{ fontWeight: 700, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: `${ACCENT}10`, borderRadius: 8, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
              Based on 14 similar balanced meals. Personal ratio 1u per {result.ratio}g carbs.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 280, color: "rgba(255,255,255,0.2)" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚡</div>
            <div style={{ fontSize: 13 }}>Enter parameters to calculate</div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── LAYOUT ──────────────────────────────────────────────────────

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: "dashboard", icon: "⊞", label: "Dashboard" },
  { id: "log", icon: "✦", label: "Quick Log" },
  { id: "entries", icon: "≡", label: "Entry Log" },
  { id: "insights", icon: "◈", label: "Insights" },
  { id: "recommend", icon: "⟲", label: "Recommend" },
  { id: "import", icon: "⬆", label: "Import" },
];

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  log: "Quick Log",
  entries: "Entry Log",
  insights: "Insights",
  recommend: "Decision Support",
  import: "Import Center",
};

export function DarkCockpit() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG, color: "white", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Sidebar */}
      <div style={{ width: 56, background: SURFACE, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", padding: "20px 10px", gap: 4, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${ACCENT}, ${PINK})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, marginBottom: 20, cursor: "pointer" }}>G</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            title={item.label}
            style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: page === item.id ? `${ACCENT}22` : "transparent", color: page === item.id ? ACCENT : "rgba(255,255,255,0.28)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
          >
            {item.icon}
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: "24px 28px", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", marginBottom: 3 }}>GLUCOJACK</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{PAGE_TITLES[page]}</h1>
          </div>
          {page !== "log" && page !== "recommend" && (
            <button onClick={() => setPage("log")} style={{ fontSize: 12, fontWeight: 600, padding: "8px 16px", borderRadius: 20, background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, border: "none", color: "white", cursor: "pointer", letterSpacing: "0.01em" }}>
              + Quick Log
            </button>
          )}
        </div>

        {page === "dashboard" && <Dashboard />}
        {page === "log" && <QuickLog />}
        {page === "entries" && <EntryLog />}
        {page === "insights" && <Insights />}
        {page === "recommend" && <Recommend />}
        {page === "import" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16, color: "rgba(255,255,255,0.3)" }}>
            <div style={{ fontSize: 48, opacity: 0.4 }}>⬆</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Import Center</div>
            <div style={{ fontSize: 13 }}>Paste tab-separated data or upload a CSV file.</div>
            <button style={{ padding: "10px 24px", background: ACCENT, border: "none", borderRadius: 10, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Upload CSV</button>
          </div>
        )}
      </div>
    </div>
  );
}
