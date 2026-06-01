"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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
  | { kind: "needs_confirm" }
  | { kind: "verifying" }
  | { kind: "ready" }
  | { kind: "invalid"; reason: string; linkUsed?: boolean }
  | { kind: "saving" }
  | { kind: "saved" };

/**
 * Per Magic-Link-Type the right user-facing copy & CTA. Used on the
 * pre-verify "Account einrichten"-Schritt, der den Mail-Scanner-Bug
 * (Outlook/Mimecast verbrennen den OTP vorab) aushebelt.
 */
function copyForType(type: string): { title: string; sub: string; cta: string } {
  switch (type) {
    case "invite":
      return {
        title: "Account einrichten",
        sub: "Du wurdest zu Glev eingeladen. Klicke unten, um deinen Account zu aktivieren und dein Passwort zu setzen.",
        cta: "Account einrichten",
      };
    case "recovery":
      return {
        title: "Passwort zurücksetzen",
        sub: "Klicke unten, um fortzufahren und ein neues Passwort zu vergeben.",
        cta: "Passwort zurücksetzen",
      };
    case "signup":
    case "email":
      return {
        title: "Email bestätigen",
        sub: "Klicke unten, um deine Email-Adresse zu bestätigen.",
        cta: "Email bestätigen",
      };
    case "magiclink":
      return {
        title: "Anmelden",
        sub: "Klicke unten, um dich anzumelden.",
        cta: "Jetzt anmelden",
      };
    default:
      return {
        title: "Bestätigung",
        sub: "Klicke unten, um fortzufahren.",
        cta: "Fortfahren",
      };
  }
}

/**
 * Erkennt ob ein Supabase-Auth-Fehler bedeutet, dass der Link schon
 * verbraucht wurde (jemand hat zuvor geklickt — SMS oder Email).
 */
function isLinkAlreadyUsed(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const code    = String(e.code    ?? "").toLowerCase();
  const message = String(e.message ?? "").toLowerCase();
  return (
    code === "otp_expired" ||
    code === "invalid_otp" ||
    message.includes("otp has expired") ||
    message.includes("otp is invalid") ||
    message.includes("token has expired") ||
    message.includes("invalid token")
  );
}

/**
 * Ruft POST /api/auth/activate-trial auf.
 * token: direkt aus verifyOtp/exchangeCodeForSession — zuverlässiger als
 * getSession() das nach dem OTP-Tausch manchmal noch null liefert.
 */
async function activateTrial(token?: string | null): Promise<void> {
  if (!supabase) return;
  try {
    // Prefer the freshly-minted token; fall back to current session.
    const accessToken =
      token ?? (await supabase.auth.getSession()).data.session?.access_token;
    await fetch("/api/auth/activate-trial", {
      method: "POST",
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  } catch {
    // silent — darf den Confirm-Flow nicht blockieren
  }
}

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

  // Start im "needs_confirm"-State, NICHT direkt verifizieren.
  // Hintergrund: Mail-Scanner (Outlook Safe Links, Mimecast, Apple Privacy
  // Relay) öffnen Email-Links automatisch zur Phishing-Prüfung. Würden wir
  // verifyOtp() in einem useEffect beim Page-Mount aufrufen, würde der
  // Scanner den Einmal-Code dabei verbrennen — der echte User sähe dann
  // beim eigenen Klick "otp_expired". Lösung (Industry-Standard, siehe
  // Slack/Vercel/GitHub): Zwischenseite mit Button. Erst der menschliche
  // Klick auf "Account einrichten" ruft verifyOtp(). Mail-Scanner laden
  // zwar die Seite, klicken aber nichts → Token bleibt unverbraucht.
  const type      = params.get("type") ?? "recovery";
  const code      = params.get("code");
  const tokenHash = params.get("token_hash");
  const hasParams = Boolean(code || tokenHash);

  const [state, setState] = useState<State>(
    hasParams ? { kind: "needs_confirm" } : { kind: "invalid", reason: "Kein gültiger Bestätigungs-Link — bitte fordere einen neuen Link an." },
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setState({ kind: "invalid", reason: "Auth-Service nicht konfiguriert." });
    }
  }, []);

  async function handleConfirmClick() {
    if (!supabase) {
      setState({ kind: "invalid", reason: "Auth-Service nicht konfiguriert." });
      return;
    }
    setState({ kind: "verifying" });
    try {
      let sessionToken: string | null = null;
      if (code) {
        const { data, error: ex } = await supabase.auth.exchangeCodeForSession(code);
        if (ex) throw ex;
        sessionToken = data.session?.access_token ?? null;
      } else if (tokenHash) {
        const { data, error: vo } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "recovery" | "invite" | "email" | "signup" | "email_change" | "magiclink",
        });
        if (vo) throw vo;
        sessionToken = data.session?.access_token ?? null;
      } else {
        throw new Error("Kein gültiger Bestätigungs-Link — bitte fordere einen neuen Reset-Link an.");
      }

      // Trial bei Meta-Lead-Invites aktivieren — Token direkt aus der
      // frischen Session, nicht via getSession() das evtl. noch null liefert.
      activateTrial(sessionToken);

      setState({ kind: "ready" });
    } catch (err) {
      if (isLinkAlreadyUsed(err)) {
        setState({
          kind: "invalid",
          reason: "Dieser Link wurde bereits verwendet. Falls du per SMS und Email je einen Link erhalten hast, wurde das Konto bereits über den ersten Klick aktiviert. Bitte logge dich direkt ein.",
          linkUsed: true,
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setState({ kind: "invalid", reason: msg });
      }
    }
  }

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

    // Zweiter Versuch: nach updateUser ist die Session garantiert frisch.
    // Idempotent — wenn bereits aktiviert passiert nichts.
    activateTrial();

    setState({ kind: "saved" });
    setTimeout(() => {
      router.refresh();
      router.replace("/dashboard");
    }, 900);
  }

  return (
    <Shell>
      {state.kind === "needs_confirm" && (() => {
        const c = copyForType(type);
        return (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em", marginBottom: 10 }}>
              GLEV
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "white", marginBottom: 10, letterSpacing: "-0.01em" }}>
              {c.title}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.55, marginBottom: 22 }}>
              {c.sub}
            </div>
            <button
              type="button"
              onClick={handleConfirmClick}
              style={{
                width: "100%",
                padding: "13px",
                background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                border: "none",
                borderRadius: 12,
                color: "white",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {c.cta}
            </button>
          </div>
        );
      })()}

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
          <div style={{ fontSize: 16, fontWeight: 600, color: state.linkUsed ? "rgba(255,255,255,0.85)" : PINK, marginBottom: 10 }}>
            {state.linkUsed ? "Link bereits verwendet" : "Link ungültig oder abgelaufen"}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 22 }}>
            {state.reason}
          </div>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              padding: "10px 18px",
              background: state.linkUsed
                ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`
                : "rgba(255,255,255,0.07)",
              borderRadius: 9,
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {state.linkUsed ? "Zum Login →" : "Zurück zum Login"}
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
          <Image src="/glev-lockup.png" alt="Glev" width={120} height={44} style={{ objectFit: "contain" }} />
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
