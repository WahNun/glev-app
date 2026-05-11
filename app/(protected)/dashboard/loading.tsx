export default function DashboardLoading() {
  return (
    <div style={{ padding: "16px 16px 96px", display: "flex", flexDirection: "column", gap: 16 }}>
      <Block height={56} />
      <Block height={180} />
      <Block height={140} />
      <Block height={140} />
      <Block height={220} />
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
