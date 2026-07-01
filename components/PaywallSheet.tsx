"use client";
import posthog from "posthog-js";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  type PurchasesPackage,
  type PurchasesOffering,
} from "@revenuecat/purchases-capacitor";
import { resolvePaywallState, type PaywallState } from "@/lib/resolvePaywallState";
import { usePlan } from "@/hooks/usePlan";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";

type Tier     = "smart" | "pro" | "plus";
type Interval = "monthly" | "yearly";

type Props = {
  open: boolean;
  onClose: () => void;
  onPurchaseSuccess?: () => void;
  /** Which tier tab is pre-selected when the sheet opens. Defaults to "pro". */
  initialTier?: Tier;
  /** Analytics source identifier for paywall_shown event. */
  source?: string;
};

// Match RevenueCat package identifiers: smart_monthly, smart_yearly, pro_monthly, pro_yearly
function pickPkg(
  pkgs: PurchasesPackage[],
  tier: Tier,
  interval: Interval,
): PurchasesPackage | null {
  return (
    pkgs.find(
      (p) =>
        p.identifier.toLowerCase().includes(tier) &&
        p.identifier.toLowerCase().includes(interval === "yearly" ? "year" : "month"),
    ) ?? null
  );
}

function fmtMonthlyEquivalent(pkg: PurchasesPackage, locale: string): string {
  try {
    const monthly = pkg.product.price / 12;
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "de-DE", {
      style: "currency",
      currency: pkg.product.currencyCode ?? "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(monthly);
  } catch {
    return `${(pkg.product.price / 12).toFixed(2)}`;
  }
}

const PLUS_PURPLE = "#7c3aed";

export default function PaywallSheet({ open, onClose, onPurchaseSuccess, initialTier = "pro", source }: Props) {
  const t      = useTranslations("paywall");
  const locale = useLocale();
  const router = useRouter();

  const { trialActive, trialEndsAt } = usePlan();

  const [offering,      setOffering]      = useState<PurchasesOffering | null>(null);
  const [offeringState, setOfferingState] = useState<"loading" | "ready" | "empty">("loading");
  const [paywallState,  setPaywallState]  = useState<PaywallState | null>(null);
  const [mounted,       setMounted]       = useState(false);
  const [tier,          setTier]          = useState<Tier>(initialTier);
  const [interval,      setInterval]      = useState<Interval>("yearly");
  const [purchasing,    setPurchasing]    = useState(false);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!open || !isNative) return;
    Promise.all([Purchases.getOfferings(), Purchases.getCustomerInfo()])
      .then(([offeringsResult, customerInfoResult]) => {
        const o = offeringsResult.current ?? null;
        setOffering(o);
        setOfferingState(o && o.availablePackages.length > 0 ? "ready" : "empty");
        const productIds = (o?.availablePackages ?? []).map((p) => p.product.identifier);
        return resolvePaywallState(customerInfoResult.customerInfo, trialActive, productIds);
      })
      .then(setPaywallState)
      .catch((e) => {
        console.warn("[PaywallSheet] init failed:", e);
        setOfferingState("empty");
        setPaywallState("eligible_for_trial");
      });
  }, [open, isNative, trialActive]);

  // Reset state each time sheet opens; fire posthog event on open
  useEffect(() => {
    if (open) {
      setTier(initialTier); setInterval("yearly"); setOfferingState("loading"); setOffering(null); setPaywallState(null);
      posthog.capture('paywall_shown', { source: source ?? 'unknown' });
    }
  }, [open, initialTier, source]);

  // User already has an active subscription — close immediately
  useEffect(() => {
    if (paywallState === "subscribed") onClose();
  }, [paywallState, onClose]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const buy = useCallback(
    async (pkg: PurchasesPackage) => {
      if (purchasing) return;
      posthog.capture('paywall_plan_selected', {
        plan: pkg.identifier,
        price: pkg.product.price,
        currency: pkg.product.currencyCode,
      });
      setPurchasing(true);
      try {
        const result = await Purchases.purchasePackage({ aPackage: pkg });
        const active = result.customerInfo.entitlements.active;
        if (active.glev_smart || active.glev_pro || active.glev_plus) {
          onPurchaseSuccess?.();
          onClose();
        }
      } catch (e: unknown) {
        const err = e as { userCancelled?: boolean | null };
        if (!err.userCancelled) console.error("[PaywallSheet] purchase error", e);
      } finally {
        setPurchasing(false);
      }
    },
    [purchasing, onClose, onPurchaseSuccess],
  );

  const restore = useCallback(async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      const r = await Purchases.restorePurchases();
      const active = r.customerInfo.entitlements.active;
      if (active.glev_smart || active.glev_pro || active.glev_plus) {
        onPurchaseSuccess?.();
        onClose();
      }
    } catch (e) {
      console.warn("[PaywallSheet] restore failed:", e);
    } finally {
      setPurchasing(false);
    }
  }, [purchasing, onClose, onPurchaseSuccess]);

  if (!open || !mounted) return null;
  if (!isNative) return null;

  const closeBtn = (
    <button
      type="button"
      onClick={onClose}
      aria-label="Schließen"
      style={{ position: "absolute", top: 12, right: 12, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", borderRadius: 10 }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  const sharedBg: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${ACCENT}22 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 100% 100%, ${GREEN}14 0%, transparent 55%), var(--bg)`,
    color: "var(--text)",
  };

  if (offeringState === "loading" || (offeringState === "ready" && paywallState === null)) {
    return createPortal(
      <div role="dialog" aria-modal="true" style={{ ...sharedBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        {closeBtn}
        <p style={{ margin: 0, fontSize: 16, color: "var(--text-muted)" }}>Paywall lädt…</p>
      </div>,
      document.body
    );
  }

  if (offeringState === "empty") {
    return createPortal(
      <div role="dialog" aria-modal="true" style={{ ...sharedBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 32px", textAlign: "center" }}>
        {closeBtn}
        <p style={{ margin: 0, fontSize: 15, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Subscriptions noch nicht verfügbar — bitte später erneut versuchen.
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{ padding: "12px 24px", background: ACCENT, color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          Schließen
        </button>
      </div>,
      document.body
    );
  }

  const pkgs   = offering?.availablePackages ?? [];
  const monthly = pickPkg(pkgs, tier, "monthly");
  const yearly  = pickPkg(pkgs, tier, "yearly");
  const chosen  = interval === "yearly" ? yearly : monthly;

  const tierTitle = tier === "smart" ? "Smart" : tier === "plus" ? "Glev+" : "Pro";

  const smartFeatures: string[] = [
    t("feature_smart_1"),
    t("feature_smart_2"),
    t("feature_smart_3"),
    t("feature_smart_4"),
  ];
  const proFeatures: string[] = [
    t("feature_pro_1"),
    t("feature_pro_2"),
    t("feature_pro_3"),
    t("feature_pro_4"),
    t("feature_pro_5"),
    t("feature_pro_6"),
  ];
  const plusFeatures: string[] = [
    t("plus.bullet_1"),
    t("plus.bullet_2"),
    t("plus.bullet_3"),
    t("plus.bullet_4"),
  ];
  const features = tier === "smart" ? smartFeatures : tier === "plus" ? plusFeatures : proFeatures;

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : 0;

  const ctaLabel = purchasing
    ? t("cta_loading")
    : paywallState === "ineligible"
      ? t("ineligible_cta")
      : paywallState === "supabase_trial_active"
        ? t("trial_active_cta")
        : tier === "smart"
          ? t("cta_smart")
          : tier === "plus"
            ? t("plus.cta")
            : t("cta_pro");

  return createPortal(
    /* ── A) ROOT CONTAINER ─────────────────────────────────────── */
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("aria_label")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, ${ACCENT}22 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 100% 100%, ${GREEN}14 0%, transparent 55%),
          var(--bg)
        `,
        color: "var(--text)",
        overflowY: "auto",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── B) HEADER-BAR ──────────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          height: 56,
          padding: "0 20px",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          zIndex: 1,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          style={{
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            borderRadius: 10,
          }}
        >
          {/* X icon — inline SVG (no lucide-react dependency) */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── C) HERO ────────────────────────────────────────────── */}
      <div style={{ padding: "20px 24px 32px", textAlign: "center" }}>
        <Image
          src="/icon.svg"
          width={72}
          height={72}
          alt="Glev"
          style={{ margin: "0 auto 20px", display: "block" }}
        />
        <h1
          style={{
            fontSize: "clamp(26px, 6vw, 32px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "0 0 12px",
            color: "var(--text)",
            lineHeight: 1.15,
          }}
        >
          {t("headline_1")}{" "}
          <span style={{ color: GREEN }}>.</span>
        </h1>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.5,
            color: "var(--text-muted)",
            maxWidth: 320,
            margin: "0 auto",
          }}
        >
          {t("subheadline")}
        </p>
      </div>

      {/* ── D) TIER-TOGGLE ─────────────────────────────────────── */}
      <div
        style={{
          maxWidth: 320,
          margin: "0 auto 24px",
          display: "flex",
          background: "var(--surface-soft, #18181B)",
          borderRadius: 12,
          padding: 4,
          width: "calc(100% - 48px)",
        }}
      >
        {(["smart", "pro", "plus"] as Tier[]).map((t2) => {
          const isPlus = t2 === "plus";
          const activeColor = isPlus ? PLUS_PURPLE : "var(--text)";
          return (
            <button
              key={t2}
              type="button"
              onClick={() => setTier(t2)}
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.005em",
                cursor: "pointer",
                border: "none",
                fontFamily: "inherit",
                transition: "background 0.15s, color 0.15s",
                background: tier === t2 ? "var(--surface)" : "transparent",
                color: tier === t2 ? activeColor : "var(--text-muted)",
                boxShadow: tier === t2 ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
              }}
            >
              {t2 === "smart" ? "Smart" : t2 === "plus" ? "Glev+" : "Pro"}
            </button>
          );
        })}
      </div>

      {/* ── E) PACKAGE-CARDS ───────────────────────────────────── */}
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "0 24px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxSizing: "border-box",
        }}
      >
      <>
        {/* Yearly card */}
        <button
          type="button"
          onClick={() => { setInterval("yearly"); if (yearly) void buy(yearly); }}
          disabled={!yearly || purchasing}
          style={{
            position: "relative",
            width: "100%",
            background: "var(--surface)",
            border: `2px solid ${tier === "plus" ? PLUS_PURPLE : ACCENT}`,
            borderRadius: 16,
            padding: "20px 24px",
            cursor: purchasing || !yearly ? "default" : "pointer",
            textAlign: "left",
            fontFamily: "inherit",
            boxShadow: `0 8px 24px ${tier === "plus" ? PLUS_PURPLE : ACCENT}20`,
            opacity: purchasing ? 0.75 : 1,
            transition: "transform 0.1s",
          }}
          onMouseDown={(e) => { (e.currentTarget.style.transform = "scale(0.98)"); }}
          onMouseUp={(e) => { (e.currentTarget.style.transform = "scale(1)"); }}
          onMouseLeave={(e) => { (e.currentTarget.style.transform = "scale(1)"); }}
          onTouchStart={(e) => { (e.currentTarget.style.transform = "scale(0.98)"); }}
          onTouchEnd={(e) => { (e.currentTarget.style.transform = "scale(1)"); }}
        >
          {/* Most-popular badge — 1:1 Marketing-Page-Style */}
          <span
            style={{
              position: "absolute",
              top: -10,
              right: 16,
              background: tier === "plus" ? PLUS_PURPLE : ACCENT,
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "4px 10px",
              borderRadius: 999,
              boxShadow: `0 4px 12px ${tier === "plus" ? PLUS_PURPLE : ACCENT}66`,
              whiteSpace: "nowrap",
            }}
          >
            {t("badge_popular")}
          </span>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              {tierTitle} · {t("label_yearly")}
            </span>
            <span>
              <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text)" }}>
                {yearly?.product.priceString ?? "—"}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>/{t("period_year")}</span>
            </span>
          </div>

          {yearly && (
            <p style={{ margin: "0 0 4px", fontSize: 13, color: GREEN, fontWeight: 600 }}>
              {t("yearly_save")} · {t("yearly_monthly_equiv", { price: fmtMonthlyEquivalent(yearly, locale) })}
            </p>
          )}
          {paywallState === "eligible_for_trial" && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("trial_label")}</p>
          )}
          {paywallState === "supabase_trial_active" && (
            <p style={{ margin: 0, fontSize: 12, color: GREEN }}>{t("trial_active_label", { days: daysLeft })}</p>
          )}
        </button>

        {/* Monthly card */}
        <button
          type="button"
          onClick={() => { setInterval("monthly"); if (monthly) void buy(monthly); }}
          disabled={!monthly || purchasing}
          style={{
            width: "100%",
            background: "var(--surface)",
            border: `1px solid var(--border)`,
            borderRadius: 16,
            padding: "20px 24px",
            cursor: purchasing || !monthly ? "default" : "pointer",
            textAlign: "left",
            fontFamily: "inherit",
            opacity: purchasing ? 0.75 : 1,
            transition: "transform 0.1s",
          }}
          onMouseDown={(e) => { (e.currentTarget.style.transform = "scale(0.98)"); }}
          onMouseUp={(e) => { (e.currentTarget.style.transform = "scale(1)"); }}
          onMouseLeave={(e) => { (e.currentTarget.style.transform = "scale(1)"); }}
          onTouchStart={(e) => { (e.currentTarget.style.transform = "scale(0.98)"); }}
          onTouchEnd={(e) => { (e.currentTarget.style.transform = "scale(1)"); }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              {tierTitle} · {t("label_monthly")}
            </span>
            <span>
              <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text)" }}>
                {monthly?.product.priceString ?? "—"}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>/{t("period_month")}</span>
            </span>
          </div>
          {paywallState === "eligible_for_trial" && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("trial_label")}</p>
          )}
          {paywallState === "supabase_trial_active" && (
            <p style={{ margin: 0, fontSize: 12, color: GREEN }}>{t("trial_active_label", { days: daysLeft })}</p>
          )}
        </button>
      </>
      </div>

      {/* ── F) FEATURE-LIST ────────────────────────────────────── */}
      <ul
        style={{
          maxWidth: 480,
          margin: "24px auto 0",
          padding: "0 24px",
          width: "100%",
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxSizing: "border-box",
        }}
      >
        {features.map((text, i) => (
          <li key={i} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5, color: "var(--text-strong)" }}>
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: `${GREEN}1f`,
                color: GREEN,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                marginTop: 2,
              }}
            >
              ✓
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>

      {/* ── G) CTA BUTTON (sticky-bottom) ──────────────────────── */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "linear-gradient(180deg, transparent, var(--bg) 30%)",
          padding: "24px 24px calc(24px + env(safe-area-inset-bottom, 0px))",
          marginTop: "auto",
        }}
      >
        <button
          type="button"
          onClick={() => { if (chosen) void buy(chosen); }}
          disabled={!chosen || purchasing}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            maxWidth: 480,
            margin: "0 auto",
            background: tier === "plus" ? PLUS_PURPLE : ACCENT,
            color: "#fff",
            border: "none",
            borderRadius: 14,
            padding: "16px 24px",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.005em",
            boxShadow: tier === "plus" ? `0 8px 24px ${PLUS_PURPLE}44` : `0 8px 24px ${ACCENT}55`,
            cursor: !chosen || purchasing ? "default" : "pointer",
            opacity: !chosen || purchasing ? 0.5 : 1,
            fontFamily: "inherit",
            transition: "transform 0.1s, opacity 0.15s",
          }}
          onMouseDown={(e) => { if (!purchasing) e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          onTouchStart={(e) => { if (!purchasing) e.currentTarget.style.transform = "scale(0.98)"; }}
          onTouchEnd={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          {ctaLabel}
        </button>
      </div>

      {/* ── H) FOOTER ──────────────────────────────────────────── */}
      <div
        style={{
          textAlign: "center",
          padding: "0 24px 24px",
          fontSize: 12,
          color: "var(--text-muted)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={() => void restore()}
          disabled={purchasing}
          style={{
            background: "none",
            border: "none",
            color: ACCENT,
            fontSize: 13,
            fontWeight: 600,
            cursor: purchasing ? "default" : "pointer",
            fontFamily: "inherit",
            padding: "4px 8px",
          }}
        >
          {purchasing ? t("restoring") : t("restore")}
        </button>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => { onClose(); router.push("/legal"); }}
            style={{ background: "none", border: "none", color: ACCENT, fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "2px 0", textDecoration: "underline" }}
          >
            {t("privacy")}
          </button>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => { onClose(); router.push("/legal?tab=agb"); }}
            style={{ background: "none", border: "none", color: ACCENT, fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "2px 0", textDecoration: "underline" }}
          >
            {t("terms")}
          </button>
        </div>
        <p style={{ margin: 0, lineHeight: 1.4 }}>{t("renewal_notice")}</p>
      </div>
    </div>,
    document.body
  );
}
