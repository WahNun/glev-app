"use client";
import React, { useState } from "react";

function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  if (a < 0.5) return false;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6;
}

export default function HexSwatch({
  hex,
  role,
}: {
  hex: string;
  role: string;
}) {
  const [copied, setCopied] = useState(false);
  const fg = isLight(hex) ? "#000" : "#fff";

  async function copy() {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignored */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      style={{
        width: 160,
        height: 160,
        background: hex,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "stretch",
        cursor: "pointer",
        position: "relative",
        textAlign: "left",
        color: fg,
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
      }}
      aria-label={`Copy ${hex}`}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        {hex}
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.3, opacity: 0.75 }}>{role}</div>
      {copied && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            borderRadius: 12,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          Kopiert: {hex}
        </div>
      )}
    </button>
  );
}
