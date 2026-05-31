"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";
import BottomSheet from "@/components/BottomSheet";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", BORDER = "var(--border)";
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function IntegrationenSettingsPage() {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);

  const closeFooter = (
    <button
      type="button"
      onClick={() => setOpen(false)}
      style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
    >
      {t("sheet_close")}
    </button>
  );

  const body: ReactNode = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "var(--surface-soft)", borderRadius: 12, padding: "14px 16px", border: `1px solid ${BORDER}` }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 2 }}>{t("google_sheets_title")}</div>
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{t("google_sheets_desc")}</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 99, background: "var(--surface)", color: "var(--text-dim)", border: `1px solid ${BORDER}`, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {t("coming_soon")}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.55 }}>{t("google_sheets_footnote")}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ {t("page_title")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{t("section_integrations")}</h1>
      </div>

      <SettingsSection>
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...iconProps}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>}
          label={t("google_sheets_title")}
          subtitle={t("subtitle_coming_soon")}
          ariaLabel={t("row_open_aria", { label: t("google_sheets_title") })}
          onClick={() => setOpen(true)}
        />
      </SettingsSection>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("google_sheets_title")} footer={closeFooter}>
        {body}
      </BottomSheet>
    </div>
  );
}
