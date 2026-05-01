import React from "react";
import { getTranslations } from "next-intl/server";
import GlevLogo from "@/components/GlevLogo";
import HexSwatch from "@/components/brand/HexSwatch";
import LogoCard from "@/components/brand/LogoCard";
import LogoPlayground from "@/components/brand/LogoPlayground";
import SectionNav from "@/components/brand/SectionNav";

const PAGE_BG = "#09090B";
const CARD_BG = "#111117";
const BORDER = "1px solid rgba(255,255,255,0.08)";
const CONTENT_MAX = 1100;

type SwatchSpec = { hex: string; roleKey: string };

const BRAND_SWATCHES: SwatchSpec[] = [
  { hex: "#4F6EF7", roleKey: "brand_color_role_primary" },
  { hex: "#6B8BFF", roleKey: "brand_color_role_hover" },
  { hex: "#4F6EF740", roleKey: "brand_color_role_focus" },
];
const INK_SWATCHES: SwatchSpec[] = [
  { hex: "#09090B", roleKey: "brand_color_role_page_bg" },
  { hex: "#0A0A0F", roleKey: "brand_color_role_body_bg" },
  { hex: "#0D0D12", roleKey: "brand_color_role_card_alt" },
  { hex: "#0F0F14", roleKey: "brand_color_role_logo_bg" },
  { hex: "#111117", roleKey: "brand_color_role_surface" },
  { hex: "#141420", roleKey: "brand_color_role_surface_alt" },
];
const STATUS_SWATCHES: SwatchSpec[] = [
  { hex: "#22D3A0", roleKey: "brand_color_role_green" },
  { hex: "#FF9500", roleKey: "brand_color_role_orange" },
  { hex: "#FF2D78", roleKey: "brand_color_role_pink" },
  { hex: "#FFD60A", roleKey: "brand_color_role_yellow" },
];
const MEAL_CHART_SWATCHES: SwatchSpec[] = [
  { hex: "#FF9500", roleKey: "brand_color_role_fast_carbs" },
  { hex: "#3B82F6", roleKey: "brand_color_role_high_protein" },
  { hex: "#A855F7", roleKey: "brand_color_role_high_fat" },
  { hex: "#22D3A0", roleKey: "brand_color_role_balanced" },
  { hex: "#60A5FA", roleKey: "brand_color_role_glucose_line" },
  { hex: "#F472B6", roleKey: "brand_color_role_chart_highlight" },
  { hex: "#A78BFA", roleKey: "brand_color_role_ui_secondary" },
];

export default async function BrandPage() {
  const t = await getTranslations("marketing");

  const resolveSwatches = (items: SwatchSpec[]) =>
    items.map(({ hex, roleKey }) => ({ hex, role: t(roleKey) }));

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
          {t("brand_subtitle")}
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
          {t("brand_tagline")}
        </div>
      </section>

      {/* FOUNDATION */}
      <Section id="foundation" title={t("brand_section_foundation")}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          <FoundationCard
            title={t("brand_foundation_what_title")}
            text={t("brand_foundation_what_text")}
          />
          <FoundationCard
            title={t("brand_foundation_not_title")}
            text={t("brand_foundation_not_text")}
          />
          <FoundationCard
            title={t("brand_foundation_who_title")}
            text={t("brand_foundation_who_text")}
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
          {t("brand_foundation_quote")}
        </blockquote>
      </Section>

      {/* COLOR */}
      <Section id="color" title={t("brand_section_color")}>
        <SwatchGroup
          label={t("brand_color_group_brand")}
          swatches={resolveSwatches(BRAND_SWATCHES)}
        />
        <SwatchGroup
          label={t("brand_color_group_ink")}
          swatches={resolveSwatches(INK_SWATCHES)}
        />
        <SwatchGroup
          label={t("brand_color_group_status")}
          swatches={resolveSwatches(STATUS_SWATCHES)}
        />
        <SwatchGroup
          label={t("brand_color_group_meal")}
          swatches={resolveSwatches(MEAL_CHART_SWATCHES)}
        />

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
            {t("brand_color_trend_heading")}
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
            <span>{t("brand_color_trend_hypo")}</span>
            <span>{t("brand_color_trend_in_range")}</span>
            <span>{t("brand_color_trend_hyper")}</span>
            <span>{t("brand_color_trend_none")}</span>
          </div>
          <p
            style={{
              marginTop: 16,
              fontSize: 14,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.65)",
            }}
          >
            {t("brand_color_trend_note")}
          </p>
        </div>
      </Section>

      {/* TYPOGRAPHY */}
      <Section id="typography" title={t("brand_section_typography")}>
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <TypeCard
            title="Inter"
            subtitle={t("brand_type_inter_subtitle")}
            sample={t("brand_type_inter_sample")}
            sampleStyle={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
            note={t("brand_type_inter_note")}
          />
          <TypeCard
            title="JetBrains Mono"
            subtitle={t("brand_type_mono_subtitle")}
            sample={t("brand_type_mono_sample")}
            sampleStyle={{
              fontFamily: "var(--font-mono)",
              fontSize: 18,
              fontWeight: 500,
            }}
            note={t("brand_type_mono_note")}
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
            label={t("brand_scale_display_label")}
            note={t("brand_scale_display_note")}
            style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.03em" }}
          >
            {t("brand_scale_display_sample")}
          </ScaleRow>
          <ScaleRow
            label={t("brand_scale_h1_label")}
            note={t("brand_scale_h1_note")}
            style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {t("brand_scale_h1_sample")}
          </ScaleRow>
          <ScaleRow
            label={t("brand_scale_h2_label")}
            note={t("brand_scale_h2_note")}
            style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            {t("brand_scale_h2_sample")}
          </ScaleRow>
          <ScaleRow
            label={t("brand_scale_body_label")}
            note={t("brand_scale_body_note")}
            style={{ fontSize: 15, fontWeight: 400, lineHeight: 1.6 }}
          >
            {t("brand_scale_body_sample")}
          </ScaleRow>
          <ScaleRow
            label={t("brand_scale_caption_label")}
            note={t("brand_scale_caption_note")}
            style={{
              fontSize: 12,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            {t("brand_scale_caption_sample")}
          </ScaleRow>
        </div>
      </Section>

      {/* LOGO */}
      <Section id="logo" title={t("brand_section_logo")}>
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.6,
            marginBottom: 24,
            maxWidth: 720,
          }}
        >
          {t("brand_logo_intro")}
        </p>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <LogoCard
            title={t("brand_logo_primary_title")}
            description={t("brand_logo_primary_desc")}
            bg="#0F0F14"
            color="#4F6EF7"
          />
          <LogoCard
            title={t("brand_logo_onbrand_title")}
            description={t("brand_logo_onbrand_desc")}
            bg="#4F6EF7"
            color="#FFFFFF"
            downloadName="glev-icon-on-brand.svg"
          />
          <LogoCard
            title={t("brand_logo_onlight_title")}
            description={t("brand_logo_onlight_desc")}
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
          {t("brand_logo_playground")}
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
            {t("brand_logo_donts_title")}
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
            <li>· {t("brand_logo_dont_1")}</li>
            <li>· {t("brand_logo_dont_2")}</li>
            <li>· {t("brand_logo_dont_3")}</li>
            <li>· {t("brand_logo_dont_4")}</li>
          </ul>
        </div>
      </Section>

      {/* VOICE */}
      <Section id="voice" title={t("brand_section_voice")}>
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.7)",
            lineHeight: 1.6,
            marginBottom: 24,
            maxWidth: 720,
          }}
        >
          {t("brand_voice_intro")}
        </p>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <VoiceCard
            kind="do"
            label={t("brand_voice_do")}
            text={t("brand_voice_do_1")}
            quoteOpen={t("brand_voice_quote_open")}
            quoteClose={t("brand_voice_quote_close")}
          />
          <VoiceCard
            kind="dont"
            label={t("brand_voice_dont")}
            text={t("brand_voice_dont_1")}
            quoteOpen={t("brand_voice_quote_open")}
            quoteClose={t("brand_voice_quote_close")}
          />
          <VoiceCard
            kind="do"
            label={t("brand_voice_do")}
            text={t("brand_voice_do_2")}
            quoteOpen={t("brand_voice_quote_open")}
            quoteClose={t("brand_voice_quote_close")}
          />
          <VoiceCard
            kind="dont"
            label={t("brand_voice_dont")}
            text={t("brand_voice_dont_2")}
            quoteOpen={t("brand_voice_quote_open")}
            quoteClose={t("brand_voice_quote_close")}
          />
          <VoiceCard
            kind="do"
            label={t("brand_voice_do")}
            text={t("brand_voice_do_3")}
            quoteOpen={t("brand_voice_quote_open")}
            quoteClose={t("brand_voice_quote_close")}
          />
          <VoiceCard
            kind="dont"
            label={t("brand_voice_dont")}
            text={t("brand_voice_dont_3")}
            quoteOpen={t("brand_voice_quote_open")}
            quoteClose={t("brand_voice_quote_close")}
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
            title={t("brand_principle_short_title")}
            text={t("brand_principle_short_text")}
          />
          <Principle
            title={t("brand_principle_numeric_title")}
            text={t("brand_principle_numeric_text")}
          />
          <Principle
            title={t("brand_principle_neutral_title")}
            text={t("brand_principle_neutral_text")}
          />
          <Principle
            title={t("brand_principle_honest_title")}
            text={t("brand_principle_honest_text")}
          />
        </div>
      </Section>

      {/* COMPLIANCE */}
      <Section id="compliance" title={t("brand_section_compliance")}>
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
            {t("brand_compliance_no_med_title")}
          </h3>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.75)",
            }}
          >
            {t("brand_compliance_no_med_body")}
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
            title={t("brand_compliance_data_title")}
            text={t("brand_compliance_data_text")}
          />
          <ComplianceCard
            title={t("brand_compliance_cgm_title")}
            text={t("brand_compliance_cgm_text")}
          />
          <ComplianceCard
            title={t("brand_compliance_trademark_title")}
            text={t("brand_compliance_trademark_text")}
          />
          <ComplianceCard
            title={t("brand_compliance_contact_title")}
            text={t("brand_compliance_contact_text")}
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
          <span>{t("brand_footer_copyright")}</span>
          <span>
            {t("brand_footer_updated")} ·{" "}
            <a
              href="/icon.svg"
              download="glev-icon.svg"
              style={{ color: "#6B8BFF", textDecoration: "none" }}
            >
              {t("brand_footer_download")}
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

function VoiceCard({
  kind,
  label,
  text,
  quoteOpen,
  quoteClose,
}: {
  kind: "do" | "dont";
  label: string;
  text: string;
  quoteOpen: string;
  quoteClose: string;
}) {
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
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1.5,
        }}
      >
        {quoteOpen}{text}{quoteClose}
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
