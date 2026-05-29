"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", PURPLE = "#A78BFA";
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function HilfeSettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/settings"
          style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}
        >
          ‹ {t("page_title")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>Hilfe</h1>
      </div>

      <SettingsSection>
        <SettingsRow
          iconColor={PURPLE}
          icon={<svg {...iconProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
          label={t("row_feature_requests")}
          subtitle={t("subtitle_feature_requests")}
          ariaLabel={t("row_open_aria", { label: t("row_feature_requests") })}
          onClick={() => window.open("https://glev.featurebase.app/", "_blank", "noopener,noreferrer")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><path d="M21 12a9 9 0 1 1-3.5-7.1L21 3v6h-6" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>}
          label={t("row_help_cgm_sources")}
          subtitle={t("subtitle_help_cgm_sources")}
          ariaLabel={t("row_open_aria", { label: t("row_help_cgm_sources") })}
          onClick={() => router.push("/settings/help/cgm-quellen")}
        />
      </SettingsSection>
    </div>
  );
}
