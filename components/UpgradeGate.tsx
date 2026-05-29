"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { usePlan } from "@/hooks/usePlan";
import { requiredPlanLabel, FEATURE_TIERS } from "@/lib/planFeatures";
import { supabase } from "@/lib/supabase";

const ACCENT = "#4F6EF7";

const CHECKOUT_ENDPOINT: Record<string, string> = {
  smart: "/api/checkout/beta",
  pro:   "/api/checkout/pro",
  plus:  "/api/checkout/plus",
};

/**
 * Bestimmt ob EUR oder USD für den Stripe-Checkout verwendet werden soll.
 *
 * Logik:
 *   1. Ist die Browser-Timezone in Europa? → immer EUR (locale "de")
 *      Das erfasst EN-Nutzer aus Europa korrekt.
 *   2. Sonst: App-Locale "de" → EUR, "en" → USD
 *
 * Damit bekommen DACH + alle europäischen Länder EUR,
 * EN-US-Nutzer außerhalb Europas bekommen USD.
 */
function resolveCheckoutLocale(appLocale: string): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.startsWith("Europe/") || tz.startsWith("Atlantic/") || tz === "UTC") {
      return "de"; // EUR
    }
  } catch {
    // Intl nicht verfügbar → Fallback auf App-Locale
  }
  return appLocale === "en" ? "en" : "de";
}

async function startCheckout(appLocale: string, tier: string): Promise<string | null> {
  const endpoint = CHECKOUT_ENDPOINT[tier] ?? "/api/checkout/pro";
  const locale = resolveCheckoutLocale(appLocale);

  let email: string | undefined;
  try {
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) email = data.user.email;
    }
  } catch {
    // best-effort — Stripe pre-fill ist nice-to-have, kein blocker
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale, ...(email ? { email } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) return null;
    return data.url;
  } catch {
    return null;
  }
}

function UpgradeModal({
  planName,
  tier,
  onClose,
}: {
  planName: string;
  tier: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  const handleUpgrade = async () => {
    if (busy) return;
    setBusy(true);
    const url = await startCheckout(locale, tier);
    if (url) {
      window.location.href = url;
    } else {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${planName} erforderlich`}
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 9999,
          width: "calc(100% - 48px)",
          maxWidth: 320,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
          padding: "28px 24px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 32, lineHeight: 1 }}>🔒</div>

        <div
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 20,
            background: `${ACCENT}18`,
            color: ACCENT,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {planName}
        </div>

        <p
          style={{
            margin: "2px 0 6px",
            fontSize: 14,
            color: "var(--text-dim)",
            lineHeight: 1.5,
          }}
        >
          Ab <strong style={{ color: "var(--text)" }}>{planName}</strong> verfügbar
        </p>

        <button
          type="button"
          onClick={() => void handleUpgrade()}
          disabled={busy}
          style={{
            width: "100%",
            padding: "13px 0",
            background: busy ? `${ACCENT}88` : ACCENT,
            color: "#fff",
            border: "none",
            borderRadius: 11,
            fontSize: 14,
            fontWeight: 700,
            cursor: busy ? "default" : "pointer",
            letterSpacing: "-0.01em",
            transition: "background 0.15s",
          }}
        >
          {busy ? "Weiterleitung …" : "Jetzt upgraden →"}
        </button>

        <Link
          href="/pro"
          onClick={onClose}
          style={{
            fontSize: 12,
            color: "var(--text-faint)",
            textDecoration: "none",
            marginTop: 2,
            opacity: 0.8,
          }}
        >
          Mehr Informationen
        </Link>
      </div>
    </>
  );
}

export default function UpgradeGate({
  feature,
  children,
  variant = "overlay",
  blurPx = 2.5,
  opacity = 0.6,
}: {
  feature: string;
  children?: React.ReactNode;
  variant?: "overlay" | "row";
  blurPx?: number;
  opacity?: number;
}) {
  const { canAccess, loading } = usePlan();
  const [modalOpen, setModalOpen] = useState(false);

  if (loading || canAccess(feature)) {
    return <>{children}</>;
  }

  const tier = FEATURE_TIERS[feature] ?? "pro";
  const planName = requiredPlanLabel(tier);

  if (variant === "row") {
    return (
      <>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setModalOpen(true); }}
          aria-label={`${planName} erforderlich`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: `${ACCENT}14`,
            color: ACCENT,
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          🔒
        </button>
        {modalOpen && (
          <UpgradeModal planName={planName} tier={tier} onClose={() => setModalOpen(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <div style={{ position: "relative" }}>
        {children && (
          <div
            aria-hidden="true"
            style={{
              filter: `blur(${blurPx}px)`,
              opacity,
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {children}
          </div>
        )}

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            position: children ? "absolute" : "relative",
            inset: children ? 0 : undefined,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: children ? 0 : "36px 24px",
            minHeight: children ? undefined : 200,
            textAlign: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "18px 22px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ fontSize: 26, lineHeight: 1 }}>🔒</div>
            <div
              style={{
                display: "inline-block",
                padding: "3px 10px",
                borderRadius: 20,
                background: `${ACCENT}18`,
                color: ACCENT,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {planName}
            </div>
            <div
              style={{
                padding: "9px 20px",
                background: ACCENT,
                color: "#fff",
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              Upgraden →
            </div>
          </div>
        </button>
      </div>

      {modalOpen && (
        <UpgradeModal planName={planName} tier={tier} onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
