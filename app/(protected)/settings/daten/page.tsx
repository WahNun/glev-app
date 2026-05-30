"use client";

import Link from "next/link";
import { useState, useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { reloadHistoricalEntries } from "@/lib/meals";
import ImportPanel from "@/components/ImportPanel";
import ExportPanel from "@/components/ExportPanel";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PINK = "#FF2D78", BORDER = "var(--border)";
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

type SheetKey = "import" | "historical" | "export";

export default function DatenSettingsPage() {
  const t = useTranslations("settings");
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const closeSheet = useCallback(() => setOpenSheet(null), []);

  const handleReloadHistorical = useCallback(async () => {
    if (!confirm(t("historical_confirm"))) return;
    setReloading(true);
    setReloadMsg(null);
    try {
      const { inserted } = await reloadHistoricalEntries();
      setReloadMsg({ kind: "ok", text: t("historical_loaded", { count: inserted }) });
    } catch (e) {
      setReloadMsg({ kind: "error", text: t("historical_error", { message: e instanceof Error ? e.message : t("historical_failed") }) });
    } finally {
      setReloading(false);
      setTimeout(() => setReloadMsg(null), 4000);
    }
  }, [t]);

  const closeFooter = (
    <button type="button" onClick={closeSheet} style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {t("sheet_close")}
    </button>
  );

  const sheetContent: Record<SheetKey, { title: string; body: ReactNode; footer: ReactNode }> = {
    export: {
      title: t("row_export"),
      body: <ExportPanel />,
      footer: closeFooter,
    },
    import: {
      title: t("row_import"),
      body: <ImportPanel embedded />,
      footer: closeFooter,
    },
    historical: {
      title: t("row_historical_reload"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55 }}>{t("historical_intro")}</div>
          <button
            onClick={handleReloadHistorical}
            disabled={reloading}
            style={{ padding: "12px 18px", borderRadius: 10, border: `1px solid ${ACCENT}40`, cursor: reloading ? "wait" : "pointer", background: `${ACCENT}15`, color: ACCENT, fontSize: 14, fontWeight: 600, opacity: reloading ? 0.6 : 1 }}
          >
            {reloading ? t("historical_loading") : t("historical_reload")}
          </button>
          {reloadMsg && (
            <div style={{ fontSize: 13, color: reloadMsg.kind === "error" ? PINK : GREEN }}>{reloadMsg.text}</div>
          )}
        </div>
      ),
      footer: closeFooter,
    },
  };

  const active = openSheet ? sheetContent[openSheet] : null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ {t("page_title")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{t("section_data")}</h1>
      </div>

      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><path d="M12 3v12" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" /></svg>}
          label={t("row_export")}
          ariaLabel={t("row_open_aria", { label: t("row_export") })}
          onClick={() => setOpenSheet("export")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...iconProps}><path d="M12 21V9" /><path d="M6 13l6-6 6 6" /><path d="M4 3h16" /></svg>}
          label={t("row_import")}
          ariaLabel={t("row_open_aria", { label: t("row_import") })}
          onClick={() => setOpenSheet("import")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...iconProps}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>}
          label={t("row_historical_reload")}
          ariaLabel={t("row_open_aria", { label: t("row_historical_reload") })}
          onClick={() => setOpenSheet("historical")}
        />
      </SettingsSection>

      <BottomSheet open={openSheet !== null} onClose={closeSheet} title={active?.title} footer={active?.footer}>
        {active?.body}
      </BottomSheet>
    </div>
  );
}
