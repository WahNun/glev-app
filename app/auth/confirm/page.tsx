"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useLocale } from "next-intl";
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

type ReactivationStatus = "idle" | "loading" | "sent" | "alreadyActivated" | "error";

type Strings = {
  loadingMoment: string;
  passwordFormTitle: string;
  passwordFormSub: string;
  labelNewPassword: string;
  labelRepeat: string;
  btnSaving: string;
  btnSave: string;
  savedTitle: string;
  savedRedirect: string;
  invalidTitle: string;
  linkUsedTitle: string;
  backToLogin: string;
  toLogin: string;
  errAuthService: string;
  errMinLength: string;
  errMismatch: string;
  errNoLink: string;
  errNoLinkInitial: string;
  errExpiredUsed: string;
  errLinkAlreadyUsed: string;
  btnRequestNewLink: string;
  btnRequestingNewLink: string;
  newLinkSentTitle: string;
  newLinkSentBody: string;
  newLinkError: string;
  alreadyActivated: string;
  copyForType: {
    invite:   { title: string; sub: string; cta: string };
    recovery: { title: string; sub: string; cta: string };
    email:    { title: string; sub: string; cta: string };
    magiclink:{ title: string; sub: string; cta: string };
    default:  { title: string; sub: string; cta: string };
  };
};

const DE: Strings = {
  loadingMoment: "Einen Moment …",
  passwordFormTitle: "Neues Passwort setzen",
  passwordFormSub: "Wähle ein Passwort mit mindestens 6 Zeichen.",
  labelNewPassword: "NEUES PASSWORT",
  labelRepeat: "WIEDERHOLEN",
  btnSaving: "Speichere …",
  btnSave: "Passwort speichern",
  savedTitle: "Passwort aktualisiert ✓",
  savedRedirect: "Du wirst zum Login weitergeleitet …",
  invalidTitle: "Link ungültig oder abgelaufen",
  linkUsedTitle: "Link bereits verwendet",
  backToLogin: "Zurück zum Login",
  toLogin: "Zum Login →",
  errAuthService: "Auth-Service nicht konfiguriert.",
  errMinLength: "Passwort muss mindestens 6 Zeichen lang sein.",
  errMismatch: "Die beiden Passwörter stimmen nicht überein.",
  errNoLink: "Kein gültiger Bestätigungs-Link — bitte fordere einen neuen Reset-Link an.",
  errNoLinkInitial: "Kein gültiger Bestätigungs-Link — bitte fordere einen neuen Link an.",
  errExpiredUsed: "Dieser Reset-Link ist abgelaufen oder wurde bereits verwendet. Bitte fordere einen neuen an.",
  errLinkAlreadyUsed: "Dieser Link wurde bereits verwendet. Falls du per SMS und Email je einen Link erhalten hast, wurde das Konto bereits über den ersten Klick aktiviert. Bitte logge dich direkt ein.",
  btnRequestNewLink: "Neuen Aktivierungslink anfordern",
  btnRequestingNewLink: "Sende neuen Link …",
  newLinkSentTitle: "Neuer Link gesendet ✓",
  newLinkSentBody: "Prüfe deinen Email-Posteingang.",
  newLinkError: "Fehler beim Senden. Bitte versuche es erneut oder schreibe uns.",
  alreadyActivated: "Dein Konto ist bereits aktiv — bitte logge dich direkt ein.",
  copyForType: {
    invite: {
      title: "Account einrichten",
      sub: "Du wurdest zu Glev eingeladen. Klicke unten, um deinen Account zu aktivieren und dein Passwort zu setzen.",
      cta: "Account einrichten",
    },
    recovery: {
      title: "Passwort zurücksetzen",
      sub: "Klicke unten, um fortzufahren und ein neues Passwort zu vergeben.",
      cta: "Passwort zurücksetzen",
    },
    email: {
      title: "Email bestätigen",
      sub: "Klicke unten, um deine Email-Adresse zu bestätigen.",
      cta: "Email bestätigen",
    },
    magiclink: {
      title: "Anmelden",
      sub: "Klicke unten, um dich anzumelden.",
      cta: "Jetzt anmelden",
    },
    default: {
      title: "Bestätigung",
      sub: "Klicke unten, um fortzufahren.",
      cta: "Fortfahren",
    },
  },
};

const EN: Strings = {
  loadingMoment: "One moment …",
  passwordFormTitle: "Set a new password",
  passwordFormSub: "Choose a password with at least 6 characters.",
  labelNewPassword: "NEW PASSWORD",
  labelRepeat: "CONFIRM PASSWORD",
  btnSaving: "Saving …",
  btnSave: "Save password",
  savedTitle: "Password updated ✓",
  savedRedirect: "You'll be redirected to login …",
  invalidTitle: "Link invalid or expired",
  linkUsedTitle: "Link already used",
  backToLogin: "Back to login",
  toLogin: "Go to login →",
  errAuthService: "Auth service not configured.",
  errMinLength: "Password must be at least 6 characters.",
  errMismatch: "The two passwords don't match.",
  errNoLink: "No valid confirmation link — please request a new reset link.",
  errNoLinkInitial: "No valid confirmation link — please request a new link.",
  errExpiredUsed: "This reset link has expired or has already been used. Please request a new one.",
  errLinkAlreadyUsed: "This link has already been used. If you received both an SMS and an email link, your account was activated on the first click. Please log in directly.",
  btnRequestNewLink: "Request new activation link",
  btnRequestingNewLink: "Sending new link …",
  newLinkSentTitle: "New link sent ✓",
  newLinkSentBody: "Check your email inbox.",
  newLinkError: "Error sending link. Please try again or contact us.",
  alreadyActivated: "Your account is already active — please log in directly.",
  copyForType: {
    invite: {
      title: "Set up your account",
      sub: "You've been invited to Glev. Click below to activate your account and set your password.",
      cta: "Set up account",
    },
    recovery: {
      title: "Reset your password",
      sub: "Click below to continue and set a new password.",
      cta: "Reset password",
    },
    email: {
      title: "Confirm your email",
      sub: "Click below to confirm your email address.",
      cta: "Confirm email",
    },
    magiclink: {
      title: "Sign in",
      sub: "Click below to sign in.",
      cta: "Sign in now",
    },
    default: {
      title: "Confirm",
      sub: "Click below to continue.",
      cta: "Continue",
    },
  },
};

/**
 * Per Magic-Link-Type the right user-facing copy & CTA. Used on the
 * pre-verify "Account einrichten"-Schritt, der den Mail-Scanner-Bug
 * (Outlook/Mimecast verbrennen den OTP vorab) aushebelt.
 */
function copyForType(
  type: string,
  C: Strings,
): { title: string; sub: string; cta: string } {
  switch (type) {
    case "invite":    return C.copyForType.invite;
    case "recovery":  return C.copyForType.recovery;
    case "signup":
    case "email":     return C.copyForType.email;
    case "magiclink": return C.copyForType.magiclink;
    default:          return C.copyForType.default;
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
    <Suspense fallback={<Shell><LoadingMark /></Shell>}>
      <ConfirmInner />
    </Suspense>
  );
}

/**
 * Branded loading indicator — the Glev icon mark breathes (CSS .glev-pulse)
 * while we resolve the link. Used both for the Suspense fallback and the
 * "verifying" state so the user never sees a blank/plain-text flash that
 * reads like an error during the ~1s setSession() round-trip.
 */
function LoadingMark() {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;
  return (
    <div style={{ textAlign: "center", padding: "26px 0" }}>
      <Image
        src="/icon.svg"
        alt="Glev"
        width={56}
        height={56}
        priority
        className="glev-pulse"
        style={{ display: "block", margin: "0 auto 18px" }}
      />
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", letterSpacing: "0.02em" }}>
        {C.loadingMoment}
      </div>
    </div>
  );
}

function ConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();
  const nextIntlLocale = useLocale();

  // Start im "needs_confirm"-State, NICHT direkt verifizieren.
  // Hintergrund: Mail-Scanner (Outlook Safe Links, Mimecast, Apple Privacy
  // Relay) öffnen Email-Links automatisch zur Phishing-Prüfung. Würden wir
  // verifyOtp() in einem useEffect beim Page-Mount aufrufen, würde der
  // Scanner den Einmal-Code dabei verbrennen — der echte User sähe dann
  // beim eigenen Klick "otp_expired". Lösung (Industry-Standard, siehe
  // Slack/Vercel/GitHub): Zwischenseite mit Button. Erst der menschliche
  // Klick auf "Account einrichten" ruft verifyOtp(). Mail-Scanner laden
  // zwar die Seite, klicken aber nichts → Token bleibt unverbraucht.
  const type        = params.get("type") ?? "recovery";
  const code        = params.get("code");
  const tokenHash   = params.get("token_hash");
  // Set by /auth/callback after it already exchanged the code server-side.
  // The session is live in cookies; we skip straight to the password form.
  const sessionReady = params.get("session") === "ready";
  const hasParams   = Boolean(code || tokenHash || sessionReady);
  // ?lang= from the provisioning redirectTo — overrides next-intl cookie/header locale
  // so users arriving from a German SMS link always see German even when roaming abroad.
  const langParam   = params.get("lang");
  const locale = (langParam === "de" || langParam === "en") ? langParam : nextIntlLocale;
  const C = locale === "en" ? EN : DE;
  // ?email= injected by provisioning redirectTo — used to pre-fill the reactivation flow
  // when a link has expired and the user needs a new activation email.
  const emailParam  = params.get("email");

  // Implicit/hash recovery flow: Supabase redirects to
  // /auth/confirm#access_token=…&type=recovery (or #error_code=otp_expired on a
  // used/expired link). detectSessionInUrl is DISABLED on this page (lib/supabase.ts),
  // so the SDK does NOT auto-process the hash here and PASSWORD_RECOVERY never fires.
  // We detect + process the hash manually in the effect below. Start in "verifying"
  // when a recovery hash is present so the user never sees a false "invalid" flash.
  const hasRecoveryHash =
    typeof window !== "undefined" &&
    /(?:^|#|&)(access_token|error_code|error)=/.test(window.location.hash);

  const [state, setState] = useState<State>(
    sessionReady
      ? { kind: "ready" }
      : hasParams
        ? { kind: "needs_confirm" }
        // When no query params: we don't know yet whether the hash contains a
        // recovery token (hash is only readable client-side). Always start as
        // "verifying" so the user never sees a false "Link not valid" flash
        // during SSR or hydration. The useEffect below sets the real state.
        : { kind: "verifying" },
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [reactivationStatus, setReactivationStatus] = useState<ReactivationStatus>("idle");
  const [reactivationError, setReactivationError]   = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setState({ kind: "invalid", reason: C.errAuthService });
      return;
    }

    // Implicit/hash recovery flow. Supabase redirects to
    // /auth/confirm#access_token=…&refresh_token=…&type=recovery (or
    // #error=…&error_code=otp_expired on an expired/used link).
    //
    // IMPORTANT: detectSessionInUrl is DISABLED on /auth/confirm (lib/supabase.ts)
    // so the SDK does NOT consume the hash here and PASSWORD_RECOVERY never fires
    // on its own — an onAuthStateChange listener alone is a no-op on this page.
    // We therefore process the hash MANUALLY: parse the tokens and call
    // setSession() ourselves, then show the password form. (For the ?code /
    // ?token_hash flows hasParams is true and we keep the button-gated flow that
    // protects the OTP from mail-scanners.)
    if (!hasParams) {
      const raw = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
      const hp = new URLSearchParams(raw);
      const accessToken  = hp.get("access_token");
      const refreshToken = hp.get("refresh_token");
      const errCode      = hp.get("error_code") || hp.get("error");
      const hashType     = hp.get("type");

      // Belt-and-suspenders: if a session ever arrives via the SDK/setSession,
      // surface the form too. Guard SIGNED_IN for signup/email confirmations:
      // those navigate to /onboarding instead of showing the password form.
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          setState((s) => (s.kind === "ready" ? s : { kind: "ready" }));
        }
        if (event === "SIGNED_IN" && hashType !== "signup" && hashType !== "email") {
          setState((s) => (s.kind === "ready" ? s : { kind: "ready" }));
        }
      });

      if (errCode) {
        setState({
          kind: "invalid",
          reason: C.errExpiredUsed,
          linkUsed: true,
        });
      } else if (accessToken && refreshToken) {
        setState({ kind: "verifying" });
        supabase.auth
          .setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ error: se }) => {
            if (se) {
              setState({ kind: "invalid", reason: se.message });
            } else {
              if (hashType === "signup" || hashType === "email") {
                router.replace("/onboarding");
                return;
              }
              setState({ kind: "ready" });
              // Strip the token hash from the address bar.
              if (typeof window !== "undefined") {
                window.history.replaceState(
                  null,
                  "",
                  window.location.pathname + window.location.search,
                );
              }
            }
          })
          .catch((e) =>
            setState({ kind: "invalid", reason: e instanceof Error ? e.message : String(e) }),
          );
      } else {
        // No hash params found either — genuinely no valid link.
        // Transition from "verifying" (initial state) to "invalid" now that we know.
        setState({ kind: "invalid", reason: C.errNoLinkInitial });
      }

      return () => subscription.unsubscribe();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirmClick() {
    if (!supabase) {
      setState({ kind: "invalid", reason: C.errAuthService });
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
        throw new Error(C.errNoLink);
      }

      // Trial bei Meta-Lead-Invites aktivieren — Token direkt aus der
      // frischen Session, nicht via getSession() das evtl. noch null liefert.
      activateTrial(sessionToken);

      if (type === "signup" || type === "email") {
        // Email-Confirmation: User hat beim /signup bereits ein Passwort gesetzt.
        // Passwort-Form überspringen — direkt zum Onboarding.
        router.replace("/onboarding");
        return;
      }
      setState({ kind: "ready" }); // invite / recovery → Passwort-Form
    } catch (err) {
      if (isLinkAlreadyUsed(err)) {
        setState({
          kind: "invalid",
          reason: C.errLinkAlreadyUsed,
          linkUsed: true,
        });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setState({ kind: "invalid", reason: msg });
      }
    }
  }

  async function handleRequestNewLink() {
    if (!emailParam) return;
    setReactivationStatus("loading");
    setReactivationError(null);
    try {
      const res = await fetch("/api/auth/reactivate-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailParam, locale }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        setReactivationStatus("error");
        setReactivationError(typeof data.error === "string" ? data.error : C.newLinkError);
      } else if (data.alreadyActivated) {
        setReactivationStatus("alreadyActivated");
      } else {
        setReactivationStatus("sent");
      }
    } catch {
      setReactivationStatus("error");
      setReactivationError(C.newLinkError);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError(C.errAuthService);
      return;
    }
    if (password.length < 6) {
      setError(C.errMinLength);
      return;
    }
    if (password !== confirm) {
      setError(C.errMismatch);
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
      router.replace("/login");
    }, 900);
  }

  return (
    <Shell>
      {state.kind === "needs_confirm" && (() => {
        const c = copyForType(type, C);
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

      {state.kind === "verifying" && <LoadingMark />}

      {state.kind === "invalid" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: state.linkUsed ? "rgba(255,255,255,0.85)" : PINK, marginBottom: 10 }}>
            {state.linkUsed ? C.linkUsedTitle : C.invalidTitle}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 18 }}>
            {state.reason}
          </div>

          {/* Reactivation flow — only when email is in URL and account not yet used */}
          {emailParam && !state.linkUsed && reactivationStatus !== "sent" && reactivationStatus !== "alreadyActivated" && (
            <button
              type="button"
              onClick={handleRequestNewLink}
              disabled={reactivationStatus === "loading"}
              style={{
                width: "100%",
                padding: "13px",
                background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                border: "none",
                borderRadius: 12,
                color: "white",
                fontSize: 14,
                fontWeight: 700,
                cursor: reactivationStatus === "loading" ? "not-allowed" : "pointer",
                opacity: reactivationStatus === "loading" ? 0.7 : 1,
                marginBottom: 12,
                transition: "all 0.15s",
              }}
            >
              {reactivationStatus === "loading" ? C.btnRequestingNewLink : C.btnRequestNewLink}
            </button>
          )}

          {reactivationStatus === "sent" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: GREEN, marginBottom: 4 }}>
                {C.newLinkSentTitle}
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                {C.newLinkSentBody}
              </div>
            </div>
          )}

          {reactivationStatus === "alreadyActivated" && (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 16 }}>
              {C.alreadyActivated}
            </div>
          )}

          {reactivationStatus === "error" && reactivationError && (
            <div style={{ fontSize: 13, color: PINK, marginBottom: 12 }}>
              {reactivationError}
            </div>
          )}

          <Link
            href="/login"
            style={{
              display: "inline-block",
              padding: "10px 18px",
              background: state.linkUsed || reactivationStatus === "alreadyActivated"
                ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`
                : "rgba(255,255,255,0.07)",
              borderRadius: 9,
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {state.linkUsed || reactivationStatus === "alreadyActivated" ? C.toLogin : C.backToLogin}
          </Link>
        </div>
      )}

      {(state.kind === "ready" || state.kind === "saving") && (
        <form onSubmit={handleSetPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "white", marginBottom: 4 }}>
            {C.passwordFormTitle}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 8 }}>
            {C.passwordFormSub}
          </div>

          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{C.labelNewPassword}</div>
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
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{C.labelRepeat}</div>
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
            {state.kind === "saving" ? C.btnSaving : C.btnSave}
          </button>
        </form>
      )}

      {state.kind === "saved" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: GREEN, marginBottom: 8 }}>
            {C.savedTitle}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
            {C.savedRedirect}
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
            T1D MANAGEMENT THAT LISTENS
          </div>
        </div>
        <div style={{ background: SURFACE, borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", padding: 28 }}>
          {children}
        </div>
      </div>
    </main>
  );
}
