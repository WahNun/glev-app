"use client";

/**
 * /signup — Public free-trial signup page (no credit card required).
 *
 * Flow:
 *   1. User enters name + email + password  → supabase.auth.signUp()
 *   2. Profile data form (phone, DOB, CGM)  → saved via auth.updateUser()
 *   3. "Check your email" confirmation screen
 *
 * This page is intentionally NOT behind the auth gate.
 * Paid users who land here (wrong link) are redirected to /dashboard.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/fb-capi-client";
import {
  ACCENT,
  ACCENT_HOVER,
  BG,
  BORDER,
  SURFACE,
  TEXT_DIM,
  TEXT_FAINT,
} from "@/components/landing/tokens";

type Step = "signup" | "profile" | "success";

const SENSOR_OPTIONS = [
  { value: "dexcom_g7",    label: "Dexcom G7" },
  { value: "dexcom_g6",    label: "Dexcom G6" },
  { value: "dexcom_one",   label: "Dexcom ONE / ONE+" },
  { value: "libre3",       label: "FreeStyle Libre 3" },
  { value: "libre2",       label: "FreeStyle Libre 2" },
  { value: "libre1",       label: "FreeStyle Libre 1" },
  { value: "medtronic",    label: "Medtronic Guardian" },
  { value: "eversense",    label: "Eversense E3" },
  { value: "other",        label: "Anderer Sensor" },
  { value: "none",         label: "Kein Sensor" },
];

export default function SignupPage() {
  const router = useRouter();

  // Step 1 — account
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 — profile data
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [usesCgm, setUsesCgm] = useState<"ja" | "nein" | null>(null);
  const [sensorType, setSensorType] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Meta — captured in Step 1, used for CRM notification in Step 2
  const [userId, setUserId] = useState<string | null>(null);
  const [trialEndAt, setTrialEndAt] = useState<string | null>(null);
  const [signedUpAt] = useState<string>(() => new Date().toISOString());

  const [step, setStep] = useState<Step>("signup");
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

  // ── Step 1: Create account ──────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setLoading(true);

    try {
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

      setUserId(data.user.id);

      // Set trial_end_at
      const session = data.session;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const trialRes = await fetch("/api/auth/free-trial", { method: "POST", headers }).catch((e) => {
        console.warn("[signup] trial API call failed:", e);
        return null;
      });
      if (trialRes?.ok) {
        const trialData = (await trialRes.json().catch(() => null)) as { trial_end_at?: string } | null;
        if (trialData?.trial_end_at) setTrialEndAt(trialData.trial_end_at);
      }

      // Pixel Lead event (Browser) — CAPI parallel via trackEvent
      if (typeof window !== "undefined" && (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq) {
        (window as unknown as { fbq: (...args: unknown[]) => void }).fbq("track", "Lead");
      }
      // Server CAPI Lead — fire-and-forget, blockiert nicht den Step-Wechsel
      const nameParts = name.trim().split(/\s+/);
      trackEvent(
        {
          email,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(" ") || undefined,
          country: "de",
        },
        {
          eventName: "Lead",
          contentName: "Glev Pro Trial",
          contentIds: ["glev-pro-monthly"],
          contentType: "product",
        },
      ).catch(() => {/* fire-and-forget */});

      // → Step 2 (profile data) regardless of whether email confirm is needed
      setStep("profile");
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setLoading(false);
    }
  }

  // ── Step 2: Save profile data ───────────────────────────────────────
  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) {
      setProfileError("Bitte gib deine Telefonnummer ein.");
      return;
    }
    setProfileLoading(true);

    try {
      if (supabase) {
        // Save extra fields into auth user metadata — no DB migration needed.
        // Can be promoted to a proper profiles column later via migration.
        await supabase.auth.updateUser({
          data: {
            phone: phone || null,
            date_of_birth: dob || null,
            uses_cgm: usesCgm === "ja",
            sensor_type: usesCgm === "ja" ? (sensorType || null) : null,
          },
        }).catch((e) => console.warn("[signup] profile update failed:", e));
      }

      // CAPI StartTrial — phone + name jetzt bekannt (Step 2 vollständig)
      {
        const nameParts = name.trim().split(/\s+/);
        trackEvent(
          {
            email,
            phone: phone || undefined,
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(" ") || undefined,
            country: "de",
          },
          {
            eventName: "StartTrial",
            value: 14.9,
            currency: "EUR",
            contentName: "Glev Pro Trial",
            contentIds: ["glev-pro-monthly"],
            contentType: "product",
          },
        ).catch(() => {/* fire-and-forget */});
      }

      // Fire-and-forget CRM notification — all form data + meta fields
      if (userId) {
        fetch("/api/crm/signup-notification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name:          name || null,
            email,
            phone:         phone || null,
            date_of_birth: dob   || null,
            uses_cgm:      usesCgm === "ja" ? true : usesCgm === "nein" ? false : null,
            sensor_type:   usesCgm === "ja" ? (sensorType || null) : null,
            user_id:       userId,
            trial_end_at:  trialEndAt,
            signed_up_at:  signedUpAt,
            plan:          "free-trial-7d",
            source_url:    typeof window !== "undefined" ? document.referrer || window.location.href : null,
            locale:        typeof window !== "undefined" ? navigator.language : null,
            user_agent:    typeof window !== "undefined" ? navigator.userAgent : null,
          }),
        }).catch((e) => console.warn("[signup] CRM notification failed:", e));
      }
    } finally {
      setStep("success");
      setProfileLoading(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────────────
  if (step === "success") {
    return (
      <main style={centerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#fff", margin: "0 0 12px" }}>
            Bestätige deine E-Mail
          </h1>
          <p style={{ fontSize: 15, color: TEXT_DIM, lineHeight: 1.6, margin: 0 }}>
            Wir haben eine Bestätigungsmail an{" "}
            <strong style={{ color: "#fff" }}>{email}</strong> gesendet.
            Klick auf den Link um dein Konto zu aktivieren.
          </p>
          <p style={{ fontSize: 13, color: TEXT_DIM, lineHeight: 1.5, margin: "12px 0 0" }}>
            Nichts da? Check deinen{" "}
            <strong style={{ color: "#fff" }}>Spam- oder Junk-Ordner</strong>{" "}
            und such nach <strong style={{ color: "#fff" }}>info@glev.app</strong>.
          </p>
        </div>
      </main>
    );
  }

  // ── Step 2: Profile data form ───────────────────────────────────────
  if (step === "profile") {
    return (
      <main style={centerStyle}>
        <div style={{ marginBottom: 32 }}>
          <img src="/glev-lockup.png" alt="glev" style={{ height: 44, width: "auto" }} />
        </div>

        <div style={{ ...cardStyle, textAlign: "left" }}>
          {/* Progress indicator */}
          <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 99,
                  background: i === 0
                    ? ACCENT
                    : "rgba(255,255,255,0.12)",
                }}
              />
            ))}
          </div>

          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 6px" }}>
              Schritt 2 von 2
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "0 0 4px", letterSpacing: "-0.02em" }}>
              Noch ein paar Angaben
            </h1>
            <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0 }}>
              Damit wir Glev besser auf dich abstimmen können.
            </p>
          </div>

          <form onSubmit={handleProfileSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Phone */}
            <div>
              <input
                type="tel"
                placeholder="Telefonnummer"
                value={phone}
                required
                onChange={(e) => { setPhone(e.target.value); setProfileError(null); }}
                autoComplete="tel"
                style={{ ...inputStyle, borderColor: profileError ? "rgba(255,80,80,0.6)" : undefined }}
              />
              {profileError && (
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ff8888" }}>{profileError}</p>
              )}
            </div>

            {/* Date of birth */}
            <div>
              <label style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 500, display: "block", marginBottom: 6 }}>
                Geburtsdatum
              </label>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                style={{ ...inputStyle, colorScheme: "dark" }}
              />
            </div>

            {/* CGM yes/no */}
            <div>
              <label style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 500, display: "block", marginBottom: 8 }}>
                Nutzt du einen CGM-Sensor?
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["ja", "nein"] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      setUsesCgm(val);
                      if (val === "nein") setSensorType("none");
                    }}
                    style={{
                      flex: 1,
                      padding: "12px 0",
                      borderRadius: 10,
                      border: `1px solid ${usesCgm === val ? ACCENT : "rgba(255,255,255,0.1)"}`,
                      background: usesCgm === val ? "rgba(79,110,247,0.15)" : "rgba(255,255,255,0.04)",
                      color: usesCgm === val ? "#fff" : TEXT_DIM,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textTransform: "capitalize",
                      transition: "all 120ms ease",
                    }}
                  >
                    {val === "ja" ? "Ja" : "Nein"}
                  </button>
                ))}
              </div>
            </div>

            {/* Sensor type — only when CGM = ja */}
            {usesCgm === "ja" && (
              <div>
                <label style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 500, display: "block", marginBottom: 6 }}>
                  Welchen Sensor nutzt du?
                </label>
                <select
                  value={sensorType}
                  onChange={(e) => setSensorType(e.target.value)}
                  style={{
                    ...inputStyle,
                    appearance: "none",
                    WebkitAppearance: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="" disabled>Sensor auswählen…</option>
                  {SENSOR_OPTIONS.filter((o) => o.value !== "none").map((o) => (
                    <option key={o.value} value={o.value} style={{ background: "#1a1f2e" }}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={profileLoading}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              style={{
                background: profileLoading ? "rgba(79,110,247,0.6)" : hover ? ACCENT_HOVER : ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "16px 24px",
                fontSize: 16,
                fontWeight: 600,
                cursor: profileLoading ? "default" : "pointer",
                fontFamily: "inherit",
                marginTop: 4,
                transition: "background 120ms ease",
              }}
            >
              {profileLoading ? "Wird gespeichert…" : "Weiter →"}
            </button>

            {/* Skip link */}
            <button
              type="button"
              onClick={() => setStep("success")}
              style={{
                background: "none",
                border: "none",
                color: TEXT_DIM,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "center",
                padding: "4px 0",
              }}
            >
              Überspringen
            </button>
          </form>
        </div>
      </main>
    );
  }

  // ── Step 1: Account creation ────────────────────────────────────────
  return (
    <main style={centerStyle}>
      <div style={{ marginBottom: 32 }}>
        <img src="/glev-lockup.png" alt="glev" style={{ height: 44, width: "auto" }} />
      </div>

      <div style={cardStyle}>
        {/* Progress indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 99,
                background: i === 0 ? ACCENT : "rgba(255,255,255,0.12)",
              }}
            />
          ))}
        </div>

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

const centerStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: BG,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
};

const cardStyle: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 20,
  padding: "36px 32px",
  maxWidth: 420,
  width: "100%",
};

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
