// Server-safe branded loading skeleton — no "use client" needed.
// Used from both server components (loading.tsx) and client components (page.tsx inline guards).

const ACCENT = "#4F6EF7";

const NODES = [
  { cx: 16, cy: 7 },  { cx: 25, cy: 12 }, { cx: 25, cy: 20 },
  { cx: 18, cy: 26 }, { cx: 9,  cy: 22 }, { cx: 7,  cy: 14 }, { cx: 16, cy: 16 },
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
  [0, 6], [1, 6], [2, 6], [3, 6],
];

const CSS = `
  @keyframes glevPulse    { 0%,100%{opacity:.45} 50%{opacity:.82} }
  @keyframes glevShimmer  { 0%{background-position:-200% center} 100%{background-position:200% center} }
  @keyframes glevLogoBeat { 0%,100%{opacity:.72;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
  .glev-skel {
    background: linear-gradient(90deg,
      var(--surface) 25%,
      ${ACCENT}14    50%,
      var(--surface) 75%
    );
    background-size: 400% 100%;
    border-radius: 16px;
    border: 1px solid var(--border-soft);
    animation: glevShimmer 2s ease-in-out infinite, glevPulse 2s ease-in-out infinite;
  }
`;

export default function GlevLoadingPattern() {
  return (
    <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{CSS}</style>

      {/* Glev logo — center-aligned, gentle beat */}
      <div
        aria-hidden
        style={{ display: "flex", justifyContent: "center", paddingTop: 8, paddingBottom: 4 }}
      >
        <svg
          width={44} height={44} viewBox="0 0 32 32" fill="none"
          style={{ animation: "glevLogoBeat 2s ease-in-out infinite" }}
          aria-hidden
        >
          <rect width="32" height="32" rx="9" fill="var(--surface)" />
          {EDGES.map(([a, b], i) => (
            <line
              key={i}
              x1={NODES[a].cx} y1={NODES[a].cy}
              x2={NODES[b].cx} y2={NODES[b].cy}
              stroke={ACCENT} strokeWidth="0.9" strokeOpacity="0.55"
            />
          ))}
          {NODES.map((n, i) => (
            <circle
              key={i}
              cx={n.cx} cy={n.cy}
              r={i === 6 ? 3.5 : 2}
              fill={i === 6 ? ACCENT : `${ACCENT}40`}
              stroke={ACCENT}
              strokeWidth={i === 6 ? 0 : 0.8}
            />
          ))}
        </svg>
      </div>

      {/* Card-shaped shimmer skeletons matching the dashboard cluster heights */}
      <div className="glev-skel" style={{ height: 56 }} />
      <div className="glev-skel" style={{ height: 180 }} />
      <div className="glev-skel" style={{ height: 140 }} />
      <div className="glev-skel" style={{ height: 140 }} />
      <div className="glev-skel" style={{ height: 220 }} />
    </div>
  );
}
