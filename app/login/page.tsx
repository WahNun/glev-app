"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import GlevLockup from "@/components/GlevLockup";

const ACCENT   = "#4F6EF7";
const GREEN    = "#22D3A0";
const PINK     = "#FF2D78";
const BG       = "#09090B";
const SURFACE  = "#111117";

const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "11px 14px",
  color: "white",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "inherit",
};

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab]           = useState<"signin" | "signup">("signin");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);

  function switchTab(t: "signin" | "signup") {
    setTab(t);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!supabase) {
      setError("Auth service is not configured. Please contact support.");
      return;
    }

    setLoading(true);

    if (tab === "signin") {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      console.log("SESSION:", data?.session);

      if (data?.session) {
        router.refresh();
        router.replace("/dashboard");
      } else {
        setError("Sign-in succeeded but no session was returned. Please try again.");
        setLoading(false);
      }

    } else {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        setNotice("Account created! Check your email to confirm, then sign in.");
        setTab("signin");
        setPassword("");
        setLoading(false);
        return;
      }

      router.refresh();
      router.replace("/dashboard");
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
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em" }}>
            INSULIN DECISION SUPPORT
          </div>
        </div>

        <div style={{ background: SURFACE, borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", padding: 28 }}>

          <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 4, marginBottom: 24 }}>
            {(["signin", "signup"] as const).map(t => (
              <button key={t} onClick={() => switchTab(t)} style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
                cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: tab === t ? ACCENT : "transparent",
                color: tab === t ? "white" : "rgba(255,255,255,0.4)",
                transition: "all 0.15s",
              }}>
                {t === "signin" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>EMAIL</div>
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
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>PASSWORD</div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                disabled={loading}
                style={inp}
                autoComplete={tab === "signin" ? "current-password" : "new-password"}
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

            {notice && (
              <div style={{
                fontSize: 13, color: GREEN,
                padding: "10px 12px",
                background: `${GREEN}12`,
                borderRadius: 9,
                border: `1px solid ${GREEN}30`,
                lineHeight: 1.4,
              }}>
                {notice}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              padding: "13px",
              background: loading
                ? "rgba(255,255,255,0.06)"
                : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
              border: "none", borderRadius: 12,
              color: loading ? "rgba(255,255,255,0.35)" : "white",
              fontSize: 14, fontWeight: 700,
              cursor: loading ? "default" : "pointer",
              transition: "all 0.15s", marginTop: 4,
            }}>
              {loading
                ? (tab === "signin" ? "Signing in…" : "Creating account…")
                : (tab === "signin" ? "Sign In" : "Create Account")}
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: "rgba(255,255,255,0.15)", letterSpacing: "0.06em" }}>
          MEMBERS ONLY · PRIVATE BETA
        </div>
      </div>
    </main>
  );
}
