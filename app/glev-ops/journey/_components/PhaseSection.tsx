/**
 * PhaseSection — Phasen-Überschrift + horizontaler Scroll-Container
 * für PhoneFrames oder E-Mail-Karten.
 *
 * Server Component — kein "use client" nötig.
 */

import React from "react";

const BG = "#0a0a0f";
const BORDER = "#1e1e2e";
const TEXT = "#e2e2ef";
const TEXT_MUTED = "#8888a8";

export default function PhaseSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 48 }}>
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#4F6EF7",
            margin: "0 0 4px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              fontSize: 12,
              color: TEXT_MUTED,
              margin: 0,
              lineHeight: 1.5,
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {/* Horizontal scroll row */}
      <div
        style={{
          display: "flex",
          gap: 20,
          overflowX: "auto",
          paddingBottom: 12,
          alignItems: "flex-start",
          scrollbarWidth: "thin",
          scrollbarColor: "#2a2a3a transparent",
        }}
      >
        {children}
      </div>
    </section>
  );
}
