"use client";

/**
 * CookieBanner — DSGVO-konformer Cookie-Consent-Banner mit granularen Kategorien.
 *
 * Erste Ebene:  kompakter Text + „Alle ablehnen" / „Einstellungen" / „Alle akzeptieren"
 * Zweite Ebene: drei Kategorien mit Toggle-Switches + „Auswahl speichern"
 *
 * Storage-Format v2: { v: 2, necessary: true, analytics: boolean, marketing: boolean }
 * Migration v1 → v2: "accepted" → marketing:true, analytics:false
 *                    "rejected" → marketing:false, analytics:false
 *
 * window.__consent = { marketing, analytics } — rückwärtskompatibel für fb-capi-client.ts
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "glev_cookie_consent";
const ACCENT = "#4F6EF7";

interface ConsentV2 {
  v: 2;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
}

function readConsent(): ConsentV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // v2 JSON
    const parsed = JSON.parse(raw) as Partial<ConsentV2>;
    if (parsed.v === 2) return parsed as ConsentV2;
    // v1 migration
    if (raw === "accepted") return { v: 2, necessary: true, analytics: false, marketing: true };
    if (raw === "rejected")  return { v: 2, necessary: true, analytics: false, marketing: false };
  } catch { /* ignore */ }
  return null;
}

function writeConsent(c: ConsentV2) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  if (typeof window !== "undefined") {
    (window as Window & { __consent?: { marketing: boolean; analytics: boolean } }).__consent = {
      marketing: c.marketing,
      analytics: c.analytics,
    };
  }
}

const BTN_BASE: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "-0.01em",
  border: "none",
  whiteSpace: "nowrap",
};

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 40, height: 24, borderRadius: 12, flexShrink: 0,
        background: checked ? ACCENT : "var(--border, rgba(255,255,255,0.12))",
        border: "none", cursor: disabled ? "default" : "pointer",
        position: "relative", transition: "background 0.2s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 3,
        left: checked ? 19 : 3,
        width: 18, height: 18, borderRadius: "50%",
        background: "white", transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        display: "block",
      }} />
    </button>
  );
}

function CategoryRow({ title, description, checked, onChange, disabled }: {
  title: string; description: string;
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderTop: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text, #fff)", marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-faint, rgba(255,255,255,0.4))", lineHeight: 1.45 }}>{description}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function CookieBanner({ forceVisible = false }: { forceVisible?: boolean }) {
  const [visible, setVisible] = useState(forceVisible);
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (forceVisible) return;
    const stored = readConsent();
    if (stored) { writeConsent(stored); return; }
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, [forceVisible]);

  if (!visible) return null;

  const acceptAll = () => { writeConsent({ v: 2, necessary: true, analytics: true, marketing: true }); setVisible(false); };
  const rejectAll = () => { writeConsent({ v: 2, necessary: true, analytics: false, marketing: false }); setVisible(false); };
  const saveChoice = () => { writeConsent({ v: 2, necessary: true, analytics, marketing }); setVisible(false); };

  return (
    <div
      role="dialog"
      aria-label="Cookie-Einstellungen"
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
        background: "var(--surface, #12151f)",
        borderTop: "1px solid var(--border, rgba(255,255,255,0.08))",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.4)",
        padding: showDetails ? "20px 24px 24px" : "14px 20px",
      }}
    >
      {!showDetails ? (
        /* ── Erste Ebene ── */
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", maxWidth: 900, margin: "0 auto" }}>
          <p style={{ flex: 1, minWidth: 200, margin: 0, fontSize: 13, color: "var(--text-faint, rgba(255,255,255,0.45))", lineHeight: 1.5 }}>
            Wir nutzen Cookies für Analyse und Werbemessung.{" "}
            <a href="/datenschutz" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: 2 }}>Datenschutzerklärung</a>
          </p>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            <button onClick={rejectAll} style={{ ...BTN_BASE, background: "transparent", color: "var(--text-faint, rgba(255,255,255,0.45))", border: "1px solid var(--border, rgba(255,255,255,0.12))" }}>
              Alle ablehnen
            </button>
            <button onClick={() => setShowDetails(true)} style={{ ...BTN_BASE, background: "transparent", color: "var(--text-dim, rgba(255,255,255,0.65))", border: "1px solid var(--border, rgba(255,255,255,0.18))" }}>
              Einstellungen
            </button>
            <button onClick={acceptAll} style={{ ...BTN_BASE, background: ACCENT, color: "#fff", boxShadow: "0 4px 12px rgba(79,110,247,0.35)" }}>
              Alle akzeptieren
            </button>
          </div>
        </div>
      ) : (
        /* ── Zweite Ebene (Detail-Panel) ── */
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text, #fff)" }}>Cookie-Einstellungen</span>
            <button onClick={() => setShowDetails(false)} style={{ ...BTN_BASE, padding: "4px 8px", background: "transparent", color: "var(--text-faint, rgba(255,255,255,0.4))", fontSize: 12 }}>
              ✕
            </button>
          </div>

          <CategoryRow
            title="Notwendig"
            description="Session-Management, Authentifizierung, Sprachpräferenz. Immer aktiv."
            checked={true} onChange={() => {}} disabled
          />
          <CategoryRow
            title="Analyse"
            description="Anonymisierte Auswertung wie Glev genutzt wird — hilft uns, die App zu verbessern."
            checked={analytics} onChange={setAnalytics}
          />
          <CategoryRow
            title="Marketing"
            description="Meta-Pixel und Facebook CAPI zur Messung der Werbewirkung."
            checked={marketing} onChange={setMarketing}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button onClick={rejectAll} style={{ ...BTN_BASE, background: "transparent", color: "var(--text-faint, rgba(255,255,255,0.45))", border: "1px solid var(--border, rgba(255,255,255,0.12))" }}>
              Alle ablehnen
            </button>
            <button onClick={saveChoice} style={{ ...BTN_BASE, background: ACCENT, color: "#fff", boxShadow: "0 4px 12px rgba(79,110,247,0.3)" }}>
              Auswahl speichern
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
