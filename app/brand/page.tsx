import React from "react";
import GlevLogo from "@/components/GlevLogo";
import HexSwatch from "@/components/brand/HexSwatch";
import LogoCard from "@/components/brand/LogoCard";
import LogoPlayground from "@/components/brand/LogoPlayground";
import SectionNav from "@/components/brand/SectionNav";

const PAGE_BG = "#09090B";
const CARD_BG = "#111117";
const BORDER = "1px solid rgba(255,255,255,0.08)";
const CONTENT_MAX = 1100;

const BRAND_COLORS = [
  { hex: "#4F6EF7", role: "Primary · CTAs, Links, Logo" },
  { hex: "#6B8BFF", role: "Hover-State" },
  { hex: "#4F6EF740", role: "Focus-Ring, Outer-Node-Fill" },
];
const INK_COLORS = [
  { hex: "#09090B", role: "Page-Background" },
  { hex: "#0A0A0F", role: "Body-Background" },
  { hex: "#0D0D12", role: "Card alternative" },
  { hex: "#0F0F14", role: "Logo-Background" },
  { hex: "#111117", role: "Surface · Cards/Modals" },
  { hex: "#141420", role: "Surface alternative" },
];
const STATUS_COLORS = [
  { hex: "#22D3A0", role: "Green · in-range, success, live" },
  { hex: "#FF9500", role: "Orange · hyper, warning" },
  { hex: "#FF2D78", role: "Pink · hypo, error, destructive" },
  { hex: "#FFD60A", role: "Yellow · spike" },
];
const MEAL_CHART_COLORS = [
  { hex: "#FF9500", role: "Fast-carbs" },
  { hex: "#3B82F6", role: "High-protein" },
  { hex: "#A855F7", role: "High-fat" },
  { hex: "#22D3A0", role: "Balanced" },
  { hex: "#60A5FA", role: "Glucose-Chart-Linie" },
  { hex: "#F472B6", role: "Chart-Highlight (nicht für Errors)" },
  { hex: "#A78BFA", role: "UI sekundär" },
];

export default function BrandPage() {
  return (
    <div
      id="top"
      style={{
        background: PAGE_BG,
        color: "#fff",
        minHeight: "100dvh",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
      }}
    >
      <SectionNav />

      {/* HERO */}
      <section
        style={{
          minHeight: "calc(100dvh - 60px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 24px",
          textAlign: "center",
        }}
      >
        <GlevLogo size={128} />
        <h1
          style={{
            marginTop: 40,
            fontSize: "clamp(56px, 12vw, 96px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "#fff",
          }}
        >
          glev<span style={{ color: "#22D3A0" }}>.</span>
        </h1>
        <div
          style={{
            marginTop: 24,
            fontSize: 16,
            color: "rgba(255,255,255,0.5)",
          }}
        >
          Brand guidelines · v1 · April 2026
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 24,
            color: "rgba(255,255,255,0.75)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          Typ 1. Neu gedacht.
        </div>
      </section>

      {/* FOUNDATION */}
      <Section id="foundation" title="Foundation">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          <FoundationCard
            title="Was Glev ist"
            text="Der sprachgesteuerte Essens-Tracker für Typ-1-Diabetiker. Mahlzeiten in Sekunden loggen, Makros per KI, Glukose live vom CGM."
          />
          <FoundationCard
            title="Was Glev nicht ist"
            text="Kein Medizinprodukt. Kein Insulinrechner. Kein Diabetes-Coach. Glev ist ein Dokumentations- und Organisations-Tool — Therapieentscheidungen triffst du mit deinem Arzt."
          />
          <FoundationCard
            title="Für wen"
            text="Typ-1-Diabetiker mit CGM (aktuell FreeStyle Libre 2 via LibreLinkUp; Dexcom und Nightscout in Arbeit). Smartphone-nativ, deutschsprachiger Markt zuerst."
          />
        </div>

        <blockquote
          style={{
            marginTop: 28,
            background: CARD_BG,
            border: BORDER,
            borderLeft: "3px solid #4F6EF7",
            borderRadius: 12,
            padding: "20px 24px",
            fontSize: 18,
            lineHeight: 1.6,
            color: "rgba(255,255,255,0.85)",
            fontStyle: "italic",
          }}
        >
          „Gebaut von Lucas — T1D, weil bestehende Apps mir zu langsam waren.“
        </blockquote>
      </Section>

      {/* COLOR */}
      <Section id="color" title="Color">
        <SwatchGroup label="Brand" swatches={BRAND_COLORS} />
        <SwatchGroup label="Ink-Layer" swatches={INK_COLORS} />
        <SwatchGroup label="Status" swatches={STATUS_COLORS} />
        <SwatchGroup label="Meal-Types & Chart" swatches={MEAL_CHART_COLORS} />

        <div style={{ marginTop: 40 }}>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "rgba(255,255,255,0.85)",
              marginBottom: 16,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Glucose-Trend-Gating
          </h3>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 48,
              borderRadius: 10,
              overflow: "hidden",
              border: BORDER,
            }}
          >
            <div style={{ flex: 1, background: "#FF2D78" }} />
            <div style={{ flex: 3, background: "#22D3A0" }} />
            <div style={{ flex: 2, background: "#FF9500" }} />
            <div style={{ flex: 1, background: "rgba(255,255,255,0.5)" }} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 3fr 2fr 1fr",
              gap: 8,
              marginTop: 10,
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              fontFamily:
                "var(--font-mono)",
              textAlign: "center",
            }}
          >
            <span>&lt;70 Hypo</span>
            <span>70–180 In-Range</span>
            <span>&gt;180 Hyper</span>
            <span>Kein Wert</span>
          </div>
          <p
            style={{
              marginTop: 16,
              fontSize: 14,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.65)",
            }}
          >
            Live-Glukose-Werte in der App nutzen exakt dieses Farbschema —
            nie anders mappen. Hypo/Hyper sind Status-Signale, kein Style;
            für allgemeine Akzente bleibt Brand-Blau (#4F6EF7) zuständig.
          </p>
        </div>
      </Section>

      {/* TYPOGRAPHY */}
      <Section id="typography" title="Typography">
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <TypeCard
            title="Inter"
            subtitle="Primärfamilie · 400 / 500 / 600 / 700"
            sample="Aa Gg 0123 — Typ 1 neu gedacht."
            sampleStyle={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
            note="Geladen via next/font/google in app/layout.tsx als CSS-Variable --font-inter."
          />
          <TypeCard
            title="JetBrains Mono"
            subtitle="Web-geladen via next/font/google · 400 / 500"
            sample="142 mg/dL · 7.9 mmol/L · 1U / 12g KH"
            sampleStyle={{
              fontFamily: "var(--font-mono)",
              fontSize: 18,
              fontWeight: 500,
            }}
            note="Reserviert für: Glukosewerte, Insulineinheiten, Zeitstempel, Hex-Codes, IDs, Tabellenzellen. Exponiert als CSS-Variable --font-jetbrains-mono, abrufbar projektweit über var(--font-mono)."
          />
        </div>

        <div
          style={{
            marginTop: 24,
            background: CARD_BG,
            border: BORDER,
            borderRadius: 12,
            padding: 28,
            display: "grid",
            gap: 18,
          }}
        >
          <ScaleRow
            label="Display"
            note="Hero · 96px / 700 / -0.03em"
            style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.03em" }}
          >
            glev.
          </ScaleRow>
          <ScaleRow
            label="H1"
            note="Section · 32px / 700"
            style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            Foundation
          </ScaleRow>
          <ScaleRow
            label="H2"
            note="Subsection · 20px / 600"
            style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            Was Glev ist
          </ScaleRow>
          <ScaleRow
            label="Body"
            note="Default · 15px / 400 · line-height 1.6"
            style={{ fontSize: 15, fontWeight: 400, lineHeight: 1.6 }}
          >
            Mahlzeiten in Sekunden loggen, Makros per KI, Glukose live vom CGM.
          </ScaleRow>
          <ScaleRow
            label="Caption"
            note="Meta · 12px / 500 · uppercase 0.06em"
            style={{
              fontSize: 12,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            Brand guidelines · v1
          </ScaleRow>
        </div>
      </Section>

      {/* LOGO */}
      <Section id="logo" title="Logo">
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.6,
            marginBottom: 24,
            maxWidth: 720,
          }}
        >
          Das Glev-Symbol ist ein Knoten-Graph: 7 Knoten, 10 Kanten, 1 zentrales
          Insulin-Atom. Die Geometrie ist fix — nur Vordergrund- und
          Hintergrundfarbe sind anpassbar.
        </p>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <LogoCard
            title="Primary · Dark"
            description="Standardvariante. Für alle dunklen Oberflächen."
            bg="#0F0F14"
            color="#4F6EF7"
          />
          <LogoCard
            title="On-Brand"
            description="Auf Brand-Blau für Marketing-Hintergründe."
            bg="#4F6EF7"
            color="#FFFFFF"
            downloadName="glev-icon-on-brand.svg"
          />
          <LogoCard
            title="On-Light"
            description="Für helle Print- oder Web-Oberflächen."
            bg="#FFFFFF"
            color="#4F6EF7"
            downloadName="glev-icon-on-light.svg"
          />
        </div>

        <h3
          style={{
            marginTop: 40,
            marginBottom: 16,
            fontSize: 16,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Playground
        </h3>
        <LogoPlayground />

        <div
          style={{
            marginTop: 32,
            background: CARD_BG,
            border: BORDER,
            borderRadius: 12,
            padding: 24,
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Don&apos;ts
          </h3>
          <ul
            style={{
              listStyle: "none",
              display: "grid",
              gap: 8,
              fontSize: 14,
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.6,
            }}
          >
            <li>· Geometrie nicht verzerren oder rotieren.</li>
            <li>· Knoten oder Kanten nicht entfernen / umfärben.</li>
            <li>· Den mintfarbenen Punkt aus der Wortmarke nicht weglassen.</li>
            <li>· Kein Drop-Shadow, kein Gradient, kein Outline-Stroke um das Symbol.</li>
          </ul>
        </div>
      </Section>

      {/* VOICE */}
      <Section id="voice" title="Voice">
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.6,
            marginBottom: 24,
            maxWidth: 720,
          }}
        >
          Glev klingt wie ein erfahrener T1D, der sich kurzhält. Direkt,
          numerisch, ohne Pathos. Deutsch im Du, Englisch im technischen
          Kontext (CGM, in-range, hyper, hypo).
        </p>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <VoiceCard kind="do" text="Glukose 142, stabil seit 30 min." />
          <VoiceCard
            kind="dont"
            text="Deine Glukose-Werte sind aktuell sehr erfreulich!"
          />
          <VoiceCard kind="do" text="Mahlzeit gespeichert. 48g KH." />
          <VoiceCard
            kind="dont"
            text="Super, wir haben deine Mahlzeit erfolgreich erfasst! 🎉"
          />
          <VoiceCard kind="do" text="LibreLinkUp neu verbinden." />
          <VoiceCard
            kind="dont"
            text="Hoppla! Es scheint ein kleines Problem mit der Verbindung zu geben."
          />
        </div>

        <div
          style={{
            marginTop: 28,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <Principle
            title="Kurz"
            text="Maximal 2 Zeilen pro UI-String. Verben vor Substantiven."
          />
          <Principle
            title="Numerisch"
            text="Werte zuerst, Erklärung danach. mg/dL und g KH ausgeschrieben."
          />
          <Principle
            title="Neutral"
            text="Keine Emojis, keine Ausrufezeichen, kein Coaching-Ton."
          />
          <Principle
            title="Medizinisch ehrlich"
            text="Nie „rechnen“, nie „dosieren“. Glev dokumentiert — Therapie macht der Arzt."
          />
        </div>
      </Section>

      {/* COMPLIANCE */}
      <Section id="compliance" title="Compliance">
        <div
          style={{
            background: CARD_BG,
            border: BORDER,
            borderLeft: "3px solid #FF9500",
            borderRadius: 12,
            padding: 24,
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Glev ist kein Medizinprodukt
          </h3>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.75)",
            }}
          >
            Glev ist ein Dokumentations- und Organisations-Tool für Menschen
            mit Typ-1-Diabetes. Glev berechnet keine Insulin-Dosen, gibt keine
            Therapie-Empfehlungen und ist nicht nach MDR/IVDR zertifiziert.
            Therapieentscheidungen triffst du mit deinem behandelnden Arzt.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          <ComplianceCard
            title="Daten"
            text="Glukose-, Mahlzeiten- und Insulin-Daten liegen in Supabase (EU-Region). Auth via Supabase, AI-Features über Replit AI Integrations."
          />
          <ComplianceCard
            title="CGM-Quellen"
            text="FreeStyle Libre 2 via LibreLinkUp (Read-Only). Zugangsdaten verschlüsselt in der DB; jederzeit in den Einstellungen widerrufbar."
          />
          <ComplianceCard
            title="Trademark"
            text="„Glev“ und das Glev-Symbol sind Wortmarke und Bildmarke. Verwendung in Presse-Kontext ohne Rückfrage erlaubt — bitte Geometrie und Farben nicht verändern."
          />
          <ComplianceCard
            title="Kontakt"
            text="Presse, Partnerschaften, Sicherheit: lucas@glev.app"
          />
        </div>

        <div
          style={{
            marginTop: 40,
            paddingTop: 24,
            borderTop: BORDER,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            fontSize: 13,
            color: "rgba(255,255,255,0.5)",
          }}
        >
          <span>© 2026 Glev. Brand Guidelines v1.</span>
          <span>
            Letzte Aktualisierung: April 2026 ·{" "}
            <a
              href="/icon.svg"
              download="glev-icon.svg"
              style={{ color: "#6B8BFF", textDecoration: "none" }}
            >
              Symbol herunterladen
            </a>
          </span>
        </div>
      </Section>
    </div>
  );
}

/* ---------- helpers ---------- */

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        maxWidth: CONTENT_MAX,
        margin: "0 auto",
        padding: "80px 24px",
        scrollMarginTop: 70,
      }}
    >
      <h2
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          marginBottom: 32,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function FoundationCard({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: BORDER,
        borderRadius: 14,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        {text}
      </p>
    </div>
  );
}

function SwatchGroup({
  label,
  swatches,
}: {
  label: string;
  swatches: { hex: string; role: string }[];
}) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "rgba(255,255,255,0.85)",
          marginBottom: 14,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {swatches.map((s) => (
          <HexSwatch key={s.hex + s.role} hex={s.hex} role={s.role} />
        ))}
      </div>
    </div>
  );
}

function TypeCard({
  title,
  subtitle,
  sample,
  sampleStyle,
  note,
}: {
  title: string;
  subtitle: string;
  sample: string;
  sampleStyle: React.CSSProperties;
  note: string;
}) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: BORDER,
        borderRadius: 14,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            marginTop: 4,
            fontFamily:
              "var(--font-mono)",
          }}
        >
          {subtitle}
        </div>
      </div>
      <div
        style={{
          padding: "20px 0",
          borderTop: BORDER,
          borderBottom: BORDER,
          color: "#fff",
          ...sampleStyle,
        }}
      >
        {sample}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.6)",
          lineHeight: 1.5,
        }}
      >
        {note}
      </div>
    </div>
  );
}

function ScaleRow({
  label,
  note,
  style,
  children,
}: {
  label: string;
  note: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr auto",
        gap: 18,
        alignItems: "baseline",
        paddingBottom: 14,
        borderBottom: "1px dashed rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily:
            "var(--font-mono)",
        }}
      >
        {label}
      </div>
      <div style={style}>{children}</div>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          fontFamily:
            "var(--font-mono)",
          textAlign: "right",
        }}
      >
        {note}
      </div>
    </div>
  );
}

function VoiceCard({ kind, text }: { kind: "do" | "dont"; text: string }) {
  const isDo = kind === "do";
  const accent = isDo ? "#22D3A0" : "#FF2D78";
  return (
    <div
      style={{
        background: CARD_BG,
        border: BORDER,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 12,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: accent,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily:
            "var(--font-mono)",
        }}
      >
        {isDo ? "Do" : "Don't"}
      </div>
      <div
        style={{
          fontSize: 15,
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1.5,
        }}
      >
        „{text}"
      </div>
    </div>
  );
}

function Principle({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: BORDER,
        borderRadius: 12,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
        {title}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.65)",
          lineHeight: 1.5,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ComplianceCard({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: BORDER,
        borderRadius: 12,
        padding: 22,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        {text}
      </p>
    </div>
  );
}
