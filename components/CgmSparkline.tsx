"use client";

import { useEffect, useRef, useState } from "react";
import {
  useCrosshair,
  CrosshairOverlay,
  CrosshairTooltip,
  type CrosshairPoint,
} from "@/components/ChartCrosshair";

/**
 * Lightweight inline SVG sparkline used in the basal expanded view.
 * Renders a 6 h CGM glucose trend with a shaded target band (70–180 mg/dL)
 * and a vertical marker at the injection time.
 *
 * Manual fingerstick readings (when supplied) overlay as colored dots
 * matching the dashboard's live 12 h glucose card (see
 * `components/CurrentDayGlucoseCard.tsx` `RollingChart`):
 *   • halo r=9 @ 0.15 opacity + inner r=4.5 with surface stroke
 *   • value-derived color via `glucoseLineColor()`
 *   • SVG `<title>` element renders a native tooltip on hover that
 *     includes the "Manual" badge wording, so users see the same
 *     "this is a hand-entered reading" signal as on the dashboard.
 *
 * The chart measures its container and renders in true pixel space so
 * dots stay perfectly round regardless of container aspect ratio.
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
  /** Optional manual fingerstick readings within the same window. */
  fingersticks?: SparklinePoint[];
  /** Window start (Unix ms) — left edge of the chart. */
  fromMs: number;
  /** Window end (Unix ms) — right edge of the chart. */
  toMs: number;
  /** Vertical marker for the injection time (Unix ms). Optional. */
  markerMs?: number;
  /** Accent colour for the line + marker. */
  color: string;
  /** Chart height in px (width is responsive via container measurement). */
  height?: number;
  /** Localised "Manual" label for fingerstick tooltips. Defaults to "Manual". */
  manualLabel?: string;
  /** Locale for tooltip time formatting. */
  locale?: string;
}

const TARGET_LO = 70;
const TARGET_HI = 180;
const Y_MIN = 40;
const Y_MAX = 300;

export default function CgmSparkline({
  points,
  fingersticks = [],
  fromMs,
  toMs,
  markerMs,
  color,
  height = 90,
  manualLabel = "Manual",
  locale = "en",
}: Props) {
  // Measure container so the SVG renders in true pixel space (no aspect
  // distortion — fingerstick dots stay round).
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(600);

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

  const W = width;
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
  const inWindow = points.filter((p) => p.t >= fromMs && p.t <= toMs);
  const path = inWindow
    .map((p, i) => {
      const x = xFor(p.t);
      const y = yFor(p.v);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const hasData = inWindow.length >= 2;
  const markerX = markerMs != null ? xFor(markerMs) : null;

  const fsInWindow = fingersticks.filter((p) => p.t >= fromMs && p.t <= toMs);

  // Build crosshair points from inWindow CGM readings.
  const crosshairPoints: CrosshairPoint[] = inWindow.map((p) => ({
    x: xFor(p.t),
    y: yFor(p.v),
    color,
    tooltip: [
      new Date(p.t).toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      `${Math.round(p.v)} mg/dL`,
    ],
  }));

  const { active, handlers } = useCrosshair(crosshairPoints);

  return (
    <div ref={containerRef} style={{ width: "100%", position: "relative" }} {...handlers}>
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="CGM glucose trend"
          style={{ display: "block" }}
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
            x1={padX}
            x2={W - padX}
            y1={targetY2}
            y2={targetY2}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          {/* Upper target line. */}
          <line
            x1={padX}
            x2={W - padX}
            y1={targetY1}
            y2={targetY1}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          {/* Injection marker. */}
          {markerX != null && (
            <line
              x1={markerX}
              x2={markerX}
              y1={padY}
              y2={H - padY}
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
          {hasData &&
            inWindow.length <= 30 &&
            inWindow.map((p, i) => (
              <circle
                key={i}
                cx={xFor(p.t)}
                cy={yFor(p.v)}
                r={1.5}
                fill={color}
                fillOpacity={0.7}
              />
            ))}
          {/* Manual fingerstick markers — same shape/size/coloring as
              the crosshair-active dot in `ChartCrosshair.tsx` and the
              dashboard live chart. Color is value-derived so a manually
              entered value reads at a glance. <title> drives the
              native browser tooltip with the "Manual" badge wording. */}
          {fsInWindow.map((p, i) => {
            const cx = xFor(p.t);
            const cy = yFor(p.v);
            const c = glucoseLineColor(p.v);
            const time = new Date(p.t).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });
            return (
              <g key={`fs-${i}-${p.t}`}>
                <title>{`${manualLabel}: ${Math.round(p.v)} mg/dL · ${time}`}</title>
                <circle cx={cx} cy={cy} r={9} fill={c} fillOpacity={0.15} />
                <circle
                  cx={cx}
                  cy={cy}
                  r={4.5}
                  fill={c}
                  stroke="var(--surface)"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
          {/* Empty-state hint. */}
          {!hasData && fsInWindow.length === 0 && (
            <text
              x={W / 2}
              y={H / 2 + 4}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-faint)"
            >
              No CGM readings in this window.
            </text>
          )}
          {/* Crosshair — rendered last so it draws on top of everything. */}
          <CrosshairOverlay
            active={active}
            top={padY}
            bottom={H - padY}
            left={padX}
            right={W - padX}
          />
        </svg>
      )}
      <CrosshairTooltip
        active={active}
        containerWidth={W}
        containerHeight={H}
      />
    </div>
  );
}

/**
 * Smooth value-derived color ramp for glucose markers — kept in sync with
 * `glucoseLineColor()` in `components/CurrentDayGlucoseCard.tsx` so the
 * fingerstick dots here look identical to the ones on the dashboard.
 *
 * Palette (Tailwind 500-shade reference):
 *   <55 mg/dL     → RED    — too low
 *   55–70 mg/dL   → RED → BLUE lerp — approaching low
 *   70–180 mg/dL  → GREEN  — in target range
 *   180–250 mg/dL → YELLOW → ORANGE lerp — going high
 *   >250 mg/dL    → ORANGE — too high
 */
function glucoseLineColor(v: number): string {
  const RED = [0xef, 0x44, 0x44];
  const BLUE = [0x3b, 0x82, 0xf6];
  const GREEN_ = [0x10, 0xb9, 0x81];
  const YELLOW = [0xea, 0xb3, 0x08];
  const ORANGE_ = [0xf9, 0x73, 0x16];
  const lerp = (a: number[], b: number[], t: number) =>
    a.map((c, i) => Math.round(c + (b[i] - c) * Math.max(0, Math.min(1, t))));
  const hex = (rgb: number[]) =>
    `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

  if (v < 55) return hex(RED);
  if (v < 70) return hex(lerp(RED, BLUE, (v - 55) / 15));
  if (v <= 180) return hex(GREEN_);
  if (v <= 250) return hex(lerp(YELLOW, ORANGE_, (v - 180) / 70));
  return hex(ORANGE_);
}
