export default function EntriesLoading() {
  return (
    <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <LogoBlock />
      <Block height={44} />
      <Block height={88} />
      <Block height={88} />
      <Block height={88} />
      <Block height={88} />
      <Block height={88} />
      <style>{`@keyframes glevPulse{0%,100%{opacity:.55}50%{opacity:.85}}`}</style>
    </div>
  );
}

function LogoBlock() {
  return (
    <div
      aria-hidden
      style={{ display: "flex", justifyContent: "center", paddingTop: 8, paddingBottom: 4 }}
    >
      <InlineLogo />
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

function InlineLogo() {
  const color = "#4F6EF7";
  const bg = "var(--surface)";
  const nodes = [
    { cx: 16, cy: 7 }, { cx: 25, cy: 12 }, { cx: 25, cy: 20 },
    { cx: 18, cy: 26 }, { cx: 9, cy: 22 }, { cx: 7, cy: 14 }, { cx: 16, cy: 16 },
  ];
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
    [0, 6], [1, 6], [2, 6], [3, 6],
  ];
  return (
    <svg width={40} height={40} viewBox="0 0 32 32" fill="none" aria-label="Glev">
      <rect width="32" height="32" rx="9" fill={bg} />
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a].cx} y1={nodes[a].cy}
          x2={nodes[b].cx} y2={nodes[b].cy}
          stroke={color} strokeWidth="0.9" strokeOpacity="0.55"
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.cx} cy={n.cy}
          r={i === 6 ? 3.5 : 2}
          fill={i === 6 ? color : `${color}40`}
          stroke={color}
          strokeWidth={i === 6 ? 0 : 0.8}
        />
      ))}
    </svg>
  );
}
