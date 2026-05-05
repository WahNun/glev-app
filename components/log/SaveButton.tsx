"use client";

/**
 * Standardised save button for every log form: medium haptic on
 * tap, 1 → 0.96 → 1 spring on press, and an optional 600 ms
 * checkmark fade-in/out when the parent flips `success` to true
 * after a successful save.
 */

import React, { useEffect, useRef, useState } from "react";
import { hapticMedium } from "@/lib/haptics";

interface SaveButtonProps {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  accent: string;
  /** Bump (e.g. flip true → false → true, or pass an incrementing key)
   *  to trigger the post-save checkmark confirmation animation. */
  successKey?: number | string | null;
}

export default function SaveButton({
  onClick, disabled, busy, label, accent, successKey,
}: SaveButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [showCheck, setShowCheck] = useState(false);

  function springPress() {
    const el = btnRef.current;
    if (!el) return;
    el.style.transition = "transform 90ms cubic-bezier(.3,.7,.3,1)";
    el.style.transform = "scale(0.96)";
    window.setTimeout(() => {
      if (!btnRef.current) return;
      btnRef.current.style.transition = "transform 130ms cubic-bezier(.34,1.56,.64,1)";
      btnRef.current.style.transform = "scale(1)";
    }, 90);
  }

  // Fade in a checkmark for ~600 ms whenever the parent bumps successKey.
  useEffect(() => {
    if (successKey == null) return;
    setShowCheck(true);
    const t = window.setTimeout(() => setShowCheck(false), 600);
    return () => window.clearTimeout(t);
  }, [successKey]);

  const isDisabled = !!disabled || !!busy;

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => {
        if (isDisabled) return;
        hapticMedium();
        springPress();
        void onClick();
      }}
      disabled={isDisabled}
      style={{
        marginTop: 18, width: "100%", padding: "13px",
        borderRadius: 12, border: "none",
        background: isDisabled ? "var(--surface-soft)" : accent,
        color: isDisabled ? "var(--text-ghost)" : "var(--on-accent)",
        fontSize: 14, fontWeight: 800,
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition: "background 0.15s, color 0.15s",
        willChange: "transform",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span style={{
        opacity: showCheck ? 0 : 1,
        transition: "opacity 180ms ease",
      }}>{label}</span>
      {showCheck && (
        <span
          aria-hidden
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--on-accent)",
            animation: "glevSaveCheck 600ms ease forwards",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round">
            <polyline points="5 12 10 17 19 7" />
          </svg>
        </span>
      )}
      <style>{`
        @keyframes glevSaveCheck {
          0%   { opacity: 0; transform: scale(0.6); }
          30%  { opacity: 1; transform: scale(1.05); }
          70%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1); }
        }
      `}</style>
    </button>
  );
}
