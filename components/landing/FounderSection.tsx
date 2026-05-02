"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { ACCENT, MINT } from "./tokens";

/**
 * Founder portrait + quote section.
 * Same content on /beta and /pro — Lucas's diagnosis story is the through-line
 * for both pages, so this is intentionally identical.
 *
 * Strings live in the `marketing` namespace under `landing_founder_*` so
 * the section automatically follows the visitor's locale (DE/EN).
 */
export default function FounderSection() {
  const t = useTranslations("marketing");
  return (
    <section style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16 }}>
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          background: ACCENT,
          overflow: "hidden",
          position: "relative",
          boxShadow: "0 8px 24px rgba(79,110,247,0.35)",
        }}
      >
        <Image
          src="/founder.png"
          alt={t("landing_founder_alt")}
          fill
          sizes="96px"
          priority
          style={{
            objectFit: "cover",
            objectPosition: "50% 18%",
            transform: "scale(1.6)",
            transformOrigin: "50% 18%",
          }}
        />
      </div>
      <p style={{ fontSize: 16, lineHeight: 1.55, color: "rgba(255,255,255,0.9)", margin: 0, maxWidth: 540 }}>
        {t("landing_founder_quote")}
      </p>
      <div style={{ fontSize: 14, fontWeight: 500, color: MINT }}>
        {t("landing_founder_caption")}
      </div>
    </section>
  );
}
