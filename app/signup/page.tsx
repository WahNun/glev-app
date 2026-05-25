"use client";

/**
 * /signup — Public free-trial signup page (no credit card required).
 *
 * Flow:
 *   1. User enters email + password
 *   2. supabase.auth.signUp() creates the account
 *   3. POST /api/auth/free-trial sets trial_end_at = NOW() + 7 days
 *   4. Redirect to /onboarding
 *
 * This page is intentionally NOT behind the auth gate.
 * Paid users who land here (wrong link) are redirected to /dashboard.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  ACCENT,
  ACCENT_HOVER,
  BG,
  BORDER,
  SURFACE,
  TEXT_DIM,
  TEXT_FAINT,
} from "@/components/landing/tokens";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hover, setHover] = useState(false);

  // Redirect already-signed-in users
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/dashboard");
    });
  }, [router]);

  // Pixel: ViewContent on mount
  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
      (window as unknown as { fbq: (...args: unknown[]) => void }).fbq("trackCustom", "ViewFreeTrialSignup");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setLoading(true);

    try {
      // 1. Create Supabase auth account
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        },
      });

      if (signUpError) throw signUpError;
      if (!data.user) throw new Error("Signup fehlgeschlagen – bitte erneut versuchen.");

      // 2. Set trial_end_at via API
      const session = data.session;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      await fetch("/api/auth/free-trial", { method: "POST", headers }).catch((e) =>
        console.warn("[signup] trial API call failed:", e)
      );

      // 3. Pixel Lead event
      if (typeof window !== "undefined" && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
        (window as unknown as { fbq: (...args: unknown[]) => void }).fbq("track", "Lead");
      }

      // 4. If email confirmation required, show success state
      if (!session) {
        setSuccess(true);
        setLoading(false);
        return;
      }

      // 5. Session available → go to onboarding
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: BG,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 16px",
        }}
      >
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 20,
            padding: "40px 32px",
            maxWidth: 420,
            width: "100%",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 12px" }}>
            Bestätige deine E-Mail
          </h1>
          <p style={{ fontSize: 15, color: TEXT_DIM, lineHeight: 1.6, margin: 0 }}>
            Wir haben eine Bestätigungsmail an <strong style={{ color: "#fff" }}>{email}</strong> gesendet.
            Klick auf den Link um dein Konto zu aktivieren.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div style={{ marginBottom: 32 }}>
        <img src="/glev-lockup.png" alt="glev" style={{ height: 44, width: "auto" }} />
      </div>

      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 20,
          padding: "36px 32px",
          maxWidth: 420,
          width: "100%",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div
            style={{
              display: "inline-block",
              background: "rgba(79,110,247,0.12)",
              border: "1px solid rgba(79,110,247,0.3)",
              borderRadius: 8,
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 600,
              color: "#4F6EF7",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 12,
            }}
          >
            7 Tage kostenlos
          </div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#fff",
              margin: "0 0 8px",
              letterSpacing: "-0.02em",
            }}
          >
            Konto erstellen
          </h1>
          <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0 }}>
            Keine Kreditkarte erforderlich.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input
            type="text"
            placeholder="Vorname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="email"
            placeholder="E-Mail-Adresse"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Passwort (min. 8 Zeichen)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />

          {error && (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                background: "rgba(255,45,120,0.08)",
                border: "1px solid rgba(255,45,120,0.25)",
                borderRadius: 8,
                color: "#FF7AA8",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              background: loading ? "rgba(79,110,247,0.6)" : hover ? ACCENT_HOVER : ACCENT,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "16px 24px",
              fontSize: 16,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              fontFamily: "inherit",
              marginTop: 4,
              transition: "background 120ms ease",
            }}
          >
            {loading ? "Wird erstellt…" : "7 Tage kostenlos starten"}
          </button>
        </form>

        {/* Footer links */}
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: TEXT_DIM, margin: "0 0 8px" }}>
            Bereits ein Konto?{" "}
            <Link href="/login" style={{ color: ACCENT, textDecoration: "none" }}>
              Anmelden
            </Link>
          </p>
          <p style={{ fontSize: 12, color: TEXT_FAINT ?? "rgba(255,255,255,0.3)", margin: 0, lineHeight: 1.5 }}>
            Mit der Registrierung akzeptierst du unsere{" "}
            <Link href="/legal/agb" style={{ color: "rgba(255,255,255,0.4)", textDecoration: "underline" }}>
              AGB
            </Link>{" "}
            und{" "}
            <Link href="/datenschutz" style={{ color: "rgba(255,255,255,0.4)", textDecoration: "underline" }}>
              Datenschutzerklärung
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "14px 16px",
  fontSize: 15,
  color: "#fff",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
