/**
 * PhoneFrame — skaliert einen 393×780-px-Inhalt auf ~300 px Breite.
 * Nutzt CSS transform: scale() mit festem Wrapper, damit das Layout
 * nicht kollabiert (transform beeinflusst kein normales Box-Layout).
 *
 * Server Component — kein "use client" nötig.
 */

import React from "react";

const INNER_W = 393;
const INNER_H = 780;
const SCALE = 300 / INNER_W;
const OUTER_W = Math.round(INNER_W * SCALE);
const OUTER_H = Math.round(INNER_H * SCALE);

export default function PhoneFrame({
  label,
  children,
  readonly = false,
}: {
  label: string;
  children: React.ReactNode;
  readonly?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
      {/* Phone silhouette border */}
      <div
        style={{
          width: OUTER_W + 14,
          height: OUTER_H + 28,
          borderRadius: 28,
          background: "#0a0a10",
          border: "1.5px solid #2a2a3a",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0,
          padding: "14px 7px",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 64,
            height: 6,
            borderRadius: 3,
            background: "#1a1a2a",
          }}
        />

        {/* Scaled viewport */}
        <div
          style={{
            width: OUTER_W,
            height: OUTER_H,
            overflow: "hidden",
            borderRadius: 8,
            position: "relative",
          }}
        >
          <div
            style={{
              width: INNER_W,
              height: INNER_H,
              transformOrigin: "top left",
              transform: `scale(${SCALE})`,
              overflow: "hidden",
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: readonly ? "none" : "auto",
              userSelect: readonly ? "none" : "auto",
            }}
          >
            {children}
          </div>
        </div>
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: 11,
          color: "#666",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          maxWidth: OUTER_W + 14,
          lineHeight: 1.3,
        }}
      >
        {label}
      </span>
    </div>
  );
}
