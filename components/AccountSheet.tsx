"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { signOut, getCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useIsNative } from "@/lib/platform";
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

interface SubscriptionInfo {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

const RETENTION_REASON_KEYS = [
  "retention_reason_expensive",
  "retention_reason_infrequent",
  "retention_reason_missing_features",
  "retention_reason_technical",
  "retention_reason_switching",
  "retention_reason_other",
] as const;

/**
 * Bottom sheet opened from the header avatar tap. Surfaces the personal
 * account info that used to live on /settings (profile row + member-since /
 * meal-count stats), plus the upgrade CTA (only when NOT pro/beta),
 * password-reset shortcut, and sign-out button.
 *
 * Pro users additionally see a "Mein Abo" section with the next billing date
 * and a cancellation button that opens a 3-step retention flow.
 *
 * Plan resolution: pulls via /api/me/plan (service-role admin client +
 * computeEffectivePlan), so an admin grant in /glev-ops immediately reflects
 * here. Plan initialises as null (loading) to avoid the FREE→PRO flicker.
 */
export default function AccountSheet({ open, onClose }: AccountSheetProps) {
  const t = useTranslations("account");
  const router = useRouter();
  const dateLocale = localeToBcp47(useLocale());
  const isNative = useIsNative();

  const [email, setEmail] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [mealCount, setMealCount] = useState<number>(0);
  // null = loading (shows skeleton pill); resolves to actual plan after fetch
  const [plan, setPlan] = useState<EffectivePlan | null>(null);
  // null = loading; false = fetch failed (show fallback); SubscriptionInfo = resolved
  const [subscription, setSubscription] = useState<SubscriptionInfo | null | false>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [pwState, setPwState] = useState<"idle" | "sending" | "ok" | "err">("idle");
  // Retention flow: 0 = not active, 1 = discount offer, 2 = 3-month trial, 3 = feedback + cancel
  const [retentionStep, setRetentionStep] = useState<0 | 1 | 2 | 3>(0);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionDone, setRetentionDone] = useState<"discount" | "trial" | "cancelled" | null>(null);
  // Reasons are optional — API and UI both allow empty (feedback is best-effort)
  const [cancelReasons, setCancelReasons] = useState<string[]>([]);
  const [cancelFeedback, setCancelFeedback] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // Reset ALL transient states synchronously when sheet opens so stale
    // data from a previous session never leaks into the new one.
    setPlan(null);
    setSubscription(null);
    setRetentionStep(0);
    setRetentionDone(null);
    setCancelReasons([]);
    setCancelFeedback("");
    setPwState("idle");
    setSignOutConfirm(false);

    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setEmail(user?.email ?? "");
        setCreatedAt(
          user?.created_at
            ? parseDbDate(user.created_at).toLocaleDateString(dateLocale, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : "",
        );
        if (supabase) {
          const { count } = await supabase
            .from("meals")
            .select("id", { count: "exact", head: true });
          if (!cancelled) setMealCount(count || 0);

          if (user?.id) {
            try {
              const res = await fetch("/api/me/plan", { credentials: "include" });
              if (res.ok) {
                const j = (await res.json()) as { plan?: EffectivePlan };
                if (!cancelled) {
                  const resolved: EffectivePlan =
                    j.plan === "pro" || j.plan === "beta" || j.plan === "free" || j.plan === "plus"
                      ? j.plan
                      : "free";
                  setPlan(resolved);

                  // Fetch live subscription data for pro/plus/beta users.
                  // On any failure (network or non-OK response), set to false
                  // so the UI shows a non-loading fallback instead of spinning.
                  if ((resolved === "pro" || resolved === "plus" || resolved === "beta") && !cancelled) {
                    fetch("/api/me/subscription", { credentials: "include" })
                      .then(async (subRes) => {
                        if (!cancelled) {
                          if (subRes.ok) {
                            const subData = (await subRes.json()) as SubscriptionInfo;
                            setSubscription(subData);
                          } else {
                            setSubscription(false);
                          }
                        }
                      })
                      .catch(() => {
                        if (!cancelled) setSubscription(false);
                      });
                  }
                }
              } else {
                if (!cancelled) setPlan("free");
              }
            } catch {
              if (!cancelled) setPlan("free");
            }
          } else {
            if (!cancelled) setPlan("free");
          }
        }
      } catch {
        if (!cancelled) setPlan("free");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, dateLocale]);

  async function handleChangePassword() {
    if (!supabase || !email) {
      setPwState("err");
      return;
    }
    setPwState("sending");
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/confirm`
          : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : undefined,
      );
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

  async function handleRetentionDiscount() {
    setRetentionLoading(true);
    try {
      const res = await fetch("/api/me/subscription/apply-retention-discount", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setRetentionDone("discount");
      } else {
        setRetentionStep(2);
      }
    } catch {
      setRetentionStep(2);
    } finally {
      setRetentionLoading(false);
    }
  }

  async function handleRetentionTrial() {
    setRetentionLoading(true);
    try {
      const res = await fetch("/api/me/subscription/apply-retention-trial", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setRetentionDone("trial");
      } else {
        setRetentionStep(3);
      }
    } catch {
      setRetentionStep(3);
    } finally {
      setRetentionLoading(false);
    }
  }

  async function handleRetentionCancel() {
    setRetentionLoading(true);
    try {
      const res = await fetch("/api/me/subscription/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reasons: cancelReasons,
          custom_text: cancelFeedback.trim() || null,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { period_end?: string };
        setRetentionDone("cancelled");
        if (data.period_end) {
          setSubscription((prev) =>
            prev
              ? { ...prev, cancel_at_period_end: true, current_period_end: data.period_end! }
              : null,
          );
        }
      }
    } catch {
      /* stay on step 3 */
    } finally {
      setRetentionLoading(false);
    }
  }

  function toggleReason(key: string) {
    setCancelReasons((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key],
    );
  }

  function closeRetention() {
    setRetentionStep(0);
    setRetentionDone(null);
    setCancelReasons([]);
    setCancelFeedback("");
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(dateLocale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  const initial = (email.split("@")[0] || "U").charAt(0).toUpperCase();
  const displayName = email.split("@")[0] || t("user_fallback");

  // Plan pill appearance
  const pillColor =
    plan === "pro" || plan === "plus"
      ? PURPLE
      : plan === "beta"
        ? GREEN
        : ACCENT;
  const pillLabel =
    plan === "pro"
      ? t("plan_pro")
      : plan === "plus"
        ? t("plan_plus")
        : plan === "beta"
          ? t("plan_beta")
          : t("plan_free");

  const isInRetentionFlow = retentionStep > 0;
  const sheetTitle = isInRetentionFlow && retentionDone === null
    ? t("retention_sheet_title")
    : t("title");

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        if (isInRetentionFlow && retentionDone === null) {
          closeRetention();
        } else {
          closeRetention();
          onClose();
        }
      }}
      title={sheetTitle}
    >
      {/* ── RETENTION FLOW ─────────────────────────────────────────── */}
      {isInRetentionFlow && (
        <div>
          {/* Done: discount applied */}
          {retentionDone === "discount" && (
            <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🎉</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>
                {t("retention_discount_applied_title")}
              </div>
              <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55, marginBottom: 24 }}>
                {t("retention_discount_applied_body")}
              </div>
              <button
                onClick={() => { closeRetention(); onClose(); }}
                style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: ACCENT, color: "var(--on-accent)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                {t("retention_close_btn")}
              </button>
            </div>
          )}

          {/* Done: trial applied */}
          {retentionDone === "trial" && (
            <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>
                {t("retention_trial_applied_title")}
              </div>
              <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55, marginBottom: 24 }}>
                {t("retention_trial_applied_body")}
              </div>
              <button
                onClick={() => { closeRetention(); onClose(); }}
                style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: ACCENT, color: "var(--on-accent)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                {t("retention_close_btn")}
              </button>
            </div>
          )}

          {/* Done: cancelled */}
          {retentionDone === "cancelled" && (
            <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>👋</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>
                {t("retention_cancelled_title")}
              </div>
              <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55, marginBottom: 24 }}>
                {subscription && typeof subscription === "object" && subscription.current_period_end
                  ? t("retention_cancelled_body_with_date", {
                      date: formatDate(subscription.current_period_end),
                    })
                  : t("retention_cancelled_body")}
              </div>
              <button
                onClick={() => { closeRetention(); onClose(); }}
                style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: "var(--surface-2, var(--surface))", color: "var(--text-dim)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                {t("retention_close_btn")}
              </button>
            </div>
          )}

          {/* Step 1 — Discount offer */}
          {retentionDone === null && retentionStep === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 44, textAlign: "center" }}>🎁</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong)", textAlign: "center" }}>
                {t("retention_step1_title")}
              </div>
              <div style={{ fontSize: 14, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.55 }}>
                {t("retention_step1_body")}
              </div>
              <button
                onClick={handleRetentionDiscount}
                disabled={retentionLoading}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: `linear-gradient(135deg, ${PURPLE}, ${ACCENT})`,
                  color: "var(--on-accent)", fontSize: 14, fontWeight: 700,
                  cursor: retentionLoading ? "wait" : "pointer",
                  opacity: retentionLoading ? 0.75 : 1,
                }}
              >
                {retentionLoading ? t("retention_loading") : t("retention_step1_accept")}
              </button>
              <button
                onClick={() => setRetentionStep(2)}
                disabled={retentionLoading}
                style={{
                  width: "100%", padding: "12px", borderRadius: 12,
                  border: `1px solid ${BORDER}`, background: "transparent",
                  color: "var(--text-dim)", fontSize: 14, cursor: retentionLoading ? "wait" : "pointer",
                }}
              >
                {t("retention_step1_decline")}
              </button>
            </div>
          )}

          {/* Step 2 — 3 months free */}
          {retentionDone === null && retentionStep === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 44, textAlign: "center" }}>🕐</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-strong)", textAlign: "center" }}>
                {t("retention_step2_title")}
              </div>
              <div style={{ fontSize: 14, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.55 }}>
                {t("retention_step2_body")}
              </div>
              <button
                onClick={handleRetentionTrial}
                disabled={retentionLoading}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: `linear-gradient(135deg, ${GREEN}cc, ${ACCENT})`,
                  color: "var(--on-accent)", fontSize: 14, fontWeight: 700,
                  cursor: retentionLoading ? "wait" : "pointer",
                  opacity: retentionLoading ? 0.75 : 1,
                }}
              >
                {retentionLoading ? t("retention_loading") : t("retention_step2_accept")}
              </button>
              <button
                onClick={() => setRetentionStep(3)}
                disabled={retentionLoading}
                style={{
                  width: "100%", padding: "12px", borderRadius: 12,
                  border: `1px solid ${BORDER}`, background: "transparent",
                  color: "var(--text-dim)", fontSize: 14, cursor: retentionLoading ? "wait" : "pointer",
                }}
              >
                {t("retention_step2_decline")}
              </button>
            </div>
          )}

          {/* Step 3 — Feedback + final cancel */}
          {retentionDone === null && retentionStep === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-strong)" }}>
                {t("retention_step3_title")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {RETENTION_REASON_KEYS.map((key) => {
                  const active = cancelReasons.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleReason(key)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px", borderRadius: 10,
                        border: `1px solid ${active ? PINK : BORDER}`,
                        background: active ? `${PINK}15` : "var(--surface-soft)",
                        color: "var(--text)", textAlign: "left", cursor: "pointer",
                        fontSize: 14, fontFamily: "inherit",
                      }}
                    >
                      <span style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        border: `2px solid ${active ? PINK : "var(--text-faint)"}`,
                        background: active ? PINK : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.15s, border-color 0.15s",
                      }}>
                        {active && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <polyline points="2,5 4,7 8,3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      {t(key)}
                    </button>
                  );
                })}
              </div>
              <textarea
                placeholder={t("retention_feedback_placeholder")}
                value={cancelFeedback}
                onChange={(e) => setCancelFeedback(e.target.value)}
                rows={3}
                style={{
                  width: "100%", borderRadius: 10, border: `1px solid ${BORDER}`,
                  background: "var(--input-bg, var(--surface-soft))",
                  color: "var(--text)", fontSize: 14, padding: "10px 14px",
                  resize: "vertical", outline: "none", fontFamily: "inherit",
                  boxSizing: "border-box", lineHeight: 1.5,
                }}
              />
              <button
                onClick={handleRetentionCancel}
                disabled={retentionLoading}
                style={{
                  width: "100%", padding: "14px", borderRadius: 12, border: "none",
                  background: PINK,
                  color: "var(--on-accent)",
                  fontSize: 14, fontWeight: 700,
                  cursor: retentionLoading ? "wait" : "pointer",
                  opacity: retentionLoading ? 0.7 : 1,
                }}
              >
                {retentionLoading ? t("retention_loading") : t("retention_step3_cancel_btn")}
              </button>
              <button
                onClick={closeRetention}
                disabled={retentionLoading}
                style={{
                  width: "100%", padding: "11px", borderRadius: 12,
                  border: `1px solid ${BORDER}`, background: "transparent",
                  color: "var(--text-dim)", fontSize: 13, cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t("retention_step3_back_btn")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── NORMAL ACCOUNT CONTENT ─────────────────────────────────── */}
      {!isInRetentionFlow && (
        <>
          {/* Profile header: avatar + name + email + plan pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 99,
              background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
              border: `2px solid ${ACCENT}66`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 800, color: "var(--on-accent)",
              letterSpacing: "-0.02em", flexShrink: 0,
            }}>
              {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)" }}>
                  {displayName}
                </div>
                {/* Plan pill — skeleton while loading to avoid FREE→PRO flicker */}
                {plan === null ? (
                  <span style={{
                    display: "inline-block", width: 76, height: 20, borderRadius: 99,
                    background: "var(--surface-soft)", opacity: 0.6,
                  }} aria-hidden />
                ) : (
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 99,
                    background: `${pillColor}20`, color: pillColor, letterSpacing: "0.08em",
                  }}>
                    {pillLabel.toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{
                fontSize: 14, color: "var(--text-dim)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {email || "—"}
              </div>
            </div>
          </div>

          {/* Three stat tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 }}>
            <div style={{ background: "var(--surface-soft)", borderRadius: 12, border: `1px solid ${BORDER}`, padding: "12px 12px" }}>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 4 }}>{t("stat_meals_logged")}</div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>{mealCount}</div>
            </div>
            <div style={{ background: "var(--surface-soft)", borderRadius: 12, border: `1px solid ${BORDER}`, padding: "12px 12px" }}>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 4 }}>{t("stat_member_since")}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)", lineHeight: 1.2 }}>{createdAt || "—"}</div>
            </div>
            <div style={{ background: "var(--surface-soft)", borderRadius: 12, border: `1px solid ${BORDER}`, padding: "12px 12px" }}>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 4 }}>{t("stat_version")}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
                v{process.env.NEXT_PUBLIC_APP_VERSION || "0.4.0"}
              </div>
            </div>
          </div>

          {/* Subscription section — Pro / Plus / Smart (beta) users */}
          {(plan === "pro" || plan === "plus" || plan === "beta") && (
            <div style={{
              background: "var(--surface)", border: `1px solid ${BORDER}`,
              borderRadius: 14, padding: "14px 16px", marginBottom: 18,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
                {t("subscription_title")}
              </div>

              {subscription === null ? (
                <div style={{ fontSize: 13, color: "var(--text-faint)" }}>
                  {t("subscription_loading")}
                </div>
              ) : subscription === false ? (
                <div style={{ fontSize: 13, color: "var(--text-faint)" }}>
                  {t("subscription_next_billing")} —
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
                      {plan === "plus" ? t("plan_plus") : plan === "beta" ? t("plan_beta") : t("plan_pro")}
                    </span>
                    {subscription.cancel_at_period_end ? (
                      <span style={{ fontSize: 13, color: PINK, fontWeight: 600 }}>
                        {t("subscription_cancels_at")} {formatDate(subscription.current_period_end)}
                      </span>
                    ) : subscription.current_period_end ? (
                      <span style={{ fontSize: 13, color: "var(--text-faint)" }}>
                        {t("subscription_next_billing")} {formatDate(subscription.current_period_end)}
                      </span>
                    ) : null}
                  </div>

                  {!subscription.cancel_at_period_end && (
                    <button
                      onClick={() => setRetentionStep(1)}
                      style={{
                        marginTop: 4, width: "100%", padding: "10px 14px", borderRadius: 10,
                        border: `1px solid ${PINK}40`, background: `${PINK}10`,
                        color: PINK, fontSize: 13, fontWeight: 600, cursor: "pointer",
                        textAlign: "center", fontFamily: "inherit",
                      }}
                    >
                      {t("subscription_cancel_btn")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Upgrade card — only shown for free users (not pro/plus/beta). */}
          {plan !== null && plan !== "pro" && plan !== "plus" && plan !== "beta" && (
            isNative ? (
              <div
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  marginBottom: 18,
                  background: `${PURPLE}14`,
                  border: `1px solid ${PURPLE}30`,
                  borderRadius: 14,
                  fontSize: 13,
                  color: "var(--text-dim)",
                  lineHeight: 1.5,
                  textAlign: "center",
                }}
              >
                Glev Pro & Plus sind über glev.app verfügbar.
              </div>
            ) : (
              <button
                onClick={() => { onClose(); router.push("/pro"); }}
                style={{
                  width: "100%", textAlign: "left", cursor: "pointer",
                  background: `linear-gradient(135deg, ${PURPLE}30, ${ACCENT}20)`,
                  border: `1px solid ${PURPLE}50`,
                  borderRadius: 14, padding: "16px 18px", marginBottom: 18,
                  display: "flex", alignItems: "center", gap: 14,
                  color: "var(--text)",
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: `${PURPLE}30`, border: `1px solid ${PURPLE}60`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={PURPLE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15 8.5 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 9 8.5 12 2" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", marginBottom: 2 }}>
                    {t("upgrade_title")}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.4 }}>
                    {t("upgrade_body")}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )
          )}

          {/* Action rows */}
          <div style={{
            background: "var(--surface)", border: `1px solid ${BORDER}`,
            borderRadius: 14, overflow: "hidden", marginBottom: 14,
          }}>
            <button
              onClick={handleChangePassword}
              disabled={pwState === "sending"}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                width: "100%", padding: "14px 16px", border: "none",
                background: "transparent", textAlign: "left",
                cursor: pwState === "sending" ? "wait" : "pointer",
                color: "var(--text)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{t("row_change_password")}</div>
                <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 2 }}>
                  {pwState === "ok"
                    ? t("password_sent")
                    : pwState === "err"
                      ? t("password_failed")
                      : pwState === "sending"
                        ? t("password_sending")
                        : t("row_change_password_sub")}
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Sign-out CTA — two-step confirmation */}
          {signOutConfirm ? (
            <div style={{
              borderRadius: 12, border: `1px solid ${PINK}40`, background: `${PINK}10`,
              padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8,
            }}>
              <span style={{ fontSize: 13, color: "var(--text-dim)", fontWeight: 500 }}>
                {t("sign_out_confirm_question")}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  aria-label="Confirm sign out"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                    cursor: signingOut ? "wait" : "pointer",
                    background: PINK, color: "var(--on-accent)",
                    fontSize: 13, fontWeight: 700,
                  }}
                >
                  {signingOut ? t("signing_out") : t("sign_out_confirm_btn")}
                </button>
                <button
                  aria-label="Cancel sign out"
                  onClick={() => setSignOutConfirm(false)}
                  disabled={signingOut}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                    cursor: "pointer", background: "var(--surface-2, var(--surface))",
                    color: "var(--text-dim)", fontSize: 13,
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
                width: "100%", padding: "14px 16px", borderRadius: 12,
                border: `1px solid ${PINK}40`, background: `${PINK}15`,
                color: PINK, fontSize: 14, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t("row_sign_out")}
            </button>
          )}
        </>
      )}
    </BottomSheet>
  );
}
