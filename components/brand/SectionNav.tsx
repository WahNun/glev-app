"use client";
import React from "react";
import { useTranslations } from "next-intl";
import LocaleSwitcher from "@/components/LocaleSwitcher";

const ITEM_IDS = [
  "foundation",
  "color",
  "typography",
  "logo",
  "voice",
  "compliance",
] as const;

export default function SectionNav() {
  const t = useTranslations("marketing");
  const items = ITEM_IDS.map((id) => ({
    id,
    label: t(`brand_section_${id}`),
  }));
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        // Tinted blur over the page bg — color-mix lets the same rule
        // serve dark and light themes (Task #42).
        background: "color-mix(in srgb, var(--bg) 85%, transparent)",
        backdropFilter: "saturate(160%) blur(10px)",
        WebkitBackdropFilter: "saturate(160%) blur(10px)",
        borderBottom: "1px solid var(--border)",
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
            color: "var(--text)",
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
            {t("brand_nav_label")}
          </span>
        </a>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <ul
            style={{
              listStyle: "none",
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            {items.map((it) => (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  style={{
                    color: "var(--text-body)",
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
          <LocaleSwitcher size="xs" ariaLabel={t("nav_aria_locale")} />
        </div>
      </div>
    </nav>
  );
}
