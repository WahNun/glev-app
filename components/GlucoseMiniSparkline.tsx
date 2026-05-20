"use client";

import { useEffect, useRef, useState } from "react";
import {
  useCrosshair,
  CrosshairOverlay,
  CrosshairTooltip,
  type CrosshairPoint,
} from "@/components/ChartCrosshair";

/**
 * A named glucose data point for GlucoseMiniSparkline.
 * `t`     — Unix ms timestamp (used for x-axis ordering + tooltip).
 * `v`     — Glucose value in mg/dL.
 * `label` — Short label shown in the crosshair tooltip (e.g. "AT LOG", "+1H").
 */
export interface GlucoseMiniPoint {
  t: number;
  v: number;
  label: string;
}

interface Props {
  /** Data points (may be sparse — null values should be filtered out by the caller). */
  points: GlucoseMiniPoint[];
  /** Accent colour for the line, dots, and crosshair. */
  color: string;
  /** Chart height in px. Width is fully responsive. Defaults to 72. */
  height?: number;
  /** Locale string for crosshair time formatting. Defaults to "en". */
  locale?: string;
}

const Y_PAD_PCT = 0.15;
const PAD_X = 20;
const PAD_Y = 8;

export default function GlucoseMiniSparkline({
  points,
  color,
  height = 72,
  locale = "en",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) return null;

  const W = width;
  const H = height;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const sorted = [...points].sort((a, b) => a.t - b.t);
  const tMin = sorted[0].t;
  const tMax = sorted[sorted.length - 1].t;
  const vMin = Math.min(...sorted.map((p) => p.v));
  const vMax = Math.max(...sorted.map((p) => p.v));

  const vRange = Math.max(vMax - vMin, 30);
  const vLo = vMin - vRange * Y_PAD_PCT;
  const vHi = vMax + vRange * Y_PAD_PCT;

  const xFor = (t: number) => {
    if (tMax <= tMin) return PAD_X + innerW / 2;
    return PAD_X + ((t - tMin) / (tMax - tMin)) * innerW;
  };
  const yFor = (v: number) => {
    const norm = (v - vLo) / (vHi - vLo);
    return PAD_Y + innerH - Math.max(0, Math.min(1, norm)) * innerH;
  };

  const pathD = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yFor(p.v).toFixed(1)}`)
    .join(" ");

  const crosshairPoints: CrosshairPoint[] = sorted.map((p) => ({
    x: xFor(p.t),
    y: yFor(p.v),
    color,
    tooltip: [
      p.label,
      `${Math.round(p.v)} mg/dL`,
    ],
  }));

  const { active, handlers } = useCrosshair(crosshairPoints);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", position: "relative" }}
      {...handlers}
    >
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Glucose trend"
          style={{ display: "block" }}
        >
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={0.85}
          />
          {sorted.map((p, i) => (
            <circle
              key={i}
              cx={xFor(p.t)}
              cy={yFor(p.v)}
              r={4}
              fill={color}
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
          ))}
          <CrosshairOverlay
            active={active}
            top={PAD_Y}
            bottom={H - PAD_Y}
            left={PAD_X}
            right={W - PAD_X}
          />
        </svg>
      )}
      <CrosshairTooltip active={active} containerWidth={W} containerHeight={H} />
    </div>
  );
}
