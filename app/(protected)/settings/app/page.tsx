"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  fetchNotificationPrefs, saveNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs,
} from "@/lib/notificationPrefs";
import { fetchCycleLoggingEnabled, saveCycleLoggingEnabled } from "@/lib/cyclePrefs";
import { fetchHapticsEnabled, saveHapticsEnabled } from "@/lib/hapticsPrefs";
import { fetchUserProfile, cycleSurfacesAvailable, EMPTY_USER_PROFILE, type UserProfile } from "@/lib/userProfile";
import { setLocale, readLocaleCookie, DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { useTheme } from "@/components/ThemeProvider";
import type { ThemeChoice } from "@/lib/theme";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import type { CarbUnit } from "@/lib/carbUnits";
import { useTimeFormat } from "@/hooks/useTimeFormat";
import { isTimeFormatPref } from "@/lib/timeFormat";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", PINK = "#FF2D78", PURPLE = "#A78BFA", BORDER = "var(--border)";
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

type SheetKey = "notifications" | "cycleLogging" | "language" | "timeFormat" | "carbUnit" | "onboarding" | "appearance";

const PUSH_DEBUG_EMAIL = "lucas@wahnon-connect.com";

function HealthDebugSection() {
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isnative, setIsnative] = useState<string | null>(null);
  const [pluginLoaded, setPluginLoaded] = useState<string | null>(null);
  const [pluginSource, setPluginSource] = useState<string | null>(null);
  const [isPluginAvailable, setIsPluginAvailable] = useState<string | null>(null);
  const [pluginMethods, setPluginMethods] = useState<string | null>(null);
  const [authResult, setAuthResult] = useState<string | null>(null);
  const [lastAttemptAt, setLastAttemptAt] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [isMasterUser, setIsMasterUser] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () => {
    setStep(localStorage.getItem("glev_health_step"));
    setError(localStorage.getItem("glev_health_error"));
    setIsnative(localStorage.getItem("glev_health_isnative"));
    setPluginLoaded(localStorage.getItem("glev_health_plugin_loaded"));
    setPluginSource(localStorage.getItem("glev_health_plugin_source"));
    setIsPluginAvailable(localStorage.getItem("glev_health_is_plugin_available"));
    setPluginMethods(localStorage.getItem("glev_health_plugin_methods"));
    setAuthResult(localStorage.getItem("glev_health_auth_result"));
    setLastAttemptAt(localStorage.getItem("glev_health_last_attempt_at"));
  };
  const stop = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  };
  useEffect(() => {
    refresh();
    const w = window as unknown as { Capacitor?: { getPlatform?: () => string } };
    setPlatform(w.Capacitor?.getPlatform?.() ?? "web");
    import("@/lib/supabase").then(({ supabase }) => {
      supabase?.auth.getUser().then(({ data }) => {
        setIsMasterUser(data.user?.email === PUSH_DEBUG_EMAIL);
      });
    });
    return () => { stop(); };
  }, []);

  const handleRetry = async () => {
    stop();
    setRetrying(true);
    setElapsedSecs(0);
    const { resetHealthDebug, requestAuthorization } = await import(
      "@/lib/cgm/appleHealthClient"
    );
    resetHealthDebug();
    refresh();
    // Fire-and-forget so the UI keeps polling while the native dialog
    // (hopefully) appears. We don't await — the result lands in
    // localStorage via the instrumented requestAuthorization itself.
    void requestAuthorization().then(() => {
      refresh();
      stop();
      setRetrying(false);
    });
    pollRef.current = setInterval(() => {
      refresh();
      const s = localStorage.getItem("glev_health_step");
      // Stop polling once we hit a terminal step (resolved / error / timeout / denied).
      if (s === "request_resolved" || s === "timeout" || s === "caught" ||
          s === "plugin_missing" || s === "not_native" || s === "load_plugin_timeout") {
        stop();
        setRetrying(false);
      }
    }, 500);
    tickRef.current = setInterval(() => setElapsedSecs((n) => n + 1), 1000);
  };

  if (!isMasterUser) return null;
  const terminalOk = step === "request_resolved";
  const terminalErr = step === "timeout" || step === "caught" ||
    step === "plugin_missing" || step === "not_native" ||
    step === "load_plugin_timeout";
  const bg = terminalOk ? "rgba(80,255,120,0.08)"
    : terminalErr ? "rgba(255,80,80,0.08)"
    : "rgba(120,120,120,0.08)";
  const border = terminalOk ? "rgba(80,255,120,0.3)"
    : terminalErr ? "rgba(255,80,80,0.3)"
    : "rgba(120,120,120,0.2)";

  return (
    <div style={{ margin: "16px 0", padding: "12px 16px", borderRadius: 12, background: bg, border: `1px solid ${border}`, fontSize: 12, color: "var(--fg)", wordBreak: "break-all" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Apple-Health-Debug</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div>🖥 Platform: <strong>{platform ?? "?"}</strong> {isnative === "true" ? "(native ✓)" : isnative === "false" ? "(non-native)" : "(?)"}</div>
        <div>🔍 Capacitor.isPluginAvailable(&quot;Health&quot;): <strong>{isPluginAvailable ?? "—"}</strong></div>
        <div>📦 Plugin loaded: <strong>{pluginLoaded ?? "—"}</strong> {pluginSource && <span style={{ color: "var(--text-faint)" }}>via {pluginSource}</span>}</div>
        {pluginMethods && <div>🧩 Methods: <span style={{ color: "var(--text-faint)" }}>{pluginMethods}</span></div>}
        <div>📍 Letzter Schritt: <strong>{step ?? "—"}</strong>{retrying && elapsedSecs > 0 && <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>({elapsedSecs}s)</span>}</div>
        {authResult && <div>🔐 Result: <span style={{ color: "var(--text-faint)" }}>{authResult.slice(0, 120)}{authResult.length > 120 ? "…" : ""}</span></div>}
        {lastAttemptAt && <div>🕒 Letzter Versuch: <span style={{ color: "var(--text-faint)" }}>{lastAttemptAt.replace("T", " ").slice(0, 19)}Z</span></div>}
        {error && <div style={{ color: "var(--red, #f87171)", marginTop: 2 }}>❌ {error}</div>}
      </div>
      {step === "plugin_missing" && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,80,80,0.10)", fontSize: 11, lineHeight: 1.4 }}>
          ⚠️ <strong>@capgo/capacitor-health</strong> wurde nicht ins Web-Bundle bzw. nicht in den Native-Bridge geladen. Prüfe: (1) Package in package.json, (2) HealthPlugin in capacitor.config.json packageClassList, (3) CapgoCapacitorHealth in CapApp-SPM/Package.swift, (4) Archive nach letztem cap sync gebaut.
        </div>
      )}
      {step === "load_plugin_timeout" && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,80,80,0.10)", fontSize: 11, lineHeight: 1.4 }}>
          ⚠️ <strong>Dynamic import von @capgo/capacitor-health hängt &gt;15 s.</strong> Möglich: (a) Vercel-Build hat den Webpack-Chunk nicht ausgespielt (auf Build-Output prüfen), (b) Capgo registerPlugin() wartet auf Capacitor-Bridge-Bootstrap der im WKWebView nie kommt → in iOS-Settings das App-Cache leeren oder App vollständig deinstallieren + reinstallieren, (c) NEXT_PUBLIC_*-env-Var fehlt im Vercel-Build.
        </div>
      )}
      {step === "timeout" && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,180,0,0.10)", border: "1px solid rgba(255,180,0,0.3)", fontSize: 11, lineHeight: 1.5 }}>
          ⏳ <strong>requestAuthorization() hat nach 30 s nicht reagiert.</strong> Native HealthKit-Dialog ist nie erschienen oder die JS-Bridge erreicht den nativen Plugin-Code nicht. Wahrscheinlichste Ursachen: (a) HealthPlugin im Bridge nicht registriert → JS landet im Web-Stub der nie resolved, (b) iOS hat einen verwaisten Modal-State → iPhone neu starten, (c) App vollständig löschen + neu installieren.
        </div>
      )}
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button onClick={() => void handleRetry()} disabled={retrying} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12, cursor: retrying ? "default" : "pointer", opacity: retrying ? 0.6 : 1 }}>
          {retrying ? `Warte… (${elapsedSecs}s)` : "🏥 Health-Permission neu anfragen"}
        </button>
      </div>
    </div>
  );
}

function PushDebugSection() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [perm, setPerm] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [isNative, setIsNative] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [waitingSecs, setWaitingSecs] = useState(0);
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [isMasterUser, setIsMasterUser] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () => {
    setToken(localStorage.getItem("glev_push_token"));
    setError(localStorage.getItem("glev_push_error"));
    setStep(localStorage.getItem("glev_push_step"));
    setPerm(localStorage.getItem("glev_push_perm"));
  };
  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (waitRef.current) { clearInterval(waitRef.current); waitRef.current = null; }
  };
  useEffect(() => {
    refresh();
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
    setIsNative(!!w.Capacitor?.isNativePlatform?.());
    setPlatform(w.Capacitor?.getPlatform?.() ?? "web");
    const onToken = () => { refresh(); stopPolling(); setRetrying(false); setWaitingSecs(0); };
    window.addEventListener("glev:push-token", onToken);
    import("@/lib/supabase").then(({ supabase }) => {
      supabase?.auth.getUser().then(({ data }) => {
        setIsMasterUser(data.user?.email === PUSH_DEBUG_EMAIL);
      });
    });
    return () => { window.removeEventListener("glev:push-token", onToken); stopPolling(); };
  }, []);
  const handleRetry = async () => {
    stopPolling(); setRetrying(true); setWaitingSecs(0);
    localStorage.removeItem("glev_push_error"); localStorage.removeItem("glev_push_token");
    localStorage.removeItem("glev_push_step"); localStorage.removeItem("glev_push_perm");
    refresh();
    const { resetPushInit, initPushNotifications } = await import("@/lib/pushNotifications");
    resetPushInit(); await initPushNotifications();
    let elapsed = 0;
    pollRef.current = setInterval(() => {
      refresh(); elapsed += 500;
      const tok = localStorage.getItem("glev_push_token");
      const err = localStorage.getItem("glev_push_error");
      if (tok || err || elapsed >= 15000) { stopPolling(); setRetrying(false); setWaitingSecs(0); }
    }, 500);
    waitRef.current = setInterval(() => setWaitingSecs(s => s + 1), 1000);
  };
  const stuckAtRegister = retrying && waitingSecs >= 4 && !localStorage.getItem("glev_push_token") && !localStorage.getItem("glev_push_error");

  const handleTest = async () => {
    if (testPending) return;
    setTestPending(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/push/self-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sandbox }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; platform?: string };
      if (json.ok) {
        setTestResult({ ok: true, msg: `✅ Gesendet (${json.platform ?? "?"})` });
      } else {
        setTestResult({ ok: false, msg: `❌ ${json.error ?? "Unbekannter Fehler"}` });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: `❌ ${String(e)}` });
    } finally {
      setTestPending(false);
    }
  };

  if (!isMasterUser) return null;
  const bg = token ? "rgba(80,255,120,0.08)" : error ? "rgba(255,80,80,0.08)" : "rgba(120,120,120,0.08)";
  const border = token ? "rgba(80,255,120,0.3)" : error ? "rgba(255,80,80,0.3)" : "rgba(120,120,120,0.2)";
  return (
    <div style={{ margin: "16px 0", padding: "12px 16px", borderRadius: 12, background: bg, border: `1px solid ${border}`, fontSize: 12, color: "var(--fg)", wordBreak: "break-all" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Push-Debug</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div>🖥 Platform: <strong>{platform ?? "?"}</strong> {isNative ? "(native ✓)" : "(web — push no-op)"}</div>
        <div>🔑 Permission: <strong>{perm ?? "—"}</strong></div>
        <div>📍 Letzter Schritt: <strong>{step ?? "—"}</strong>{retrying && waitingSecs > 0 && <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>({waitingSecs}s)</span>}</div>
        {token ? <div>✅ Token: {token.slice(0, 20)}…</div> : <div>⏳ Kein Token</div>}
        {error && <div style={{ color: "var(--red, #f87171)", marginTop: 2 }}>❌ {error}</div>}
      </div>
      {perm === "denied" && <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(255,80,80,0.12)", fontSize: 11, lineHeight: 1.4 }}>⚠️ Benachrichtigungen in iOS-Einstellungen abgelehnt.<br />Geh zu <strong>Einstellungen → Glev → Mitteilungen</strong> und schalte sie manuell ein.</div>}
      {stuckAtRegister && <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,180,0,0.10)", border: "1px solid rgba(255,180,0,0.3)", fontSize: 11, lineHeight: 1.5 }}>⏳ <strong>register() wurde aufgerufen — warte auf APNs-Antwort…</strong><br />Wenn das nach 15 s hängen bleibt, prüfe in Xcode:<br /><strong>Target → Signing &amp; Capabilities → Push Notifications</strong> muss als Capability eingetragen sein.</div>}
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => void handleRetry()} disabled={retrying} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12, cursor: retrying ? "default" : "pointer", opacity: retrying ? 0.6 : 1 }}>
          {retrying ? `Warte auf APNs… (${waitingSecs}s)` : "Push-Registrierung neu starten"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-faint)", cursor: "pointer" }}>
          <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
          Sandbox
        </label>
        <button onClick={() => void handleTest()} disabled={testPending || !token} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: token ? "rgba(80,180,255,0.18)" : "rgba(120,120,120,0.12)", color: token ? "#60b4ff" : "var(--text-faint)", fontSize: 12, cursor: testPending || !token ? "default" : "pointer", opacity: testPending ? 0.6 : 1 }}>
          {testPending ? "Sende…" : "🔔 Test-Push"}
        </button>
      </div>
      {testResult && (
        <div style={{ marginTop: 6, fontSize: 11, color: testResult.ok ? "rgba(80,255,120,0.9)" : "var(--red, #f87171)" }}>
          {testResult.msg}
        </div>
      )}
    </div>
  );
}

export default function AppSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const uiLocale = useLocale();
  const { choice: themeChoice, setChoice: setThemeChoice } = useTheme();
  const carbUnit = useCarbUnit();
  const timeFormat = useTimeFormat();

  const notifTouchedRef = useRef(false);

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [cycleLoggingEnabled, setCycleLoggingEnabled] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile>(EMPTY_USER_PROFILE);
  const [currentLocale, setCurrentLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftNotif, setDraftNotif] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    const fromCookie = readLocaleCookie();
    if (fromCookie) setCurrentLocale(fromCookie);
    fetchNotificationPrefs().then((p) => { if (!notifTouchedRef.current) setNotifPrefs(p); }).catch(() => {}).finally(() => { notifTouchedRef.current = false; });
    fetchCycleLoggingEnabled().then(setCycleLoggingEnabled).catch(() => {});
    fetchHapticsEnabled().then(setHapticsEnabled).catch(() => {});
    fetchUserProfile().then(setUserProfile).catch(() => {});
  }, []);

  const openSheetWith = useCallback((id: SheetKey) => {
    notifTouchedRef.current = true;
    setSaveError("");
    setDraftNotif({ ...notifPrefs });
    setPendingLocale(null);
    setOpenSheet(id);
  }, [notifPrefs]);

  const closeSheet = useCallback(() => {
    if (draftNotif) setNotifPrefs(draftNotif);
    setDraftNotif(null);
    setPendingLocale(null);
    setSaveError("");
    setOpenSheet(null);
  }, [draftNotif]);

  function updNotif<K extends keyof NotificationPrefs>(key: K, val: NotificationPrefs[K]) {
    notifTouchedRef.current = true;
    setNotifPrefs((prev) => ({ ...prev, [key]: val }));
  }
  const toggleHapticsEnabled = useCallback(async (next: boolean) => {
    const prev = hapticsEnabled;
    setHapticsEnabled(next);
    try { await saveHapticsEnabled(next); } catch { setHapticsEnabled(prev); }
  }, [hapticsEnabled]);

  const toggleCycleLogging = useCallback(async (next: boolean) => {
    const prev = cycleLoggingEnabled;
    setCycleLoggingEnabled(next);
    try { await saveCycleLoggingEnabled(next); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    catch { setCycleLoggingEnabled(prev); }
  }, [cycleLoggingEnabled]);

  async function saveNotifPrefsAction(): Promise<boolean> {
    setSaving(true); setSaveError("");
    try {
      await saveNotificationPrefs(notifPrefs);
      setDraftNotif(null);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (e) { setSaveError(e instanceof Error ? e.message : t("save_failed")); return false; }
    finally { setSaving(false); }
  }

  function SaveFooter({ onSave }: { onSave: () => Promise<boolean> }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {saveError && <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4, textAlign: "center" }}>{saveError}</div>}
        <button type="button" onClick={async () => { const ok = await onSave(); if (ok) setOpenSheet(null); }} disabled={saving} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", cursor: saving ? "wait" : "pointer", background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color: "var(--on-accent)", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving ? t("save_button_busy") : saved ? t("save_button_done") : tCommon("save")}
        </button>
      </div>
    );
  }

  const closeFooter = (
    <button type="button" onClick={closeSheet} style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {t("sheet_close")}
    </button>
  );

  const cycleRowVisible = cycleSurfacesAvailable(userProfile.sex);
  const notifSub = notifPrefs.criticalAlerts ? t("subtitle_notif_on", { from: notifPrefs.quietStart, to: notifPrefs.quietEnd }) : t("subtitle_notif_off");
  const cycleLoggingSub = cycleLoggingEnabled ? t("subtitle_cycle_logging_on") : t("subtitle_cycle_logging_off");
  const localeSub = currentLocale === "de" ? t("subtitle_language_de") : t("subtitle_language_en");
  const timeFormatSub = timeFormat.pref === "24h" ? t("subtitle_time_format_24h") : timeFormat.pref === "12h" ? t("subtitle_time_format_12h") : t("subtitle_time_format_auto");
  const themeSub = useMemo(() => themeChoice === "dark" ? t("theme_dark") : themeChoice === "light" ? t("theme_light") : t("theme_system"), [themeChoice, t]);

  const sheetContent: Record<SheetKey, { title: string; body: ReactNode; footer: ReactNode }> = {
    notifications: {
      title: t("notifications"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10, gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t("notif_critical_label")}</div>
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 2 }}>{t("notif_critical_desc")}</div>
            </div>
            <div role="switch" aria-checked={notifPrefs.criticalAlerts} onClick={() => updNotif("criticalAlerts", !notifPrefs.criticalAlerts)} style={{ width: 44, height: 24, borderRadius: 99, cursor: "pointer", flexShrink: 0, background: notifPrefs.criticalAlerts ? ACCENT : "var(--border-strong)", border: `1px solid ${notifPrefs.criticalAlerts ? ACCENT + "60" : BORDER}`, position: "relative", transition: "background 0.2s" }}>
              <div style={{ position: "absolute", top: 2, left: notifPrefs.criticalAlerts ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10, gap: 12, opacity: 0.55 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t("notif_smart_label")}</div>
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 2 }}>{t("notif_smart_soon")}</div>
            </div>
            <div role="switch" aria-checked={notifPrefs.smartReminders} aria-disabled style={{ width: 44, height: 24, borderRadius: 99, cursor: "not-allowed", flexShrink: 0, background: "var(--border-strong)", border: `1px solid ${BORDER}`, position: "relative" }}>
              <div style={{ position: "absolute", top: 2, left: notifPrefs.smartReminders ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
            </div>
          </div>
          <div style={{ padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{t("notif_quiet_label")}</div>
            <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 10 }}>{t("notif_quiet_desc")}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text-body)" }}>{t("notif_quiet_from")}</span>
              <input type="time" value={notifPrefs.quietStart} onChange={(e) => updNotif("quietStart", e.target.value)} style={{ background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "6px 10px", color: "var(--text)", fontSize: 14, outline: "none", width: "auto" }} />
              <span style={{ fontSize: 13, color: "var(--text-body)" }}>{t("notif_quiet_to")}</span>
              <input type="time" value={notifPrefs.quietEnd} onChange={(e) => updNotif("quietEnd", e.target.value)} style={{ background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "6px 10px", color: "var(--text)", fontSize: 14, outline: "none", width: "auto" }} />
            </div>
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveNotifPrefsAction} />,
    },
    cycleLogging: {
      title: t("cycle_logging_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10, gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t("cycle_logging_label")}</div>
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 2 }}>{t("cycle_logging_desc")}</div>
            </div>
            <div role="switch" aria-checked={cycleLoggingEnabled} aria-label={t("cycle_logging_label")} onClick={() => { void toggleCycleLogging(!cycleLoggingEnabled); }} style={{ width: 44, height: 24, borderRadius: 99, cursor: "pointer", flexShrink: 0, background: cycleLoggingEnabled ? PINK : "var(--border-strong)", border: `1px solid ${cycleLoggingEnabled ? PINK + "60" : BORDER}`, position: "relative", transition: "background 0.2s" }}>
              <div style={{ position: "absolute", top: 2, left: cycleLoggingEnabled ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
            </div>
          </div>
          {saveError && <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4 }}>{saveError}</div>}
        </div>
      ),
      footer: closeFooter,
    },
    language: {
      title: t("language_card_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <select value={pendingLocale ?? currentLocale} onChange={(e) => { const next = e.target.value as Locale; setPendingLocale(next === currentLocale ? null : next); }} style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 500, cursor: "pointer", appearance: "none", WebkitAppearance: "none", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%23888' d='M2 4l4 4 4-4z'/></svg>\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center", paddingRight: 36 }}>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="en">🇬🇧 English</option>
            </select>
            <button type="button" disabled={!pendingLocale} onClick={() => { if (!pendingLocale) return; const target = pendingLocale; setCurrentLocale(target); void setLocale(target); }} style={{ padding: "12px 22px", borderRadius: 10, border: `1px solid ${pendingLocale ? ACCENT : BORDER}`, background: pendingLocale ? ACCENT : "transparent", color: pendingLocale ? "var(--on-accent)" : "var(--text-faint)", fontSize: 14, fontWeight: 600, cursor: pendingLocale ? "pointer" : "not-allowed", whiteSpace: "nowrap", transition: "background 120ms ease, color 120ms ease, border-color 120ms ease" }}>
              {tCommon("save")}
            </button>
          </div>
          {pendingLocale && <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("language_confirm_body")}</div>}
        </div>
      ),
      footer: closeFooter,
    },
    timeFormat: {
      title: t("time_format_card_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <select value={timeFormat.pref} onChange={(e) => { const next = e.target.value; if (isTimeFormatPref(next)) timeFormat.setPref(next); }} style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 500, cursor: "pointer", appearance: "none", WebkitAppearance: "none", backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%23888' d='M2 4l4 4 4-4z'/></svg>\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center", paddingRight: 36 }}>
            <option value="auto">{t("time_format_opt_auto")}</option>
            <option value="24h">{t("time_format_opt_24h")}</option>
            <option value="12h">{t("time_format_opt_12h")}</option>
          </select>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("time_format_hint")}</div>
        </div>
      ),
      footer: closeFooter,
    },
    carbUnit: {
      title: t("carb_unit_title"),
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
        </div>
      ),
      footer: closeFooter,
    },
    onboarding: {
      title: t("onboarding_replay_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55 }}>{t("onboarding_replay_desc")}</div>
          <button onClick={async () => {
            if (!window.confirm(t("onboarding_replay_confirm"))) return;
            try {
              const res = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              window.location.href = "/onboarding";
            } catch { window.alert(t("onboarding_replay_error")); }
          }} style={{ alignSelf: "flex-start", padding: "12px 22px", borderRadius: 12, border: "none", background: ACCENT, color: "var(--on-accent)", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer", boxShadow: `0 4px 14px ${ACCENT}55` }}>
            {t("onboarding_replay_btn")}
          </button>
        </div>
      ),
      footer: closeFooter,
    },
    appearance: {
      title: t("appearance"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("appearance_hint")}</div>
          <div style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.5 }}>{t("appearance_app_only_hint")}</div>
          <div role="radiogroup" aria-label={t("appearance")} style={{ display: "flex", gap: 2, padding: 4, borderRadius: 99, background: "var(--surface-soft)", border: `1px solid ${BORDER}` }}>
            {([{ v: "dark" as ThemeChoice, label: t("theme_dark") }, { v: "light" as ThemeChoice, label: t("theme_light") }, { v: "system" as ThemeChoice, label: t("theme_system") }]).map((opt) => {
              const active = themeChoice === opt.v;
              return (
                <button key={opt.v} role="radio" aria-checked={active} onClick={() => setThemeChoice(opt.v)} style={{ flex: 1, padding: "9px 12px", borderRadius: 99, border: "none", cursor: "pointer", background: active ? ACCENT : "transparent", color: active ? "var(--on-accent)" : "var(--text-body)", fontSize: 14, fontWeight: active ? 600 : 500, transition: "background 120ms ease, color 120ms ease" }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
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
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{t("section_app")}</h1>
      </div>

      <SettingsSection>
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>} label={t("notifications")} subtitle={notifSub} ariaLabel={t("row_open_aria", { label: t("notifications") })} onClick={() => openSheetWith("notifications")} />
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><path d="M5 12h2a5 5 0 0 1 10 0h2" /><path d="M5 12a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /></svg>}
          label={t("row_haptics_label")}
          subtitle={hapticsEnabled ? t("row_haptics_subtitle_on") : t("row_haptics_subtitle_off")}
          ariaLabel={t("row_haptics_label")}
          onClick={() => void toggleHapticsEnabled(!hapticsEnabled)}
          rightAdornment={
            <div role="switch" aria-checked={hapticsEnabled} style={{ width: 44, height: 26, borderRadius: 13, background: hapticsEnabled ? ACCENT : "var(--border)", position: "relative", transition: "background 0.2s ease", flexShrink: 0, cursor: "pointer" }}>
              <div style={{ position: "absolute", top: 3, left: hapticsEnabled ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "white", transition: "left 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </div>
          }
        />
        {cycleRowVisible && (
          <SettingsRow iconColor={PINK} icon={<svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18" /></svg>} label={t("cycle_logging_title")} subtitle={cycleLoggingSub} ariaLabel={t("row_open_aria", { label: t("cycle_logging_title") })} onClick={() => openSheetWith("cycleLogging")} />
        )}
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>} label={t("row_language")} subtitle={localeSub} ariaLabel={t("row_open_aria", { label: t("row_language") })} onClick={() => openSheetWith("language")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>} label={t("row_time_format")} subtitle={timeFormatSub} ariaLabel={t("row_open_aria", { label: t("row_time_format") })} onClick={() => openSheetWith("timeFormat")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><path d="M12 2v6" /><path d="M9 5l3 3 3-3" /><path d="M5 12c0-3 3-5 7-5s7 2 7 5c0 5-3 9-7 9s-7-4-7-9z" /></svg>} label={t("row_carb_unit")} subtitle={carbUnit.label} ariaLabel={t("row_open_aria", { label: t("row_carb_unit") })} onClick={() => openSheetWith("carbUnit")} />
        <SettingsRow iconColor={ACCENT} icon={<svg {...iconProps}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>} label={t("onboarding_replay_title")} subtitle={t("onboarding_replay_desc")} ariaLabel={t("row_open_aria", { label: t("onboarding_replay_title") })} onClick={() => openSheetWith("onboarding")} />
        <SettingsRow iconColor={PURPLE} icon={<svg {...iconProps}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>} label={t("appearance")} subtitle={themeSub} ariaLabel={t("row_open_aria", { label: t("appearance") })} onClick={() => openSheetWith("appearance")} />
      </SettingsSection>

      <PushDebugSection />

      <HealthDebugSection />

      <BottomSheet open={openSheet !== null} onClose={closeSheet} title={active?.title} footer={active?.footer}>
        {active?.body}
      </BottomSheet>
    </div>
  );
}
