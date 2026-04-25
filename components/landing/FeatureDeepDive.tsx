import Image from "next/image";
import { BORDER, TEXT_DIM } from "./tokens";

type Feature = {
  title: string;
  body: string;
  /**
   * Marketing screenshot of the in-app flow. Sourced from
   * /mockups/*.png — the same screenshots that power /mockups/dark-cockpit.
   */
  image: { src: string; alt: string };
};

const FEATURES: Feature[] = [
  {
    title: "Voice-first Mahlzeit-Logging",
    body: "Du sprichst deine Mahlzeit, Glev versteht Lebensmittel, Mengen und Zubereitungen. Schneller als jede Tipp-Form.",
    image: {
      src: "/mockups/entries.png",
      alt: "Glev Log-Screen mit großem Mikrofon-Button und 'Tap to speak' für sprachbasierte Mahlzeiteneingabe",
    },
  },
  {
    title: "KI-Makroberechnung mit deinem Korrektur-Recht",
    body: "Die KI schätzt Kohlenhydrate, Protein und Fett. Du kannst jeden Wert per Tippen oder Sprache überschreiben — die Atomicität bleibt erhalten.",
    image: {
      src: "/mockups/engine.png",
      alt: "Glev Eingabemaske mit ausgefüllten Werten für Glukose, Kohlenhydrate, Protein und Fett sowie automatischer Makro-Klassifikation",
    },
  },
  {
    title: "CGM live im Dashboard",
    body: "Glev verbindet sich mit deinem FreeStyle Libre 2 via LibreLinkUp und zeigt deinen aktuellen Glukosewert direkt im Log-Flow. Vor und nach jeder Mahlzeit.",
    image: {
      src: "/mockups/dashboard.png",
      alt: "Glev Dashboard mit Control Score, Glukose-Trend-Diagramm, Outcome-Verteilung und letzten Mahlzeiten-Einträgen",
    },
  },
  {
    title: "Performance & Insights",
    body: "Alle deine Mahlzeiten, Insulindosen und Glukosewerte über die Zeit — strukturiert, mit gelernter Carb-Ratio, Good-Rate und Trends, die du im Diabetologen-Gespräch teilen kannst.",
    image: {
      src: "/mockups/insights.png",
      alt: "Glev Insights-Ansicht mit Performance-Kennzahlen wie Control Score, Good Rate, Spike Rate und Hypo Rate für den Arztbericht",
    },
  },
];

/**
 * Four alternating left/right rows. Each row pairs a real product
 * screenshot from /public/mockups/ with German marketing copy.
 *
 * On screens narrower than ~720px the rows stack mockup-above-text.
 */
export default function FeatureDeepDive() {
  return (
    <section
      id="features"
      aria-label="Features im Detail"
      style={{ display: "flex", flexDirection: "column", gap: 64 }}
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
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 480px) minmax(0, 1fr)",
        gap: 40,
        alignItems: "center",
      }}
      className={`feature-row ${reverse ? "feature-row--reverse" : ""}`}
    >
      <div className="feature-row__mockup">
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "3 / 2",
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            overflow: "hidden",
            background: "#0F0F14",
          }}
        >
          <Image
            src={feature.image.src}
            alt={feature.image.alt}
            fill
            sizes="(max-width: 720px) 100vw, 480px"
            style={{ objectFit: "cover", objectPosition: "top left" }}
          />
        </div>
      </div>
      <div className="feature-row__copy" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
        <p style={{ fontSize: 16, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>{feature.body}</p>
      </div>
      <style>{`
        @media (max-width: 720px) {
          .feature-row {
            grid-template-columns: 1fr !important;
            gap: 20px !important;
          }
          .feature-row--reverse .feature-row__copy,
          .feature-row--reverse .feature-row__mockup {
            order: 0 !important;
          }
        }
        @media (min-width: 721px) {
          .feature-row--reverse .feature-row__mockup { order: 2; }
          .feature-row--reverse .feature-row__copy   { order: 1; }
        }
      `}</style>
    </div>
  );
}
