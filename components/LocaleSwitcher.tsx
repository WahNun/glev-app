"use client";

import { useLocale } from "next-intl";
import { setLocale, type Locale, SUPPORTED_LOCALES } from "@/lib/locale";

const BORDER = "rgba(255,255,255,0.10)";
const ACCENT = "#4F6EF7";

type Props = {
  size?: "sm" | "xs";
  ariaLabel?: string;
};

export default function LocaleSwitcher({ size = "sm", ariaLabel }: Props) {
  const active = useLocale() as Locale;
  const padY = size === "xs" ? 3 : 4;
  const padX = size === "xs" ? 7 : 9;
  const fontSize = size === "xs" ? 10 : 11;

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? "Language"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: 2,
        gap: 2,
        borderRadius: 999,
        border: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.03)",
        fontFamily: "inherit",
      }}
    >
      {SUPPORTED_LOCALES.map((loc) => {
        const isActive = loc === active;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => {
              if (!isActive) void setLocale(loc);
            }}
            aria-pressed={isActive}
            aria-label={loc === "de" ? "Deutsch" : "English"}
            style={{
              padding: `${padY}px ${padX}px`,
              fontSize,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              borderRadius: 999,
              border: "none",
              cursor: isActive ? "default" : "pointer",
              background: isActive ? ACCENT : "transparent",
              color: isActive ? "#fff" : "rgba(255,255,255,0.6)",
              transition: "background 0.15s, color 0.15s",
              fontFamily: "inherit",
              lineHeight: 1,
            }}
          >
            {loc.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
