"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  fetchTargetRange, saveTargetRange,
  fetchLowAlarmSettingsFromDb, saveLowAlarmSettingsToDb,
  type LowAlarmSettingsDb,
} from "@/lib/userSettings";
import { getLowAlarmSettings, persistLowAlarmSettingsLocally } from "@/lib/lowGlucoseAlarm";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import type { CarbUnit } from "@/lib/carbUnits";
import SnapSlider from "@/components/log/SnapSlider";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PINK = "#FF2D78", BORDER = "var(--border)";
const inp: React.CSSProperties = { background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14, outline: "none", width: "100%" };
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

type SheetKey = "targetRange" | "lowAlarm" | "units";

interface RangeState { targetMin: number; targetMax: number; }

export default function GlukoseSettingsPage() {
  const t = useTranslations("settings");
  const carbUnit = useCarbUnit();
  const touchedRef = useRef(false);

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [range, setRange] = useState<RangeState>({ targetMin: 70, targetMax: 180 });
  const [lowAlarmEnabled, setLowAlarmEnabled] = useState(true);
  const [lowAlarmThreshold, setLowAlarmThreshold] = useState(70);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftRange, setDraftRange] = useState<RangeState | null>(null);
  const [draftLowAlarm, setDraftLowAlarm] = useState<{ enabled: boolean; threshold: number } | null>(null);

  useEffect(() => {
    const local = getLowAlarmSettings();
    setLowAlarmEnabled(local.enabled);
    setLowAlarmThreshold(local.thresholdMgdl);
    fetchLowAlarmSettingsFromDb().then((s) => {
      if (!touchedRef.current) {
        setLowAlarmEnabled(s.enabled);
        setLowAlarmThreshold(s.thresholdMgdl);
        persistLowAlarmSettingsLocally(s);
      }
    }).catch(() => {});
    fetchTargetRange().then((r) => {
      if (!touchedRef.current) setRange({ targetMin: r.low, targetMax: r.high });
    }).catch(() => {});
  }, []);

  const openSheetWith = useCallback((id: SheetKey) => {
    touchedRef.current = true;
    setSaveError("");
    setDraftRange({ ...range });
    setDraftLowAlarm({ enabled: lowAlarmEnabled, threshold: lowAlarmThreshold });
    setOpenSheet(id);
  }, [range, lowAlarmEnabled, lowAlarmThreshold]);

  const closeSheet = useCallback(() => {
    if (draftRange) setRange(draftRange);
    if (draftLowAlarm) { setLowAlarmEnabled(draftLowAlarm.enabled); setLowAlarmThreshold(draftLowAlarm.threshold); }
    setDraftRange(null);
    setDraftLowAlarm(null);
    setSaveError("");
    setOpenSheet(null);
  }, [draftRange, draftLowAlarm]);

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

  async function saveLowAlarmAction(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      const clamped: LowAlarmSettingsDb = { enabled: lowAlarmEnabled, thresholdMgdl: Math.min(90, Math.max(40, Math.round(lowAlarmThreshold))) };
      await saveLowAlarmSettingsToDb(clamped);
      persistLowAlarmSettingsLocally(clamped);
      setDraftLowAlarm(null);
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
    lowAlarm: {
      title: t("sheet_low_alarm_title"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, margin: "0 0 16px" }}>{t("low_alarm_hint")}</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 0" }}>
            <span style={{ fontSize: 14, color: "var(--text-strong)", fontWeight: 500 }}>{t("low_alarm_enabled_label")}</span>
            <button type="button" role="switch" aria-checked={lowAlarmEnabled} onClick={() => setLowAlarmEnabled((v) => !v)} style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer", background: lowAlarmEnabled ? ACCENT : "var(--surface-raised)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <span style={{ position: "absolute", top: 3, width: 20, height: 20, borderRadius: "50%", background: "white", left: lowAlarmEnabled ? 21 : 3, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
          {lowAlarmEnabled && (
            <>
              <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 8 }}>{t("low_alarm_threshold_label")}</p>
              <SnapSlider value={lowAlarmThreshold} onChange={(v) => setLowAlarmThreshold(v)} min={40} max={90} step={1} unit="mg/dL" accent={ACCENT} ariaLabel={t("low_alarm_threshold_label")} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
                {[40, 50, 60, 70, 80, 90].map((tick) => (
                  <span key={tick} style={{ fontSize: 10, color: lowAlarmThreshold === tick ? ACCENT : "var(--text-ghost)", fontWeight: lowAlarmThreshold === tick ? 700 : 400 }}>{tick}</span>
                ))}
              </div>
            </>
          )}
        </div>
      ),
      footer: <SaveFooter onSave={saveLowAlarmAction} />,
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
          icon={<svg {...iconProps}><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></svg>}
          label={t("row_low_alarm")}
          subtitle={lowAlarmEnabled ? t("subtitle_low_alarm_on", { threshold: lowAlarmThreshold }) : t("subtitle_low_alarm_off")}
          ariaLabel={t("row_open_aria", { label: t("row_low_alarm") })}
          onClick={() => openSheetWith("lowAlarm")}
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
