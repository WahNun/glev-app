"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import GlevLockup from "@/components/GlevLockup";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const BG      = "#09090B";
const SURFACE = "#111117";

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

type State =
  | { kind: "verifying" }
  | { kind: "ready" }
  | { kind: "invalid"; reason: string }
  | { kind: "saving" }
  | { kind: "saved" };

/**
 * /auth/confirm — universeller Landing-Endpoint für Magic-Links die
 * der User über Supabase-Emails empfängt:
 *   - Recovery (Passwort vergessen)  → type=recovery
 *   - Email-Confirmation             → type=email / type=signup
 *   - Invite (falls jemals aktiviert) → type=invite
 *
 * Unterstützt beide Link-Formate die Supabase ausstellen kann:
 *   1) PKCE / neuer Stil:  ?code=…&type=recovery
 *      → exchangeCodeForSession(code) etabliert Session
 *   2) Token-Hash / OTP:   ?token_hash=…&type=recovery
 *      → verifyOtp({ token_hash, type }) etabliert Session
 *
 * Sobald Session steht: zeigt Passwort-Setup-Form, ruft updateUser({ password }),
 * redirected nach /dashboard. Das gleiche Flow funktioniert für recovery
 * (User setzt NEUES Passwort) genauso wie für invite (User setzt ERSTES Passwort).
 *
 * Für die Suspense-Wrapper-Begründung siehe app/welcome/page.tsx — gleicher
 * Grund: useSearchParams() erzwingt Client-Rendering, ohne Suspense-Boundary
 * würde die Vercel-Static-Prerender-Pass scheitern.
 */
export default function ConfirmPage() {
  return (
    <Suspense fallback={<Shell><CenterDim>Lädt …</CenterDim></Shell>}>
      <ConfirmInner />
    </Suspense>
  );
}

function ConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [state, setState] = useState<State>({ kind: "verifying" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!supabase) {
      setState({ kind: "invalid", reason: "Auth-Service nicht konfiguriert." });
      return;
    }

    const code      = params.get("code");
    const tokenHash = params.get("token_hash");
    const type      = params.get("type") ?? "recovery";

    (async () => {
      try {
        if (code) {
          const { error: ex } = await supabase!.auth.exchangeCodeForSession(code);
          if (ex) throw ex;
        } else if (tokenHash) {
          const { error: vo } = await supabase!.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as "recovery" | "invite" | "email" | "signup" | "email_change" | "magiclink",
          });
          if (vo) throw vo;
        } else {
          throw new Error("Kein gültiger Bestätigungs-Link — bitte fordere einen neuen Reset-Link an.");
        }

        if (cancelled) return;
        setState({ kind: "ready" });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ kind: "invalid", reason: msg });
      }
    })();

    return () => { cancelled = true; };
  }, [params]);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError("Auth-Service nicht konfiguriert.");
      return;
    }
    if (password.length < 6) {
      setError("Passwort muss mindestens 6 Zeichen lang sein.");
      return;
    }
    if (password !== confirm) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }

    setState({ kind: "saving" });

    const { error: updateErr } = await supabase.auth.updateUser({ password });

    if (updateErr) {
      setError(updateErr.message);
      setState({ kind: "ready" });
      return;
    }

    setState({ kind: "saved" });
    setTimeout(() => {
      router.refresh();
      router.replace("/dashboard");
    }, 900);
  }

  return (
    <Shell>
      {state.kind === "verifying" && (
        <CenterDim>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 8 }}>
            BESTÄTIGE LINK
          </div>
          <div>Einen Moment …</div>
        </CenterDim>
      )}

      {state.kind === "invalid" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: PINK, marginBottom: 10 }}>
            Link ungültig oder abgelaufen
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 22 }}>
            {state.reason}
          </div>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              padding: "10px 18px",
              background: "rgba(255,255,255,0.07)",
              borderRadius: 9,
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Zurück zum Login
          </Link>
        </div>
      )}

      {(state.kind === "ready" || state.kind === "saving") && (
        <form onSubmit={handleSetPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "white", marginBottom: 4 }}>
            Neues Passwort setzen
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 8 }}>
            Wähle ein Passwort mit mindestens 6 Zeichen.
          </div>

          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>NEUES PASSWORT</div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoFocus
              disabled={state.kind === "saving"}
              style={inp}
              autoComplete="new-password"
            />
          </div>

          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>WIEDERHOLEN</div>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              disabled={state.kind === "saving"}
              style={inp}
              autoComplete="new-password"
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

          <button type="submit" disabled={state.kind === "saving"} style={{
            padding: "13px",
            background: state.kind === "saving"
              ? "rgba(255,255,255,0.06)"
              : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            border: "none", borderRadius: 12,
            color: state.kind === "saving" ? "rgba(255,255,255,0.35)" : "white",
            fontSize: 14, fontWeight: 700,
            cursor: state.kind === "saving" ? "default" : "pointer",
            transition: "all 0.15s", marginTop: 4,
          }}>
            {state.kind === "saving" ? "Speichere …" : "Passwort speichern"}
          </button>
        </form>
      )}

      {state.kind === "saved" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: GREEN, marginBottom: 8 }}>
            Passwort aktualisiert ✓
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
            Du wirst zum Dashboard weitergeleitet …
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
          {children}
        </div>
      </div>
    </main>
  );
}

function CenterDim({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.55)", fontSize: 14 }}>
      {children}
    </div>
  );
}
