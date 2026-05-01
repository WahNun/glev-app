"use client";
import React from "react";
import { useTranslations } from "next-intl";
import GlevLogo from "@/components/GlevLogo";

export default function LogoCard({
  title,
  description,
  bg = "#0F0F14",
  color = "#4F6EF7",
  size = 128,
  downloadHref = "/icon.svg",
  downloadName = "glev-icon.svg",
}: {
  title: string;
  description?: string;
  bg?: string;
  color?: string;
  size?: number;
  downloadHref?: string;
  downloadName?: string;
}) {
  const t = useTranslations("marketing");
  return (
    <div
      style={{
        background: "#111117",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          background: bg,
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
        }}
      >
        <GlevLogo size={size} color={color} bg={bg} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        {description && (
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.6)",
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        )}
      </div>
      <a
        href={downloadHref}
        download={downloadName}
        style={{
          alignSelf: "flex-start",
          background: "#4F6EF7",
          color: "#fff",
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        {t("brand_logo_download_svg")}
      </a>
    </div>
  );
}
