"use client";
import React, { useState } from "react";
import { useTranslations } from "next-intl";
import GlevLogo from "@/components/GlevLogo";

const COLOR_PRESETS = [
  "#4F6EF7",
  "#6B8BFF",
  "#22D3A0",
  "#FF9500",
  "#FF2D78",
  "#FFD60A",
  "#FFFFFF",
];

const BG_PRESETS = [
  "#0F0F14",
  "#09090B",
  "#111117",
  "#FFFFFF",
  "#4F6EF7",
  "transparent",
];

export default function LogoPlayground() {
  const t = useTranslations("marketing");
  const [size, setSize] = useState(160);
  const [color, setColor] = useState("#4F6EF7");
  const [bg, setBg] = useState("#0F0F14");

  return (
    <div
      style={{
        background: "#111117",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: 24,
        display: "grid",
        gap: 24,
        gridTemplateColumns: "minmax(0, 1fr)",
      }}
    >
      <div
        style={{
          background:
            bg === "transparent"
              ? "repeating-conic-gradient(#1a1a22 0% 25%, #0d0d12 25% 50%) 50% / 24px 24px"
              : bg,
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          minHeight: 320,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <GlevLogo size={size} color={color} bg={bg === "transparent" ? "transparent" : bg} />
      </div>

      <div style={{ display: "grid", gap: 18 }}>
        <Control label={t("brand_playground_size_label", { size })}>
          <input
            type="range"
            min={32}
            max={320}
            step={4}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#4F6EF7" }}
          />
        </Control>

        <Control label={t("brand_playground_foreground_label")}>
          <Swatches
            values={COLOR_PRESETS}
            current={color}
            onPick={setColor}
          />
          <input
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            spellCheck={false}
            style={inputStyle}
          />
        </Control>

        <Control label={t("brand_playground_background_label")}>
          <Swatches
            values={BG_PRESETS}
            current={bg}
            onPick={setBg}
            transparentValue="transparent"
          />
          <input
            type="text"
            value={bg}
            onChange={(e) => setBg(e.target.value)}
            spellCheck={false}
            style={inputStyle}
          />
        </Control>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#0A0A0F",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "#fff",
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  width: "100%",
};

function Control({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Swatches({
  values,
  current,
  onPick,
  transparentValue,
}: {
  values: string[];
  current: string;
  onPick: (v: string) => void;
  transparentValue?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {values.map((v) => {
        const active = v === current;
        const isTransparent = v === transparentValue;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            aria-label={v}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: active
                ? "2px solid #fff"
                : "1px solid rgba(255,255,255,0.18)",
              background: isTransparent
                ? "repeating-conic-gradient(#1a1a22 0% 25%, #0d0d12 25% 50%) 50% / 10px 10px"
                : v,
              cursor: "pointer",
              padding: 0,
            }}
          />
        );
      })}
    </div>
  );
}
