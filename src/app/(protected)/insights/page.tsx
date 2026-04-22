const ACCENT = "#4F6EF7";

export default function InsightsPage() {
  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Insights</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Advanced analytics — coming soon</p>
      </div>
      <div style={{
        background: "#111117", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18,
        padding: "60px 40px", textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.4 }}>◈</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>Coming Soon</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
          Meal pattern analysis, insulin-to-carb ratios, and personalized recommendations will appear here.
        </div>
      </div>
    </div>
  );
}
