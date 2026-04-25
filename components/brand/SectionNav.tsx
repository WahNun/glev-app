"use client";
import React from "react";

const ITEMS = [
  { id: "foundation", label: "Foundation" },
  { id: "color", label: "Color" },
  { id: "typography", label: "Typography" },
  { id: "logo", label: "Logo" },
  { id: "voice", label: "Voice" },
  { id: "compliance", label: "Compliance" },
];

export default function SectionNav() {
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(9,9,11,0.85)",
        backdropFilter: "saturate(160%) blur(10px)",
        WebkitBackdropFilter: "saturate(160%) blur(10px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <a
          href="#top"
          style={{
            color: "#fff",
            textDecoration: "none",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "-0.01em",
          }}
        >
          glev<span style={{ color: "#22D3A0" }}>.</span>
          <span
            style={{
              fontWeight: 400,
              opacity: 0.55,
              marginLeft: 8,
              fontSize: 14,
            }}
          >
            brand
          </span>
        </a>
        <ul
          style={{
            listStyle: "none",
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          {ITEMS.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                style={{
                  color: "rgba(255,255,255,0.7)",
                  textDecoration: "none",
                  fontSize: 14,
                  padding: "6px 10px",
                  borderRadius: 6,
                  display: "inline-block",
                }}
              >
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
