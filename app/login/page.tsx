"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";
import GlevLockup from "@/components/GlevLockup";

const T = {
  de: {
    email: "E-MAIL",
    password: "PASSWORT",
    placeholder_email: "deine@email.de",
    submit: "Anmelden",
    submitting: "Anmelden …",
    forgot: "Passwort vergessen?",
    reset_intro: "Gib deine Email ein — wir schicken dir einen Link zum Setzen eines neuen Passworts.",
    reset_cancel: "Abbrechen",
    reset_send: "Reset-Email anfordern",
    reset_sending: "Sende …",
    reset_sent: "Gesendet ✓",
    reset_notice: "Falls ein Account mit dieser Email existiert, ist gleich eine Reset-Mail unterwegs. Schau in dein Postfach (auch Spam).",
    reset_invalid: "Bitte gib eine gültige Email-Adresse ein.",
    no_auth: "Auth-Service nicht konfiguriert.",
    no_session: "Anmeldung erfolgreich, aber keine Session zurückgegeben. Bitte erneut versuchen.",
    no_account: "Noch kein Konto?",
    register: "Jetzt registrieren",
    back: "← Zurück zur Startseite",
    apple_signin: "Mit Apple anmelden",
    apple_error: "Apple-Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
    or: "oder",
  },
  en: {
    email: "EMAIL",
    password: "PASSWORD",
    placeholder_email: "you@example.com",
    submit: "Sign In",
    submitting: "Signing in…",
    forgot: "Forgot password?",
    reset_intro: "Enter your email — we'll send you a link to set a new password.",
    reset_cancel: "Cancel",
    reset_send: "Send reset email",
    reset_sending: "Sending…",
    reset_sent: "Sent ✓",
    reset_notice: "If an account with that email exists, a reset email is on its way. Check your inbox (and spam).",
    reset_invalid: "Please enter a valid email address.",
    no_auth: "Auth service is not configured. Please contact support.",
    no_session: "Sign-in succeeded but no session was returned. Please try again.",
    no_account: "No account yet?",
    register: "Sign up",
    back: "← Back to homepage",
    apple_signin: "Sign in with Apple",
    apple_error: "Apple sign-in failed. Please try again.",
    or: "or",
  },
};

function getLocale(): "de" | "en" {
  if (typeof document === "undefined") return "de";
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const val = match?.[1];
  return val === "en" ? "en" : "de";
}

const ACCENT   = "#4F6EF7";
const GREEN    = "#22D3A0";
const PINK     = "#FF2D78";
// Brand accents stay constant across themes (per the brand spec) — surface,
// border and text colors point at the theme CSS variables in
// `app/globals.css` so this page automatically follows Light Mode (Task #42).
const BG       = "var(--bg)";
const SURFACE  = "var(--surface)";

const inp: React.CSSProperties = {
  background: "var(--input-bg)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  padding: "11px 14px",
  color: "var(--text)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "inherit",
};

export default function LoginPage() {
  const router = useRouter();
  const [locale, setLocale] = useState<"de" | "en">("de");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => { setLocale(getLocale()); }, []);

  const t = T[locale];

  // Passwort-vergessen-Flow (Inline-Mini-Form, nicht modal — bleibt im
  // gleichen Visual-Container wie der Login). Eigener Email-State, weil
  // ein User der gerade eingeloggt war und das Passwort vergessen hat
  // ggf. eine andere Email reset-en will als die im Hauptfeld klebt.
  const [showReset, setShowReset]       = useState(false);
  const [resetEmail, setResetEmail]     = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError]     = useState<string | null>(null);
  const [resetNotice, setResetNotice]   = useState<string | null>(null);

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetNotice(null);

    const target = resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setResetError(t.reset_invalid);
      return;
    }

    setResetLoading(true);
    try {
      await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
    } catch {
      // Network errors are silently swallowed — the success notice is shown
      // regardless to prevent user enumeration.
    }
    setResetLoading(false);

    // Aus Sicherheitsgründen IMMER die gleiche Bestätigung — nie verraten
    // ob die Email-Adresse in unserer DB existiert (User-Enumeration).
    setResetNotice(t.reset_notice);
    setResetEmail("");
  }

  const [appleLoading, setAppleLoading] = useState(false);

  async function handleAppleSignIn() {
    if (!supabase) { setError(t.no_auth); return; }
    setAppleLoading(true);
    setError(null);
    try {
      const { AppleSignIn, SignInScope } = await import("@capawesome/capacitor-apple-sign-in");
      const rawNonce = crypto.randomUUID();
      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(rawNonce),
      );
      const hashedNonce = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const result = await AppleSignIn.signIn({
        scopes: [SignInScope.Email, SignInScope.FullName],
        nonce: hashedNonce,
      });

      const { idToken } = result;
      if (!idToken) throw new Error("No identity token from Apple");

      const { data, error: authError } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: idToken,
        nonce: rawNonce,
      });

      if (authError) throw authError;

      if (result.givenName && data.user) {
        await supabase.from("profiles").update({
          first_name: result.givenName,
          last_name: result.familyName,
        }).eq("user_id", data.user.id);
      }

      import("@/lib/pushNotifications").then(({ syncCachedPushToken }) => {
        void syncCachedPushToken();
      }).catch(() => { /* non-fatal */ });

      window.location.replace("/dashboard");
    } catch (err) {
      console.error("[apple-signin]", err);
      setError(t.apple_error);
      setAppleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError(t.no_auth);
      return;
    }

    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (data?.session) {
      // Re-sync push token: the first registration attempt may have failed
      // with 401 if the user wasn't logged in when the native shell fired
      // the registration event. Calling here (session now established) ensures
      // the token reaches Supabase before we navigate away.
      import("@/lib/pushNotifications").then(({ syncCachedPushToken }) => {
        void syncCachedPushToken();
      }).catch(() => { /* non-fatal */ });

      // Hard redirect to /dashboard instead of a client-side router.replace.
      // This forces a full browser navigation so the auth cookies written by
      // Supabase are reliably sent with the next request. The middleware then
      // sees the valid session and serves /dashboard. Using window.location
      // also makes Playwright's waitForURL() fire correctly in e2e tests
      // (client-side router navigation is not always tracked by the browser's
      // navigation API that Playwright hooks into).
      window.location.replace("/dashboard");
    } else {
      setError(t.no_session);
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh", background: BG,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 32 }}>
          <GlevLockup size={44} />
          <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.12em" }}>
            T1D MANAGEMENT THAT LISTENS
          </div>
        </div>

        <div style={{ background: SURFACE, borderRadius: 18, border: "1px solid var(--border-soft)", padding: 28 }}>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 6, letterSpacing: "0.08em" }}>{t.email}</div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t.placeholder_email}
                required
                disabled={loading}
                style={inp}
                autoComplete="username"
              />
            </div>

            <div>
              <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 6, letterSpacing: "0.08em" }}>{t.password}</div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                disabled={loading}
                style={inp}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{
                fontSize: 13, color: PINK,
                padding: "10px 12px",
                background: `${PINK}12`,
                borderRadius: 9,
                border: `1px solid ${PINK}30`,
                lineHeight: 1.4,
              }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              padding: "13px",
              background: loading
                ? "var(--surface-soft)"
                : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
              border: "none", borderRadius: 12,
              // Active button keeps white text (readable on accent
              // gradient in both themes); disabled state borrows the
              // muted token so it greys-out correctly in Light Mode.
              color: loading ? "var(--text-faint)" : "white",
              fontSize: 14, fontWeight: 700,
              cursor: loading ? "default" : "pointer",
              transition: "all 0.15s", marginTop: 4,
            }}>
              {loading ? t.submitting : t.submit}
            </button>
          </form>

          {Capacitor.getPlatform() === "ios" && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10, margin: "4px 0 12px",
              }}>
                <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
                <span style={{ fontSize: 11, color: "var(--text-ghost)", letterSpacing: "0.06em" }}>{t.or}</span>
                <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
              </div>
              <button
                type="button"
                onClick={handleAppleSignIn}
                disabled={appleLoading}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  width: "100%", padding: "13px",
                  background: appleLoading ? "#333" : "#000",
                  border: "none", borderRadius: 12,
                  color: "#fff", fontSize: 14, fontWeight: 600,
                  cursor: appleLoading ? "default" : "pointer",
                  transition: "background 0.15s",
                  fontFamily: "inherit",
                }}
              >
                {/* Apple logo — SF-like glyph via inline SVG */}
                <svg width="22" height="27" viewBox="0 0 814 1000" fill="white" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                  <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.3 135.3-317 268.4-317 70.1 0 128.4 46.4 172.5 46.4 42.4 0 109.2-49.1 190.5-49.1 30.8 0 111.9 2.6 167.1 98.3zm-180.5-114.9c-34.6 40.6-92.7 71.4-148.8 71.4-7.7 0-15.4-.6-22.4-2 0-4.5.7-9 .7-13.4 0-38.9 18.6-79.9 50.9-110.7 32.3-30.8 83.2-53.3 127.4-55.3 1.3 7.7 1.9 15.4 1.9 22.4 0 37.6-16 77.9-9.7 87.6z"/>
                </svg>
                {appleLoading ? "…" : t.apple_signin}
              </button>
            </div>
          )}

          {/* Passwort-vergessen-Einstieg + Inline-Form. Toggle-Link unter
              dem Sign-In-Button, expandiert in-place — kein Modal, kein
              Page-Wechsel. Reset-Email läuft über Supabase und landet
              zurück auf /auth/confirm wo der Recovery-Link verarbeitet wird. */}
          <div style={{
            marginTop: 18, paddingTop: 16,
            borderTop: "1px solid var(--border-soft)",
          }}>
            {!showReset ? (
              <button
                type="button"
                onClick={() => { setShowReset(true); setResetError(null); setResetNotice(null); }}
                style={{
                  background: "transparent", border: "none", padding: 0,
                  color: "var(--text-muted)", fontSize: 13,
                  cursor: "pointer", fontFamily: "inherit",
                  textDecoration: "underline",
                  textDecorationColor: "var(--text-ghost)",
                  textUnderlineOffset: 3,
                  width: "100%", textAlign: "center",
                }}
              >
                {t.forgot}
              </button>
            ) : (
              <form onSubmit={handleResetRequest} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {t.reset_intro}
                </div>

                <input
                  type="email"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  placeholder={t.placeholder_email}
                  required
                  autoFocus
                  disabled={resetLoading || !!resetNotice}
                  style={inp}
                  autoComplete="email"
                />

                {resetError && (
                  <div style={{
                    fontSize: 12, color: PINK,
                    padding: "8px 10px",
                    background: `${PINK}12`,
                    borderRadius: 8,
                    border: `1px solid ${PINK}30`,
                    lineHeight: 1.4,
                  }}>
                    {resetError}
                  </div>
                )}

                {resetNotice && (
                  <div style={{
                    fontSize: 12, color: GREEN,
                    padding: "8px 10px",
                    background: `${GREEN}10`,
                    borderRadius: 8,
                    border: `1px solid ${GREEN}30`,
                    lineHeight: 1.4,
                  }}>
                    {resetNotice}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReset(false);
                      setResetError(null);
                      setResetNotice(null);
                      setResetEmail("");
                    }}
                    disabled={resetLoading}
                    style={{
                      flex: "0 0 auto",
                      padding: "10px 14px",
                      background: "var(--surface-soft)",
                      border: "1px solid var(--border)",
                      borderRadius: 9,
                      color: "var(--text-muted)",
                      fontSize: 13, fontWeight: 500,
                      cursor: resetLoading ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {t.reset_cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading || !!resetNotice}
                    style={{
                      flex: 1,
                      padding: "10px 14px",
                      background: (resetLoading || !!resetNotice)
                        ? "var(--surface-soft)"
                        : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                      border: "none", borderRadius: 9,
                      // White stays constant on the active accent gradient;
                      // disabled state borrows the muted token.
                      color: (resetLoading || !!resetNotice) ? "var(--text-faint)" : "white",
                      fontSize: 13, fontWeight: 700,
                      cursor: (resetLoading || !!resetNotice) ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {resetLoading ? t.reset_sending : resetNotice ? t.reset_sent : t.reset_send}
                  </button>
                </div>
              </form>
            )}
          </div>

        </div>

        <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: "var(--text-muted)" }}>
          {t.no_account}{" "}
          <Link
            href="/#pricing"
            style={{ color: "#4F6EF7", textDecoration: "none", fontWeight: 600 }}
          >
            {t.register}
          </Link>
        </div>

        <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>
          <Link
            href="/"
            style={{ color: "var(--text-muted)", textDecoration: "none", fontWeight: 500 }}
          >
            {t.back}
          </Link>
        </div>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 10, color: "var(--text-ghost)", letterSpacing: "0.12em" }}>
          GLEV — T1D MANAGEMENT THAT LISTENS
        </div>

      </div>
    </main>
  );
}
