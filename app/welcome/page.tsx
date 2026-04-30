"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
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

type VerifyState =
  | { kind: "verifying" }
  | { kind: "valid"; email: string | null }
  | { kind: "invalid"; reason: string };

// Page-level default export wraps the inner component in Suspense.
// Required by Next.js App Router because useSearchParams() forces the
// route into client-side rendering at request time. Without the Suspense
// boundary, Vercel's static prerender pass for /welcome fails with
// "useSearchParams() should be wrapped in a suspense boundary".
export default function WelcomePage() {
  return (
    <Suspense fallback={<WelcomeFallback />}>
      <WelcomeInner />
    </Suspense>
  );
}

// Lightweight fallback that mirrors the shell of the real page so the
// transition into the verifying state doesn't flash an empty viewport.
function WelcomeFallback() {
  const t = useTranslations("marketing");
  return (
    <main style={{
      minHeight: "100vh", background: BG,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 32 }}>
          <GlevLockup size={44} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em" }}>
            {t("welcome_subtitle")}
          </div>
        </div>
        <div style={{
          background: SURFACE, borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.07)", padding: 28,
          textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: 13,
        }}>
          {t("welcome_loading")}
        </div>
      </div>
    </main>
  );
}

// Per-reason copy for the "invalid session" branch. The default fallback
// keeps the legacy "kein gültiger Beta-Zugang" text but every other branch
// surfaces a specific failure mode + a mailto support link instead of just
// throwing the user back to /beta. This matters because users who arrive
// via the email resume link days/hours later may hit `not_found` if Stripe
// purged the session, or `not_paid` if they bookmarked the cancel page.
function InvalidState({ reason }: { reason: string }) {
  const t = useTranslations("marketing");
  let title = t("welcome_invalid_default_title");
  let body = t("welcome_invalid_default_body");
  let showBetaCta = true;

  if (reason === "no_session_id" || reason === "missing_session_id") {
    title = t("welcome_invalid_no_session_title");
    body = t("welcome_invalid_no_session_body");
    showBetaCta = false;
  } else if (reason === "not_found") {
    title = t("welcome_invalid_not_found_title");
    body = t("welcome_invalid_not_found_body");
    showBetaCta = false;
  } else if (reason === "not_paid") {
    title = t("welcome_invalid_not_paid_title");
    body = t("welcome_invalid_not_paid_body");
  } else if (reason === "retrieve_failed" || reason === "network") {
    title = t("welcome_invalid_network_title");
    body = t("welcome_invalid_network_body");
    showBetaCta = false;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", textAlign: "center" }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.6 }}>
        {body}
      </div>
      <a
        href="mailto:hello@glev.app?subject=Beta-Zugang%20%E2%80%94%20Welcome-Page%20Problem"
        style={{
          marginTop: 6, padding: "12px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 600,
          textAlign: "center", textDecoration: "none",
        }}
      >
        {t("welcome_support_cta")}
      </a>
      {showBetaCta && (
        <Link href="/beta" style={{
          padding: "13px",
          background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
          border: "none", borderRadius: 12,
          color: "white", fontSize: 14, fontWeight: 700,
          textAlign: "center", textDecoration: "none",
        }}>
          {t("welcome_reserve_cta")}
        </Link>
      )}
    </div>
  );
}

function WelcomeInner() {
  const t = useTranslations("marketing");
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const [verify, setVerify] = useState<VerifyState>({ kind: "verifying" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!sessionId) {
      setVerify({ kind: "invalid", reason: "no_session_id" });
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.valid) {
          setVerify({ kind: "valid", email: typeof data.email === "string" ? data.email : null });
        } else {
          setVerify({ kind: "invalid", reason: data?.reason ?? "not_paid" });
        }
      } catch {
        if (!cancelled) setVerify({ kind: "invalid", reason: "network" });
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (verify.kind !== "valid") return;
    if (!verify.email) {
      setError(t("welcome_err_email"));
      return;
    }
    if (!supabase) {
      setError(t("welcome_err_auth"));
      return;
    }
    if (password.length < 6) {
      setError(t("welcome_err_password_short"));
      return;
    }
    if (password !== confirm) {
      setError(t("welcome_err_password_mismatch"));
      return;
    }

    setSubmitting(true);

    const { data, error: authError } = await supabase.auth.signUp({
      email: verify.email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setSubmitting(false);
      return;
    }

    if (!data.session) {
      // Supabase email-confirmation flow — user must click the link in the inbox.
      setNotice(t("welcome_notice_check_email"));
      setSubmitting(false);
      return;
    }

    router.refresh();
    router.replace("/dashboard");
  }

  return (
    <main style={{
      minHeight: "100vh", background: BG,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 440 }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 32 }}>
          <GlevLockup size={44} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em" }}>
            {t("welcome_subtitle")}
          </div>
        </div>

        <div style={{ background: SURFACE, borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", padding: 28 }}>

          {verify.kind === "verifying" && (
            <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.55)", fontSize: 14 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 8 }}>
                {t("welcome_verifying")}
              </div>
              <svg width="22" height="22" viewBox="0 0 24 24" style={{ marginTop: 4 }} aria-hidden="true">
                <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3"/>
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                </path>
              </svg>
            </div>
          )}

          {verify.kind === "invalid" && (
            <InvalidState reason={verify.reason} />
          )}

          {verify.kind === "valid" && (
            <>
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 11, color: GREEN, letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>
                  {t("welcome_payment_confirmed")}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  {t("welcome_create_account")}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                  {t("welcome_choose_password")}
                </div>
              </div>

              <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{t("welcome_email_label")}</div>
                  <input
                    type="email"
                    value={verify.email ?? ""}
                    readOnly
                    style={{ ...inp, opacity: 0.7, cursor: "not-allowed" }}
                    autoComplete="email"
                  />
                </div>

                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{t("welcome_password_label")}</div>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t("welcome_password_placeholder")}
                    required
                    minLength={6}
                    disabled={submitting}
                    style={inp}
                    autoComplete="new-password"
                  />
                </div>

                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{t("welcome_password_confirm_label")}</div>
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder={t("welcome_password_confirm_placeholder")}
                    required
                    minLength={6}
                    disabled={submitting}
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

                <button type="submit" disabled={submitting || !!notice} style={{
                  padding: "13px",
                  background: submitting || notice
                    ? "rgba(255,255,255,0.06)"
                    : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                  border: "none", borderRadius: 12,
                  color: submitting || notice ? "rgba(255,255,255,0.35)" : "white",
                  fontSize: 14, fontWeight: 700,
                  cursor: submitting || notice ? "default" : "pointer",
                  transition: "all 0.15s", marginTop: 4,
                }}>
                  {submitting ? t("welcome_submitting") : t("welcome_submit")}
                </button>

                {notice && (
                  <Link href="/login" style={{
                    padding: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600,
                    textAlign: "center", textDecoration: "none",
                  }}>
                    {t("welcome_to_login")}
                  </Link>
                )}
              </form>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: "rgba(255,255,255,0.15)", letterSpacing: "0.06em" }}>
          {t("welcome_members_only")}
        </div>
      </div>
    </main>
  );
}
