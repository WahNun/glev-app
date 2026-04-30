"use client";

import { useTranslations } from "next-intl";
import FeatureLiveMockup from "./FeatureLiveMockup";
import { TEXT_DIM } from "./tokens";

type DesktopPage =
  | "dashboard"
  | "log"
  | "entries"
  | "insights"
  | "recommend"
  | "import"
  | "profile";

type MobileTab =
  | "dashboard"
  | "entries"
  | "engine"
  | "insights"
  | "settings";

type Feature = {
  title: string;
  body: string;
  /** Page rendered in the dark-cockpit iframe on desktop viewports. */
  desktopPage: DesktopPage;
  /** Tab the locked AppMockupPhone is opened on for mobile viewports. */
  mobileTab: MobileTab;
};

/**
 * Four alternating feature rows. Each row pairs a live in-app mockup
 * with marketing copy. The mockup itself swaps presentation per
 * viewport (desktop SaaS layout vs locked iPhone) — see
 * <FeatureLiveMockup> for the responsive switching logic.
 *
 * Desktop (>720px): mockup left or right (alternating), copy in the
 *   other column. Mockup column gets ~60% of row width so the
 *   dark-cockpit layout has room to breathe.
 * Mobile (≤720px): mockup centered above the copy, single column.
 *
 * Copy lives in the `marketing` namespace so the section reacts to
 * the visitor's locale without the parent threading strings through.
 * The desktopPage / mobileTab routing keys stay hardcoded — they map
 * to in-app surfaces, not user-facing strings.
 */
export default function FeatureDeepDive() {
  const t = useTranslations("marketing");
  const features: Feature[] = [
    {
      title: t("deepdive_voice_title"),
      body: t("deepdive_voice_body"),
      // The "Glev Engine" page (key: "recommend") shows the voice mic
      // surface plus the GPT-Reasoning side panel — that's the canonical
      // voice-first surface in the desktop app.
      desktopPage: "recommend",
      mobileTab: "engine",
    },
    {
      title: t("deepdive_macro_title"),
      body: t("deepdive_macro_body"),
      desktopPage: "entries",
      mobileTab: "entries",
    },
    {
      title: t("deepdive_cgm_title"),
      body: t("deepdive_cgm_body"),
      desktopPage: "dashboard",
      mobileTab: "dashboard",
    },
    {
      title: t("deepdive_insights_title"),
      body: t("deepdive_insights_body"),
      desktopPage: "insights",
      mobileTab: "insights",
    },
  ];
  return (
    <section
      id="features"
      aria-label={t("deepdive_aria")}
      style={{ display: "flex", flexDirection: "column", gap: 96 }}
    >
      <h2
        style={{
          fontSize: "clamp(28px, 4vw, 36px)",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          margin: 0,
          color: "#fff",
        }}
      >
        {t("deepdive_title")}
      </h2>

      {features.map((f, i) => (
        <FeatureRow key={f.title} feature={f} reverse={i % 2 === 1} />
      ))}
    </section>
  );
}

function FeatureRow({ feature, reverse }: { feature: Feature; reverse: boolean }) {
  return (
    <div
      className={`feature-row ${reverse ? "feature-row--reverse" : ""}`}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
        gap: 56,
        alignItems: "center",
      }}
    >
      <div
        className="feature-row__mockup"
        style={{ display: "flex", justifyContent: "center", width: "100%" }}
      >
        <FeatureLiveMockup
          desktopPage={feature.desktopPage}
          mobileTab={feature.mobileTab}
          label={feature.title}
        />
      </div>
      <div
        className="feature-row__copy"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <h3
          style={{
            fontSize: "clamp(22px, 3vw, 28px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            margin: 0,
            color: "#fff",
          }}
        >
          {feature.title}
        </h3>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
          {feature.body}
        </p>
      </div>
      <style>{`
        @media (max-width: 720px) {
          .feature-row {
            grid-template-columns: 1fr !important;
            gap: 28px !important;
            justify-items: center;
            text-align: center;
          }
          .feature-row .feature-row__copy { align-items: center; }
        }
        @media (min-width: 721px) {
          .feature-row--reverse .feature-row__mockup { order: 2; }
          .feature-row--reverse .feature-row__copy   { order: 1; }
        }
      `}</style>
    </div>
  );
}
