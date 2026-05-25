"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const ACCENT = "#4F6EF7";

export default function TrialExpiredModal() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!supabase) return;

      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes?.user;
      if (!user || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("trial_end_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile?.trial_end_at || cancelled) return;

      const trialExpired = new Date(profile.trial_end_at).getTime() < Date.now();
      if (!trialExpired) return;

      const res = await fetch("/api/me/plan", { cache: "no-store" }).catch(() => null);
      if (!res || cancelled) return;
      const { plan } = await res.json().catch(() => ({ plan: "free" })) as { plan: string };

      if (plan === "free") {
        setExpired(true);
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  if (!expired) return null;

  async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="trial-expired-title"
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "32px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: `${ACCENT}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
          }}
          aria-hidden
        >
          ⏱
        </div>

        <div>
          <h2
            id="trial-expired-title"
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text)",
              margin: "0 0 8px",
              letterSpacing: "-0.02em",
            }}
          >
            Deine Testphase ist abgelaufen
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-dim)", margin: 0, lineHeight: 1.55 }}>
            Deine 7-tägige Testphase ist beendet. Werde jetzt Pro-Mitglied und behalte
            vollen Zugriff auf alle Funktionen.
          </p>
        </div>

        <Link
          href="/pro"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: ACCENT,
            color: "#fff",
            borderRadius: 12,
            padding: "14px 20px",
            fontSize: 15,
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: `0 6px 18px ${ACCENT}40`,
            textAlign: "center",
          }}
        >
          Jetzt Pro werden →
        </Link>

        <button
          onClick={handleLogout}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "11px 20px",
            fontSize: 14,
            color: "var(--text-dim)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Abmelden
        </button>
      </div>
    </div>
  );
}
