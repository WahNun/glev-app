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

const FEATURES: Feature[] = [
  {
    title: "Voice-first Mahlzeit-Logging",
    body: "Du sprichst deine Mahlzeit, Glev versteht Lebensmittel, Mengen und Zubereitungen. Schneller als jede Tipp-Form.",
    desktopPage: "log",
    mobileTab: "engine",
  },
  {
    title: "KI-Makroberechnung mit deinem Korrektur-Recht",
    body: "Die KI schätzt Kohlenhydrate, Protein und Fett. Du kannst jeden Wert per Tippen oder Sprache überschreiben — die Atomicität bleibt erhalten.",
    desktopPage: "entries",
    mobileTab: "entries",
  },
  {
    title: "CGM live im Dashboard",
    body: "Glev verbindet sich mit deinem FreeStyle Libre 2 via LibreLinkUp und zeigt deinen aktuellen Glukosewert direkt im Log-Flow. Vor und nach jeder Mahlzeit.",
    desktopPage: "dashboard",
    mobileTab: "dashboard",
  },
  {
    title: "Performance & Insights",
    body: "Alle deine Mahlzeiten, Insulindosen und Glukosewerte über die Zeit — strukturiert, mit gelernter Carb-Ratio, Good-Rate und Trends, die du im Diabetologen-Gespräch teilen kannst.",
    desktopPage: "insights",
    mobileTab: "insights",
  },
];

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
 */
export default function FeatureDeepDive() {
  return (
    <section
      id="features"
      aria-label="Features im Detail"
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
        Features im Detail
      </h2>

      {FEATURES.map((f, i) => (
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
