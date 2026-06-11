"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { useFeatureFlag } from "@/lib/featureFlags";
import { type TtsSpeed, TTS_SPEED_KEY, TTS_SPEED_EVENT } from "@/hooks/useTTS";

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
  const [aiScopeFeedback, setAiScopeFeedback] = useState<boolean | null>(null);
  const [aiScopeBusy, setAiScopeBusy] = useState<"glucose" | "iob" | "history" | "feedback" | "revoke" | null>(null);

  const [fabMode, setFabMode] = useState<"ai" | "voice">("voice");
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

  const [chatPosition, setChatPosition] = useState<"tap" | "swipe">("swipe");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("glev_chat_position");
      if (stored === "tap" || stored === "swipe") setChatPosition(stored);
    } catch { /* ignore */ }
  }, []);
  const setChatPositionAndPersist = useCallback((next: "tap" | "swipe") => {
    setChatPosition(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("glev_chat_position", next);
        window.dispatchEvent(new CustomEvent("glev:chat-position-changed", { detail: next }));
      } catch { /* ignore */ }
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

  const [ttsIntentAnnounce, setTtsIntentAnnounce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem("glev_tts_intent");
      setTtsIntentAnnounce(v !== null && v !== "0");
    } catch { /* ignore */ }
  }, []);
  const toggleTtsIntentAnnounce = useCallback(() => {
    setTtsIntentAnnounce((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("glev_tts_intent", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const [ttsSpeed, setTtsSpeedState] = useState<TtsSpeed>("normal");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(TTS_SPEED_KEY);
      if (v === "slow" || v === "fast") setTtsSpeedState(v);
    } catch { /* ignore */ }
  }, []);
  const setTtsSpeed = useCallback((next: TtsSpeed) => {
    setTtsSpeedState(next);
    try { window.localStorage.setItem(TTS_SPEED_KEY, next); } catch { /* ignore */ }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<TtsSpeed>(TTS_SPEED_EVENT, { detail: next }));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!supabase) { setAiConsentGranted(false); return; }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setAiConsentGranted(false); return; }
        const { data } = await supabase
          .from("profiles")
          .select("ai_consent_at, ai_consent_glucose_at, ai_consent_iob_at, ai_consent_history_at, ai_feedback_consent_at")
          .eq("user_id", user.id)
          .maybeSingle();
        setAiConsentGranted(Boolean(data?.ai_consent_at));
        setAiScopeGlucose(Boolean(data?.ai_consent_glucose_at));
        setAiScopeIob(Boolean(data?.ai_consent_iob_at));
        setAiScopeHistory(Boolean(data?.ai_consent_history_at));
        setAiScopeFeedback(Boolean(data?.ai_feedback_consent_at));
      } catch {
        setAiConsentGranted(false);
        setAiScopeGlucose(false);
        setAiScopeIob(false);
        setAiScopeHistory(false);
        setAiScopeFeedback(false);
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
          .select("ai_consent_at, ai_consent_glucose_at, ai_consent_iob_at, ai_consent_history_at, ai_feedback_consent_at")
          .eq("user_id", user.id)
          .maybeSingle();
        setAiConsentGranted(Boolean(data?.ai_consent_at));
        setAiScopeGlucose(Boolean(data?.ai_consent_glucose_at));
        setAiScopeIob(Boolean(data?.ai_consent_iob_at));
        setAiScopeHistory(Boolean(data?.ai_consent_history_at));
        setAiScopeFeedback(Boolean(data?.ai_feedback_consent_at));
      } catch { /* keep previous */ }
    };
    // Re-sync when the window regains focus (e.g. user switches tabs).
    window.addEventListener("focus", refresh);
    // Re-sync when the consent modal in Layout confirms a grant — this fires
    // after the user re-enables AI via the toggle (OFF → ON path dispatched
    // "glev:ai-open-consent-modal", user accepted, grantConsent() succeeded).
    // Without this listener the Settings page state stays stuck at false and
    // the toggle appears unresponsive until the next app restart.
    window.addEventListener("glev:ai-consent-granted", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("glev:ai-consent-granted", refresh);
    };
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

  const toggleAiScope = useCallback(async (scope: "glucose" | "iob" | "history" | "feedback", next: boolean) => {
    if (aiScopeBusy) return;
    if (!aiConsentGranted) return;
    const setter =
      scope === "glucose"  ? setAiScopeGlucose  :
      scope === "iob"      ? setAiScopeIob      :
      scope === "feedback" ? setAiScopeFeedback :
                             setAiScopeHistory;
    const prev =
      scope === "glucose"  ? aiScopeGlucose  :
      scope === "iob"      ? aiScopeIob      :
      scope === "feedback" ? aiScopeFeedback :
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
    const prev = { master: aiConsentGranted, glucose: aiScopeGlucose, iob: aiScopeIob, history: aiScopeHistory, feedback: aiScopeFeedback };
    setAiConsentGranted(false);
    setAiScopeGlucose(false);
    setAiScopeIob(false);
    setAiScopeHistory(false);
    setAiScopeFeedback(false);
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
      setAiScopeFeedback(prev.feedback);
    } finally {
      setAiScopeBusy(null);
    }
  }, [aiConsentBusy, aiScopeBusy, aiConsentGranted, aiScopeGlucose, aiScopeIob, aiScopeHistory, aiScopeFeedback, t]);

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
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{t("chat_position_label")}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.3 }}>{t("chat_position_desc")}</span>
          </div>
          <div role="radiogroup" aria-label={t("chat_position_label")} style={{ display: "flex", gap: 8, padding: 4, borderRadius: 10, background: "var(--surface-soft)", border: `1px solid ${BORDER}` }}>
            {(["tap", "swipe"] as const).map((opt) => {
              const active = chatPosition === opt;
              return (
                <button key={opt} type="button" role="radio" aria-checked={active}
                  onClick={() => setChatPositionAndPersist(opt)}
                  style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "var(--on-accent)" : "var(--text-strong)", background: active ? ACCENT : "transparent", transition: "background 0.15s, color 0.15s" }}>
                  {t(opt === "tap" ? "chat_position_option_tap" : "chat_position_option_swipe")}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: `1px solid ${BORDER}` }}>
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
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: `1px solid ${BORDER}` }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{t("tts_intent_label")}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.3 }}>{t("tts_intent_desc")}</span>
          </span>
          <div role="switch" aria-checked={ttsIntentAnnounce} aria-label={t("tts_intent_label")}
            onClick={toggleTtsIntentAnnounce}
            style={{ width: 44, height: 24, borderRadius: 99, cursor: "pointer", flexShrink: 0, background: ttsIntentAnnounce ? ACCENT : "var(--border-strong)", border: `1px solid ${ttsIntentAnnounce ? ACCENT + "60" : BORDER}`, position: "relative", transition: "background 0.2s" }}>
            <div style={{ position: "absolute", top: 2, left: ttsIntentAnnounce ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
          </div>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{t("tts_speed_label")}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.3 }}>{t("tts_speed_desc")}</span>
          </div>
          <div role="radiogroup" aria-label={t("tts_speed_label")} style={{ display: "flex", gap: 8, padding: 4, borderRadius: 10, background: "var(--surface-soft)", border: `1px solid ${BORDER}` }}>
            {(["slow", "normal", "fast"] as const).map((opt) => {
              const active = ttsSpeed === opt;
              const label = opt === "slow" ? t("tts_speed_slow") : opt === "fast" ? t("tts_speed_fast") : t("tts_speed_normal");
              return (
                <button key={opt} type="button" role="radio" aria-checked={active}
                  onClick={() => setTtsSpeed(opt)}
                  style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "var(--on-accent)" : "var(--text-strong)", background: active ? ACCENT : "transparent", transition: "background 0.15s, color 0.15s" }}>
                  {label}
                </button>
              );
            })}
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
        {/* When master consent is off, show an activation prompt instead of
            grayed-out scope toggles — makes the required first step obvious. */}
        {aiConsentGranted === false ? (
          <div style={{ borderTop: `1px solid ${BORDER}`, padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {t("glev_intel_master_off_hint")}
            </p>
            <button
              type="button"
              onClick={() => { void toggleAiConsent(true); }}
              style={{ alignSelf: "flex-start", padding: "9px 16px", borderRadius: 10, border: "none", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(79,110,247,0.3)" }}
            >
              {t("glev_intel_master_off_cta")} →
            </button>
          </div>
        ) : ([
          { key: "meal" as const,    granted: true,            locked: true,
            title: t("glev_intel_row_meal_title"),    desc: t("glev_intel_row_meal_desc") },
          { key: "glucose" as const, granted: !!aiScopeGlucose, locked: false,
            title: t("glev_intel_row_glucose_title"), desc: t("glev_intel_row_glucose_desc") },
          { key: "iob" as const,     granted: !!aiScopeIob,    locked: false,
            title: t("glev_intel_row_iob_title"),     desc: t("glev_intel_row_iob_desc") },
          { key: "history" as const, granted: !!aiScopeHistory, locked: false,
            title: t("glev_intel_row_history_title"), desc: t("glev_intel_row_history_desc") },
          { key: "feedback" as const, granted: !!aiScopeFeedback, locked: false,
            title: t("glev_intel_row_feedback_title"), desc: t("glev_intel_row_feedback_desc") },
        ]).map((row) => {
          const busy = aiScopeBusy === row.key;
          const disabled = row.locked || busy || aiConsentGranted === null;
          return (
            <div key={row.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", gap: 12, borderTop: `1px solid ${BORDER}` }}>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>{row.title}</span>
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
