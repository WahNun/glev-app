"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import Lockup from "@/components/landing/Lockup";
import { ACCENT, BORDER, MINT, SURFACE, TEXT_DIM } from "@/components/landing/tokens";
import { supabase } from "@/lib/supabase";

// Pro flow note: this page replaces the previously-static success screen so
// it can verify the Stripe Checkout Session before promising the user that
// their card is on file. Shape mirrors /welcome (Beta) — same verifying →
// valid / invalid states — but with copy that fits Pro's "trial, no charge
// until launch day" narrative instead of Beta's "you're in".

const BG = "#09090B";
const PINK = "#FF2D78";
const TRIAL_END_DISPLAY_DE = "1. Juli 2026";
const TRIAL_END_DISPLAY_EN = "July 1, 2026";

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

type InvalidReasonCopy = { title: string; body: string };

type Copy = {
  verifying: string;
  // InvalidCard
  invalid: {
    default: InvalidReasonCopy;
    no_session_id: InvalidReasonCopy;
    not_found: InvalidReasonCopy;
    not_paid: InvalidReasonCopy;
    network: InvalidReasonCopy;
  };
  invalidEmail: string;
  invalidRetry: string;
  invalidBack: string;
  noScript: string;
  // ValidCard
  checkmark_label: string;
  heading: (tierName: string) => string;
  intro: (trialEnd: string) => React.ReactNode;
  confirmationTo: string;
  spamHint: (senderEmail: string) => React.ReactNode;
  // Auth sub-card
  authChecking: string;
  alreadySignedIn: string;
  toDashboard: string;
  signupHeading: string;
  signupSub: (email: string) => string;
  passwordPlaceholder: string;
  confirmPlaceholder: string;
  submitIdle: string;
  submitting: string;
  alreadyRegistered: string;
  loginLink: string;
  // "What happens next" card
  nextHeading: string;
  nextItems: (trialEnd: string, firstChargeAmount: string, tierName: string) => React.ReactNode[];
  // Errors (handleSignup)
  errAuthUnavailable: string;
  errNoEmail: string;
  errTooShort: string;
  errPasswordMismatch: string;
  errExistingWrongPassword: string;
  // Footer links
  contactLink: string;
  backLink: string;
};

const DE: Copy = {
  verifying: "STRIPE-SESSION WIRD GEPRÜFT …",
  invalid: {
    default: {
      title: "Diese Bestätigungs-Seite ist nicht aufrufbar.",
      body: "Sie ist nur nach erfolgreichem Pro-Checkout über Stripe zu sehen. Falls du gerade gezahlt hast und das hier siehst, schreib uns an hello@glev.app — wir helfen sofort.",
    },
    no_session_id: {
      title: "Link unvollständig",
      body: 'Es fehlt die Session-ID in der URL. Klicke noch einmal auf den "Registrierung abschließen"-Button in deiner Bestätigungs-Email.',
    },
    not_found: {
      title: "Session konnte nicht geladen werden",
      body: "Stripe kennt diese Checkout-Session nicht (mehr). Das passiert sehr selten, und am schnellsten lösen wir das per Email — meld dich kurz bei hello@glev.app, wir bestätigen deine Mitgliedschaft dann manuell.",
    },
    not_paid: {
      title: "Checkout noch nicht abgeschlossen",
      body: "Diese Stripe-Session wurde gestartet, aber dein Karten-Setup ist noch nicht durchgelaufen. Falls das ein Versehen war, kannst du unten neu starten — oder schreib uns an hello@glev.app, wenn du sicher bist dass alles geklappt hat.",
    },
    network: {
      title: "Verbindung zu Stripe hat nicht geklappt",
      body: "Bitte lade die Seite in ein paar Sekunden neu. Wenn das wiederholt fehlschlägt, melde dich bei hello@glev.app — wir helfen schnell weiter.",
    },
  },
  invalidEmail: "Schreib uns: hello@glev.app",
  invalidRetry: "Pro-Mitgliedschaft erneut starten",
  invalidBack: "← zurück zur Mitgliedschafts-Seite",
  noScript: "JavaScript ist nötig, um die Stripe-Session zu prüfen.",
  checkmark_label: "Bestätigt",
  heading: (tierName) => `Deine ${tierName}-Mitgliedschaft ist angelegt.`,
  intro: (trialEnd) => (
    <>
      Schön dass du dabei bist. Du kannst die Web-App{" "}
      <strong style={{ color: "#fff" }}>ab sofort</strong> nutzen. Deine Karte ist
      hinterlegt, abgebucht wird erst am {trialEnd} — bis dahin nichts.
    </>
  ),
  confirmationTo: "Bestätigung geht an",
  spamHint: (senderEmail) => (
    <>
      Nichts in der Inbox? Schau im{" "}
      <strong style={{ color: "#fff" }}>Spam-/Junk-Ordner</strong>{" "}
      und such nach <strong style={{ color: "#fff" }}>{senderEmail}</strong>.
    </>
  ),
  authChecking: "Status wird geprüft …",
  alreadySignedIn: "Du bist bereits angemeldet.",
  toDashboard: "Zum Dashboard →",
  signupHeading: "Passwort wählen, um die Registrierung abzuschließen",
  signupSub: (email) => `Mindestens 6 Zeichen. Du loggst dich später mit ${email} ein.`,
  passwordPlaceholder: "Passwort",
  confirmPlaceholder: "Passwort wiederholen",
  submitIdle: "Registrierung abschließen",
  submitting: "Wird gespeichert …",
  alreadyRegistered: "Schon registriert?",
  loginLink: "Hier einloggen",
  nextHeading: "Was jetzt passiert",
  nextItems: (trialEnd, firstChargeAmount, tierName) => [
    "Bestätigung von Stripe per Email (Mitgliedschaft angelegt, keine Abbuchung).",
    <><strong style={{ color: "#fff" }}>Web-App jetzt verfügbar</strong> — logge dich ein und leg los.</>,
    `iOS & Android App im App Store ab ${trialEnd} — wir melden uns zwei Wochen vorher.`,
    `Erste monatliche Abbuchung am ${trialEnd} (${firstChargeAmount} für ${tierName}).`,
    "Kündigung jederzeit vor Launch — einfach an hello@glev.app schreiben.",
  ],
  errAuthUnavailable: "Auth-System ist gerade nicht erreichbar. Bitte später erneut versuchen.",
  errNoEmail: "Keine Email zur Stripe-Session gefunden. Schreib uns an hello@glev.app.",
  errTooShort: "Bitte mindestens 6 Zeichen wählen.",
  errPasswordMismatch: "Die Passwörter stimmen nicht überein.",
  errExistingWrongPassword:
    "Diese Email ist bereits registriert. Bitte logge dich auf /login mit deinem bestehenden Passwort ein.",
  contactLink: "Fragen? Schreib uns →",
  backLink: "← zurück zur Mitgliedschafts-Seite",
};

const EN: Copy = {
  verifying: "VERIFYING STRIPE SESSION …",
  invalid: {
    default: {
      title: "This confirmation page is not accessible.",
      body: "It is only shown after a successful Pro checkout via Stripe. If you just paid and you're seeing this, write to us at hello@glev.app — we'll sort it out straight away.",
    },
    no_session_id: {
      title: "Incomplete link",
      body: 'The session ID is missing from the URL. Click the "Complete registration" button in your confirmation email again.',
    },
    not_found: {
      title: "Session could not be loaded",
      body: "Stripe no longer recognises this checkout session. This is very rare — the quickest fix is an email to hello@glev.app and we'll confirm your membership manually.",
    },
    not_paid: {
      title: "Checkout not yet completed",
      body: "This Stripe session was started but your card setup didn't go through. If that was a mistake, you can restart below — or write to hello@glev.app if you're sure everything worked.",
    },
    network: {
      title: "Could not reach Stripe",
      body: "Please reload the page in a few seconds. If this keeps happening, contact hello@glev.app — we'll help quickly.",
    },
  },
  invalidEmail: "Contact us: hello@glev.app",
  invalidRetry: "Restart Pro membership",
  invalidBack: "← back to membership page",
  noScript: "JavaScript is required to verify the Stripe session.",
  checkmark_label: "Confirmed",
  heading: (tierName) => `Your ${tierName} membership is set up.`,
  intro: (trialEnd) => (
    <>
      Great to have you on board. You can use the web app{" "}
      <strong style={{ color: "#fff" }}>right now</strong>. Your card is on file — the
      first charge is on {trialEnd}, nothing until then.
    </>
  ),
  confirmationTo: "Confirmation sent to",
  spamHint: (senderEmail) => (
    <>
      Nothing in your inbox? Check your{" "}
      <strong style={{ color: "#fff" }}>spam / junk folder</strong>{" "}
      and search for <strong style={{ color: "#fff" }}>{senderEmail}</strong>.
    </>
  ),
  authChecking: "Checking status …",
  alreadySignedIn: "You are already signed in.",
  toDashboard: "Go to dashboard →",
  signupHeading: "Choose a password to complete registration",
  signupSub: (email) => `At least 6 characters. You'll sign in later with ${email}.`,
  passwordPlaceholder: "Password",
  confirmPlaceholder: "Repeat password",
  submitIdle: "Complete registration",
  submitting: "Saving …",
  alreadyRegistered: "Already registered?",
  loginLink: "Sign in here",
  nextHeading: "What happens next",
  nextItems: (trialEnd, firstChargeAmount, tierName) => [
    "Stripe confirmation by email (membership created, no charge).",
    <><strong style={{ color: "#fff" }}>Web app available now</strong> — sign in and get started.</>,
    `iOS & Android app in the App Store from ${trialEnd} — we'll reach out two weeks before.`,
    `First monthly charge on ${trialEnd} (${firstChargeAmount} for ${tierName}).`,
    "Cancel any time before launch — just write to hello@glev.app.",
  ],
  errAuthUnavailable: "Auth system is currently unavailable. Please try again later.",
  errNoEmail: "No email found for this Stripe session. Write to hello@glev.app.",
  errTooShort: "Please choose at least 6 characters.",
  errPasswordMismatch: "The passwords do not match.",
  errExistingWrongPassword:
    "This email is already registered. Please sign in at /login with your existing password.",
  contactLink: "Questions? Write to us →",
  backLink: "← back to membership page",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VerifyState =
  | { kind: "verifying" }
  | { kind: "valid"; email: string | null; feature: "pro_subscription" | "plus_subscription" }
  | { kind: "invalid"; reason: string };

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function ProSuccessPage() {
  return (
    <Suspense fallback={<SuccessFallback />}>
      <ProSuccessInner />
    </Suspense>
  );
}

// Lightweight loading shell — same chrome as the verifying state so the
// hand-off doesn't flash an empty viewport.
function SuccessFallback() {
  return (
    <PageShell>
      <VerifyingCard />
    </PageShell>
  );
}

function ProSuccessInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [verify, setVerify] = useState<VerifyState>({ kind: "verifying" });

  useEffect(() => {
    let cancelled = false;

    if (!sessionId) {
      setVerify({ kind: "invalid", reason: "no_session_id" });
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        // /pro/success is the Pro confirmation page — accept any valid
        // session that carries the `pro_subscription` feature tag (set by
        // both /api/checkout/pro and /api/pro/checkout). This works for
        // both pre-launch trial sessions (kind: "subscription_trial") AND
        // post-launch immediate-charge subscriptions (kind: "paid"), so
        // the page won't break the moment trials stop being viable. The
        // feature tag — not just `kind` — keeps Beta sessions from being
        // accepted here even though they're also "paid" subscriptions.
        if (res.ok && data.valid && (data.feature === "pro_subscription" || data.feature === "plus_subscription")) {
          setVerify({
            kind: "valid",
            email: typeof data.email === "string" ? data.email : null,
            feature: data.feature,
          });
        } else {
          setVerify({ kind: "invalid", reason: data?.reason ?? "not_paid" });
        }
      } catch {
        if (!cancelled) setVerify({ kind: "invalid", reason: "network" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <PageShell>
      {verify.kind === "verifying" && <VerifyingCard />}
      {verify.kind === "invalid" && <InvalidCard reason={verify.reason} />}
      {verify.kind === "valid" && <ValidCard email={verify.email} feature={verify.feature} />}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: "#fff",
        padding: "64px 20px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 24,
        }}
      >
        <Lockup width={180} />
        {children}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// VerifyingCard
// ---------------------------------------------------------------------------

function VerifyingCard() {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 28,
        width: "100%",
        color: TEXT_DIM,
        fontSize: 14,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.35)",
          letterSpacing: "0.1em",
          marginBottom: 8,
        }}
      >
        {C.verifying}
      </div>
      <svg width="22" height="22" viewBox="0 0 24 24" style={{ marginTop: 4 }} aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          fill="none"
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InvalidCard
// Mirrors /welcome's InvalidState — same set of `reason` codes, same
// support-link fallback — but the recovery CTAs lead back into the /pro
// funnel instead of /beta because that's the product the user just bought.
// ---------------------------------------------------------------------------

function InvalidCard({ reason }: { reason: string }) {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  let copy = C.invalid.default;
  let showProCta = true;

  if (reason === "no_session_id" || reason === "missing_session_id") {
    copy = C.invalid.no_session_id;
    showProCta = false;
  } else if (reason === "not_found") {
    copy = C.invalid.not_found;
    showProCta = false;
  } else if (reason === "not_paid") {
    copy = C.invalid.not_paid;
  } else if (reason === "retrieve_failed" || reason === "network") {
    copy = C.invalid.network;
    showProCta = false;
  }

  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 28,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", textAlign: "center" }}>
        {copy.title}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.55)",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        {copy.body}
      </div>
      <a
        href="mailto:hello@glev.app?subject=Pro-Mitgliedschaft%20%E2%80%94%20Success-Page%20Problem"
        style={{
          marginTop: 6,
          padding: "12px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          color: "rgba(255,255,255,0.85)",
          fontSize: 13,
          fontWeight: 600,
          textAlign: "center",
          textDecoration: "none",
        }}
      >
        {C.invalidEmail}
      </a>
      {showProCta && (
        <Link
          href="/pro"
          style={{
            padding: "13px",
            background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            border: "none",
            borderRadius: 12,
            color: "white",
            fontSize: 14,
            fontWeight: 700,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          {C.invalidRetry}
        </Link>
      )}
      {!showProCta && (
        <Link
          href="/pro"
          style={{
            color: TEXT_DIM,
            fontSize: 12,
            textDecoration: "none",
            textAlign: "center",
            marginTop: 4,
          }}
        >
          {C.invalidBack}
        </Link>
      )}
      <noscript>
        <span style={{ fontSize: 12, color: PINK, textAlign: "center", display: "block" }}>
          {C.noScript}
        </span>
      </noscript>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ValidCard
// AuthState models the three sub-states inside the "valid Stripe session"
// branch:
//   - "checking"      — we don't yet know if the buyer has a Supabase Auth
//                       row for this email. Renders a slim spinner so we
//                       don't flash the wrong UI.
//   - "needs_signup"  — no Supabase user exists for this email yet → show
//                       the password-setup form so the buyer can finish
//                       account creation. This is the load-bearing state
//                       reached via the "Registrierung abschließen"-CTA in
//                       the pro-welcome email.
//   - "signed_in"     — buyer already completed registration (either just
//                       now in this tab, or in an earlier session). Show a
//                       "back to dashboard" CTA instead of the form.
// ---------------------------------------------------------------------------

type AuthState = "checking" | "needs_signup" | "signed_in";

function ValidCard({
  email,
  feature,
}: {
  email: string | null;
  feature: "pro_subscription" | "plus_subscription";
}) {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;
  const trialEnd = locale === "en" ? TRIAL_END_DISPLAY_EN : TRIAL_END_DISPLAY_DE;

  // Tier-spezifische Copy: Pro = €19/Monat (monatlich kündbar), Plus =
  // €29/Monat (Lifetime-Lock — Preis bleibt für immer derselbe). Beide
  // landen auf dieser Seite, weil /api/checkout/plus auf das gleiche
  // success_url zeigt wie /api/checkout/pro.
  const isPlus = feature === "plus_subscription";
  const firstChargeAmount = isPlus ? "€29" : "€19";
  const tierName = isPlus ? "Glev+" : "Glev Pro";
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // On mount: ask Supabase whether this browser already carries a session
  // for the buyer's email. If yes → skip the signup form. If no (or the
  // session belongs to a different email) → show the form so they can set
  // a password and link this Stripe purchase to a Supabase Auth user.
  useEffect(() => {
    if (!supabase) {
      setAuthState("needs_signup");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const sameEmail =
        data?.user?.email && email
          ? data.user.email.toLowerCase() === email.toLowerCase()
          : false;
      setAuthState(sameEmail ? "signed_in" : "needs_signup");
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!supabase) {
      setError(C.errAuthUnavailable);
      return;
    }
    if (!email) {
      setError(C.errNoEmail);
      return;
    }
    if (password.length < 6) {
      setError(C.errTooShort);
      return;
    }
    if (password !== confirm) {
      setError(C.errPasswordMismatch);
      return;
    }
    setSubmitting(true);

    // Server-side user creation with email_confirm: true — no Supabase
    // confirmation email is sent. The buyer already proved email ownership
    // by completing Stripe Checkout, so a second confirmation is redundant.
    const regRes = await fetch("/api/pro/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const regData = await regRes.json().catch(() => ({}));

    if (!regRes.ok) {
      const msg: string = regData?.error ?? "Unbekannter Fehler";
      if (/already|duplicate|email_exists/i.test(msg)) {
        // User exists — try to sign in with the supplied password.
        // Falls through to signInWithPassword below.
      } else if (msg === "password_too_short") {
        setError(C.errTooShort);
        setSubmitting(false);
        return;
      } else {
        setError(msg);
        setSubmitting(false);
        return;
      }
    }

    // Sign in immediately — no email confirmation step needed.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      if (regData?.existed) {
        // Existing account + wrong password → direct to login.
        setError(C.errExistingWrongPassword);
      } else {
        setError(signInError.message);
      }
      setSubmitting(false);
      return;
    }

    router.refresh();
    router.replace("/dashboard");
  }

  return (
    <>
      <div
        aria-label={C.checkmark_label}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(34,211,160,0.12)",
          border: `1px solid ${MINT}`,
          color: MINT,
          display: "grid",
          placeItems: "center",
          fontSize: 26,
        }}
      >
        ✓
      </div>

      <h1
        style={{
          fontSize: 36,
          lineHeight: 1.1,
          letterSpacing: "-0.03em",
          fontWeight: 700,
          margin: 0,
        }}
      >
        {C.heading(tierName)}
      </h1>

      <p style={{ fontSize: 17, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
        {C.intro(trialEnd)}
      </p>

      {email && (
        <p style={{ fontSize: 13, color: TEXT_DIM, margin: 0 }}>
          {C.confirmationTo} <strong style={{ color: "#fff" }}>{email}</strong>.
        </p>
      )}
      {email && (
        <p style={{ fontSize: 12, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
          {C.spamHint("info@glev.app")}
        </p>
      )}

      {/* Registration / dashboard sub-card — the load-bearing piece linked
          from the pro-welcome email. Three render branches keep the buyer
          oriented no matter when they click the email. */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          padding: 24,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {authState === "checking" && (
          <div style={{ fontSize: 13, color: TEXT_DIM, textAlign: "center" }}>
            {C.authChecking}
          </div>
        )}

        {authState === "signed_in" && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", textAlign: "center" }}>
              {C.alreadySignedIn}
            </div>
            <Link
              href="/dashboard"
              style={{
                padding: "13px",
                background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                border: "none",
                borderRadius: 12,
                color: "white",
                fontSize: 14,
                fontWeight: 700,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              {C.toDashboard}
            </Link>
          </>
        )}

        {authState === "needs_signup" && (
          <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", textAlign: "center" }}>
              {C.signupHeading}
            </div>
            <div style={{ fontSize: 12, color: TEXT_DIM, textAlign: "center", lineHeight: 1.5 }}>
              {(() => {
                const fallback = locale === "en" ? "your email" : "deiner Email";
                const addr = email ?? fallback;
                const full = C.signupSub(addr);
                if (!email) return full;
                const [before, ...rest] = full.split(email);
                return (
                  <>
                    {before}
                    <strong style={{ color: "#fff" }}>{email}</strong>
                    {rest.join(email)}
                  </>
                );
              })()}
            </div>
            <input
              type="password"
              autoComplete="new-password"
              placeholder={C.passwordPlaceholder}
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              disabled={submitting}
              style={inp}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder={C.confirmPlaceholder}
              value={confirm}
              onChange={(ev) => setConfirm(ev.target.value)}
              disabled={submitting}
              style={inp}
            />
            {error && (
              <div style={{ fontSize: 12, color: PINK, textAlign: "center", lineHeight: 1.5 }}>
                {error}
              </div>
            )}
            {notice && (
              <div style={{ fontSize: 12, color: MINT, textAlign: "center", lineHeight: 1.5 }}>
                {notice}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "13px",
                background: submitting
                  ? "rgba(79,110,247,0.5)"
                  : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                border: "none",
                borderRadius: 12,
                color: "white",
                fontSize: 14,
                fontWeight: 700,
                cursor: submitting ? "default" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {submitting ? C.submitting : C.submitIdle}
            </button>
            <div style={{ fontSize: 11, color: TEXT_DIM, textAlign: "center" }}>
              {C.alreadyRegistered}{" "}
              <Link href="/login" style={{ color: ACCENT, textDecoration: "none" }}>
                {C.loginLink}
              </Link>
            </div>
          </form>
        )}
      </div>

      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          padding: 20,
          fontSize: 14,
          color: TEXT_DIM,
          textAlign: "left",
          lineHeight: 1.55,
          width: "100%",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 8 }}>
          {C.nextHeading}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {C.nextItems(trialEnd, firstChargeAmount, tierName).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>

      <Link
        href="/contact?source=pro-success"
        style={{
          color: ACCENT,
          fontSize: 14,
          textDecoration: "none",
          borderBottom: `1px solid ${ACCENT}40`,
          paddingBottom: 1,
        }}
      >
        {C.contactLink}
      </Link>

      <Link
        href="/pro"
        style={{
          color: TEXT_DIM,
          fontSize: 12,
          textDecoration: "none",
          marginTop: 8,
        }}
      >
        {C.backLink}
      </Link>
    </>
  );
}

const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  padding: "11px 14px",
  color: "#fff",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "inherit",
};
