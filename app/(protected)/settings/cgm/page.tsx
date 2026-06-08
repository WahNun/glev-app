"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import CgmSettingsCard from "@/components/CgmSettingsCard";
import NightscoutSettingsCard from "@/components/NightscoutSettingsCard";
import AppleHealthSettingsCard from "@/components/AppleHealthSettingsCard";
import CgmSetupRequestForm from "@/components/CgmSetupRequestForm";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow, ConnectedDot } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", BORDER = "var(--border)";
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const DEXCOM_KB_URL = "https://nightscout.pro/knowledge-base/dexcom";

function DexcomSheetBody() {
  const t = useTranslations("settings_cgm");
  const openKb = () => {
    try { window.open(DEXCOM_KB_URL, "_blank", "noopener,noreferrer"); } catch {}
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 14, color: "var(--text-body)", lineHeight: 1.6, margin: 0 }}>
        {t("sheet_dexcom_body")}
      </p>

      {/* Nightscout KB callout */}
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--surface-soft)",
        padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>
            nightscout.pro
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.55, margin: 0 }}>
          {t("sheet_dexcom_kb_intro")}
        </p>
        <button
          type="button"
          onClick={openKb}
          style={{
            alignSelf: "flex-start",
            padding: "8px 14px",
            borderRadius: 8,
            border: `1px solid ${ACCENT}`,
            background: "transparent",
            color: ACCENT,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.01em",
          }}
        >
          {t("sheet_dexcom_kb_label")}
        </button>
      </div>

      {/* Compliance disclaimer */}
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, margin: 0 }}>
        {t("sheet_dexcom_disclaimer")}
      </p>
    </div>
  );
}

function useCgmConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cgm/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setConnected(Boolean(data?.connected)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return connected;
}

function useNightscoutConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cgm/nightscout/sync", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setConnected(Boolean(data?.connected)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return connected;
}

function useAppleHealthConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cgm/source", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setConnected(data?.source === "apple_health"); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return connected;
}

type SheetKey = "libre2" | "nightscout" | "dexcom" | "apple_health" | "setup_request";

export default function CgmSettingsPage() {
  const t = useTranslations("settings");
  const tReq = useTranslations("cgmSetupRequest");
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const cgmConnected = useCgmConnected();
  const nightscoutConnected = useNightscoutConnected();
  const appleHealthConnected = useAppleHealthConnected();
  const [isNativePlatform, setIsNativePlatform] = useState(false);
  const cgmSetupHandledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = (await import("@capacitor/core")) as unknown as {
          Capacitor?: { isNativePlatform?: () => boolean };
        };
        if (!cancelled) setIsNativePlatform(!!mod.Capacitor?.isNativePlatform?.());
      } catch {
        if (!cancelled) setIsNativePlatform(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (cgmSetupHandledRef.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const setup = url.searchParams.get("cgmSetup");
    if (!setup) return;
    cgmSetupHandledRef.current = true;
    const sheet: SheetKey | null =
      setup === "librelinkup"  ? "libre2"        :
      setup === "apple_health" ? "apple_health"  :
      setup === "nightscout"   ? "nightscout"    :
      null;
    url.searchParams.delete("cgmSetup");
    window.history.replaceState({}, "", url.toString());
    if (sheet) setTimeout(() => setOpenSheet(sheet), 0);
  }, []);

  const closeSheet = useCallback(() => setOpenSheet(null), []);

  const closeFooter = (
    <button type="button" onClick={closeSheet} style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {t("sheet_close")}
    </button>
  );

  const sheetMap: Record<SheetKey, { title: string; body: React.ReactNode }> = {
    libre2:        { title: t("row_libre2"),              body: <CgmSettingsCard /> },
    nightscout:    { title: t("row_nightscout"),          body: <NightscoutSettingsCard /> },
    dexcom:        { title: t("sheet_dexcom_title"),      body: <DexcomSheetBody /> },
    apple_health:  { title: t("row_apple_health"),        body: <AppleHealthSettingsCard /> },
    setup_request: { title: tReq("intro_title"),          body: <CgmSetupRequestForm onSuccess={closeSheet} /> },
  };
  const active = openSheet ? sheetMap[openSheet] : null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ {t("page_title")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>CGM</h1>
      </div>

      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><path d="M4 12h3l2-6 4 12 2-6h5" /></svg>}
          label={t("row_libre2")}
          rightAdornment={cgmConnected ? <ConnectedDot label={t("status_connected")} /> : undefined}
          ariaLabel={t("row_open_aria", { label: t("row_libre2") })}
          onClick={() => setOpenSheet("libre2")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>}
          label={t("row_nightscout")}
          rightAdornment={nightscoutConnected ? <ConnectedDot label={t("status_connected")} /> : undefined}
          ariaLabel={t("row_open_aria", { label: t("row_nightscout") })}
          onClick={() => setOpenSheet("nightscout")}
        />
        <SettingsRow
          iconColor="#FF2D55"
          icon={
            <svg {...iconProps}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          }
          label={t("row_apple_health")}
          subtitle={isNativePlatform ? undefined : t("subtitle_only_iphone")}
          rightAdornment={appleHealthConnected ? <ConnectedDot label={t("status_connected")} /> : undefined}
          ariaLabel={t("row_open_aria", { label: t("row_apple_health") })}
          onClick={() => setOpenSheet("apple_health")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /></svg>}
          label={t("row_cgm_dexcom")}
          subtitle={t("subtitle_coming_soon")}
          ariaLabel={t("row_open_aria", { label: t("row_cgm_dexcom") })}
          onClick={() => setOpenSheet("dexcom")}
        />
      </SettingsSection>

      {/* Setup support request — for sensors not directly supported */}
      <div style={{ marginTop: 28 }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", margin: "0 0 10px 2px" }}>
          {t("group_cgm")} — Hilfe
        </p>
        <SettingsSection>
          <SettingsRow
            iconColor="#8B5CF6"
            icon={
              <svg {...iconProps}>
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            }
            label={t("row_setup_request_label") ?? "Sensor nicht dabei? Setup-Hilfe anfragen"}
            subtitle={t("row_setup_request_sub") ?? "Pilot-Liste für künftigen Setup-Support"}
            ariaLabel="CGM Setup-Hilfe anfragen"
            onClick={() => setOpenSheet("setup_request")}
          />
        </SettingsSection>
      </div>

      <BottomSheet open={openSheet !== null} onClose={closeSheet} title={active?.title} footer={closeFooter}>
        {active?.body}
      </BottomSheet>
    </div>
  );
}
