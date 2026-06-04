"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  fetchTargetRange, saveTargetRange,
} from "@/lib/userSettings";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import type { CarbUnit } from "@/lib/carbUnits";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PINK = "#FF2D78", BORDER = "var(--border)";
const inp: React.CSSProperties = { background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14, outline: "none", width: "100%" };
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

type SheetKey = "targetRange" | "units";

interface RangeState { targetMin: number; targetMax: number; }

export default function GlukoseSettingsPage() {
  const t = useTranslations("settings");
  const carbUnit = useCarbUnit();
  const touchedRef = useRef(false);

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [range, setRange] = useState<RangeState>({ targetMin: 70, targetMax: 180 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftRange, setDraftRange] = useState<RangeState | null>(null);

  useEffect(() => {
    fetchTargetRange().then((r) => {
      if (!touchedRef.current) setRange({ targetMin: r.low, targetMax: r.high });
    }).catch(() => {});
  }, []);

  const openSheetWith = useCallback((id: SheetKey) => {
    touchedRef.current = true;
    setSaveError("");
    setDraftRange({ ...range });
    setOpenSheet(id);
  }, [range]);

  const closeSheet = useCallback(() => {
    if (draftRange) setRange(draftRange);
    setDraftRange(null);
    setSaveError("");
    setOpenSheet(null);
  }, [draftRange]);

  async function saveTargetRangeAction(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      const low = Math.min(250, Math.max(40, Math.round(range.targetMin)));
      const high = Math.min(250, Math.max(low + 20, Math.round(range.targetMax)));
      await saveTargetRange({ low, high });
      setRange({ targetMin: low, targetMax: high });
      setDraftRange(null);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("save_failed"));
      return false;
    } finally { setSaving(false); }
  }

  function SaveFooter({ onSave }: { onSave: () => Promise<boolean> }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {saveError && <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4, textAlign: "center" }}>{saveError}</div>}
        <button type="button" onClick={async () => { const ok = await onSave(); if (ok) setOpenSheet(null); }} disabled={saving} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", cursor: saving ? "wait" : "pointer", background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color: "var(--on-accent)", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving ? t("save_button_busy") : saved ? t("save_button_done") : t("save_button_label", { defaultValue: "Speichern" })}
        </button>
      </div>
    );
  }

  const closeFooter = (
    <button type="button" onClick={closeSheet} style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {t("sheet_close")}
    </button>
  );

  const targetRangeSub = t("subtitle_target_range", { min: range.targetMin, max: range.targetMax });

  const sheetContent: Record<SheetKey, { title: string; body: ReactNode; footer: ReactNode }> = {
    targetRange: {
      title: t("row_target_range"),
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t("target_min")}</label>
            <input style={inp} type="number" value={range.targetMin} onChange={(e) => setRange((prev) => ({ ...prev, targetMin: parseInt(e.target.value) || 70 }))} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t("target_max")}</label>
            <input style={inp} type="number" value={range.targetMax} onChange={(e) => setRange((prev) => ({ ...prev, targetMax: parseInt(e.target.value) || 180 }))} />
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveTargetRangeAction} />,
    },
    units: {
      title: t("sheet_units_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("carb_unit_hint")}</div>
          <div role="radiogroup" aria-label={t("carb_unit_title")} style={{ display: "flex", gap: 2, padding: 4, borderRadius: 99, background: "var(--surface-soft)", border: `1px solid ${BORDER}` }}>
            {(["g", "BE", "KE"] as CarbUnit[]).map((v) => {
              const active = carbUnit.unit === v;
              const label = v === "g" ? t("carb_unit_g") : v === "BE" ? t("carb_unit_be") : t("carb_unit_ke");
              return (
                <button key={v} role="radio" aria-checked={active} onClick={() => carbUnit.setUnit(v)} style={{ flex: 1, padding: "9px 12px", borderRadius: 99, border: "none", cursor: "pointer", background: active ? ACCENT : "transparent", color: active ? "var(--on-accent)" : "var(--text-body)", fontSize: 14, fontWeight: active ? 600 : 500, transition: "background 120ms ease, color 120ms ease" }}>
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{carbUnit.description}</div>
          <p style={{ fontSize: 14, color: "var(--text-body)", lineHeight: 1.55, margin: 0 }}>{t("sheet_units_body")}</p>
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
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{t("section_glucose")}</h1>
      </div>

      <SettingsSection>
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...iconProps}><path d="M12 2C8 8 6 12 6 15a6 6 0 0 0 12 0c0-3-2-7-6-13z" /></svg>}
          label={t("row_target_range")}
          subtitle={targetRangeSub}
          ariaLabel={t("row_open_aria", { label: t("row_target_range") })}
          onClick={() => openSheetWith("targetRange")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...iconProps}><path d="M3 7h18M3 12h18M3 17h18" /></svg>}
          label={t("row_units")}
          subtitle={t("subtitle_unit_mgdl")}
          ariaLabel={t("row_open_aria", { label: t("row_units") })}
          onClick={() => openSheetWith("units")}
        />
      </SettingsSection>

      <BottomSheet open={openSheet !== null} onClose={closeSheet} title={active?.title} footer={active?.footer}>
        {active?.body}
      </BottomSheet>
    </div>
  );
}
