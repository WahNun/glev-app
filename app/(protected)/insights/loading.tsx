export default function InsightsLoading() {
  return (
    <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <Block height={48} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Block height={96} />
        <Block height={96} />
      </div>
      <Block height={260} />
      <Block height={200} />
      <Block height={200} />
      <style>{`@keyframes glevPulse{0%,100%{opacity:.55}50%{opacity:.85}}`}</style>
    </div>
  );
}

function Block({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      style={{
        height,
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px solid var(--border-soft)",
        animation: "glevPulse 1.4s ease-in-out infinite",
      }}
    />
  );
}
