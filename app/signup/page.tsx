"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import GlevLockup from "@/components/GlevLockup";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";

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

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) { setError("Auth-Service nicht konfiguriert."); return; }
    setLoading(true);
    setError(null);

    const { data, error: signUpErr } = await supabase.auth.signUp({ email, password });

    if (signUpErr || !data.session) {
      setLoading(false);
      setError(signUpErr?.message ?? "Registrierung fehlgeschlagen.");
      return;
    }

    try {
      await fetch("/api/auth/free-trial", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
    } catch {
    }

    router.push("/onboarding");
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: "24px",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <Link href="/" style={{ display: "inline-block", textDecoration: "none", color: "inherit" }}>
            <GlevLockup size={28} />
          </Link>
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "28px 24px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 11px",
              borderRadius: 999,
              background: `${GREEN}14`,
              border: `1px solid ${GREEN}30`,
              color: GREEN,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 20,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 99, background: GREEN }} />
            7 Tage kostenlos
          </div>

          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text)",
              margin: "0 0 6px",
            }}
          >
            Konto erstellen
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-dim)", margin: "0 0 24px", lineHeight: 1.5 }}>
            Keine Kreditkarte nötig — 7 Tage vollen Zugriff, danach Free-Tier.
          </p>

          <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label
                htmlFor="email"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}
              >
                E-Mail-Adresse
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="deine@email.de"
                style={inp}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}
              >
                Passwort
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mindestens 8 Zeichen"
                style={inp}
              />
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  padding: "10px 12px",
                  background: "rgba(255,45,120,0.08)",
                  border: "1px solid rgba(255,45,120,0.3)",
                  borderRadius: 8,
                  color: "#FF7AA8",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                background: loading ? `${ACCENT}99` : ACCENT,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "13px 20px",
                fontSize: 15,
                fontWeight: 700,
                cursor: loading ? "default" : "pointer",
                fontFamily: "inherit",
                transition: "background 120ms",
              }}
            >
              {loading ? "Einen Moment…" : "Kostenlos starten"}
            </button>
          </form>

          <p style={{ marginTop: 20, fontSize: 13, color: "var(--text-dim)", textAlign: "center" }}>
            Bereits ein Konto?{" "}
            <Link href="/login" style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}>
              Anmelden
            </Link>
          </p>
        </div>

        <p style={{ marginTop: 20, fontSize: 11, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.5 }}>
          Kein Medizinprodukt. Alle Empfehlungen sind Gesprächsgrundlage für dein Diabetologen-Team.
        </p>
      </div>
    </main>
  );
}
