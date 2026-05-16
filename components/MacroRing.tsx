"use client";

// Single circular progress ring shared between Dashboard's "TODAY'S MACROS"
// card and the Engine wizard's "Makros prüfen" review step. Big colored arc
// over a faint track, bold mono number in the centre, CAPS label below, and
// an optional "/ {target}{unit}" hint underneath. The SVG renders at 100%
// of its (capped) container width so the rings stay legible across
// viewports.
//
// Extracted from `app/(protected)/dashboard/page.tsx` so both surfaces stay
// pixel-identical and the macro palette (carbs orange, protein blue, fat
// purple, fiber green) is sourced from a single place.

import React from "react";

interface MacroRingProps {
  label: string;
  value: number;
  /** Daily target — when null/undefined the hint line and arc fill are
   *  suppressed. Used by the Engine review step where there's no "/200g"
   *  context to show. */
  target?: number | null;
  color: string;
  unit: string;
}

export default function MacroRing({
  label,
  value,
  target,
  color,
  unit,
}: MacroRingProps) {
  const r = 32;                                     // SVG-unit radius
  const circ = 2 * Math.PI * r;                     // ring circumference
  const hasTarget = typeof target === "number" && target > 0;
  const pct = hasTarget ? Math.min(1, value / (target as number)) : 0;

  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center", gap:6,
      // CRITICAL: width:"100%" + aspectRatio:"1" guarantees identical
      // outer-circle diameter for all 4 rings regardless of macro
      // value. Without aspectRatio the cell height could vary with
      // the value text length below the SVG (e.g. "128" vs "17"),
      // visually shrinking some rings.
      width:"100%", maxWidth:96,
    }}>
      <div style={{ width:"100%", aspectRatio:"1" }}>
        <svg width="100%" height="100%" viewBox="0 0 80 80" style={{ display:"block" }}>
          {/* Background track */}
          <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="8" />
          {/* Progress arc — rotate -90deg so 0% sits at 12 o'clock and the arc
              grows clockwise; rounded cap so the leading edge looks polished.
              When no target is given, draw a full ring at low opacity so the
              shape stays unmistakable. */}
          {hasTarget ? (
            <circle
              cx="40" cy="40" r={r}
              fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${(circ * pct).toFixed(2)} ${circ.toFixed(2)}`}
              transform="rotate(-90 40 40)"
            />
          ) : (
            <circle
              cx="40" cy="40" r={r}
              fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
              opacity={0.9}
            />
          )}
          {/* Centre value — bold mono, theme-aware (var(--text)) so it
              stays legible whether the surface is in dark or light mode. */}
          <text
            x="40" y="46"
            textAnchor="middle"
            fontSize="20" fontWeight="800" fill="var(--text)"
            fontFamily="var(--font-mono)"
          >
            {value}
          </text>
        </svg>
      </div>
      <div style={{ fontSize:12, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700 }}>
        {label}
      </div>
      {hasTarget && (
        <div style={{ fontSize:11, color:"var(--text-faint)", fontFamily:"var(--font-mono)" }}>
          / {target}{unit}
        </div>
      )}
    </div>
  );
}
