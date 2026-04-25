import Image from "next/image";
import { ACCENT, TEXT_DIM } from "./tokens";

type Feature = {
  title: string;
  body: string;
  /**
   * Marketing screenshot of the in-app flow. Sourced from
   * /public/mockups/*.png — portrait phone screenshots (526×1129).
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
 * screenshot from /public/mockups/ — rendered inside an iPhone-shaped
 * portrait frame so the screenshots fit naturally at every breakpoint.
 *
 * Desktop (>720px): phone left or right (alternating), copy in the
 *   other column.
 * Mobile (≤720px): phone centered above the copy.
 */
export default function FeatureDeepDive() {
  return (
    <section
      id="features"
      aria-label="Features im Detail"
      style={{ display: "flex", flexDirection: "column", gap: 80 }}
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
        gridTemplateColumns: "260px minmax(0, 1fr)",
        gap: 56,
        alignItems: "center",
      }}
      className={`feature-row ${reverse ? "feature-row--reverse" : ""}`}
    >
      <div className="feature-row__mockup" style={{ display: "flex", justifyContent: "center" }}>
        <PhoneFrame src={feature.image.src} alt={feature.image.alt} />
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

/**
 * Static portrait phone frame around a screenshot. Aspect ratio matches
 * the source PNGs (526:1129) so screenshots fill edge-to-edge with no
 * cropping at any width.
 */
function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 260,
        aspectRatio: "526 / 1129",
        borderRadius: 36,
        padding: 6,
        background: "#0F0F14",
        boxShadow: `
          0 0 0 1px rgba(255,255,255,0.10),
          0 24px 60px rgba(0,0,0,0.55),
          0 4px 12px ${ACCENT}1A,
          inset 0 0 0 1px rgba(255,255,255,0.04)
        `,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 30,
          overflow: "hidden",
          background: "#09090B",
        }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 720px) 260px, 260px"
          style={{ objectFit: "cover", objectPosition: "center top" }}
        />
      </div>
    </div>
  );
}
