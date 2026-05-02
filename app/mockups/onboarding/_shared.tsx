"use client";

/**
 * Shared chrome for the 4 Onboarding-Screen mockups under
 * `app/mockups/onboarding/{welcome,log-meal,engine,insights}/page.tsx`.
 *
 * INTENTIONALLY DARK — DO NOT THEME (mirrors `dark-cockpit/page.tsx`).
 * These mockups represent the iOS product surface and must keep the
 * dark cockpit appearance regardless of the user's theme preference.
 *
 * Each screen page imports `<Shell>` to get the consistent chrome
 * (progress dots, footer buttons, safe-area handling) and the brand
 * color tokens. Pages render their own body inside the Shell children.
 *
 * Locale is read from the `?locale=de|en` query string via
 * `useLocaleParam()` so the same component renders both languages
 * by passing different URLs to the iframe on the canvas.
 */

import React from "react";

// ─── Brand tokens (hardcoded — mockup is intentionally dark) ────
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

// ─── Locale helpers ─────────────────────────────────────────────
export type Locale = "de" | "en";

export function useLocaleParam(): Locale {
  // Read once per render; on the server we default to "de" so the
  // initial HTML matches the most common case (Lucas → DE). The
  // canvas iframes reload with the explicit `?locale=` so the
  // hydration mismatch is harmless and self-corrects.
  if (typeof window === "undefined") return "de";
  const sp = new URLSearchParams(window.location.search);
  return sp.get("locale") === "en" ? "en" : "de";
}

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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  withArrow?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "14px 26px",
        borderRadius: 12,
        border: "none",
        background: ACCENT,
        color: "#fff",
        fontWeight: 700,
        fontSize: 15,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "transform 0.1s, box-shadow 0.15s",
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

// Linear screen order for mockup-only navigation. Used by `Shell`
// to wire Skip/Back/Next when a page does not provide explicit
// handlers, so the prototype is actually clickable for sign-off.
const SCREEN_ORDER = ["welcome", "log-meal", "engine", "insights"] as const;

function navTo(step: number, locale: Locale) {
  if (typeof window === "undefined") return;
  const target = SCREEN_ORDER[step];
  if (!target) return;
  window.location.href = `/mockups/onboarding/${target}?locale=${locale}`;
}

// ─── Shell ──────────────────────────────────────────────────────
export function Shell({
  step,
  locale,
  onNext,
  onBack,
  primaryLabel,
  primaryWithArrow = true,
  children,
  showSkip = true,
}: {
  step: 0 | 1 | 2 | 3;
  locale: Locale;
  onNext?: () => void;
  onBack?: () => void;
  primaryLabel?: string;
  primaryWithArrow?: boolean;
  showSkip?: boolean;
  children: React.ReactNode;
}) {
  const skip = locale === "de" ? "Überspringen" : "Skip";
  const back = locale === "de" ? "Zurück" : "Back";
  const next = primaryLabel ?? (locale === "de" ? "Weiter" : "Continue");

  // Default mockup navigation: next/skip advance through the linear
  // screen order; back rewinds; the final-screen primary CTA pops a
  // simple confirmation since the real /engine route isn't part of
  // the mockup. Pages can override either handler via props.
  const handleNext =
    onNext ??
    (() => {
      if (step >= 3) {
        if (typeof window !== "undefined") {
          window.alert(
            locale === "de"
              ? "Hier würde die App jetzt zum Glev-Tab springen."
              : "From here the app would jump to the Glev tab.",
          );
        }
        return;
      }
      navTo(step + 1, locale);
    });
  const handleBack = onBack ?? (() => navTo(Math.max(0, step - 1), locale));
  const handleSkip = onNext ?? (() => navTo(3, locale));

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
        body { margin: 0; }
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

      {showSkip && (
        <button
          onClick={handleSkip}
          className="ob-skip"
          style={{
            background: "transparent",
            border: "none",
            color: TEXT_DIM,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            // Generous tap target (~44×44) so the Skip control
            // satisfies iOS touch-area guidelines.
            minHeight: 44,
            minWidth: 44,
            padding: "10px 14px",
          }}
        >
          {skip}
        </button>
      )}

      <div className="ob-progress">
        <ProgressDots active={step} />
      </div>

      <div className="ob-content">{children}</div>

      <div className="ob-footer">
        <div className="ob-footer-row">
          {step > 0 ? (
            <GhostButton onClick={handleBack}>← {back}</GhostButton>
          ) : (
            <span />
          )}
          <PrimaryButton onClick={handleNext} withArrow={primaryWithArrow}>
            {next}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
