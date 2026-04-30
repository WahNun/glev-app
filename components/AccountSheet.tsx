"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { signOut, getCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { parseDbDate, localeToBcp47 } from "@/lib/time";
import BottomSheet from "@/components/BottomSheet";

const ACCENT = "#4F6EF7";
const PINK = "#FF2D78";
const PURPLE = "#A78BFA";
const BORDER = "var(--border)";

interface AccountSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet opened from the header avatar tap. Surfaces the personal
 * account info that used to live on /settings (profile row + member-since /
 * meal-count stats), plus the upgrade CTA, password-reset shortcut, and
 * sign-out button. Pro detection is intentionally omitted — there is no
 * isPro state in the codebase yet, so the upgrade card is always shown
 * (which matches the spec "visible if NOT pro").
 */
export default function AccountSheet({ open, onClose }: AccountSheetProps) {
  const t = useTranslations("account");
  const router = useRouter();
  const dateLocale = localeToBcp47(useLocale());

  const [email, setEmail] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [mealCount, setMealCount] = useState<number>(0);
  const [signingOut, setSigningOut] = useState(false);
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
        }
      } catch {
        // Network failures here are non-fatal — the sheet still renders
        // with empty placeholders so the user can sign out / upgrade.
      }
    })();
    // Reset transient password-state every time the sheet re-opens so a
    // previous "✓ sent" label doesn't linger on the next visit.
    setPwState("idle");
    return () => { cancelled = true; };
  }, [open, dateLocale]);

  async function handleChangePassword() {
    if (!supabase || !email) {
      setPwState("err");
      return;
    }
    setPwState("sending");
    try {
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;
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
            <span style={{
              fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:99,
              background:`${ACCENT}20`, color:ACCENT, letterSpacing:"0.08em",
            }}>
              {t("plan_free").toUpperCase()}
            </span>
          </div>
          <div style={{
            fontSize:13, color:"var(--text-dim)",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{email || "—"}</div>
        </div>
      </div>

      {/* Two stat tiles in a row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
        <div style={{
          background:"var(--surface-soft)", borderRadius:12,
          border:`1px solid ${BORDER}`, padding:"14px 16px",
        }}>
          <div style={{ fontSize:11, color:"var(--text-faint)", marginBottom:4 }}>{t("stat_meals_logged")}</div>
          <div style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.02em" }}>{mealCount}</div>
        </div>
        <div style={{
          background:"var(--surface-soft)", borderRadius:12,
          border:`1px solid ${BORDER}`, padding:"14px 16px",
        }}>
          <div style={{ fontSize:11, color:"var(--text-faint)", marginBottom:4 }}>{t("stat_member_since")}</div>
          <div style={{ fontSize:14, fontWeight:700, color:"var(--text-strong)" }}>{createdAt || "—"}</div>
        </div>
      </div>

      {/* Upgrade card (purple gradient). Always shown — no isPro detection
          exists in the codebase yet, which matches the spec "visible if NOT
          pro" since every current user is on the free plan. */}
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
          <div style={{ fontSize:12, color:"var(--text-dim)", lineHeight:1.4 }}>
            {t("upgrade_body")}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

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
            <div style={{ fontSize:12, color:"var(--text-faint)", marginTop:2 }}>
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

      {/* Sign-out CTA — destructive styling matches the About modal button */}
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        style={{
          width:"100%", padding:"14px 16px", borderRadius:12,
          border:`1px solid ${PINK}40`, background:`${PINK}15`,
          color:PINK, fontSize:14, fontWeight:700,
          cursor: signingOut ? "wait" : "pointer",
        }}
      >
        {signingOut ? t("signing_out") : t("row_sign_out")}
      </button>
    </BottomSheet>
  );
}
