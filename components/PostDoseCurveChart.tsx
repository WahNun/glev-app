"use client";

import { useEffect, useRef, useState } from "react";
import {
  useCrosshair,
  CrosshairOverlay,
  CrosshairTooltip,
  type CrosshairPoint,
} from "@/components/ChartCrosshair";

export interface PostDoseSample {
  t_offset_min: number;
  value_mgdl: number;
}

interface Props {
  samples: PostDoseSample[];
  hadHypo?: boolean | null;
  color?: string;
  height?: number;
}

const HYPO_THRESHOLD = 70;
const PAD_L = 28;
const PAD_R = 10;
const PAD_T = 20;
const PAD_B = 22;
const PINK = "#FF2D78";
const GREEN = "#22D3A0";
const ORANGE = "#FF9500";

export default function PostDoseCurveChart({
  samples,
  hadHypo,
  color = "#4F6EF7",
  height = 130,
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

  if (!samples || samples.length < 2) return null;

  const sorted = [...samples].sort((a, b) => a.t_offset_min - b.t_offset_min);
  const W = width;
  const H = height;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const values = sorted.map((s) => s.value_mgdl);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  const vLo = Math.min(rawMin, HYPO_THRESHOLD) - 10;
  const vHi = Math.max(rawMax, 140) + 10;

  const tMin = 0;
  const tMax = 180;

  const xFor = (t: number) => PAD_L + ((t - tMin) / (tMax - tMin)) * innerW;
  const yFor = (v: number) => PAD_T + innerH - ((v - vLo) / (vHi - vLo)) * innerH;

  const pathD = sorted
    .map((s, i) => `${i === 0 ? "M" : "L"}${xFor(s.t_offset_min).toFixed(1)},${yFor(s.value_mgdl).toFixed(1)}`)
    .join(" ");

  const lastX = xFor(sorted[sorted.length - 1].t_offset_min);
  const areaD = `${pathD} L${lastX.toFixed(1)},${(H - PAD_B).toFixed(1)} L${xFor(0).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

  const hypoY = yFor(HYPO_THRESHOLD);
  const showHypoLine = hypoY >= PAD_T && hypoY <= H - PAD_B;

  const minSample = sorted.reduce((a, b) => (b.value_mgdl < a.value_mgdl ? b : a));
  const maxSample = sorted.reduce((a, b) => (b.value_mgdl > a.value_mgdl ? b : a));
  const minX = xFor(minSample.t_offset_min);
  const minY = yFor(minSample.value_mgdl);
  const maxX = xFor(maxSample.t_offset_min);
  const maxY = yFor(maxSample.value_mgdl);

  const crosshairPoints: CrosshairPoint[] = sorted.map((s) => ({
    x: xFor(s.t_offset_min),
    y: yFor(s.value_mgdl),
    color,
    tooltip: [`+${s.t_offset_min} min`, `${Math.round(s.value_mgdl)} mg/dL`],
  }));

  const { active, handlers } = useCrosshair(crosshairPoints);

  const gradId = `pdcc-${color.replace(/[^a-z0-9]/gi, "")}`;

  const xTickLabels = [0, 60, 120, 180];

  return (
    <div>
      {hadHypo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            marginBottom: 8,
            background: `${PINK}18`,
            border: `1px solid ${PINK}50`,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            color: PINK,
            letterSpacing: "0.04em",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Hypo in 3-h window
        </div>
      )}

      <div
        ref={containerRef}
        style={{ width: "100%", position: "relative", touchAction: "pan-y" }}
        {...handlers}
      >
        {W > 0 && (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Post-dose glucose curve"
            style={{ display: "block", overflow: "visible" }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Y-axis grid lines */}
            {[80, 100, 140, 180].map((v) => {
              const y = yFor(v);
              if (y < PAD_T || y > H - PAD_B) return null;
              return (
                <g key={v}>
                  <line
                    x1={PAD_L}
                    y1={y}
                    x2={W - PAD_R}
                    y2={y}
                    stroke="var(--surface-soft)"
                    strokeWidth="1"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={PAD_L - 4}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize="9"
                    fill="var(--text-ghost)"
                  >
                    {v}
                  </text>
                </g>
              );
            })}

            {/* Hypo threshold line */}
            {showHypoLine && (
              <g>
                <line
                  x1={PAD_L}
                  y1={hypoY}
                  x2={W - PAD_R}
                  y2={hypoY}
                  stroke={PINK}
                  strokeWidth="1.2"
                  strokeDasharray="4 3"
                  strokeOpacity="0.65"
                />
                <text
                  x={PAD_L - 4}
                  y={hypoY + 3.5}
                  textAnchor="end"
                  fontSize="9"
                  fill={PINK}
                  fillOpacity="0.8"
                >
                  70
                </text>
              </g>
            )}

            {/* Area fill */}
            <path d={areaD} fill={`url(#${gradId})`} />

            {/* Curve line */}
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Min marker */}
            <circle cx={minX} cy={minY} r="4.5" fill={PINK} stroke="var(--surface)" strokeWidth="1.5" />
            <text
              x={minX}
              y={minY + 14}
              textAnchor="middle"
              fontSize="9"
              fill={PINK}
              fontWeight="700"
            >
              ↓{Math.round(minSample.value_mgdl)}
            </text>

            {/* Max marker (only if different from min) */}
            {maxSample.t_offset_min !== minSample.t_offset_min && (
              <>
                <circle cx={maxX} cy={maxY} r="4.5" fill={ORANGE} stroke="var(--surface)" strokeWidth="1.5" />
                <text
                  x={maxX}
                  y={maxY - 8}
                  textAnchor="middle"
                  fontSize="9"
                  fill={ORANGE}
                  fontWeight="700"
                >
                  ↑{Math.round(maxSample.value_mgdl)}
                </text>
              </>
            )}

            {/* X-axis tick labels */}
            {xTickLabels.map((t) => (
              <text
                key={t}
                x={xFor(t)}
                y={H - 6}
                textAnchor="middle"
                fontSize="9"
                fill="var(--text-ghost)"
              >
                {t === 0 ? "0" : `+${t}m`}
              </text>
            ))}

            <CrosshairOverlay
              active={active}
              top={PAD_T}
              bottom={H - PAD_B}
              left={PAD_L}
              right={W - PAD_R}
            />
          </svg>
        )}
        <CrosshairTooltip active={active} containerWidth={W} containerHeight={H} />
      </div>

      {/* Legend row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
        <span style={{ fontSize: 10, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: ORANGE, display: "inline-block" }} />
          Max {Math.round(maxSample.value_mgdl)} mg/dL · +{maxSample.t_offset_min}m
        </span>
        <span style={{ fontSize: 10, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: PINK, display: "inline-block" }} />
          Min {Math.round(minSample.value_mgdl)} mg/dL · +{minSample.t_offset_min}m
        </span>
        {!hadHypo && rawMin > HYPO_THRESHOLD && (
          <span style={{ fontSize: 10, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, display: "inline-block" }} />
            No hypo
          </span>
        )}
      </div>
    </div>
  );
}
