import { ACCENT, BORDER, MINT, SURFACE } from "./tokens";

const ORANGE = "#FF9500";

export type FeatureExtra = { color: string; title: string; text: string };

function FeatureCard({
  color,
  title,
  text,
}: {
  color: string;
  title: string;
  text: string;
}) {
  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: "22px 22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: `${color}18`,
          border: `1px solid ${color}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 99, background: color, display: "block" }} />
      </div>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          margin: 0,
          color: "#fff",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          lineHeight: 1.55,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        {text}
      </p>
    </div>
  );
}

export type FeatureItem = { color: string; title: string; text: string };

const DEFAULT_ITEMS: readonly FeatureItem[] = [
  {
    color: ACCENT,
    title: "Sprach-Input, kein Formular",
    text: `Voice-Input, KI-Parser. „Pasta mit Tomatensauce, 80 g Nudeln und ein Apfel." → Makros in 2 s.`,
  },
  {
    color: MINT,
    title: "CGM live im Loop",
    text: "FreeStyle Libre 2 ist verbunden. Glukose wird parallel zum Log gespeichert — pre-meal & post-meal.",
  },
  {
    color: ORANGE,
    title: "Du behältst die Kontrolle",
    text: "Glev dokumentiert. Du und dein Arzt entscheiden.",
  },
];

/**
 * Three (or four) colored feature cards used across /, /beta, /pro.
 * Renders a CSS grid with class `glev-feat-grid` — the parent page
 * is responsible for providing the responsive grid CSS (3-col on
 * desktop, 1-col on mobile). The optional `extra` slot adds a fourth
 * card (used by /pro to show the Arztbericht-PDF feature). The
 * optional `items` prop overrides the three default cards (used by
 * /pro to show Trend / Mahlzeit / Timing instead).
 */
export default function FeatureTrio(
  { items, extra }: { items?: readonly FeatureItem[]; extra?: FeatureExtra } = {},
) {
  const cards = items ?? DEFAULT_ITEMS;
  return (
    <div className="glev-feat-grid">
      {cards.map((c, i) => (
        <FeatureCard key={i} color={c.color} title={c.title} text={c.text} />
      ))}
      {extra && <FeatureCard color={extra.color} title={extra.title} text={extra.text} />}
    </div>
  );
}
