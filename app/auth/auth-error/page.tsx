"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

/**
 * Landing page when the email-confirmation link can't be exchanged for a
 * session (expired link, missing code, Supabase URL config not set, etc).
 *
 * Also handles the Supabase implicit-flow case where the token arrives as
 * #access_token=… in the hash instead of ?code= (PKCE). In that case
 * detectSessionInUrl has already created the session — we just need to
 * detect it and redirect to /onboarding instead of showing an error.
 */
export default function AuthErrorPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabase) { setChecking(false); return; }

    // Give Supabase JS a moment to process the hash (#access_token=…)
    // via detectSessionInUrl before we check for an active session.
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Session exists — user confirmed their email via implicit flow.
        // Set trial_end_at (non-fatal if it fails) then go to onboarding.
        try {
          await fetch("/api/auth/free-trial", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
        } catch {
          // non-fatal
        }
        router.replace("/onboarding");
      } else {
        setChecking(false);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [router]);

  if (checking) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#09090B",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      />
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#09090B",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: "100%",
          padding: "32px 28px",
          background: "#111117",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: "rgba(239, 68, 68, 0.12)",
            color: "#EF4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 18px",
            fontSize: 26,
            fontWeight: 700,
          }}
          aria-hidden
        >
          !
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, letterSpacing: "-0.01em" }}>
          Couldn&apos;t verify your account
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.55, marginBottom: 22 }}>
          The confirmation link may have expired or already been used. Please try signing in,
          or contact support if the problem persists.
        </p>
        <Link
          href="/login"
          style={{
            display: "inline-block",
            padding: "10px 20px",
            borderRadius: 10,
            background: "#4F6EF7",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
