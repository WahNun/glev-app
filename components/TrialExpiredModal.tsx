"use client";

/**
 * TrialExpiredModal
 *
 * Non-dismissable paywall shown when:
 *   - profiles.trial_end_at is not null AND in the past
 *   - AND GET /api/me/plan returns "free"
 *
 * NULL trial_end_at = regular free/paid user → modal never shows.
 * Paid users (beta/pro/plus) → modal never shows even if trial_end_at is set.
 *
 * Zeigt zwei Optionen: Smart (Einstieg) und Pro (empfohlen, wie im Trial).
 * Mounted in app/(protected)/layout.tsx after LowGlucoseAlarmTicker.
 */

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { supabase } from "@/lib/supabase";
import { useIsNative } from "@/lib/platform";
import PaywallSheet from "@/components/PaywallSheet";

const ACCENT = "#4F6EF7";

type ModalCopy = {
  ariaLabel: string;
  title: string;
  body: string;
  badge: string;
  proLabel: (busy: boolean) => string;
  proSub: string;
  smartLabel: (busy: boolean) => string;
  smartSub: string;
  signOut: string;
};

const DE: ModalCopy = {
  ariaLabel: "Testphase abgelaufen",
  title: "Deine Testphase ist abgelaufen",
  body: "Deine Daten bleiben vollständig erhalten.\nWähle ein Abo um weiterzumachen.",
  badge: "Empfohlen",
  proLabel: (busy) => busy ? "Weiterleitung …" : "Pro — Wie im Trial weiter →",
  proSub: "Voller Funktionsumfang · alle Features entsperrt",
  smartLabel: (busy) => busy ? "Weiterleitung …" : "Smart — Einsteigen →",
  smartSub: "Kernfeatures · ideal zum Einstieg",
  signOut: "Abmelden",
};

const EN: ModalCopy = {
  ariaLabel: "Trial expired",
  title: "Your trial has ended",
  body: "Your data is fully preserved.\nChoose a plan to keep going.",
  badge: "Most popular",
  proLabel: (busy) => busy ? "Redirecting …" : "Pro — Continue as in your trial →",
  proSub: "Full feature set · everything unlocked",
  smartLabel: (busy) => busy ? "Redirecting …" : "Smart — Get started →",
  smartSub: "Core features · great for getting started",
  signOut: "Sign out",
};

async function startCheckout(tier: "smart" | "pro"): Promise<void> {
  const endpoint = tier === "smart" ? "/api/checkout/beta" : "/api/checkout/pro";

  let email: string | undefined;
  let locale = "de";
  try {
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) email = data.user.email;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz.startsWith("Europe/") && !tz.startsWith("Atlantic/") && tz !== "UTC") {
      locale = "en";
    }
  } catch {
    // best-effort
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale, ...(email ? { email } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (data.url) window.location.href = data.url;
  } catch {
    // fallback
    window.location.href = "/pro";
  }
}

export default function TrialExpiredModal({ forceOpen = false }: { forceOpen?: boolean }) {
  const locale = useLocale();
  const isNative = useIsNative();
  const C = locale === "en" ? EN : DE;

  const [expired, setExpired] = useState(forceOpen);
  const [loading, setLoading] = useState(!forceOpen);
  const [busySmart, setBusySmart] = useState(false);
  const [busyPro, setBusyPro] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  useEffect(() => {
    if (forceOpen) return;
    async function check() {
      try {
        if (!supabase) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("trial_end_at")
          .eq("user_id", user.id)
          .single();

        if (!profile?.trial_end_at) return;

        const trialEnd = new Date(profile.trial_end_at);
        if (trialEnd > new Date()) return;

        const res = await fetch("/api/me/plan");
        if (!res.ok) return;
        const { plan } = (await res.json()) as { plan?: string };

        if (plan === "free") setExpired(true);
      } catch (e) {
        console.warn("[TrialExpiredModal] check failed silently:", e);
      } finally {
        setLoading(false);
      }
    }
    check();
  }, [forceOpen]);

  if (loading || !expired) return null;

  const busy = busySmart || busyPro;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={C.ariaLabel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(10,10,15,0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "36px 28px 28px",
          maxWidth: 380,
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: `${ACCENT}1e`,
            border: `1px solid ${ACCENT}4d`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
          }}
        >
          ⏰
        </div>

        <h2
          style={{
            fontSize: 21,
            fontWeight: 700,
            color: "var(--text)",
            margin: 0,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          {C.title}
        </h2>

        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          {C.body}
        </p>

        {isNative ? (
          /* iOS: RevenueCat Paywall */
          <>
            <button
              type="button"
              onClick={() => setPaywallOpen(true)}
              style={{
                width: "100%",
                padding: "15px 0",
                background: ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: 13,
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
            >
              {locale === "en" ? "Choose a plan →" : "Plan wählen →"}
            </button>

            <button
              type="button"
              onClick={async () => {
                if (supabase) await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-faint)",
                fontSize: 13,
                cursor: "pointer",
                padding: "4px 8px",
                fontFamily: "inherit",
              }}
            >
              {C.signOut}
            </button>

            <PaywallSheet open={paywallOpen} onClose={() => { setPaywallOpen(false); setExpired(false); }} onPurchaseSuccess={() => setExpired(false)} suppressTrial={true} />
          </>
        ) : (
          <>
            {/* Plan cards */}
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginTop: 4,
              }}
            >
              {/* Pro — recommended */}
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusyPro(true);
                  await startCheckout("pro");
                  setBusyPro(false);
                }}
                style={{
                  position: "relative",
                  width: "100%",
                  background: busy ? `${ACCENT}88` : ACCENT,
                  color: "#fff",
                  border: "none",
                  borderRadius: 13,
                  padding: "18px 20px 14px",
                  cursor: busy ? "default" : "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "background 0.15s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: -10,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: ACCENT,
                    border: "2px solid var(--surface)",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "2px 10px",
                    borderRadius: 20,
                    whiteSpace: "nowrap",
                  }}
                >
                  {C.badge}
                </span>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
                  {C.proLabel(busyPro)}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {C.proSub}
                </div>
              </button>

              {/* Smart — entry option */}
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusySmart(true);
                  await startCheckout("smart");
                  setBusySmart(false);
                }}
                style={{
                  width: "100%",
                  background: "transparent",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 13,
                  padding: "14px 20px",
                  cursor: busy ? "default" : "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "border-color 0.15s",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, color: "var(--text)" }}>
                  {C.smartLabel(busySmart)}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {C.smartSub}
                </div>
              </button>
            </div>

            {/* Logout */}
            <button
              type="button"
              onClick={async () => {
                if (supabase) await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-faint)",
                fontSize: 13,
                cursor: "pointer",
                padding: "4px 8px",
                fontFamily: "inherit",
              }}
            >
              {C.signOut}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
