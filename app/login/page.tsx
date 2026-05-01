"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import GlevLockup from "@/components/GlevLockup";

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
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

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

    if (!supabase) {
      setResetError("Auth-Service nicht konfiguriert.");
      return;
    }

    const target = resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setResetError("Bitte gib eine gültige Email-Adresse ein.");
      return;
    }

    // redirectTo MUSS in Supabase Dashboard → Auth → URL Configuration
    // → "Redirect URLs" whitelisted sein, sonst lehnt Supabase ab.
    // Wir benutzen NEXT_PUBLIC_APP_URL damit Dev (Replit-URL) und Prod
    // (glev.app) automatisch korrekt routen.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    if (!appUrl) {
      setResetError("App-URL nicht konfiguriert. Bitte Support kontaktieren.");
      return;
    }

    setResetLoading(true);
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${appUrl}/auth/confirm`,
    });

    setResetLoading(false);

    if (resetErr) {
      setResetError(resetErr.message);
      return;
    }

    // Aus Sicherheitsgründen IMMER die gleiche Bestätigung — nie verraten
    // ob die Email-Adresse in unserer DB existiert (User-Enumeration).
    setResetNotice(
      "Falls ein Account mit dieser Email existiert, ist gleich eine Reset-Mail unterwegs. Schau in dein Postfach (auch Spam).",
    );
    setResetEmail("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError("Auth service is not configured. Please contact support.");
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
      router.refresh();
      router.replace("/dashboard");
    } else {
      setError("Sign-in succeeded but no session was returned. Please try again.");
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
            INSULIN DECISION SUPPORT
          </div>
        </div>

        <div style={{ background: SURFACE, borderRadius: 18, border: "1px solid var(--border-soft)", padding: 28 }}>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 6, letterSpacing: "0.08em" }}>EMAIL</div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                style={inp}
                autoComplete="email"
              />
            </div>

            <div>
              <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 6, letterSpacing: "0.08em" }}>PASSWORD</div>
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
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

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
                Passwort vergessen?
              </button>
            ) : (
              <form onSubmit={handleResetRequest} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Gib deine Email ein — wir schicken dir einen Link zum Setzen eines neuen Passworts.
                </div>

                <input
                  type="email"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
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
                    Abbrechen
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
                    {resetLoading ? "Sende …" : resetNotice ? "Gesendet ✓" : "Reset-Email anfordern"}
                  </button>
                </div>
              </form>
            )}
          </div>

        </div>

        {/* Login ist ausschließlich für bereits registrierte Beta-Member.
            Account-Erstellung läuft über den bezahlten Beta-/Pro-Flow auf
            der Startseite — daher hier KEIN „Sign up"-CTA. Stattdessen ein
            neutraler Rückweg, falls jemand versehentlich auf /login landet. */}
        <div style={{ textAlign: "center", marginTop: 18, fontSize: 12, color: "var(--text-faint)" }}>
          <Link
            href="/"
            style={{ color: "var(--text-muted)", textDecoration: "none", fontWeight: 500 }}
          >
            ← Zurück zur Startseite
          </Link>
        </div>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 10, color: "var(--text-ghost)", letterSpacing: "0.06em" }}>
          MEMBERS ONLY · PRIVATE BETA
        </div>
      </div>
    </main>
  );
}
