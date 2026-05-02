"use client";

import { useTranslations } from "next-intl";
import { TEXT_FAINT } from "./tokens";

/**
 * Minimal legal footer, identical across landing pages.
 * Labels are localized — links keep their German slugs (`/legal`)
 * because the legal pages are German-only by content.
 */
export default function LandingFooter() {
  const t = useTranslations("marketing");
  return (
    <footer
      style={{
        fontSize: 12,
        color: TEXT_FAINT,
        display: "flex",
        gap: 8,
        justifyContent: "center",
        flexWrap: "wrap",
        marginTop: 24,
      }}
    >
      <a href="/legal" style={{ color: TEXT_FAINT, textDecoration: "none" }}>
        {t("landing_footer_imprint")}
      </a>
      <span aria-hidden>·</span>
      <a href="/legal" style={{ color: TEXT_FAINT, textDecoration: "none" }}>
        {t("landing_footer_privacy")}
      </a>
      <span aria-hidden>·</span>
      <a href="mailto:hello@glev.app" style={{ color: TEXT_FAINT, textDecoration: "none" }}>
        hello@glev.app
      </a>
    </footer>
  );
}
