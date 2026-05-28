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
 * Mounted in app/(protected)/layout.tsx after LowGlucoseAlarmTicker.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function TrialExpiredModal() {
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function check() {
      try {
        if (!supabase) return;

        // 1. Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // 2. Fetch trial_end_at from profiles
        const { data: profile } = await supabase
          .from("profiles")
          .select("trial_end_at")
          .eq("user_id", user.id)
          .single();

        // No trial = not a trial user, never show modal
        if (!profile?.trial_end_at) return;

        const trialEnd = new Date(profile.trial_end_at);
        if (trialEnd > new Date()) return; // still within trial

        // 3. Confirm plan is still "free" (not paid after trial)
        const res = await fetch("/api/me/plan");
        if (!res.ok) return;
        const { plan } = (await res.json()) as { plan?: string };

        if (plan === "free") {
          setExpired(true);
        }
      } catch (e) {
        console.warn("[TrialExpiredModal] check failed silently:", e);
      } finally {
        setLoading(false);
      }
    }

    check();
  }, []);

  if (loading || !expired) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Testphase abgelaufen"
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
          padding: "36px 32px",
          maxWidth: 400,
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "rgba(79,110,247,0.12)",
            border: "1px solid rgba(79,110,247,0.3)",
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
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text)",
            margin: 0,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          Deine Testphase ist abgelaufen
        </h2>

        <p
          style={{
            fontSize: 15,
            color: "var(--text-muted)",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Um Glev weiter zu nutzen, wähle ein Abo.
          Deine Daten bleiben vollständig erhalten.
        </p>

        {/* Primary CTA */}
        <a
          href="/pro"
          style={{
            display: "block",
            width: "100%",
            background: "#4F6EF7",
            color: "var(--on-accent)",
            textDecoration: "none",
            borderRadius: 12,
            padding: "16px 24px",
            fontSize: 16,
            fontWeight: 600,
            textAlign: "center",
            boxSizing: "border-box",
            marginTop: 4,
          }}
        >
          Jetzt Pro werden →
        </a>

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
          Abmelden
        </button>
      </div>
    </div>
  );
}
