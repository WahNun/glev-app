"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const ACCENT   = "#4F6EF7";
const GREEN    = "#22D3A0";
const PINK     = "#FF2D78";
const BG       = "#09090B";
const SURFACE  = "#111117";

const LOGO_NODES = [{cx:16,cy:7},{cx:25,cy:12},{cx:25,cy:20},{cx:18,cy:26},{cx:9,cy:22},{cx:7,cy:14},{cx:16,cy:16}];
const LOGO_EDGES = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[0,6],[1,6],[2,6],[3,6]];

function LogoMark() {
  const c = "#4F6EF7";
  return (
    <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="9" fill="#0F0F14"/>
      {LOGO_EDGES.map(([a, b], i) => (
        <line key={i}
          x1={LOGO_NODES[a].cx} y1={LOGO_NODES[a].cy}
          x2={LOGO_NODES[b].cx} y2={LOGO_NODES[b].cy}
          stroke={c} strokeWidth="0.9" strokeOpacity="0.55"
        />
      ))}
      {LOGO_NODES.map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy}
          r={i === 6 ? 3.5 : 2}
          fill={i === 6 ? c : `${c}40`}
          stroke={c} strokeWidth={i === 6 ? 0 : 0.8}
        />
      ))}
    </svg>
  );
}

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
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      router.push("/dashboard");

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

      router.push("/dashboard");
    }
  }

  return (
    <main style={{
      minHeight: "100vh", background: BG,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 32 }}>
          <LogoMark />
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 4 }}>Glev</div>
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
