"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  fetchInsulinSettings, saveInsulinSettings,
  fetchTargetRange, saveTargetRange,
  DEFAULT_INSULIN_SETTINGS,
  fetchAdjustmentHistory, fetchEngineIcrInfo, setEngineIcrAutoApply,
  DEFAULT_ENGINE_ICR_INFO, type EngineIcrInfo,
  fetchInsulinType, saveInsulinType,
} from "@/lib/userSettings";
import { parseDbDate, localeToBcp47 } from "@/lib/time";
import { fetchIcrSchedule } from "@/lib/icrSchedule";
import type { InsulinType } from "@/lib/iob";
import type { AdjustmentRecord } from "@/lib/engine/adjustment";
import { BASAL_WINDOW_PRESETS, BASAL_BRAND_PRESETS, DEFAULT_BASAL_WINDOW_H } from "@/lib/engine/constants";
import SnapSlider from "@/components/log/SnapSlider";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", PINK = "#FF2D78", BORDER = "var(--border)";
const inp: React.CSSProperties = { background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14, outline: "none", width: "100%" };
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const BOLUS_BRAND_PRESETS: Array<{ name: string; mfr: string; ultraRapid: boolean }> = [
  { name: "NovoRapid", mfr: "Novo Nordisk", ultraRapid: false },
  { name: "Fiasp",     mfr: "Novo Nordisk", ultraRapid: true  },
  { name: "Humalog",   mfr: "Eli Lilly",    ultraRapid: false },
  { name: "Lyumjev",   mfr: "Eli Lilly",    ultraRapid: true  },
  { name: "Apidra",    mfr: "Sanofi",       ultraRapid: false },
];

function SubgroupLabel({ label }: { label: string }) {
  return (
    <div style={{ padding: "10px 14px 6px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", borderTop: `1px solid ${BORDER}`, background: "transparent" }}>
      {label}
    </div>
  );
}

interface Settings {
  targetMin: number; targetMax: number;
  icr: number; cf: number; targetBg: number; diaMinutes?: number;
  insulinBrandBolus: string; insulinBrandBolus2: string; insulinBrandBasal: string; basalActionWindowH?: number;
}

const DEFAULTS: Settings = {
  targetMin: 70, targetMax: 180,
  icr: DEFAULT_INSULIN_SETTINGS.icr, cf: DEFAULT_INSULIN_SETTINGS.cf, targetBg: DEFAULT_INSULIN_SETTINGS.targetBg,
  insulinBrandBolus: "", insulinBrandBolus2: "", insulinBrandBasal: "",
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("glev_settings") || "{}") }; }
  catch { return DEFAULTS; }
}
function saveSettingsLocal(s: Settings) {
  if (typeof window !== "undefined") localStorage.setItem("glev_settings", JSON.stringify(s));
}

type SheetKey = "icr" | "cf" | "targetBg" | "dia" | "insulinType" | "insulinBrandBolus" | "insulinBrandBolus2" | "insulinBrandBasal" | "basalWindow" | "adjustmentHistory";

export default function InsulinSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const uiLocale = useLocale();
  const bcp47 = localeToBcp47(uiLocale);
  const insulinTouchedRef = useRef(false);
  const pendingClampRef = useRef<{ notice: string } | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [insulinType, setInsulinType] = useState<InsulinType>("rapid");
  const [engineIcrInfo, setEngineIcrInfo] = useState<EngineIcrInfo>(DEFAULT_ENGINE_ICR_INFO);
  const [autoApplyBusy, setAutoApplyBusy] = useState(false);
  const [adjustmentHistory, setAdjustmentHistory] = useState<AdjustmentRecord[]>([]);
  const [icrScheduleSummary, setIcrScheduleSummary] = useState<{ enabled: boolean; activeSlots: number } | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [clampNotice, setClampNotice] = useState<string | null>(null);
  const [draftSnapshot, setDraftSnapshot] = useState<Settings | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    fetchTargetRange().then((range) => {
      if (insulinTouchedRef.current) return;
      setSettings((prev) => { const next = { ...prev, targetMin: range.low, targetMax: range.high }; saveSettingsLocal(next); return next; });
    }).catch(() => {});
    fetchInsulinSettings().then((ins) => {
      if (insulinTouchedRef.current) return;
      setSettings((prev) => {
        const next = { ...prev, icr: ins.icr, cf: ins.cf, targetBg: ins.targetBg, diaMinutes: ins.diaMinutes, insulinBrandBolus: ins.insulinBrandBolus ?? prev.insulinBrandBolus, insulinBrandBolus2: ins.insulinBrandBolus2 ?? prev.insulinBrandBolus2, insulinBrandBasal: ins.insulinBrandBasal ?? prev.insulinBrandBasal, basalActionWindowH: ins.basalActionWindowH ?? prev.basalActionWindowH };
        saveSettingsLocal(next); return next;
      });
    }).catch(() => {}).finally(() => { insulinTouchedRef.current = false; });
    fetchInsulinType().then(setInsulinType).catch(() => {});
    fetchEngineIcrInfo().then(setEngineIcrInfo).catch(() => {});
    fetchAdjustmentHistory().then((rows) => setAdjustmentHistory(rows.slice(0, 10))).catch(() => {});
    fetchIcrSchedule().then((s) => setIcrScheduleSummary({ enabled: s.enabled, activeSlots: s.slots.filter((slot) => slot.enabled).length })).catch(() => {});
  }, []);

  function upd<K extends keyof Settings>(key: K, val: Settings[K]) {
    if (key === "icr" || key === "cf" || key === "targetBg" || key === "diaMinutes") insulinTouchedRef.current = true;
    setSettings((prev) => ({ ...prev, [key]: val }));
  }

  const openSheetWith = useCallback((id: SheetKey) => {
    insulinTouchedRef.current = true;
    setSaveError(""); setClampNotice(null); pendingClampRef.current = null;
    setSettings((cur) => { setDraftSnapshot({ ...cur }); return cur; });
    setOpenSheet(id);
  }, []);

  const closeSheet = useCallback(() => {
    if (draftSnapshot) setSettings(draftSnapshot);
    setDraftSnapshot(null);
    setSaveError(""); setClampNotice(null); pendingClampRef.current = null;
    setOpenSheet(null);
  }, [draftSnapshot]);

  async function saveInsulinAction(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      const clamped = {
        icr: Math.min(30, Math.max(5, Math.round(settings.icr * 10) / 10)),
        cf: Math.min(500, Math.max(1, Math.round(settings.cf))),
        targetBg: Math.min(200, Math.max(60, Math.round(settings.targetBg))),
        ...(settings.diaMinutes !== undefined ? { diaMinutes: Math.min(360, Math.max(60, Math.round(settings.diaMinutes))) } : {}),
      };
      await saveInsulinSettings(clamped);
      try {
        const rangeLow = Math.min(250, Math.max(40, Math.round(settings.targetMin)));
        const rangeHigh = Math.min(250, Math.max(rangeLow + 20, Math.round(settings.targetMax)));
        await saveTargetRange({ low: rangeLow, high: rangeHigh });
      } catch { /* non-fatal */ }
      const next = { ...settings, ...clamped };
      setSettings(next); saveSettingsLocal(next);
      setDraftSnapshot(null);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      const clamp = pendingClampRef.current;
      pendingClampRef.current = null;
      setClampNotice(clamp ? clamp.notice : null);
      return !clamp;
    } catch (e) { setSaveError(e instanceof Error ? e.message : t("save_failed")); return false; }
    finally { setSaving(false); }
  }

  async function saveInsulinBrandsAction(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      await saveInsulinSettings({
        icr: Math.min(30, Math.max(5, Math.round(settings.icr * 10) / 10)),
        cf: Math.min(500, Math.max(1, Math.round(settings.cf))),
        targetBg: Math.min(200, Math.max(60, Math.round(settings.targetBg))),
        ...(settings.diaMinutes !== undefined ? { diaMinutes: Math.min(360, Math.max(60, Math.round(settings.diaMinutes))) } : {}),
        insulinBrandBolus: settings.insulinBrandBolus.trim().slice(0, 40) || undefined,
        insulinBrandBolus2: settings.insulinBrandBolus2.trim().slice(0, 40) || undefined,
        insulinBrandBasal: settings.insulinBrandBasal.trim().slice(0, 40) || undefined,
        ...(settings.basalActionWindowH !== undefined ? { basalActionWindowH: Math.min(72, Math.max(12, Math.round(settings.basalActionWindowH))) } : {}),
      });
      const next = { ...settings };
      setSettings(next); saveSettingsLocal(next);
      setDraftSnapshot(null);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (e) { setSaveError(e instanceof Error ? e.message : t("save_failed")); return false; }
    finally { setSaving(false); }
  }

  async function saveInsulinTypeAction(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      await saveInsulinType(insulinType);
      setSaved(true); setTimeout(() => setSaved(false), 1500);
      return true;
    } catch (e) { setSaveError(e instanceof Error ? e.message : t("save_failed")); return false; }
    finally { setSaving(false); }
  }

  function SaveFooter({ onSave }: { onSave: () => Promise<boolean> }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {clampNotice && <div data-testid="clamp-notice" style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.45, textAlign: "center", padding: "8px 12px", background: "var(--surface-soft)", border: "1px solid var(--border)", borderRadius: 8 }}>{clampNotice}</div>}
        {saveError && <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4, textAlign: "center" }}>{saveError}</div>}
        <button type="button" onClick={async () => { const ok = await onSave(); if (ok) setOpenSheet(null); }} disabled={saving} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", cursor: saving ? "wait" : "pointer", background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color: "var(--on-accent)", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving ? t("save_button_busy") : saved ? t("save_button_done") : tCommon("save")}
        </button>
      </div>
    );
  }

  const closeFooter = <button type="button" onClick={closeSheet} style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{t("sheet_close")}</button>;

  const icrSub = t("subtitle_icr", { value: settings.icr });
  const cfSub = t("subtitle_cf", { value: settings.cf });
  const targetBgSub = t("subtitle_target_bg", { value: settings.targetBg });
  const diaSub = settings.diaMinutes != null ? t("subtitle_dia", { minutes: settings.diaMinutes }) : t("subtitle_dia_unset");
  const adjustmentHistorySub = adjustmentHistory.length === 0 ? t("subtitle_adjustment_history_empty") : t("subtitle_adjustment_history_count", { n: adjustmentHistory.length });

  const sheetContent: Record<SheetKey, { title: string; body: ReactNode; footer: ReactNode }> = {
    icr: {
      title: t("insulin_to_carb_ratio"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>{t("icr_label")}</p>
          <SnapSlider value={settings.icr ?? 10} onChange={(v) => upd("icr", v)} onRawChange={(raw) => { const clamped = Math.max(5, Math.min(30, raw)); pendingClampRef.current = Math.abs(clamped - raw) > 0.001 ? { notice: t("clamp_notice", { value: `${clamped} g/IE`, min: 5, max: 30 }) } : null; }} min={5} max={30} step={1} unit="g/IE" accent={ACCENT} ariaLabel={t("insulin_to_carb_ratio")} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
            {[5, 10, 15, 20, 25, 30].map((tick) => <span key={tick} style={{ fontSize: 10, color: (settings.icr ?? 10) === tick ? ACCENT : "var(--text-ghost)", fontWeight: (settings.icr ?? 10) === tick ? 700 : 400, transition: "color 150ms ease" }}>{tick}</span>)}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{t("icr_hint")}</div>
          {engineIcrInfo.value != null && engineIcrInfo.sampleSize > 0 ? (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--surface-soft)", border: `1px solid var(--border-soft)`, borderRadius: 10, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {t("icr_engine_suggestion", { value: Math.round(engineIcrInfo.value * 10) / 10, n: engineIcrInfo.sampleSize })}
            </div>
          ) : engineIcrInfo.sampleSize > 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>{t("icr_engine_warming_up", { n: engineIcrInfo.sampleSize })}</div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>{t("icr_engine_no_data_yet")}</div>
          )}
          <label style={{ marginTop: 14, display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", background: "var(--surface-soft)", border: `1px solid var(--border)`, borderRadius: 12, cursor: autoApplyBusy ? "wait" : "pointer", opacity: autoApplyBusy ? 0.6 : 1 }}>
            <input type="checkbox" checked={engineIcrInfo.autoApply} disabled={autoApplyBusy} onChange={async (e) => {
              const next = e.target.checked;
              setEngineIcrInfo((p) => ({ ...p, autoApply: next }));
              setAutoApplyBusy(true);
              try { await setEngineIcrAutoApply(next); }
              catch { setEngineIcrInfo((p) => ({ ...p, autoApply: !next })); setSaveError(t("save_failed")); }
              finally { setAutoApplyBusy(false); }
            }} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, cursor: "inherit" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("icr_auto_apply_label")}</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.5 }}>{t("icr_auto_apply_hint")}</div>
            </div>
          </label>
          <button type="button" onClick={() => { setOpenSheet(null); router.push("/settings/icr-schedule"); }} style={{ marginTop: 18, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--surface-soft)", border: `1px solid var(--border)`, borderRadius: 12, cursor: "pointer", textAlign: "left" }} aria-label={t("row_open_aria", { label: t("row_icr_schedule") })}>
            <div style={{ flex: 1, paddingRight: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("row_icr_schedule")}</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>{icrScheduleSummary?.enabled && icrScheduleSummary.activeSlots > 0 ? t("subtitle_icr_schedule_on", { n: icrScheduleSummary.activeSlots }) : t("subtitle_icr_schedule_off")}</div>
            </div>
            <span style={{ fontSize: 18, color: "var(--text-ghost)" }}>›</span>
          </button>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    cf: {
      title: t("correction_factor"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>{t("cf_label")}</p>
          <SnapSlider value={settings.cf ?? 50} onChange={(v) => upd("cf", v)} onRawChange={(raw) => { const clamped = Math.max(10, Math.min(100, raw)); pendingClampRef.current = clamped !== raw ? { notice: t("clamp_notice", { value: `${clamped} mg/dL/IE`, min: 10, max: 100 }) } : null; }} min={10} max={100} step={1} unit="mg/dL/IE" accent={ACCENT} ariaLabel={t("correction_factor")} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
            {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((tick) => <span key={tick} style={{ fontSize: 10, color: (settings.cf ?? 50) === tick ? ACCENT : "var(--text-ghost)", fontWeight: (settings.cf ?? 50) === tick ? 700 : 400, transition: "color 150ms ease" }}>{tick}</span>)}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{t("cf_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    targetBg: {
      title: t("row_target_bg"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>{t("target_bg_label")}</p>
          <SnapSlider value={settings.targetBg ?? 100} onChange={(v) => upd("targetBg", v)} onRawChange={(raw) => { const clamped = Math.max(60, Math.min(200, raw)); pendingClampRef.current = clamped !== raw ? { notice: t("clamp_notice", { value: `${clamped} mg/dL`, min: 60, max: 200 }) } : null; }} min={60} max={200} step={5} unit="mg/dL" accent={ACCENT} ariaLabel={t("row_target_bg")} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
            {[80, 100, 120, 140, 160, 180].map((tick) => <span key={tick} style={{ fontSize: 10, color: (settings.targetBg ?? 100) === tick ? ACCENT : "var(--text-ghost)", fontWeight: (settings.targetBg ?? 100) === tick ? 700 : 400, transition: "color 150ms ease" }}>{tick}</span>)}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{t("target_bg_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    dia: {
      title: t("sheet_dia_title"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>{t("sheet_dia_body")}</p>
          <SnapSlider value={settings.diaMinutes ?? 180} onChange={(v) => upd("diaMinutes", v)} onRawChange={(raw) => { const clamped = Math.max(60, Math.min(360, raw)); pendingClampRef.current = clamped !== raw ? { notice: t("clamp_notice", { value: `${clamped} min`, min: 60, max: 360 }) } : null; }} min={60} max={360} step={30} unit="min" accent={ACCENT} ariaLabel={t("sheet_dia_label")} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
            {[60, 120, 180, 240, 300, 360].map((tick) => <span key={tick} style={{ fontSize: 10, color: (settings.diaMinutes ?? 180) === tick ? ACCENT : "var(--text-ghost)", fontWeight: (settings.diaMinutes ?? 180) === tick ? 700 : 400, transition: "color 150ms ease" }}>{tick}</span>)}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{t("sheet_dia_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    insulinType: {
      title: t("sheet_insulin_type_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(["rapid", "regular"] as const).map((type) => {
            const isSelected = insulinType === type;
            return (
              <button key={type} type="button" onClick={() => setInsulinType(type)} style={{ width: "100%", padding: "14px 16px", borderRadius: 14, border: `2px solid ${isSelected ? ACCENT : BORDER}`, background: isSelected ? `${ACCENT}14` : "var(--surface-soft)", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, transition: "border-color 150ms ease, background 150ms ease" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: isSelected ? ACCENT : "var(--text-strong)" }}>{type === "rapid" ? t("insulin_type_rapid_label") : t("insulin_type_regular_label")}</div>
                <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{type === "rapid" ? t("insulin_type_rapid_examples") : t("insulin_type_regular_examples")}</div>
                <div style={{ fontSize: 12, color: isSelected ? ACCENT : "var(--text-faint)", marginTop: 2 }}>{type === "rapid" ? t("insulin_type_rapid_dia") : t("insulin_type_regular_dia")}</div>
              </button>
            );
          })}
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinTypeAction} />,
    },
    insulinBrandBolus: {
      title: t("sheet_insulin_brand_bolus_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>{t("insulin_brand_body")}</p>
          {BOLUS_BRAND_PRESETS.map((preset) => {
            const isSel = settings.insulinBrandBolus === preset.name;
            return (
              <button key={preset.name} type="button" onClick={() => upd("insulinBrandBolus", preset.name)} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${isSel ? ACCENT : BORDER}`, background: isSel ? `${ACCENT}14` : "var(--surface-soft)", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, transition: "border-color 150ms ease, background 150ms ease" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: isSel ? ACCENT : "var(--text-strong)" }}>{preset.name}</div>
                <div style={{ fontSize: 12, color: isSel ? ACCENT : "var(--text-faint)" }}>{preset.mfr} · {preset.ultraRapid ? t("insulin_brand_preset_ultra_rapid") : t("insulin_type_rapid_label")}</div>
              </button>
            );
          })}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t("insulin_brand_or_manual")}</label>
            <input style={inp} type="text" maxLength={40} placeholder={t("insulin_brand_bolus_placeholder")} value={settings.insulinBrandBolus} onChange={(e) => upd("insulinBrandBolus", e.target.value.slice(0, 40))} />
            <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 6 }}>{t("insulin_brand_hint")}</div>
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
    },
    insulinBrandBolus2: {
      title: t("sheet_insulin_brand_bolus_2_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>{t("insulin_brand_bolus_2_body")}</p>
          {BOLUS_BRAND_PRESETS.map((preset) => {
            const isSel = settings.insulinBrandBolus2 === preset.name;
            return (
              <button key={preset.name} type="button" onClick={() => upd("insulinBrandBolus2", preset.name)} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${isSel ? ACCENT : BORDER}`, background: isSel ? `${ACCENT}14` : "var(--surface-soft)", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, transition: "border-color 150ms ease, background 150ms ease" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: isSel ? ACCENT : "var(--text-strong)" }}>{preset.name}</div>
                <div style={{ fontSize: 12, color: isSel ? ACCENT : "var(--text-faint)" }}>{preset.mfr} · {preset.ultraRapid ? t("insulin_brand_preset_ultra_rapid") : t("insulin_type_rapid_label")}</div>
              </button>
            );
          })}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t("insulin_brand_or_manual")}</label>
            <input style={inp} type="text" maxLength={40} placeholder={t("insulin_brand_bolus_2_placeholder")} value={settings.insulinBrandBolus2} onChange={(e) => upd("insulinBrandBolus2", e.target.value.slice(0, 40))} />
            <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 6 }}>{t("insulin_brand_hint")}</div>
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
    },
    insulinBrandBasal: {
      title: t("sheet_insulin_brand_basal_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>{t("insulin_brand_basal_body")}</p>
          {BASAL_BRAND_PRESETS.map((preset) => {
            const isSel = settings.insulinBrandBasal === preset.name;
            return (
              <button key={preset.name} type="button" onClick={() => {
                insulinTouchedRef.current = true;
                setSettings((prev) => ({ ...prev, insulinBrandBasal: preset.name, basalActionWindowH: preset.windowH }));
              }} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${isSel ? ACCENT : BORDER}`, background: isSel ? `${ACCENT}14` : "var(--surface-soft)", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, transition: "border-color 150ms ease, background 150ms ease" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: isSel ? ACCENT : "var(--text-strong)" }}>{preset.name}</div>
                <div style={{ fontSize: 12, color: isSel ? ACCENT : "var(--text-faint)" }}>{preset.mfr} · {t("basal_window_preset_duration", { h: preset.windowH })}</div>
              </button>
            );
          })}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t("insulin_brand_or_manual")}</label>
            <input style={inp} type="text" maxLength={40} placeholder={t("insulin_brand_basal_placeholder")} value={settings.insulinBrandBasal} onChange={(e) => upd("insulinBrandBasal", e.target.value.slice(0, 40))} />
            <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 6 }}>{t("insulin_brand_hint")}</div>
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
    },
    basalWindow: {
      title: t("sheet_basal_window_title"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 14 }}>{t("basal_window_body")}</p>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 8 }}>{t("basal_window_preset_label")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {Object.entries(BASAL_WINDOW_PRESETS).map(([brand, hours]) => {
              const isSel = settings.basalActionWindowH === hours;
              return (
                <button key={brand} type="button" onClick={() => upd("basalActionWindowH", hours)} style={{ background: isSel ? ACCENT : "var(--surface-soft)", color: isSel ? "var(--on-accent)" : "var(--text)", border: `1px solid ${isSel ? ACCENT : BORDER}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: isSel ? 600 : 500, cursor: "pointer" }}>
                  {brand} · {hours} h
                </button>
              );
            })}
          </div>
          <SnapSlider min={12} max={72} step={2} unit="h" accent={ACCENT} value={settings.basalActionWindowH ?? DEFAULT_BASAL_WINDOW_H} onChange={(v) => upd("basalActionWindowH", v)} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-ghost)", marginTop: 6, padding: "0 4px" }}>
            {[12, 24, 36, 48, 60, 72].map((tick) => <span key={tick} style={{ color: (settings.basalActionWindowH ?? DEFAULT_BASAL_WINDOW_H) === tick ? ACCENT : "var(--text-ghost)", fontWeight: (settings.basalActionWindowH ?? DEFAULT_BASAL_WINDOW_H) === tick ? 700 : 400 }}>{tick}</span>)}
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
    },
    adjustmentHistory: {
      title: t("adjustment_history_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.5, margin: 0 }}>{t("adjustment_history_intro")}</p>
          {adjustmentHistory.length === 0 ? (
            <div style={{ padding: "14px 16px", borderRadius: 12, background: "var(--surface-soft)", border: `1px solid ${BORDER}`, fontSize: 14, color: "var(--text-faint)" }}>{t("adjustment_history_empty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {adjustmentHistory.map((rec, idx) => {
                const date = parseDbDate(rec.at).toLocaleDateString(bcp47, { year: "numeric", month: "short", day: "numeric" });
                const fieldLabel = rec.field === "icr" ? t("adjustment_field_icr") : t("adjustment_field_cf");
                return (
                  <div key={`${rec.at}-${idx}`} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-soft)", border: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{t("adjustment_history_row", { date, field: fieldLabel, from: rec.from, to: rec.to })}</div>
                    {rec.reason && <div style={{ fontSize: 13, color: "var(--text-faint)" }}>{rec.reason}</div>}
                  </div>
                );
              })}
            </div>
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
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{t("section_insulin")}</h1>
      </div>

      <SettingsSection>
        <SubgroupLabel label={t("group_insulin_params")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("insulin_to_carb_ratio")} subtitle={icrSub} ariaLabel={t("row_open_aria", { label: t("insulin_to_carb_ratio") })} onClick={() => openSheetWith("icr")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>} label={t("correction_factor")} subtitle={cfSub} ariaLabel={t("row_open_aria", { label: t("correction_factor") })} onClick={() => openSheetWith("cf")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M12 2C8 8 6 12 6 15a6 6 0 0 0 12 0c0-3-2-7-6-13z" /></svg>} label={t("row_target_bg")} subtitle={targetBgSub} ariaLabel={t("row_open_aria", { label: t("row_target_bg") })} onClick={() => openSheetWith("targetBg")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("row_dia")} subtitle={diaSub} ariaLabel={t("row_open_aria", { label: t("row_dia") })} onClick={() => openSheetWith("dia")} />
        <SubgroupLabel label={t("group_insulin_bolus")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("row_insulin_type")} subtitle={insulinType === "rapid" ? t("subtitle_insulin_type_rapid") : t("subtitle_insulin_type_regular")} ariaLabel={t("row_open_aria", { label: t("row_insulin_type") })} onClick={() => openSheetWith("insulinType")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("row_insulin_brand_bolus")} subtitle={settings.insulinBrandBolus.trim() || t("subtitle_no_brand")} ariaLabel={t("row_open_aria", { label: t("row_insulin_brand_bolus") })} onClick={() => openSheetWith("insulinBrandBolus")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("row_insulin_brand_bolus_2")} subtitle={settings.insulinBrandBolus2.trim() || t("subtitle_no_brand")} ariaLabel={t("row_open_aria", { label: t("row_insulin_brand_bolus_2") })} onClick={() => openSheetWith("insulinBrandBolus2")} />
        <SubgroupLabel label={t("group_insulin_basal")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("row_insulin_brand_basal")} subtitle={settings.insulinBrandBasal.trim() || t("subtitle_no_brand")} ariaLabel={t("row_open_aria", { label: t("row_insulin_brand_basal") })} onClick={() => openSheetWith("insulinBrandBasal")} />
        {settings.insulinBrandBasal.trim() && (
          <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("row_basal_window")} subtitle={settings.basalActionWindowH !== undefined ? t("subtitle_basal_window_h", { h: settings.basalActionWindowH }) : t("subtitle_basal_window_default")} ariaLabel={t("row_open_aria", { label: t("row_basal_window") })} onClick={() => openSheetWith("basalWindow")} />
        )}
        <SubgroupLabel label={t("group_insulin_history")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>} label={t("row_adjustment_history")} subtitle={adjustmentHistorySub} ariaLabel={t("row_open_aria", { label: t("row_adjustment_history") })} onClick={() => openSheetWith("adjustmentHistory")} />
      </SettingsSection>

      <BottomSheet open={openSheet !== null} onClose={closeSheet} title={active?.title} footer={active?.footer}>
        {active?.body}
      </BottomSheet>
    </div>
  );
}
