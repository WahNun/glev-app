"use client";

/**
 * Lightweight inline SVG sparkline used in the basal expanded view.
 * Renders a 6 h CGM glucose trend with a shaded target band (70–180 mg/dL)
 * and a vertical marker at the injection time.
 *
 * Pure presentation — the parent owns fetching + filtering of readings.
 */

export interface SparklinePoint {
  /** Unix ms timestamp of the reading. */
  t: number;
  /** Glucose value in mg/dL. */
  v: number;
}

interface Props {
  /** Readings sorted ascending by timestamp. */
  points: SparklinePoint[];
  /** Window start (Unix ms) — left edge of the chart. */
  fromMs: number;
  /** Window end (Unix ms) — right edge of the chart. */
  toMs: number;
  /** Vertical marker for the injection time (Unix ms). Optional. */
  markerMs?: number;
  /** Accent colour for the line + marker. */
  color: string;
  /** Chart height in px (width is responsive via viewBox). */
  height?: number;
}

const TARGET_LO = 70;
const TARGET_HI = 180;
const Y_MIN = 40;
const Y_MAX = 300;

export default function CgmSparkline({
  points, fromMs, toMs, markerMs, color, height = 90,
}: Props) {
  const W = 600; // viewBox width — scales to container via CSS.
  const H = height;
  const padX = 4;
  const padY = 6;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  // Map a value to vertical pixel position (Y_MAX at top, Y_MIN at bottom).
  const yFor = (v: number) => {
    const clamped = Math.max(Y_MIN, Math.min(Y_MAX, v));
    const norm = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
    return padY + innerH - norm * innerH;
  };
  const xFor = (t: number) => {
    if (toMs <= fromMs) return padX;
    const norm = (t - fromMs) / (toMs - fromMs);
    return padX + Math.max(0, Math.min(1, norm)) * innerW;
  };

  const targetY1 = yFor(TARGET_HI);
  const targetY2 = yFor(TARGET_LO);

  // Build the polyline path.
  const inWindow = points.filter(p => p.t >= fromMs && p.t <= toMs);
  const path = inWindow.map((p, i) => {
    const x = xFor(p.t);
    const y = yFor(p.v);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const hasData = inWindow.length >= 2;
  const markerX = markerMs != null ? xFor(markerMs) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label="CGM glucose trend"
    >
      {/* Target band — soft green tint between 70 and 180 mg/dL. */}
      <rect
        x={padX}
        y={targetY1}
        width={innerW}
        height={Math.max(0, targetY2 - targetY1)}
        fill="rgba(34,197,160,0.08)"
      />
      {/* Lower target line. */}
      <line
        x1={padX} x2={W - padX}
        y1={targetY2} y2={targetY2}
        stroke="rgba(255,255,255,0.08)"
        strokeDasharray="3 3"
      />
      {/* Upper target line. */}
      <line
        x1={padX} x2={W - padX}
        y1={targetY1} y2={targetY1}
        stroke="rgba(255,255,255,0.08)"
        strokeDasharray="3 3"
      />
      {/* Injection marker. */}
      {markerX != null && (
        <line
          x1={markerX} x2={markerX}
          y1={padY} y2={H - padY}
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={1.5}
        />
      )}
      {/* Trend line. */}
      {hasData && (
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Reading dots — only render when we have a small enough set
          to keep them legible (> ~30 points becomes noise). */}
      {hasData && inWindow.length <= 30 && inWindow.map((p, i) => (
        <circle
          key={i}
          cx={xFor(p.t)}
          cy={yFor(p.v)}
          r={1.5}
          fill={color}
          fillOpacity={0.7}
        />
      ))}
      {/* Empty-state hint. */}
      {!hasData && (
        <text
          x={W / 2}
          y={H / 2 + 4}
          textAnchor="middle"
          fontSize={11}
          fill="rgba(255,255,255,0.35)"
        >
          No CGM readings in this window.
        </text>
      )}
    </svg>
  );
}
