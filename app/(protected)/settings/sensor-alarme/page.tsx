"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  fetchLowAlarmSettingsFromDb, saveLowAlarmSettingsToDb, type LowAlarmSettingsDb,
  fetchElevatedAlarmSettingsFromDb, saveElevatedAlarmSettingsToDb, type ElevatedAlarmSettingsDb,
  fetchHighAlarmSettingsFromDb, saveHighAlarmSettingsToDb, type HighAlarmSettingsDb,
} from "@/lib/userSettings";
import {
  fetchCriticalAlertsEnabled,
  saveCriticalAlertsEnabled,
  requestCriticalAlertPermission,
  checkCriticalAlertPermission,
} from "@/lib/criticalAlerts";
import { getLowAlarmSettings, persistLowAlarmSettingsLocally } from "@/lib/lowGlucoseAlarm";
import { persistElevatedAlarmSettingsLocally } from "@/lib/elevatedAlarm";
import { persistHyperAlarmSettingsLocally } from "@/lib/hyperAlarm";
import SnapSlider from "@/components/log/SnapSlider";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", ORANGE = "#F59E0B", PINK = "#FF2D78", RED = "#EF4444", BORDER = "var(--border)";
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

type SheetKey = "lowAlarm" | "elevatedAlarm" | "highAlarm";

export default function SensorAlarmePage() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const touchedRef = useRef(false);

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const [lowEnabled, setLowEnabled] = useState(true);
  const [lowThreshold, setLowThreshold] = useState(70);
  const [draftLow, setDraftLow] = useState<{ enabled: boolean; threshold: number } | null>(null);

  const [elevatedEnabled, setElevatedEnabled] = useState(false);
  const [elevatedThreshold, setElevatedThreshold] = useState(140);
  const [draftElevated, setDraftElevated] = useState<{ enabled: boolean; threshold: number } | null>(null);

  const [highEnabled, setHighEnabled] = useState(false);
  const [highThreshold, setHighThreshold] = useState(200);
  const [draftHigh, setDraftHigh] = useState<{ enabled: boolean; threshold: number } | null>(null);

  const [criticalEnabled, setCriticalEnabled] = useState(false);
  const [criticalSaving, setCriticalSaving] = useState(false);
  const [iosPermissionMissing, setIosPermissionMissing] = useState(false);

  useEffect(() => {
    const local = getLowAlarmSettings();
    setLowEnabled(local.enabled);
    setLowThreshold(local.thresholdMgdl);
    fetchLowAlarmSettingsFromDb().then((s) => {
      if (!touchedRef.current) {
        setLowEnabled(s.enabled);
        setLowThreshold(s.thresholdMgdl);
        persistLowAlarmSettingsLocally(s);
      }
    }).catch(() => {});
    fetchElevatedAlarmSettingsFromDb().then((s) => {
      if (!touchedRef.current) { setElevatedEnabled(s.enabled); setElevatedThreshold(s.thresholdMgdl); }
    }).catch(() => {});
    fetchHighAlarmSettingsFromDb().then((s) => {
      if (!touchedRef.current) { setHighEnabled(s.enabled); setHighThreshold(s.thresholdMgdl); }
    }).catch(() => {});
    fetchCriticalAlertsEnabled().then((v) => {
      if (!touchedRef.current) setCriticalEnabled(v);
    }).catch(() => {});
    checkCriticalAlertPermission().then((granted) => {
      if (!touchedRef.current) setIosPermissionMissing(!granted);
    }).catch(() => {});
  }, []);

  const openSheetWith = useCallback((id: SheetKey) => {
    touchedRef.current = true;
    setSaveError("");
    setDraftLow({ enabled: lowEnabled, threshold: lowThreshold });
    setDraftElevated({ enabled: elevatedEnabled, threshold: elevatedThreshold });
    setDraftHigh({ enabled: highEnabled, threshold: highThreshold });
    setOpenSheet(id);
  }, [lowEnabled, lowThreshold, elevatedEnabled, elevatedThreshold, highEnabled, highThreshold]);

  const closeSheet = useCallback(() => {
    if (draftLow) { setLowEnabled(draftLow.enabled); setLowThreshold(draftLow.threshold); }
    if (draftElevated) { setElevatedEnabled(draftElevated.enabled); setElevatedThreshold(draftElevated.threshold); }
    if (draftHigh) { setHighEnabled(draftHigh.enabled); setHighThreshold(draftHigh.threshold); }
    setDraftLow(null);
    setDraftElevated(null);
    setDraftHigh(null);
    setSaveError("");
    setOpenSheet(null);
  }, [draftLow, draftElevated, draftHigh]);

  function showSuccessToast() {
    setSuccessToast(t("alarm_saved_toast"));
    setTimeout(() => setSuccessToast(null), 2400);
  }

  function showErrorToast(msg: string) {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 4000);
  }

  async function handleCriticalToggle() {
    if (criticalSaving) return;
    const next = !criticalEnabled;
    setCriticalEnabled(next);
    setCriticalSaving(true);
    try {
      if (next) {
        // Request OS permission when enabling — shows iOS dialog if not yet granted.
        await requestCriticalAlertPermission();
        const osGranted = await checkCriticalAlertPermission();
        setIosPermissionMissing(!osGranted);
      } else {
        await saveCriticalAlertsEnabled(false);
        setIosPermissionMissing(false);
      }
    } catch {
      setCriticalEnabled(!next); // rollback
    } finally {
      setCriticalSaving(false);
    }
  }

  async function saveLowAlarm(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      const clamped: LowAlarmSettingsDb = { enabled: lowEnabled, thresholdMgdl: Math.min(90, Math.max(40, Math.round(lowThreshold))) };
      await saveLowAlarmSettingsToDb(clamped);
      persistLowAlarmSettingsLocally(clamped);
      setLowThreshold(clamped.thresholdMgdl);
      setDraftLow(null);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      setTimeout(showSuccessToast, 120);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("save_failed");
      setSaveError(msg);
      showErrorToast(msg);
      return false;
    } finally { setSaving(false); }
  }

  async function saveElevatedAlarm(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      const clamped: ElevatedAlarmSettingsDb = { enabled: elevatedEnabled, thresholdMgdl: Math.min(180, Math.max(100, Math.round(elevatedThreshold))) };
      await saveElevatedAlarmSettingsToDb(clamped);
      persistElevatedAlarmSettingsLocally({ enabled: clamped.enabled, thresholdMgdl: clamped.thresholdMgdl });
      setElevatedThreshold(clamped.thresholdMgdl);
      setDraftElevated(null);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      setTimeout(showSuccessToast, 120);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("save_failed");
      setSaveError(msg);
      showErrorToast(msg);
      return false;
    } finally { setSaving(false); }
  }

  async function saveHighAlarm(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      const clamped: HighAlarmSettingsDb = { enabled: highEnabled, thresholdMgdl: Math.min(250, Math.max(140, Math.round(highThreshold))) };
      await saveHighAlarmSettingsToDb(clamped);
      persistHyperAlarmSettingsLocally({ enabled: clamped.enabled, thresholdMgdl: clamped.thresholdMgdl });
      setHighThreshold(clamped.thresholdMgdl);
      setDraftHigh(null);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      setTimeout(showSuccessToast, 120);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("save_failed");
      setSaveError(msg);
      showErrorToast(msg);
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

  function AlarmSheetBody({
    enabled, onToggle, threshold, onThreshold,
    min, max, ticks, accent, hint, thresholdLabel, enabledLabel,
  }: {
    enabled: boolean; onToggle: () => void;
    threshold: number; onThreshold: (v: number) => void;
    min: number; max: number; ticks: number[];
    accent: string; hint: string; thresholdLabel: string; enabledLabel: string;
  }) {
    return (
      <div>
        <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, margin: "0 0 16px" }}>{hint}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 0" }}>
          <span style={{ fontSize: 14, color: "var(--text-strong)", fontWeight: 500 }}>{enabledLabel}</span>
          <button type="button" role="switch" aria-checked={enabled} onClick={onToggle} style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer", background: enabled ? accent : "var(--surface-raised)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, width: 20, height: 20, borderRadius: "50%", background: "white", left: enabled ? 21 : 3, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
          </button>
        </div>
        {enabled && (
          <>
            <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 8 }}>{thresholdLabel}</p>
            <SnapSlider value={threshold} onChange={onThreshold} min={min} max={max} step={1} unit="mg/dL" accent={accent} ariaLabel={thresholdLabel} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
              {ticks.map((tick) => (
                <span key={tick} style={{ fontSize: 10, color: threshold === tick ? accent : "var(--text-ghost)", fontWeight: threshold === tick ? 700 : 400 }}>{tick}</span>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const thresholdConflict = elevatedThreshold >= highThreshold;

  function ConflictWarning() {
    if (!thresholdConflict) return null;
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span style={{ fontSize: 13, color: ORANGE, lineHeight: 1.45 }}>
          {t("alarm_conflict_warning", { elevated: elevatedThreshold, high: highThreshold })}
        </span>
      </div>
    );
  }

  const sheetContent: Record<SheetKey, { title: string; body: ReactNode; footer: ReactNode }> = {
    lowAlarm: {
      title: t("sheet_low_alarm_title"),
      body: (
        <AlarmSheetBody
          enabled={lowEnabled} onToggle={() => setLowEnabled((v) => !v)}
          threshold={lowThreshold} onThreshold={setLowThreshold}
          min={40} max={90} ticks={[40, 50, 60, 70, 80, 90]}
          accent={ACCENT}
          hint={t("low_alarm_hint")}
          thresholdLabel={t("low_alarm_threshold_label")}
          enabledLabel={t("low_alarm_enabled_label")}
        />
      ),
      footer: <SaveFooter onSave={saveLowAlarm} />,
    },
    elevatedAlarm: {
      title: t("sheet_elevated_alarm_title"),
      body: (
        <>
          <ConflictWarning />
          <AlarmSheetBody
            enabled={elevatedEnabled} onToggle={() => setElevatedEnabled((v) => !v)}
            threshold={elevatedThreshold} onThreshold={setElevatedThreshold}
            min={100} max={180} ticks={[100, 120, 140, 160, 180]}
            accent={ORANGE}
            hint={t("elevated_alarm_hint")}
            thresholdLabel={t("elevated_alarm_threshold_label")}
            enabledLabel={t("elevated_alarm_enabled_label")}
          />
        </>
      ),
      footer: <SaveFooter onSave={saveElevatedAlarm} />,
    },
    highAlarm: {
      title: t("sheet_high_alarm_title"),
      body: (
        <>
          <ConflictWarning />
          <AlarmSheetBody
            enabled={highEnabled} onToggle={() => setHighEnabled((v) => !v)}
            threshold={highThreshold} onThreshold={setHighThreshold}
            min={140} max={250} ticks={[140, 170, 200, 230, 250]}
            accent={RED}
            hint={t("high_alarm_hint")}
            thresholdLabel={t("high_alarm_threshold_label")}
            enabledLabel={t("high_alarm_enabled_label")}
          />
        </>
      ),
      footer: <SaveFooter onSave={saveHighAlarm} />,
    },
  };

  const active = openSheet ? sheetContent[openSheet] : null;

  const lowSub = lowEnabled ? t("subtitle_low_alarm_on", { threshold: lowThreshold }) : t("subtitle_low_alarm_off");
  const elevatedSub = elevatedEnabled ? t("subtitle_elevated_alarm_on", { threshold: elevatedThreshold }) : t("subtitle_elevated_alarm_off");
  const highSub = highEnabled ? t("subtitle_high_alarm_on", { threshold: highThreshold }) : t("subtitle_high_alarm_off");

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          {locale === "en" ? "‹ Settings" : "‹ Einstellungen"}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{locale === "en" ? "Sensor & alarms" : "Sensor & Alarme"}</h1>
      </div>

      {successToast && (
        <div role="status" aria-live="polite" style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(34,211,160,0.12)", border: "1px solid rgba(34,211,160,0.35)", color: "#22D3A0", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#22D3A0" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          {successToast}
        </div>
      )}
      {errorToast && (
        <div role="alert" style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(255,45,120,0.10)", border: "1px solid rgba(255,45,120,0.35)", color: PINK, fontSize: 13 }}>
          {errorToast}
        </div>
      )}

      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><path d="M4 12h3l2-6 4 12 2-6h5" /></svg>}
          label={locale === "en" ? "CGM source" : "CGM-Quelle"}
          subtitle="LibreLinkUp, Nightscout, Dexcom"
          ariaLabel={locale === "en" ? "Open CGM source" : "CGM-Quelle öffnen"}
          onClick={() => router.push("/settings/cgm")}
          first
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></svg>}
          label={t("row_low_alarm")}
          subtitle={lowSub}
          ariaLabel={t("row_open_aria", { label: t("row_low_alarm") })}
          onClick={() => openSheetWith("lowAlarm")}
        />
        <SettingsRow
          iconColor={ORANGE}
          icon={<svg {...iconProps}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
          label={t("row_elevated_alarm")}
          subtitle={elevatedSub}
          ariaLabel={t("row_open_aria", { label: t("row_elevated_alarm") })}
          onClick={() => openSheetWith("elevatedAlarm")}
        />
        <SettingsRow
          iconColor={RED}
          icon={<svg {...iconProps}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>}
          label={t("row_high_alarm")}
          subtitle={highSub}
          ariaLabel={t("row_open_aria", { label: t("row_high_alarm") })}
          onClick={() => openSheetWith("highAlarm")}
        />
      </SettingsSection>

      {/* Critical Alerts toggle — separate section below the three alarm rows */}
      <div style={{ marginTop: 24 }}>
      <SettingsSection>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
                  {locale === "en" ? "Critical Alerts (Hypo + severe Hyper)" : "Critical Alerts (Hypo + schwere Hyper)"}
                </span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, margin: 0 }}>
                {locale === "en"
                  ? "Wakes you even in silent mode or Focus for life-critical hypoglycaemia and severe hyperglycaemia. Only used for Hypo below threshold and severe Hyper."
                  : "Weckt dich auch bei Stummmodus oder Fokus bei lebenskritischer Hypoglykämie und schwerer Hyperglykämie. Ausschließlich für Hypo unter Schwelle und schwere Hyper."}
              </p>
              {criticalEnabled && iosPermissionMissing && (
                <p style={{ fontSize: 11, color: ORANGE, lineHeight: 1.4, margin: "6px 0 0", display: "flex", alignItems: "flex-start", gap: 4 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  {locale === "en"
                    ? "Critical Alerts not allowed in iOS Settings → Notifications → Glev. Please enable there."
                    : "Critical Alerts in iOS-Einstellungen → Mitteilungen → Glev nicht erlaubt. Bitte dort aktivieren."}
                </p>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={criticalEnabled}
              disabled={criticalSaving}
              onClick={handleCriticalToggle}
              style={{
                width: 44, height: 26, borderRadius: 13, border: "none",
                cursor: criticalSaving ? "wait" : "pointer",
                background: criticalEnabled ? "#FF3B30" : "var(--surface-raised)",
                position: "relative", transition: "background 0.2s", flexShrink: 0,
                opacity: criticalSaving ? 0.6 : 1,
              }}
            >
              <span style={{
                position: "absolute", top: 3, width: 20, height: 20, borderRadius: "50%",
                background: "white", left: criticalEnabled ? 21 : 3,
                transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </button>
          </div>
        </div>
      </SettingsSection>
      </div>

      <BottomSheet open={openSheet !== null} onClose={closeSheet} title={active?.title} footer={active?.footer}>
        {active?.body}
      </BottomSheet>
    </div>
  );
}
