import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function getPractice(slug: string) {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("practice_referrals")
    .select("slug, name, greeting_text, active")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await getPractice(slug);
  if (!p || !p.active) return { title: "Glev" };
  return {
    title: `Glev – Empfohlen von ${p.name}`,
    description:
      p.greeting_text ??
      `${p.name} empfiehlt Glev zur Unterstützung bei Typ-1-Diabetes.`,
  };
}

export default async function PraxisLandingPage({ params }: Props) {
  const { slug } = await params;
  const practice = await getPractice(slug);

  if (!practice || !practice.active) notFound();

  const ctaHref = `/login?ref=${encodeURIComponent(slug)}`;

  return (
    <main style={outerStyle}>
      <div style={cardStyle}>
        {/* Glev wordmark */}
        <div style={wordmarkRowStyle}>
          <span style={wordmarkStyle}>Glev</span>
          <span style={taglineStyle}>Insulin-Entscheidungsunterstützung</span>
        </div>

        {/* Divider */}
        <div style={dividerStyle} />

        {/* Practice badge */}
        <div style={badgeRowStyle}>
          <span style={badgeDotStyle} />
          <span style={badgeLabelStyle}>Empfohlen von</span>
        </div>
        <h1 style={practiceNameStyle}>{practice.name}</h1>

        {/* Greeting text */}
        {practice.greeting_text && (
          <p style={greetingStyle}>„{practice.greeting_text}"</p>
        )}

        {/* CTA */}
        <Link href={ctaHref} style={ctaBtnStyle}>
          Glev starten
        </Link>
        <p style={ctaSubStyle}>
          Kostenlos registrieren · Keine Kreditkarte
        </p>

        {/* Footer */}
        <div style={footerStyle}>
          <Link href="/" style={footerLinkStyle}>
            Mehr über Glev erfahren
          </Link>
          <span style={{ color: "#3a3f4a" }}>·</span>
          <Link href="/legal/datenschutz" style={footerLinkStyle}>
            Datenschutz
          </Link>
        </div>

        {/* Medical disclaimer */}
        <p style={disclaimerStyle}>
          Glev ist ein Entscheidungsunterstützungswerkzeug und ersetzt keine
          ärztliche Beratung. Alle Insulin-Empfehlungen sind Gesprächsgrundlagen
          für dein Diabetes-Team.
        </p>
      </div>
    </main>
  );
}

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const BG      = "#09090B";
const SURFACE = "#111318";
const BORDER  = "#1e2330";

const outerStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: BG,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px 20px",
  fontFamily: "var(--font-sans, 'Inter', system-ui, sans-serif)",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 20,
  padding: "36px 32px 28px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 0,
};

const wordmarkRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  marginBottom: 24,
};

const wordmarkStyle: React.CSSProperties = {
  fontSize: 36,
  fontWeight: 800,
  letterSpacing: "-0.04em",
  color: ACCENT,
  lineHeight: 1,
};

const taglineStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.08em",
  color: "#5a6270",
  textTransform: "uppercase",
};

const dividerStyle: React.CSSProperties = {
  width: "100%",
  height: 1,
  background: BORDER,
  marginBottom: 24,
};

const badgeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 8,
};

const badgeDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: GREEN,
  flexShrink: 0,
};

const badgeLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.08em",
  color: GREEN,
  textTransform: "uppercase",
};

const practiceNameStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 700,
  color: "#f0f4ff",
  margin: "0 0 16px",
  letterSpacing: "-0.02em",
  lineHeight: 1.2,
};

const greetingStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#8b949e",
  lineHeight: 1.6,
  margin: "0 0 28px",
  fontStyle: "italic",
};

const ctaBtnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "15px 24px",
  background: ACCENT,
  color: "#fff",
  borderRadius: 12,
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  textDecoration: "none",
  marginBottom: 10,
  boxSizing: "border-box",
};

const ctaSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#5a6270",
  margin: "0 0 28px",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 20,
  flexWrap: "wrap",
  justifyContent: "center",
};

const footerLinkStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#5a6270",
  textDecoration: "none",
};

const disclaimerStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#3a3f4a",
  lineHeight: 1.5,
  margin: 0,
  maxWidth: 340,
};
