"use client";
import React from "react";

/**
 * GlevLogo — stylised β-D-glucopyranose (the cyclic form of glucose).
 *
 * The 6-membered ring is drawn as a hexagon with the ring oxygen at the
 * top (highlighted as the largest filled node). Carbons C1–C5 occupy the
 * remaining five vertices. C1–C4 each carry a hydroxyl; C5 carries the
 * CH₂OH branch (C6 then O6) drawn as the small two-node tail at the
 * upper-left.
 *
 * All coordinates fit safely inside the rounded-square frame (rx=9 in the
 * 32-unit viewBox) — including node radii — so the blue elements never
 * cross the dark container edge. A clipPath on the inner group is also
 * applied as a belt-and-braces guard against anti-aliasing leaks.
 */

type Atom = { cx: number; cy: number; role: "ringO" | "ringC" | "sub" };

const NODES: Atom[] = [
  // Ring (clockwise from top)
  { cx: 16.0,  cy: 10.5,  role: "ringO" }, // 0  O5 (highlighted)
  { cx: 20.76, cy: 13.25, role: "ringC" }, // 1  C1
  { cx: 20.76, cy: 18.75, role: "ringC" }, // 2  C2
  { cx: 16.0,  cy: 21.5,  role: "ringC" }, // 3  C3
  { cx: 11.24, cy: 18.75, role: "ringC" }, // 4  C4
  { cx: 11.24, cy: 13.25, role: "ringC" }, // 5  C5
  // Hydroxyls on C1–C4
  { cx: 24.5,  cy: 10.5,  role: "sub"   }, // 6  OH on C1 (anomeric)
  { cx: 24.5,  cy: 21.5,  role: "sub"   }, // 7  OH on C2
  { cx: 16.0,  cy: 25.5,  role: "sub"   }, // 8  OH on C3
  { cx:  7.5,  cy: 21.5,  role: "sub"   }, // 9  OH on C4
  // CH2OH branch on C5
  { cx:  7.5,  cy: 10.5,  role: "sub"   }, // 10 C6
  { cx:  4.5,  cy:  7.5,  role: "sub"   }, // 11 O6
];

const EDGES: [number, number][] = [
  // Ring bonds
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
  // Hydroxyl bonds
  [1, 6], [2, 7], [3, 8], [4, 9],
  // CH2OH tail
  [5, 10], [10, 11],
];

export default function GlevLogo({
  size = 32,
  color = "#4F6EF7",
  bg = "#0F0F14",
  style,
}: {
  size?: number;
  color?: string;
  bg?: string;
  style?: React.CSSProperties;
}) {
  // React needs unique IDs when multiple instances render side-by-side
  // (e.g. sidebar + bottom nav), so derive one per call.
  const clipId = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={style} aria-label="Glev">
      <defs>
        <clipPath id={clipId}>
          <rect width="32" height="32" rx="9" />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="9" fill={bg} />
      <g clipPath={`url(#${clipId})`}>
        {EDGES.map(([a, b], i) => (
          <line
            key={`e${i}`}
            x1={NODES[a].cx} y1={NODES[a].cy}
            x2={NODES[b].cx} y2={NODES[b].cy}
            stroke={color} strokeWidth="0.9" strokeOpacity="0.55" strokeLinecap="round"
          />
        ))}
        {NODES.map((n, i) => {
          if (n.role === "ringO") {
            return <circle key={`n${i}`} cx={n.cx} cy={n.cy} r={3.5} fill={color} />;
          }
          if (n.role === "ringC") {
            return (
              <circle key={`n${i}`} cx={n.cx} cy={n.cy} r={2.2}
                fill={`${color}40`} stroke={color} strokeWidth={0.85} />
            );
          }
          return (
            <circle key={`n${i}`} cx={n.cx} cy={n.cy} r={1.55}
              fill={`${color}30`} stroke={color} strokeWidth={0.7} />
          );
        })}
      </g>
    </svg>
  );
}
