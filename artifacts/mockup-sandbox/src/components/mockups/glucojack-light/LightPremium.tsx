export function LightPremium() {
  const glucosePoints = [112, 128, 95, 185, 130, 105, 105, 138, 88, 210, 120, 92, 99, 125, 108, 140];
  const maxG = 220;
  const minG = 60;
  const w = 560;
  const h = 110;

  const toY = (g: number) => h - ((g - minG) / (maxG - minG)) * h;
  const toX = (i: number) => (i / (glucosePoints.length - 1)) * w;

  const pathD = glucosePoints
    .map((g, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(g).toFixed(1)}`)
    .join(" ");

  const areaD = pathD + ` L ${w} ${h} L 0 ${h} Z`;

  const entries = [
    { time: "12:30", meal: "Quinoa bowl", type: "BALANCED", bg: 108, carbs: 55, insulin: 5.5, eval: "GOOD" },
    { time: "Yesterday", meal: "Pizza night", type: "FAST_CARBS", bg: 88, carbs: 80, insulin: 5.0, eval: "UNDERDOSE" },
    { time: "Yesterday", meal: "Avocado eggs", type: "HIGH_FAT", bg: 120, carbs: 25, insulin: 4.0, eval: "GOOD" },
    { time: "Apr 19", meal: "Brown rice bowl", type: "BALANCED", bg: 105, carbs: 50, insulin: 5.5, eval: "GOOD" },
    { time: "Apr 18", meal: "Grilled chicken", type: "HIGH_PROTEIN", bg: 130, carbs: 30, insulin: 6.0, eval: "OVERDOSE" },
  ];

  const evalBadge = (e: string) => {
    if (e === "GOOD") return { bg: "#E8FBF4", text: "#0D9467", label: "Good" };
    if (e === "UNDERDOSE") return { bg: "#FFF4E3", text: "#C06000", label: "Low dose" };
    if (e === "OVERDOSE") return { bg: "#FFECF1", text: "#C8004A", label: "Overdose" };
    return { bg: "#F2F2F7", text: "#636366", label: "Review" };
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
      className="min-h-screen"
      style={{ background: "#F2F2F7", fontFamily: "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif", color: "#1D1D1F" }}
    >
      <div className="flex min-h-screen">

        {/* Sidebar — Apple-style frosted nav */}
        <div
          className="flex flex-col py-5 px-4 gap-1"
          style={{
            width: 220,
            background: "rgba(255,255,255,0.82)",
            backdropFilter: "blur(20px)",
            borderRight: "1px solid rgba(0,0,0,0.06)",
            flexShrink: 0,
          }}
        >
          {/* Logo lockup */}
          <div className="flex items-center gap-2 mb-6 px-2">
            <div
              style={{
                width: 30, height: 30, borderRadius: 9,
                background: "linear-gradient(135deg, #4F6EF7 0%, #FF2D78 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ color: "white", fontSize: 13, fontWeight: 800 }}>G</span>
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#1D1D1F", letterSpacing: "-0.02em" }}>GlucoJack</span>
          </div>

          {[
            { icon: "⊞", label: "Dashboard", active: true },
            { icon: "✦", label: "Quick Log", active: false },
            { icon: "≡", label: "Entry Log", active: false },
            { icon: "◈", label: "Insights", active: false },
            { icon: "⟲", label: "Recommend", active: false },
            { icon: "⬆", label: "Import", active: false },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-xl px-3 py-2"
              style={{
                background: item.active ? "rgba(79,110,247,0.10)" : "transparent",
                color: item.active ? "#3B5BFF" : "#636366",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ fontSize: 13, width: 16, textAlign: "center" }}>{item.icon}</span>
              <span style={{ fontSize: 13, fontWeight: item.active ? 600 : 400 }}>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Main */}
        <div className="flex-1 overflow-auto" style={{ padding: "28px 32px" }}>

          {/* Page header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, color: "#1D1D1F" }}>
                Dashboard
              </h1>
              <p style={{ fontSize: 13, color: "#8E8E93", marginTop: 4 }}>
                Tuesday, April 21 — Your metabolic performance summary
              </p>
            </div>
            <button
              style={{
                fontSize: 13, fontWeight: 600, padding: "9px 18px", borderRadius: 20,
                background: "#3B5BFF", color: "white", border: "none", cursor: "pointer",
                boxShadow: "0 4px 14px rgba(59,91,255,0.35)",
              }}
            >
              + Quick Log
            </button>
          </div>

          {/* Stats grid */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {[
              { label: "Control Score", value: "75", unit: "/100", trend: "+3 vs last week", trendUp: true, accent: "#3B5BFF" },
              { label: "Time in Range", value: "62.5%", unit: "", trend: "5 of 8 entries", trendUp: null, accent: "#0D9467" },
              { label: "Spike Rate", value: "25.0%", unit: "", trend: "2 hyperglycemia events", trendUp: false, accent: "#C06000" },
              { label: "Hypo Rate", value: "0.0%", unit: "", trend: "No hypoglycemia", trendUp: true, accent: "#C8004A" },
            ].map((m) => (
              <div
                key={m.label}
                style={{
                  background: "white",
                  borderRadius: 16,
                  padding: "18px 20px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
                  border: "1px solid rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 10, fontWeight: 500, letterSpacing: "0.02em" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", color: "#1D1D1F", marginBottom: 6 }}>
                  {m.value}
                  {m.unit && <span style={{ fontSize: 14, fontWeight: 500, color: "#8E8E93" }}>{m.unit}</span>}
                </div>
                <div style={{ fontSize: 11, color: m.trendUp === true ? "#0D9467" : m.trendUp === false ? "#C06000" : "#8E8E93" }}>
                  {m.trend}
                </div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
            {/* Glucose trend */}
            <div
              style={{
                background: "white",
                borderRadius: 16,
                padding: "20px 22px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                border: "1px solid rgba(0,0,0,0.05)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1D1D1F" }}>Glucose Trend</div>
                  <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 2 }}>Pre-meal readings · 7 days</div>
                </div>
                <div className="flex gap-1">
                  {["7d", "14d", "30d"].map((t, i) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11, padding: "4px 10px", borderRadius: 99, cursor: "pointer",
                        background: i === 0 ? "#3B5BFF" : "rgba(0,0,0,0.04)",
                        color: i === 0 ? "white" : "#636366",
                        fontWeight: i === 0 ? 600 : 400,
                      }}
                    >{t}</span>
                  ))}
                </div>
              </div>

              {/* Target range annotation */}
              <div style={{ position: "relative", height: 130 }}>
                <div style={{
                  position: "absolute", left: 0, right: 0,
                  top: `${((maxG - 140) / (maxG - minG)) * 100}%`,
                  height: `${((140 - 80) / (maxG - minG)) * 100}%`,
                  background: "rgba(13,148,103,0.05)",
                  borderTop: "1px solid rgba(13,148,103,0.2)",
                  borderBottom: "1px solid rgba(13,148,103,0.2)",
                }} />
                <div style={{
                  position: "absolute", left: 0, right: 0,
                  top: `${((maxG - 70) / (maxG - minG)) * 100}%`,
                  borderTop: "1px dashed rgba(200,0,74,0.3)",
                }} />
                <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
                  <defs>
                    <linearGradient id="lightGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B5BFF" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="#3B5BFF" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaD} fill="url(#lightGrad)" />
                  <path d={pathD} fill="none" stroke="#3B5BFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  {glucosePoints.map((g, i) =>
                    g > 180 ? (
                      <circle key={i} cx={toX(i)} cy={toY(g)} r={4} fill="white" stroke="#C06000" strokeWidth="2" />
                    ) : null
                  )}
                </svg>
                {/* Legend */}
                <div className="flex gap-3 mt-3" style={{ position: "absolute", bottom: -18 }}>
                  {[
                    { color: "rgba(13,148,103,0.6)", label: "Target range 80–140" },
                    { color: "#C8004A", label: "Hypo threshold", dashed: true },
                    { color: "#C06000", label: "Spike detected", circle: true },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      {l.circle ? (
                        <div style={{ width: 8, height: 8, borderRadius: 99, background: "white", border: `2px solid ${l.color}` }} />
                      ) : (
                        <div style={{ width: 14, height: 1.5, background: l.color, borderStyle: l.dashed ? "dashed" : "solid" }} />
                      )}
                      <span style={{ fontSize: 10, color: "#8E8E93" }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Breakdown */}
            <div
              style={{
                background: "white",
                borderRadius: 16,
                padding: "20px 22px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                border: "1px solid rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1D1D1F", marginBottom: 2 }}>Outcomes</div>
              <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 18 }}>8 total entries logged</div>

              <div className="flex flex-col gap-3">
                {[
                  { label: "Good", count: 5, pct: 62.5, color: "#0D9467", bg: "#E8FBF4" },
                  { label: "Underdose", count: 2, pct: 25, color: "#C06000", bg: "#FFF4E3" },
                  { label: "Overdose", count: 1, pct: 12.5, color: "#C8004A", bg: "#FFECF1" },
                  { label: "Review", count: 0, pct: 0, color: "#8E8E93", bg: "#F2F2F7" },
                ].map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: r.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: r.color }}>{r.count}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="flex justify-between items-center mb-1">
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#1D1D1F" }}>{r.label}</span>
                        <span style={{ fontSize: 11, color: "#8E8E93" }}>{r.pct}%</span>
                      </div>
                      <div style={{ height: 4, background: "#F2F2F7", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${r.pct}%`, height: "100%", background: r.color, borderRadius: 99 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 3 }}>Avg carb ratio</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#1D1D1F" }}>
                  1u <span style={{ color: "#8E8E93", fontWeight: 400 }}>per</span> 9.8g carbs
                </div>
              </div>
            </div>
          </div>

          {/* Entry table */}
          <div
            style={{
              background: "white",
              borderRadius: 16,
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              border: "1px solid rgba(0,0,0,0.05)",
              overflow: "hidden",
            }}
          >
            <div className="flex items-center justify-between" style={{ padding: "14px 22px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1D1D1F" }}>Recent Entries</div>
              <div style={{ fontSize: 13, color: "#3B5BFF", fontWeight: 500, cursor: "pointer" }}>View all →</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#FAFAFA" }}>
                  {["Time", "Meal", "Type", "BG Before", "Carbs", "Insulin", "Result"].map((h) => (
                    <th key={h} style={{ padding: "9px 22px", textAlign: "left", fontSize: 11, color: "#8E8E93", fontWeight: 500, letterSpacing: "0.03em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const ev = evalBadge(e.eval);
                  return (
                    <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                      <td style={{ padding: "11px 22px", fontSize: 12, color: "#8E8E93" }}>{e.time}</td>
                      <td style={{ padding: "11px 22px", fontSize: 13, fontWeight: 500, color: "#1D1D1F" }}>{e.meal}</td>
                      <td style={{ padding: "11px 22px" }}>
                        <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 8, background: "rgba(0,0,0,0.04)", color: "#636366", fontWeight: 500 }}>
                          {typeLabel(e.type)}
                        </span>
                      </td>
                      <td style={{ padding: "11px 22px", fontSize: 13, fontWeight: 600, color: e.bg > 140 ? "#C06000" : e.bg < 80 ? "#C8004A" : "#1D1D1F" }}>
                        {e.bg} <span style={{ fontSize: 11, fontWeight: 400, color: "#8E8E93" }}>mg/dL</span>
                      </td>
                      <td style={{ padding: "11px 22px", fontSize: 13, color: "#1D1D1F" }}>{e.carbs}g</td>
                      <td style={{ padding: "11px 22px", fontSize: 13, color: "#1D1D1F" }}>{e.insulin}u</td>
                      <td style={{ padding: "11px 22px" }}>
                        <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: ev.bg, color: ev.text, fontWeight: 600 }}>
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
