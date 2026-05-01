"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Lockup from "@/components/landing/Lockup";
import { ACCENT, BORDER, MINT, SURFACE, TEXT_DIM } from "@/components/landing/tokens";

// Pro flow note: this page replaces the previously-static success screen so
// it can verify the Stripe Checkout Session before promising the user that
// their card is on file. Shape mirrors /welcome (Beta) — same verifying →
// valid / invalid states — but with copy that fits Pro's "trial, no charge
// until launch day" narrative instead of Beta's "you're in".

const BG = "#09090B";
const PINK = "#FF2D78";
const TRIAL_END_DISPLAY = "1. Juli 2026";

type VerifyState =
  | { kind: "verifying" }
  | { kind: "valid"; email: string | null }
  | { kind: "invalid"; reason: string };

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
        if (res.ok && data.valid && data.feature === "pro_subscription") {
          setVerify({ kind: "valid", email: typeof data.email === "string" ? data.email : null });
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
      {verify.kind === "valid" && <ValidCard email={verify.email} />}
    </PageShell>
  );
}

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

function VerifyingCard() {
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
        STRIPE-SESSION WIRD GEPRÜFT …
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

// Mirrors /welcome's InvalidState — same set of `reason` codes, same
// support-link fallback — but the recovery CTAs lead back into the /pro
// funnel instead of /beta because that's the product the user just bought.
function InvalidCard({ reason }: { reason: string }) {
  let title = "Diese Bestätigungs-Seite ist nicht aufrufbar.";
  let body =
    "Sie ist nur nach erfolgreichem Pro-Checkout über Stripe zu sehen. Falls du gerade gezahlt hast und das hier siehst, schreib uns an hello@glev.app — wir helfen sofort.";
  let showProCta = true;

  if (reason === "no_session_id" || reason === "missing_session_id") {
    title = "Link unvollständig";
    body =
      "Es fehlt die Session-ID in der URL. Klicke noch einmal auf den \"Registrierung abschließen\"-Button in deiner Bestätigungs-Email.";
    showProCta = false;
  } else if (reason === "not_found") {
    title = "Session konnte nicht geladen werden";
    body =
      "Stripe kennt diese Checkout-Session nicht (mehr). Das passiert sehr selten, und am schnellsten lösen wir das per Email — meld dich kurz bei hello@glev.app, wir bestätigen deine Mitgliedschaft dann manuell.";
    showProCta = false;
  } else if (reason === "not_paid") {
    title = "Checkout noch nicht abgeschlossen";
    body =
      "Diese Stripe-Session wurde gestartet, aber dein Karten-Setup ist noch nicht durchgelaufen. Falls das ein Versehen war, kannst du unten neu starten — oder schreib uns an hello@glev.app, wenn du sicher bist dass alles geklappt hat.";
  } else if (reason === "retrieve_failed" || reason === "network") {
    title = "Verbindung zu Stripe hat nicht geklappt";
    body =
      "Bitte lade die Seite in ein paar Sekunden neu. Wenn das wiederholt fehlschlägt, melde dich bei hello@glev.app — wir helfen schnell weiter.";
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
        {title}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.55)",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        {body}
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
        Schreib uns: hello@glev.app
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
          Pro-Mitgliedschaft erneut starten
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
          ← zurück zur Mitgliedschafts-Seite
        </Link>
      )}
      <noscript>
        <span style={{ fontSize: 12, color: PINK, textAlign: "center", display: "block" }}>
          JavaScript ist nötig, um die Stripe-Session zu prüfen.
        </span>
      </noscript>
    </div>
  );
}

function ValidCard({ email }: { email: string | null }) {
  return (
    <>
      <div
        aria-hidden
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
        Deine Mitgliedschaft ist angelegt.
      </h1>

      <p style={{ fontSize: 17, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
        Schön dass du dabei bist. Deine Karte ist hinterlegt, abgebucht wird erst am{" "}
        {TRIAL_END_DISPLAY} — bis dahin nichts.
      </p>

      {email && (
        <p style={{ fontSize: 13, color: TEXT_DIM, margin: 0 }}>
          Bestätigung geht an <strong style={{ color: "#fff" }}>{email}</strong>.
        </p>
      )}

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
          Was jetzt passiert
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>Bestätigung von Stripe per Email (Mitgliedschaft angelegt, keine Abbuchung).</li>
          <li>App-Zugang am {TRIAL_END_DISPLAY} — wir melden uns zwei Wochen vorher.</li>
          <li>Erste monatliche Abbuchung am {TRIAL_END_DISPLAY} (€24,90).</li>
          <li>Kündigung jederzeit vor Launch — einfach an hello@glev.app schreiben.</li>
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
        Fragen? Schreib uns →
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
        ← zurück zur Mitgliedschafts-Seite
      </Link>
    </>
  );
}
