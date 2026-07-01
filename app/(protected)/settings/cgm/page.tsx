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

type ToastState = { msg: string; kind: "success" | "error" };
type DexcomCardProps = { onConnected: () => void; onDisconnected: () => void; onError: (msg: string) => void; onTestSuccess: (msg: string) => void; isConnected: boolean };

function DexcomDirectCard({ onConnected, onDisconnected, onError, onTestSuccess, isConnected }: DexcomCardProps) {
  const t = useTranslations("cgm");
  const [region, setRegion] = useState<"eu" | "us">("eu");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${BORDER}`,
    background: "var(--surface-soft)",
    color: "var(--text-strong)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  async function handleTest() {
    setTestStatus("testing");
    setTestMsg("");
    try {
      const res = await fetch("/api/cgm/dexcom/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, region }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestStatus("ok");
        setTestMsg(t("dexcom.test_success"));
      } else {
        setTestStatus("error");
        const code = data?.error as string | undefined;
        if (code === "test_invalid_credentials") {
          setTestMsg(t("dexcom.test_invalid_credentials"));
        } else if (code === "test_invalid_region") {
          setTestMsg(t("dexcom.test_invalid_region"));
        } else {
          setTestMsg(code ?? t("dexcom.test_invalid_credentials"));
        }
      }
    } catch {
      setTestStatus("error");
      setTestMsg(t("dexcom.test_invalid_credentials"));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/cgm/dexcom/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, region }),
      });
      if (res.ok) {
        onConnected();
      } else {
        const data = await res.json();
        const errMsg = data?.error ?? "Unbekannter Fehler";
        setTestStatus("error");
        setTestMsg(errMsg);
        onError(`Verbindung fehlgeschlagen: ${errMsg}`);
      }
    } catch {
      setTestStatus("error");
      setTestMsg("Netzwerkfehler");
      onError("Verbindung fehlgeschlagen: Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestStored() {
    setTestStatus("testing");
    setTestMsg("");
    try {
      const res = await fetch("/api/cgm/dexcom/test");
      const data = await res.json();
      if (res.ok) {
        setTestStatus("ok");
        const glucoseMsg = data?.current?.value != null
          ? `${t("dexcom.test_active")} — ${data.current.value} mg/dL`
          : t("dexcom.test_active");
        onTestSuccess(glucoseMsg);
      } else {
        setTestStatus("error");
        const code = data?.error as string | undefined;
        if (code === "no_credentials") {
          onError(t("dexcom.no_credentials"));
        } else if (code === "test_invalid_credentials") {
          onError(t("dexcom.test_invalid_credentials"));
        } else if (code === "test_invalid_region") {
          onError(t("dexcom.test_invalid_region"));
        } else {
          onError(code ?? t("dexcom.test_invalid_credentials"));
        }
      }
    } catch {
      setTestStatus("error");
      onError(t("dexcom.test_invalid_credentials"));
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/cgm/dexcom/credentials", { method: "DELETE" });
      onDisconnected();
    } catch {
      // ignore
    } finally {
      setDisconnecting(false);
    }
  }

  if (isConnected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--surface-soft)", border: `1px solid ${BORDER}` }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-body)" }}>
            ✓ {t("dexcom.test_success")}
          </p>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0 }}>
          {t("dexcom.disclaimer_inofficial_api")}
        </p>
        <button
          type="button"
          onClick={handleTestStored}
          disabled={testStatus === "testing"}
          style={{
            padding: "11px 16px",
            borderRadius: 10,
            border: `1px solid ${ACCENT}`,
            background: "transparent",
            color: ACCENT,
            fontSize: 14,
            fontWeight: 600,
            cursor: testStatus === "testing" ? "not-allowed" : "pointer",
          }}
        >
          {testStatus === "testing" ? "…" : t("dexcom.test_btn")}
        </button>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          style={{ padding: "11px 16px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-body)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          {disconnecting ? "…" : t("dexcom.disconnect_btn")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Region picker */}
      <div>
        <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>
          {t("dexcom.region_label")}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {(["eu", "us"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              style={{
                flex: 1,
                padding: "9px 12px",
                borderRadius: 10,
                border: `1.5px solid ${region === r ? ACCENT : BORDER}`,
                background: region === r ? `${ACCENT}18` : "var(--surface-soft)",
                color: region === r ? ACCENT : "var(--text-body)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {r === "eu" ? t("dexcom.region_eu") : t("dexcom.region_us")}
            </button>
          ))}
        </div>
      </div>

      {/* Username */}
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>
          {t("dexcom.username_label")}
        </label>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setTestStatus("idle"); }}
          style={inputStyle}
        />
      </div>

      {/* Password */}
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>
          {t("dexcom.password_label")}
        </label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setTestStatus("idle"); }}
          style={inputStyle}
        />
      </div>

      {/* Test result */}
      {testStatus !== "idle" && (
        <p style={{ margin: 0, fontSize: 13, color: testStatus === "ok" ? "#22c55e" : "#ef4444" }}>
          {testStatus === "testing" ? "…" : testMsg}
        </p>
      )}

      {/* Test button */}
      <button
        type="button"
        onClick={handleTest}
        disabled={!username || !password || testStatus === "testing"}
        style={{
          padding: "11px 16px",
          borderRadius: 10,
          border: `1px solid ${ACCENT}`,
          background: "transparent",
          color: ACCENT,
          fontSize: 14,
          fontWeight: 600,
          cursor: !username || !password || testStatus === "testing" ? "not-allowed" : "pointer",
          opacity: !username || !password ? 0.5 : 1,
        }}
      >
        {testStatus === "testing" ? "…" : t("dexcom.test_btn")}
      </button>

      {/* Save button — only enabled after successful test */}
      {testStatus === "ok" && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "11px 16px",
            borderRadius: 10,
            border: "none",
            background: ACCENT,
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {saving ? "…" : t("dexcom.save_btn")}
        </button>
      )}

      {/* Info */}
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, margin: 0 }}>
        {t("dexcom.info_eu_servers")}
      </p>
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, margin: 0 }}>
        {t("dexcom.disclaimer_inofficial_api")}
      </p>
    </div>
  );
}

type CgmSourceStatus = {
  lluConnected: boolean;
  nightscoutConnected: boolean;
  dexcomConnected: boolean;
  appleHealthConnected: boolean;
};

function useCgmSourceStatus(): CgmSourceStatus {
  const [status, setStatus] = useState<CgmSourceStatus>({
    lluConnected: false,
    nightscoutConnected: false,
    dexcomConnected: false,
    appleHealthConnected: false,
  });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cgm/source", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setStatus({
          lluConnected: Boolean(data?.llu_connected),
          nightscoutConnected: Boolean(data?.nightscout_connected),
          dexcomConnected: Boolean(data?.dexcom_connected),
          appleHealthConnected: Boolean(data?.apple_health_connected),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return status;
}

function useAppleHealthActivityConnected(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/activity-sync", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setEnabled(data?.enabled === true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return enabled;
}

type SheetKey = "libre2" | "nightscout" | "dexcom" | "apple_health" | "setup_request";

export default function CgmSettingsPage() {
  const t = useTranslations("settings");
  const tReq = useTranslations("cgmSetupRequest");
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const { lluConnected: cgmConnected, nightscoutConnected, appleHealthConnected, dexcomConnected: dexcomInit } = useCgmSourceStatus();
  const appleHealthActivityConnected = useAppleHealthActivityConnected();
  const [dexcomConnected, setDexcomConnected] = useState(false);
  useEffect(() => { setDexcomConnected(dexcomInit); }, [dexcomInit]);
  const [dexcomToast, setDexcomToast] = useState<ToastState | null>(null);
  const showDexcomToast = useCallback((msg: string, kind: "success" | "error") => {
    setDexcomToast({ msg, kind });
    setTimeout(() => setDexcomToast(null), 3500);
  }, []);
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
    libre2:        { title: t("row_libre2"),         body: <CgmSettingsCard /> },
    nightscout:    { title: t("row_nightscout"),     body: <NightscoutSettingsCard /> },
    dexcom:        {
      title: t("sheet_dexcom_title"),
      body: (
        <DexcomDirectCard
          isConnected={dexcomConnected}
          onConnected={() => { setDexcomConnected(true); closeSheet(); showDexcomToast("Dexcom erfolgreich verbunden", "success"); }}
          onDisconnected={() => { setDexcomConnected(false); closeSheet(); }}
          onError={(msg) => showDexcomToast(msg, "error")}
          onTestSuccess={(msg) => showDexcomToast(msg, "success")}
        />
      ),
    },
    apple_health:  { title: t("row_apple_health"),   body: <AppleHealthSettingsCard /> },
    setup_request: { title: tReq("intro_title"),     body: <CgmSetupRequestForm onSuccess={closeSheet} /> },
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
          rightAdornment={
            appleHealthConnected && appleHealthActivityConnected
              ? <ConnectedDot label={t("status_ah_glucose_activity")} />
              : appleHealthConnected
              ? <ConnectedDot label={t("status_connected")} />
              : appleHealthActivityConnected
              ? <ConnectedDot label={t("status_ah_activity_only")} />
              : undefined
          }
          ariaLabel={t("row_open_aria", { label: t("row_apple_health") })}
          onClick={() => setOpenSheet("apple_health")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /></svg>}
          label={t("row_cgm_dexcom")}
          rightAdornment={dexcomConnected ? <ConnectedDot label={t("status_connected")} /> : undefined}
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

      {dexcomToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            padding: "10px 18px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            maxWidth: "calc(100vw - 32px)",
            textAlign: "center",
            whiteSpace: "nowrap",
            background: dexcomToast.kind === "success" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${dexcomToast.kind === "success" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
            color: dexcomToast.kind === "success" ? "rgb(34,197,94)" : "rgb(239,68,68)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          }}
        >
          {dexcomToast.msg}
        </div>
      )}
    </div>
  );
}
