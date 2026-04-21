export function DarkCockpit() {
  const glucosePoints = [112, 128, 95, 185, 130, 105, 105, 138, 88, 210, 120, 92, 99, 125, 108, 140];
  const maxG = 220;
  const minG = 60;
  const w = 560;
  const h = 120;

  const toY = (g: number) => h - ((g - minG) / (maxG - minG)) * h;
  const toX = (i: number) => (i / (glucosePoints.length - 1)) * w;

  const pathD = glucosePoints
    .map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`)
    .join(" ");

  const areaD =
    pathD +
    ` L ${w} ${h} L 0 ${h} Z`;

  const entries = [
    { time: "Today 12:30", meal: "Quinoa bowl", type: "BALANCED", bg: 108, carbs: 55, insulin: 5.5, eval: "GOOD" },
    { time: "Yesterday 19:15", meal: "Pizza night", type: "FAST_CARBS", bg: 88, carbs: 80, insulin: 5.0, eval: "UNDERDOSE" },
    { time: "Yesterday 12:00", meal: "Avocado eggs", type: "HIGH_FAT", bg: 120, carbs: 25, insulin: 4.0, eval: "GOOD" },
    { time: "Apr 19 19:00", meal: "Brown rice bowl", type: "BALANCED", bg: 105, carbs: 50, insulin: 5.5, eval: "GOOD" },
    { time: "Apr 18 20:00", meal: "Grilled chicken", type: "HIGH_PROTEIN", bg: 130, carbs: 30, insulin: 6.0, eval: "OVERDOSE" },
  ];

  const evalStyle = (e: string) => {
    if (e === "GOOD") return { color: "#22D3A0", label: "GOOD" };
    if (e === "UNDERDOSE") return { color: "#FF9500", label: "LOW DOSE" };
    if (e === "OVERDOSE") return { color: "#FF2D78", label: "OVERDOSE" };
    return { color: "#8B8FA8", label: "CHECK" };
  };

  const typeLabel = (t: string) => {
    const m: Record<string, string> = {
      BALANCED: "Balanced", FAST_CARBS: "Fast Carbs",
      HIGH_FAT: "High Fat", HIGH_PROTEIN: "High Protein"
    };
    return m[t] ?? t;
  };

  return (
    <div
      className="min-h-screen font-sans text-white"
      style={{ background: "#09090B", fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Sidebar */}
      <div className="flex min-h-screen">
        <div
          className="flex flex-col py-6 px-3 gap-1"
          style={{ width: 56, background: "#111117", borderRight: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Logo */}
          <div
            className="flex items-center justify-center mb-6 rounded-xl"
            style={{ width: 36, height: 36, background: "linear-gradient(135deg, #4F6EF7, #FF2D78)" }}
          >
            <span style={{ fontSize: 16, fontWeight: 900 }}>G</span>
          </div>
          {[
            { icon: "⊞", active: true },
            { icon: "✦", active: false },
            { icon: "≡", active: false },
            { icon: "◈", active: false },
            { icon: "⟲", active: false },
          ].map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-center rounded-xl"
              style={{
                width: 36, height: 36, fontSize: 14,
                background: item.active ? "rgba(79,110,247,0.15)" : "transparent",
                color: item.active ? "#4F6EF7" : "rgba(255,255,255,0.3)",
                cursor: "pointer"
              }}
            >
              {item.icon}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-6 overflow-auto" style={{ maxWidth: 1224 }}>

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                GlucoJack
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Dashboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <div
                style={{
                  fontSize: 12, padding: "7px 16px", borderRadius: 20,
                  background: "linear-gradient(135deg, #4F6EF7, #6B8BFF)",
                  fontWeight: 600, cursor: "pointer", letterSpacing: "0.01em"
                }}
              >
                + Quick Log
              </div>
            </div>
          </div>

          {/* Metric strip */}
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {[
              { label: "Control Score", value: "75", unit: "/100", sub: "Last 8 entries", color: "#4F6EF7", bar: 75 },
              { label: "Time in Range", value: "62.5", unit: "%", sub: "5 of 8 entries", color: "#22D3A0", bar: 62.5 },
              { label: "Spike Rate", value: "25.0", unit: "%", sub: "Hyperglycemia events", color: "#FF9500", bar: 25 },
              { label: "Hypo Rate", value: "0.0", unit: "%", sub: "Hypoglycemia events", color: "#FF2D78", bar: 0 },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  background: "#111117",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 14,
                  padding: "16px 18px",
                }}
              >
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.04em" }}>
                  {m.label.toUpperCase()}
                </div>
                <div className="flex items-end gap-1 mb-3">
                  <span style={{ fontSize: 28, fontWeight: 800, color: m.color, letterSpacing: "-0.03em" }}>{m.value}</span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", paddingBottom: 3 }}>{m.unit}</span>
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${m.bar}%`, height: "100%", background: m.color, borderRadius: 99 }} />
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "1.8fr 1fr" }}>
            {/* Glucose chart */}
            <div style={{ background: "#111117", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "18px 20px" }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Glucose Trend</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Pre-meal readings, last 7 days</div>
                </div>
                <div style={{ fontSize: 11, padding: "4px 10px", background: "rgba(79,110,247,0.15)", color: "#4F6EF7", borderRadius: 99, fontWeight: 500 }}>7d</div>
              </div>
              <div style={{ position: "relative", height: 130 }}>
                {/* Target zone */}
                <div style={{
                  position: "absolute",
                  left: 0, right: 0,
                  top: `${((maxG - 140) / (maxG - minG)) * 100}%`,
                  height: `${((140 - 80) / (maxG - minG)) * 100}%`,
                  background: "rgba(34,211,160,0.06)",
                  borderTop: "1px dashed rgba(34,211,160,0.3)",
                  borderBottom: "1px dashed rgba(34,211,160,0.3)",
                }} />
                {/* Hypo line */}
                <div style={{
                  position: "absolute",
                  left: 0, right: 0,
                  top: `${((maxG - 70) / (maxG - minG)) * 100}%`,
                  borderTop: "1px dashed rgba(255,45,120,0.4)",
                }} />
                <svg width="100%" height={h + 10} viewBox={`0 0 ${w} ${h + 10}`} preserveAspectRatio="none" style={{ display: "block" }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4F6EF7" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#4F6EF7" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaD} fill="url(#areaGrad)" />
                  <path d={pathD} fill="none" stroke="#4F6EF7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {glucosePoints.map((g, i) => (
                    g > 180 ? (
                      <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill="#FF9500" />
                    ) : g < 70 ? (
                      <circle key={i} cx={toX(i)} cy={toY(g)} r={3.5} fill="#FF2D78" />
                    ) : null
                  ))}
                </svg>
                {/* Y axis labels */}
                <div style={{ position: "absolute", left: -28, top: 0, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>220</div>
                <div style={{ position: "absolute", left: -28, top: "40%", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>140</div>
                <div style={{ position: "absolute", left: -28, bottom: 0, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>60</div>
              </div>
            </div>

            {/* Breakdown donut */}
            <div style={{ background: "#111117", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Outcome Breakdown</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>Evaluation distribution</div>
              <div className="flex flex-col gap-2">
                {[
                  { label: "GOOD", count: 5, pct: 62.5, color: "#22D3A0" },
                  { label: "UNDERDOSE", count: 2, pct: 25.0, color: "#FF9500" },
                  { label: "OVERDOSE", count: 1, pct: 12.5, color: "#FF2D78" },
                  { label: "CHECK", count: 0, pct: 0, color: "#4B5070" },
                ].map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: r.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="flex justify-between" style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>{r.label}</span>
                        <span style={{ fontSize: 10, color: r.color, fontWeight: 600 }}>{r.count}</span>
                      </div>
                      <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${r.pct}%`, height: "100%", background: r.color, borderRadius: 99 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick stat */}
              <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>AVG INSULIN / CARBS</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#4F6EF7" }}>1u <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>per</span> 9.8g</div>
              </div>
            </div>
          </div>

          {/* Recent entries */}
          <div style={{ background: "#111117", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden" }}>
            <div className="flex items-center justify-between" style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Recent Entries</div>
              <div style={{ fontSize: 11, color: "#4F6EF7", cursor: "pointer" }}>View all →</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {["Time", "Meal", "Type", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                    <th key={h} style={{ padding: "8px 20px", textAlign: "left", fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em" }}>
                      {h.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const ev = evalStyle(e.eval);
                  return (
                    <tr key={i} style={{ borderBottom: i < entries.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                      <td style={{ padding: "10px 20px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{e.time}</td>
                      <td style={{ padding: "10px 20px", fontSize: 12, fontWeight: 500 }}>{e.meal}</td>
                      <td style={{ padding: "10px 20px" }}>
                        <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>
                          {typeLabel(e.type)}
                        </span>
                      </td>
                      <td style={{ padding: "10px 20px", fontSize: 12, fontWeight: 600, color: e.bg > 140 ? "#FF9500" : e.bg < 80 ? "#FF2D78" : "rgba(255,255,255,0.85)" }}>
                        {e.bg} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>mg/dL</span>
                      </td>
                      <td style={{ padding: "10px 20px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.carbs}g</td>
                      <td style={{ padding: "10px 20px", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{e.insulin}u</td>
                      <td style={{ padding: "10px 20px" }}>
                        <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, fontWeight: 700, background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em" }}>
                          {ev.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  );
}
