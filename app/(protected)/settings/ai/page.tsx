"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { useFeatureFlag } from "@/lib/featureFlags";

const ACCENT = "#4F6EF7";
const BORDER = "var(--border)";

export default function AiSettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();
  const aiVoiceEnabled = useFeatureFlag("ai_voice");

  const [aiConsentGranted, setAiConsentGranted] = useState<boolean | null>(null);
  const [aiConsentBusy, setAiConsentBusy] = useState(false);
  const [aiScopeGlucose, setAiScopeGlucose] = useState<boolean | null>(null);
  const [aiScopeIob, setAiScopeIob] = useState<boolean | null>(null);
  const [aiScopeHistory, setAiScopeHistory] = useState<boolean | null>(null);
  const [aiScopeBusy, setAiScopeBusy] = useState<"glucose" | "iob" | "history" | "revoke" | null>(null);

  const [fabMode, setFabMode] = useState<"ai" | "voice">("ai");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("glev_fab_mode");
      if (stored === "voice" || stored === "ai") setFabMode(stored);
    } catch { /* ignore */ }
  }, []);
  const setFabModeAndPersist = useCallback((next: "ai" | "voice") => {
    setFabMode(next);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem("glev_fab_mode", next); } catch { /* ignore */ }
    }
  }, []);

  const [ttsAutoRead, setTtsAutoRead] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem("glev_tts_auto");
      setTtsAutoRead(v !== null && v !== "0");
    } catch { /* ignore */ }
  }, []);
  const toggleTtsAutoRead = useCallback(() => {
    setTtsAutoRead((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("glev_tts_auto", next ? "1" : "0"); } catch { /* ignore */ }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("glev:tts-auto-changed", { detail: next }));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!supabase) { setAiConsentGranted(false); return; }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setAiConsentGranted(false); return; }
        const { data } = await supabase
          .from("profiles")
          .select("ai_consent_at, ai_consent_glucose_at, ai_consent_iob_at, ai_consent_history_at")
          .eq("user_id", user.id)
          .maybeSingle();
        setAiConsentGranted(Boolean(data?.ai_consent_at));
        setAiScopeGlucose(Boolean(data?.ai_consent_glucose_at));
        setAiScopeIob(Boolean(data?.ai_consent_iob_at));
        setAiScopeHistory(Boolean(data?.ai_consent_history_at));
      } catch {
        setAiConsentGranted(false);
        setAiScopeGlucose(false);
        setAiScopeIob(false);
        setAiScopeHistory(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = async () => {
      try {
        if (!supabase) return;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("profiles")
          .select("ai_consent_at, ai_consent_glucose_at, ai_consent_iob_at, ai_consent_history_at")
          .eq("user_id", user.id)
          .maybeSingle();
        setAiConsentGranted(Boolean(data?.ai_consent_at));
        setAiScopeGlucose(Boolean(data?.ai_consent_glucose_at));
        setAiScopeIob(Boolean(data?.ai_consent_iob_at));
        setAiScopeHistory(Boolean(data?.ai_consent_history_at));
      } catch { /* keep previous */ }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const toggleAiConsent = useCallback(async (next: boolean) => {
    if (aiConsentBusy || aiConsentGranted === null) return;
    if (next) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("glev:ai-open-consent-modal"));
      }
      return;
    }
    setAiConsentBusy(true);
    const prev = aiConsentGranted;
    const prevScopes = { glucose: aiScopeGlucose, iob: aiScopeIob, history: aiScopeHistory };
    setAiConsentGranted(false);
    setAiScopeGlucose(false);
    setAiScopeIob(false);
    setAiScopeHistory(false);
    if (typeof window !== "undefined") {
      try { window.sessionStorage.removeItem("glev_ai_history_v1"); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("glev:ai-consent-revoked"));
    }
    try {
      const res = await fetch("/api/ai/consent", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setAiConsentGranted(prev);
      setAiScopeGlucose(prevScopes.glucose);
      setAiScopeIob(prevScopes.iob);
      setAiScopeHistory(prevScopes.history);
    } finally {
      setAiConsentBusy(false);
    }
  }, [aiConsentGranted, aiConsentBusy, aiScopeGlucose, aiScopeIob, aiScopeHistory]);

  const toggleAiScope = useCallback(async (scope: "glucose" | "iob" | "history", next: boolean) => {
    if (aiScopeBusy) return;
    if (!aiConsentGranted) return;
    const setter =
      scope === "glucose" ? setAiScopeGlucose :
      scope === "iob"     ? setAiScopeIob     :
                            setAiScopeHistory;
    const prev =
      scope === "glucose" ? aiScopeGlucose :
      scope === "iob"     ? aiScopeIob     :
                            aiScopeHistory;
    setAiScopeBusy(scope);
    setter(next);
    try {
      const res = await fetch("/api/ai/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, granted: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setter(prev);
    } finally {
      setAiScopeBusy(null);
    }
  }, [aiConsentGranted, aiScopeBusy, aiScopeGlucose, aiScopeIob, aiScopeHistory]);

  const revokeAllAiAccess = useCallback(async () => {
    if (aiScopeBusy || aiConsentBusy) return;
    if (typeof window !== "undefined") {
      if (!window.confirm(t("glev_intel_revoke_confirm"))) return;
    }
    setAiScopeBusy("revoke");
    const prev = { master: aiConsentGranted, glucose: aiScopeGlucose, iob: aiScopeIob, history: aiScopeHistory };
    setAiConsentGranted(false);
    setAiScopeGlucose(false);
    setAiScopeIob(false);
    setAiScopeHistory(false);
    if (typeof window !== "undefined") {
      try { window.sessionStorage.removeItem("glev_ai_history_v1"); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("glev:ai-consent-revoked"));
    }
    try {
      const res = await fetch("/api/ai/consent", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setAiConsentGranted(prev.master);
      setAiScopeGlucose(prev.glucose);
      setAiScopeIob(prev.iob);
      setAiScopeHistory(prev.history);
    } finally {
      setAiScopeBusy(null);
    }
  }, [aiConsentBusy, aiScopeBusy, aiConsentGranted, aiScopeGlucose, aiScopeIob, aiScopeHistory, t]);

  if (aiVoiceEnabled === false) {
    router.replace("/settings");
    return null;
  }

  if (aiVoiceEnabled === null) {
    return null;
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 16, paddingBottom: 80 }}>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/settings"
          style={{ fontSize: 13, color: ACCENT, textDecoration: "none", display: "inline-block", marginBottom: 8 }}
        >
          ← {t("ai_settings_back")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
          {t("ai_page_title")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
          {t("ai_page_subtitle")}
        </p>
      </div>

      {/* Master toggle */}
      <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: 14, marginBottom: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", gap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${ACCENT}18`, color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
              </svg>
            </span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.25 }}>
                {t("glev_ai_label")}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.3 }}>
                {aiConsentGranted ? t("glev_ai_desc_on") : t("glev_ai_desc_off")}
              </span>
            </span>
          </span>
          <div
            role="switch"
            aria-checked={!!aiConsentGranted}
            aria-disabled={aiConsentBusy || aiConsentGranted === null}
            aria-label={t("glev_ai_label")}
            onClick={() => { void toggleAiConsent(!aiConsentGranted); }}
            style={{
              width: 44, height: 24, borderRadius: 99,
              cursor: aiConsentBusy || aiConsentGranted === null ? "not-allowed" : "pointer",
              flexShrink: 0,
              background: aiConsentGranted ? ACCENT : "var(--border-strong)",
              border: `1px solid ${aiConsentGranted ? ACCENT + "60" : BORDER}`,
              position: "relative", transition: "background 0.2s",
              opacity: aiConsentGranted === null ? 0.55 : 1,
            }}
          >
            <div style={{ position: "absolute", top: 2, left: aiConsentGranted ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
          </div>
        </div>
      </div>

      {/* FAB mode + TTS */}
      <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: 14, marginBottom: 16, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{t("fab_mode_label")}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.3 }}>{t("fab_mode_desc")}</span>
          </div>
          <div role="radiogroup" aria-label={t("fab_mode_label")} style={{ display: "flex", gap: 8, padding: 4, borderRadius: 10, background: "var(--surface-soft)", border: `1px solid ${BORDER}` }}>
            {(["ai", "voice"] as const).map((opt) => {
              const active = fabMode === opt;
              return (
                <button key={opt} type="button" role="radio" aria-checked={active}
                  onClick={() => setFabModeAndPersist(opt)}
                  style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "var(--on-accent)" : "var(--text-strong)", background: active ? ACCENT : "transparent", transition: "background 0.15s, color 0.15s" }}>
                  {t(opt === "ai" ? "fab_mode_option_ai" : "fab_mode_option_voice")}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{t("tts_auto_label")}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.3 }}>{t("tts_auto_desc")}</span>
          </span>
          <div role="switch" aria-checked={ttsAutoRead} aria-label={t("tts_auto_label")}
            onClick={toggleTtsAutoRead}
            style={{ width: 44, height: 24, borderRadius: 99, cursor: "pointer", flexShrink: 0, background: ttsAutoRead ? ACCENT : "var(--border-strong)", border: `1px solid ${ttsAutoRead ? ACCENT + "60" : BORDER}`, position: "relative", transition: "background 0.2s" }}>
            <div style={{ position: "absolute", top: 2, left: ttsAutoRead ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
          </div>
        </div>
      </div>

      {/* Intelligence — data access scopes */}
      <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: 14, marginBottom: 16, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px 8px" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)" }}>
            {t("section_glev_intelligence")}
          </p>
        </div>
        <div style={{ padding: "0 16px 10px", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.4 }}>
          {t("glev_intel_intro")}
        </div>
        {([
          { key: "meal" as const,    granted: true,            locked: true,  badge: null,
            title: t("glev_intel_row_meal_title"),    desc: t("glev_intel_row_meal_desc") },
          { key: "glucose" as const, granted: !!aiScopeGlucose, locked: false, badge: null,
            title: t("glev_intel_row_glucose_title"), desc: t("glev_intel_row_glucose_desc") },
          { key: "iob" as const,     granted: !!aiScopeIob,    locked: false, badge: null,
            title: t("glev_intel_row_iob_title"),     desc: t("glev_intel_row_iob_desc") },
          { key: "history" as const, granted: !!aiScopeHistory, locked: false, badge: null,
            title: t("glev_intel_row_history_title"), desc: t("glev_intel_row_history_desc") },
        ]).map((row) => {
          const masterOff = !aiConsentGranted;
          const interactive = !row.locked && !masterOff;
          const busy = aiScopeBusy === row.key;
          const disabled = !interactive || busy || aiConsentGranted === null;
          return (
            <div key={row.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", gap: 12, borderTop: `1px solid ${BORDER}`, opacity: masterOff && !row.locked ? 0.55 : 1 }}>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>{row.title}</span>
                  {row.badge && (
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: "var(--border-soft)", color: "var(--text-dim)", border: `1px solid ${BORDER}`, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {row.badge}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.35 }}>{row.desc}</span>
              </span>
              <div
                role="switch" aria-checked={row.granted} aria-disabled={disabled} aria-label={row.title}
                onClick={() => { if (disabled || row.key === "meal") return; void toggleAiScope(row.key, !row.granted); }}
                style={{ width: 44, height: 24, borderRadius: 99, cursor: disabled ? "not-allowed" : "pointer", flexShrink: 0, background: row.granted ? ACCENT : "var(--border-strong)", border: `1px solid ${row.granted ? ACCENT + "60" : BORDER}`, position: "relative", transition: "background 0.2s", opacity: disabled ? 0.55 : 1 }}
              >
                <div style={{ position: "absolute", top: 2, left: row.granted ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
              </div>
            </div>
          );
        })}
        <div style={{ padding: "12px 16px 14px", borderTop: `1px solid ${BORDER}` }}>
          <button
            type="button"
            onClick={() => { void revokeAllAiAccess(); }}
            disabled={!aiConsentGranted || aiScopeBusy === "revoke"}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.10)", color: "rgb(239,68,68)", fontSize: 13, fontWeight: 600, cursor: !aiConsentGranted || aiScopeBusy === "revoke" ? "not-allowed" : "pointer", opacity: !aiConsentGranted ? 0.55 : 1 }}
          >
            {aiScopeBusy === "revoke" ? t("glev_intel_revoke_busy") : t("glev_intel_revoke_all")}
          </button>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
            {t("glev_intel_revoke_hint")}
          </p>
        </div>
      </div>
    </div>
  );
}
