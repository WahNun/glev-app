"use client";

/**
 * CookieBanner — DSGVO-konformer Cookie-Consent-Banner.
 *
 * - Zeigt sich beim ersten Besuch (kein gespeicherter Consent).
 * - Opt-in:  setzt window.__consent = { marketing: true }  + speichert in localStorage.
 * - Opt-out: setzt window.__consent = { marketing: false } + speichert in localStorage.
 * - trackEvent() aus lib/fb-capi-client.ts prüft window.__consent.marketing vor jedem Fire.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "glev_cookie_consent";

type ConsentValue = "accepted" | "rejected";

function getStoredConsent(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "accepted" || v === "rejected") return v;
  } catch {
    // localStorage blocked (private mode etc.)
  }
  return null;
}

function applyConsent(value: ConsentValue) {
  if (typeof window !== "undefined") {
    (window as Window & { __consent?: { marketing: boolean } }).__consent = {
      marketing: value === "accepted",
    };
  }
}

function storeConsent(value: ConsentValue) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore
  }
  applyConsent(value);
}

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = getStoredConsent();
    if (stored) {
      // Bereits entschieden — window.__consent wiederherstellen, kein Banner
      applyConsent(stored);
      return;
    }
    // Kleiner Delay damit das Banner nicht beim SSR-Flash sichtbar ist
    const t = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  function handleAccept() {
    storeConsent("accepted");
    setVisible(false);
  }

  function handleReject() {
    storeConsent("rejected");
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie-Einstellungen"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "var(--surface, #12151f)",
        borderTop: "1px solid var(--border, rgba(255,255,255,0.08))",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <p
        style={{
          flex: 1,
          minWidth: 200,
          margin: 0,
          fontSize: 13,
          color: "var(--text-muted, rgba(255,255,255,0.55))",
          lineHeight: 1.5,
        }}
      >
        Wir nutzen Cookies zur Analyse und Optimierung unserer Werbung.{" "}
        <a
          href="/datenschutz"
          style={{
            color: "var(--accent, #4F6EF7)",
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          Datenschutzerklärung
        </a>
      </p>

      <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
        <button
          onClick={handleReject}
          style={{
            padding: "9px 18px",
            borderRadius: 9,
            border: "1px solid var(--border, rgba(255,255,255,0.12))",
            background: "transparent",
            color: "var(--text-muted, rgba(255,255,255,0.55))",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "-0.01em",
          }}
        >
          Ablehnen
        </button>
        <button
          onClick={handleAccept}
          style={{
            padding: "9px 18px",
            borderRadius: 9,
            border: "none",
            background: "var(--accent, #4F6EF7)",
            color: "var(--on-accent)",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "-0.01em",
            boxShadow: "0 4px 12px rgba(79,110,247,0.35)",
          }}
        >
          Akzeptieren
        </button>
      </div>
    </div>
  );
}
