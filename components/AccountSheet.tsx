"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { signOut, getCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { parseDbDate, localeToBcp47 } from "@/lib/time";
import BottomSheet from "@/components/BottomSheet";
import { type EffectivePlan } from "@/lib/admin/effectivePlan";

const ACCENT = "#4F6EF7";
const PINK = "#FF2D78";
const PURPLE = "#A78BFA";
const GREEN = "#22D3A0";
const BORDER = "var(--border)";

interface AccountSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet opened from the header avatar tap. Surfaces the personal
 * account info that used to live on /settings (profile row + member-since /
 * meal-count stats), plus the upgrade CTA (only when NOT pro/beta),
 * password-reset shortcut, and sign-out button.
 *
 * Plan resolution: pulls the same four columns the admin panel uses
 * (manual_plan_override / manual_plan_expires_at / plan / subscription_status)
 * and runs them through computeEffectivePlan, so an admin grant in
 * /admin/users immediately reflects here. Falls back to "free" if the
 * row can't be read.
 */
export default function AccountSheet({ open, onClose }: AccountSheetProps) {
  const t = useTranslations("account");
  const router = useRouter();
  const dateLocale = localeToBcp47(useLocale());

  const [email, setEmail] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [mealCount, setMealCount] = useState<number>(0);
  const [plan, setPlan] = useState<EffectivePlan>("free");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  // password-reset request state. "ok"/"err" are sticky labels shown on
  // the row's right-hand side until the sheet re-opens, so the user gets
  // immediate feedback without a separate toast system.
  const [pwState, setPwState] = useState<"idle" | "sending" | "ok" | "err">("idle");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setEmail(user?.email ?? "");
        setCreatedAt(
          user?.created_at
            ? parseDbDate(user.created_at).toLocaleDateString(dateLocale, { year: "numeric", month: "long", day: "numeric" })
            : ""
        );
        if (supabase) {
          const { count } = await supabase.from("meals").select("id", { count: "exact", head: true });
          if (!cancelled) setMealCount(count || 0);

          // Resolve effective plan via /api/me/plan. We deliberately do
          // NOT read `profiles` directly with the browser client here:
          // any RLS quirk on the manual-override columns silently
          // collapses the read to null and pins the UI to "free" even
          // when the admin panel shows Pro. The server route uses the
          // service-role admin client + the same `computeEffectivePlan`
          // logic the admin panel uses, so this badge is guaranteed to
          // match what the operator sees.
          if (user?.id) {
            try {
              const res = await fetch("/api/me/plan", { credentials: "include" });
              if (res.ok) {
                const j = (await res.json()) as { plan?: EffectivePlan };
                if (!cancelled && (j.plan === "pro" || j.plan === "beta" || j.plan === "free")) {
                  setPlan(j.plan);
                }
              }
            } catch {
              /* leave default "free" — non-fatal */
            }
          }
        }
      } catch {
        // Network failures here are non-fatal — the sheet still renders
        // with empty placeholders so the user can sign out / upgrade.
      }
    })();
    // Reset transient states every time the sheet re-opens so a
    // previous "✓ sent" label or pending confirm doesn't linger.
    setPwState("idle");
    setSignOutConfirm(false);
    return () => { cancelled = true; };
  }, [open, dateLocale]);

  async function handleChangePassword() {
    if (!supabase || !email) {
      setPwState("err");
      return;
    }
    setPwState("sending");
    try {
      // /auth/confirm statt /auth/callback: die confirm-Page zeigt erst
      // einen User-Klick-Button bevor sie den Token gegen Supabase
      // einlöst. Damit überleben die Single-Use-Recovery-Tokens
      // Mail-Scanner-Prefetches (Apple Mail / iCloud / Mimecast etc.),
      // die sonst den Token "verbrennen" bevor der User selbst klickt.
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/confirm` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
      setPwState("ok");
    } catch {
      setPwState("err");
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      onClose();
      router.push("/login");
    } finally {
      setSigningOut(false);
    }
  }

  const initial = (email.split("@")[0] || "U").charAt(0).toUpperCase();
  const displayName = email.split("@")[0] || t("user_fallback");

  return (
    <BottomSheet open={open} onClose={onClose} title={t("title")}>
      {/* Profile header: large avatar + name + email + plan pill */}
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18 }}>
        <div style={{
          width:56, height:56, borderRadius:99,
          background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
          border:`2px solid ${ACCENT}66`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:24, fontWeight:800, color:"#fff",
          letterSpacing:"-0.02em", flexShrink:0,
        }}>
          {initial}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2, flexWrap:"wrap" }}>
            <div style={{ fontSize:16, fontWeight:700, color:"var(--text-strong)" }}>{displayName}</div>
            {/* Plan pill — colour matches the plan: Pro = purple (premium),
                Beta = green (active reservation), Free = blue (default). */}
            {(() => {
              const pillColor = plan === "pro" ? PURPLE : plan === "plus" ? PURPLE : plan === "beta" ? GREEN : ACCENT;
              const pillLabel = plan === "pro" ? t("plan_pro")
                : plan === "plus" ? t("plan_plus")
                : plan === "beta" ? t("plan_beta")
                : t("plan_free");
              return (
                <span style={{
                  fontSize:12, fontWeight:700, padding:"3px 9px", borderRadius:99,
                  background:`${pillColor}20`, color:pillColor, letterSpacing:"0.08em",
                }}>
                  {pillLabel.toUpperCase()}
                </span>
              );
            })()}
          </div>
          <div style={{
            fontSize:14, color:"var(--text-dim)",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{email || "—"}</div>
        </div>
      </div>

      {/* Three stat tiles in a row — Meals · Member since · App version.
          Version was added 2026-05-17 when this sheet became the single
          surface opened from BOTH the header wordmark AND the settings
          Account row, replacing the standalone AboutGlevModal. Padding
          on tiles is narrower (12px) so three tiles fit comfortably on
          393px-wide iPhones without the "Member since" date wrapping. */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:18 }}>
        <div style={{
          background:"var(--surface-soft)", borderRadius:12,
          border:`1px solid ${BORDER}`, padding:"12px 12px",
        }}>
          <div style={{ fontSize:12, color:"var(--text-faint)", marginBottom:4 }}>{t("stat_meals_logged")}</div>
          <div style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.02em" }}>{mealCount}</div>
        </div>
        <div style={{
          background:"var(--surface-soft)", borderRadius:12,
          border:`1px solid ${BORDER}`, padding:"12px 12px",
        }}>
          <div style={{ fontSize:12, color:"var(--text-faint)", marginBottom:4 }}>{t("stat_member_since")}</div>
          <div style={{ fontSize:13, fontWeight:700, color:"var(--text-strong)", lineHeight:1.2 }}>{createdAt || "—"}</div>
        </div>
        <div style={{
          background:"var(--surface-soft)", borderRadius:12,
          border:`1px solid ${BORDER}`, padding:"12px 12px",
        }}>
          <div style={{ fontSize:12, color:"var(--text-faint)", marginBottom:4 }}>{t("stat_version")}</div>
          <div style={{ fontSize:14, fontWeight:700, color:"var(--text-strong)", fontVariantNumeric:"tabular-nums" }}>
            v{process.env.NEXT_PUBLIC_APP_VERSION || "0.4.0"}
          </div>
        </div>
      </div>

      {/* Upgrade card — only shown when the user is NOT already on Pro.
          Beta users still see it (Beta is the reservation tier; the
          actual Pro subscription is the upgrade target). */}
      {plan !== "pro" && plan !== "plus" && (
      <button
        onClick={() => { onClose(); router.push("/pro"); }}
        style={{
          width:"100%", textAlign:"left", cursor:"pointer",
          background:`linear-gradient(135deg, ${PURPLE}30, ${ACCENT}20)`,
          border:`1px solid ${PURPLE}50`,
          borderRadius:14, padding:"16px 18px", marginBottom:18,
          display:"flex", alignItems:"center", gap:14,
          color:"var(--text)",
        }}
      >
        <div style={{
          width:38, height:38, borderRadius:10, flexShrink:0,
          background:`${PURPLE}30`, border:`1px solid ${PURPLE}60`,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={PURPLE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15 8.5 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 9 8.5 12 2"/>
          </svg>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"var(--text-strong)", marginBottom:2 }}>
            {t("upgrade_title")}
          </div>
          <div style={{ fontSize:13, color:"var(--text-dim)", lineHeight:1.4 }}>
            {t("upgrade_body")}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      )}

      {/* Action rows — grouped card, hairline-separated. Mirrors the
          iOS-style row pattern used on the main settings page. */}
      <div style={{
        background:"var(--surface)", border:`1px solid ${BORDER}`,
        borderRadius:14, overflow:"hidden", marginBottom:14,
      }}>
        <button
          onClick={handleChangePassword}
          disabled={pwState === "sending"}
          style={{
            display:"flex", alignItems:"center", gap:12,
            width:"100%", padding:"14px 16px", border:"none",
            background:"transparent", textAlign:"left",
            cursor: pwState === "sending" ? "wait" : "pointer",
            color:"var(--text)",
          }}
        >
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:500 }}>{t("row_change_password")}</div>
            <div style={{ fontSize:13, color:"var(--text-faint)", marginTop:2 }}>
              {pwState === "ok" ? t("password_sent")
                : pwState === "err" ? t("password_failed")
                : pwState === "sending" ? t("password_sending")
                : t("row_change_password_sub")}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      {/* Sign-out CTA — two-step confirmation to prevent accidental logout */}
      {signOutConfirm ? (
        <div style={{
          borderRadius:12, border:`1px solid ${PINK}40`, background:`${PINK}10`,
          padding:"12px 16px", display:"flex", flexDirection:"column", gap:8,
        }}>
          <span style={{ fontSize:13, color:"var(--text-dim)", fontWeight:500 }}>
            {t("sign_out_confirm_question")}
          </span>
          <div style={{ display:"flex", gap:8 }}>
            <button
              aria-label="Confirm sign out"
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                flex:1, padding:"9px 0", borderRadius:8, border:"none",
                cursor: signingOut ? "wait" : "pointer",
                background: PINK, color:"#fff",
                fontSize:13, fontWeight:700,
              }}
            >
              {signingOut ? t("signing_out") : t("sign_out_confirm_btn")}
            </button>
            <button
              aria-label="Cancel sign out"
              onClick={() => setSignOutConfirm(false)}
              disabled={signingOut}
              style={{
                flex:1, padding:"9px 0", borderRadius:8, border:"none",
                cursor:"pointer", background:"var(--surface-2, var(--surface))",
                color:"var(--text-dim)", fontSize:13,
              }}
            >
              {t("sign_out_cancel_btn")}
            </button>
          </div>
        </div>
      ) : (
        <button
          aria-label="Sign out of Glev"
          onClick={() => setSignOutConfirm(true)}
          style={{
            width:"100%", padding:"14px 16px", borderRadius:12,
            border:`1px solid ${PINK}40`, background:`${PINK}15`,
            color:PINK, fontSize:14, fontWeight:700,
            cursor:"pointer",
          }}
        >
          {t("row_sign_out")}
        </button>
      )}
    </BottomSheet>
  );
}
