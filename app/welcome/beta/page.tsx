"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import GlevLockup from "@/components/GlevLockup";

/**
 * /welcome/beta — Signup-Maske für Beta-Free-Year-Empfänger:innen, die
 * vom Admin-BFY-Block (siehe app/admin/users/actions.ts grantBetaFreeYearAction)
 * brand-neu eingeladen wurden. Der Login-Link in der Welcome-Mail
 * (siehe lib/emails/beta-free-year-welcome.ts, Invite-Variante) zeigt
 * hierhin und etabliert per Supabase-Magiclink eine Session.
 *
 * Flow:
 *   1. Token-Verifikation: Supabase setzt automatisch die Session aus dem
 *      URL-Hash (#access_token=…) sobald der Magiclink aufgerufen wird.
 *      Falls stattdessen ?code=… (PKCE) ankommt, machen wir manuell ein
 *      exchangeCodeForSession.
 *   2. Wenn Session steht: zeigen wir Email read-only + Name (Pflicht) +
 *      Passwort + Bestätigung.
 *   3. Bei Submit: updateUser({ password, data: { full_name } }) UND
 *      profiles.display_name update — letzteres weil das Onboarding den
 *      Namen aktuell nicht erfasst, also ist diese Maske unsere einzige
 *      Chance, ihn zu setzen.
 *   4. Redirect → /dashboard. Onboarding triggert dort beim ersten Besuch.
 *
 * Lokalisiert via next-intl. Locale wird durch i18n/request.ts aus dem
 * NEXT_LOCALE-Cookie / Accept-Language-Header / Geo-Hinweis aufgelöst —
 * brand-neue Empfänger ohne Cookie kriegen i.d.R. die Browser-Sprache.
 *
 * Suspense-Boundary wie in app/welcome/page.tsx — useSearchParams()
 * erzwingt Client-Rendering, ohne Boundary scheitert Vercels statischer
 * Prerender.
 */
export default function WelcomeBetaPage() {
  return (
    <Suspense fallback={<Shell><CenterDim>…</CenterDim></Shell>}>
      <WelcomeBetaInner />
    </Suspense>
  );
}

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
  | { kind: "ready"; email: string | null; userId: string }
  | { kind: "invalid"; reason: string }
  | { kind: "saving"; email: string | null; userId: string }
  | { kind: "saved" };

function WelcomeBetaInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("marketing");

  const [state, setState] = useState<State>({ kind: "verifying" });
  const [name, setName]         = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!supabase) {
      setState({ kind: "invalid", reason: t("welcome_beta_invalid_no_auth") });
      return;
    }

    const code = params.get("code");

    (async () => {
      try {
        // PKCE-Variante: ?code=… → manuell tauschen.
        if (code) {
          const { error: ex } = await supabase!.auth.exchangeCodeForSession(code);
          if (ex) throw ex;
        }
        // Implicit-Variante (#access_token=…): Supabase JS hört auf den
        // Hash und legt die Session selbst ab — wir brauchen nur kurz
        // zu warten und dann getSession() abzufragen. Ein einzelner
        // Tick reicht in der Praxis, weil das supabase-js-SDK den Hash
        // synchron beim Modul-Laden parst.
        const { data: sess, error: sessErr } = await supabase!.auth.getSession();
        if (sessErr) throw sessErr;
        if (!sess.session?.user) {
          throw new Error(t("welcome_beta_invalid_no_session"));
        }
        if (cancelled) return;
        const u = sess.session.user;
        // Wenn Supabase-Metadata oder ein vorhandenes Profil schon einen
        // Namen kennt, vorbelegen — User kann editieren.
        const metaName =
          (u.user_metadata?.full_name as string | undefined) ?? "";
        if (metaName) setName(metaName);
        setState({ kind: "ready", email: u.email ?? null, userId: u.id });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ kind: "invalid", reason: msg });
      }
    })();

    return () => { cancelled = true; };
  }, [params, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError(t("welcome_beta_invalid_no_auth"));
      return;
    }
    if (state.kind !== "ready") return;

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError(t("welcome_beta_err_name_short"));
      return;
    }
    if (password.length < 6) {
      setError(t("welcome_beta_err_password_short"));
      return;
    }
    if (password !== confirm) {
      setError(t("welcome_beta_err_password_mismatch"));
      return;
    }

    setState({ kind: "saving", email: state.email, userId: state.userId });

    // (1) Passwort + full_name in user_metadata schreiben — beides in
    // einem Aufruf, damit ein Fehler nicht zu einem halben Zustand führt.
    const { error: updateErr } = await supabase.auth.updateUser({
      password,
      data: { full_name: trimmedName },
    });
    if (updateErr) {
      setError(updateErr.message);
      setState({ kind: "ready", email: state.email, userId: state.userId });
      return;
    }

    // (2) Profile.display_name nachziehen — das Admin-BFY-Setup hat eine
    // Profile-Zeile angelegt (manual_plan_override='beta', expires_at,
    // language='de'), aber display_name nur dann gefüllt, wenn der Operator
    // ihn schon im Admin-Block eingegeben hatte. Hier setzen wir den
    // User-eigenen Namen rüber. Best-effort — falls das fehlschlägt,
    // ist der Account trotzdem benutzbar (Onboarding läuft ohnehin).
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "display_name", display_name: trimmedName }),
      });
    } catch {
      // Stiller Fail — siehe oben.
    }

    setState({ kind: "saved" });
    setTimeout(() => {
      router.refresh();
      router.replace("/dashboard");
    }, 900);
  }

  const supportHref =
    `mailto:hello@glev.app?subject=${encodeURIComponent(t("welcome_beta_support_subject"))}`;

  return (
    <Shell>
      {state.kind === "verifying" && (
        <CenterDim>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 8 }}>
            {t("welcome_beta_verify_kicker")}
          </div>
          <div>{t("welcome_beta_verify_body")}</div>
        </CenterDim>
      )}

      {state.kind === "invalid" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: PINK, marginBottom: 10 }}>
            {t("welcome_beta_invalid_title")}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 22 }}>
            {state.reason}
          </div>
          <a
            href={supportHref}
            style={{
              display: "inline-block",
              padding: "10px 18px",
              background: "rgba(255,255,255,0.07)",
              borderRadius: 9,
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              marginRight: 10,
            }}
          >
            {t("welcome_beta_support_cta")}
          </a>
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
            {t("welcome_beta_login_cta")}
          </Link>
        </div>
      )}

      {(state.kind === "ready" || state.kind === "saving") && (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 11, color: GREEN, letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>
            {t("welcome_beta_kicker")}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "white", marginBottom: 2 }}>
            {t("welcome_beta_title")}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 6 }}>
            {t("welcome_beta_subtitle")}
          </div>

          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{t("welcome_beta_email_label")}</div>
            <input
              type="email"
              value={state.email ?? ""}
              readOnly
              style={{ ...inp, opacity: 0.7, cursor: "not-allowed" }}
              autoComplete="email"
            />
          </div>

          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{t("welcome_beta_name_label")}</div>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("welcome_beta_name_placeholder")}
              required
              minLength={2}
              autoFocus
              disabled={state.kind === "saving"}
              style={inp}
              autoComplete="name"
            />
          </div>

          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{t("welcome_beta_password_label")}</div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              disabled={state.kind === "saving"}
              style={inp}
              autoComplete="new-password"
            />
          </div>

          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em" }}>{t("welcome_beta_password_confirm_label")}</div>
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
            {state.kind === "saving" ? t("welcome_beta_submitting") : t("welcome_beta_submit")}
          </button>
        </form>
      )}

      {state.kind === "saved" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: GREEN, marginBottom: 8 }}>
            {t("welcome_beta_saved_title")}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
            {t("welcome_beta_saved_body")}
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

function CenterDim({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.55)", fontSize: 14 }}>
      {children}
    </div>
  );
}
