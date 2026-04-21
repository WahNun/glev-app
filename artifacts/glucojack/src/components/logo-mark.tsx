import React from "react";

const NODES = [
  { cx: 16, cy: 7 },
  { cx: 25, cy: 12 },
  { cx: 25, cy: 20 },
  { cx: 18, cy: 26 },
  { cx: 9, cy: 22 },
  { cx: 7, cy: 14 },
  { cx: 16, cy: 16 },
];

const EDGES = [
  [0, 1],[1, 2],[2, 3],[3, 4],[4, 5],[5, 0],[0, 6],[1, 6],[2, 6],[3, 6],
];

const BLUE = "#4F6EF7";

export function GlevLogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Glev logo"
    >
      <rect width="32" height="32" rx="9" fill="#0F0F14" />
      {EDGES.map(([a, b], i) => (
        <line
          key={i}
          x1={NODES[a].cx} y1={NODES[a].cy}
          x2={NODES[b].cx} y2={NODES[b].cy}
          stroke={BLUE}
          strokeWidth="0.9"
          strokeOpacity="0.55"
        />
      ))}
      {NODES.map((n, i) => (
        <circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r={i === 6 ? 3.5 : 2}
          fill={i === 6 ? BLUE : `${BLUE}40`}
          stroke={BLUE}
          strokeWidth={i === 6 ? 0 : 0.8}
        />
      ))}
    </svg>
  );
}
