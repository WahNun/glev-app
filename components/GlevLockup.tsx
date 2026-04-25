"use client";
import React from "react";
import GlevLogo from "@/components/GlevLogo";

export default function GlevLockup({
  size = 32,
  color = "#fff",
  symbolColor = "#4F6EF7",
  symbolBg = "#0F0F14",
  showDot = false,
  dotColor = "#22D3A0",
  gap,
  style,
  className,
}: {
  size?: number;
  color?: string;
  symbolColor?: string;
  symbolBg?: string;
  showDot?: boolean;
  dotColor?: string;
  gap?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const wordSize = Math.round(size * 0.78);
  const computedGap = gap ?? Math.round(size * 0.32);

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: computedGap,
        lineHeight: 1,
        ...style,
      }}
      aria-label="Glev"
    >
      <GlevLogo size={size} color={symbolColor} bg={symbolBg} />
      <span
        style={{
          fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
          fontSize: wordSize,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "baseline",
        }}
      >
        glev{showDot && <span style={{ color: dotColor }}>.</span>}
      </span>
    </span>
  );
}
