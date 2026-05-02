"use client";

/**
 * Shared chrome for the live Onboarding flow under
 * `app/onboarding/{welcome,log-meal,engine,insights}.tsx`.
 *
 * Forked from `app/mockups/onboarding/_shared.tsx`:
 *   - locale comes from `next-intl` (cookie/profile-driven), not `?locale`
 *   - navigation handlers are required props, not query-param fallbacks
 *   - Skip is wired to `POST /api/onboarding { action: "complete" }` by
 *     the parent flow, NOT a route hop — see `app/onboarding/page.tsx`
 *
 * INTENTIONALLY DARK — the onboarding surface mirrors the iOS dark
 * cockpit and is independent of the user's app-theme preference, so
 * everyone sees the same Glev brand presentation on first run.
 */

import React from "react";
import { useTranslations } from "next-intl";

// ─── Brand tokens (mirror mockup) ───────────────────────────────
export const ACCENT     = "#4F6EF7";
export const GREEN      = "#22D3A0";
export const PINK       = "#FF2D78";
export const ORANGE     = "#FF9500";
export const BG         = "#09090B";
export const SURFACE    = "#111117";
export const BORDER     = "rgba(255,255,255,0.08)";
export const TEXT       = "rgba(255,255,255,0.96)";
export const TEXT_DIM   = "rgba(255,255,255,0.55)";
export const TEXT_FAINT = "rgba(255,255,255,0.32)";

// ─── Progress dots ──────────────────────────────────────────────
export function ProgressDots({ active }: { active: 0 | 1 | 2 | 3 }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: i === active ? 24 : 8,
            height: 8,
            borderRadius: 99,
            background: i === active ? ACCENT : "rgba(255,255,255,0.18)",
            transition: "all 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

// ─── Buttons ────────────────────────────────────────────────────
export function PrimaryButton({
  children,
  onClick,
  withArrow = true,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  withArrow?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "14px 26px",
        borderRadius: 12,
        border: "none",
        background: ACCENT,
        color: "#fff",
        fontWeight: 700,
        fontSize: 15,
        fontFamily: "inherit",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.65 : 1,
        transition: "transform 0.1s, box-shadow 0.15s, opacity 0.15s",
        boxShadow: `0 4px 16px ${ACCENT}55`,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
      {withArrow && <span style={{ fontSize: 16, lineHeight: 1 }}>→</span>}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "14px 22px",
        borderRadius: 12,
        border: `1px solid ${BORDER}`,
        background: "transparent",
        color: TEXT_DIM,
        fontWeight: 600,
        fontSize: 14,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ─── Shell ──────────────────────────────────────────────────────
export function Shell({
  step,
  onNext,
  onBack,
  onSkip,
  primaryLabel,
  primaryWithArrow = true,
  primaryDisabled = false,
  showSkip = true,
  children,
}: {
  step: 0 | 1 | 2 | 3;
  onNext: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  primaryLabel?: string;
  primaryWithArrow?: boolean;
  primaryDisabled?: boolean;
  showSkip?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("onboarding");
  const skipLabel = t("skip");
  const backLabel = t("back");
  const nextLabel = primaryLabel ?? t("next");

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        background: BG,
        color: TEXT,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        :root { --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; }
        .ob-content { padding: 24px 22px 32px; max-width: 460px; margin: 0 auto; width: 100%; box-sizing: border-box; flex: 1; display: flex; flex-direction: column; gap: 22px; }
        .ob-footer { padding: 18px 22px calc(env(safe-area-inset-bottom) + 22px); border-top: 1px solid ${BORDER}; background: ${BG}; }
        .ob-footer-row { display: flex; gap: 12px; max-width: 460px; margin: 0 auto; align-items: center; justify-content: space-between; }
        .ob-skip { position: absolute; top: calc(env(safe-area-inset-top) + 18px); right: 22px; z-index: 2; }
        .ob-progress { padding: calc(env(safe-area-inset-top) + 26px) 0 14px; }
        @media (min-width: 768px) {
          .ob-content   { max-width: 680px; padding: 56px 56px 48px; gap: 28px; }
          .ob-footer    { padding: 24px 56px 32px; }
          .ob-footer-row{ max-width: 680px; }
          .ob-skip      { top: 26px; right: 32px; }
          .ob-progress  { padding: 28px 0 18px; }
        }
      `}</style>

      {showSkip && onSkip && (
        <button
          onClick={onSkip}
          className="ob-skip"
          style={{
            background: "transparent",
            border: "none",
            color: TEXT_DIM,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            minHeight: 44,
            minWidth: 44,
            padding: "10px 14px",
          }}
        >
          {skipLabel}
        </button>
      )}

      <div className="ob-progress">
        <ProgressDots active={step} />
      </div>

      <div className="ob-content">{children}</div>

      <div className="ob-footer">
        <div className="ob-footer-row">
          {step > 0 && onBack ? (
            <GhostButton onClick={onBack}>← {backLabel}</GhostButton>
          ) : (
            <span />
          )}
          <PrimaryButton
            onClick={onNext}
            withArrow={primaryWithArrow}
            disabled={primaryDisabled}
          >
            {nextLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
