"use client";

import { useState } from "react";
import { ACCENT, ACCENT_HOVER } from "./tokens";

/**
 * Primary CTA button used in the hero forms.
 * Stateless w/r to the form — parent controls `submitting` and `label`.
 */
export default function CTAButton({
  submitting,
  label,
}: {
  submitting: boolean;
  label: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="submit"
      disabled={submitting}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover && !submitting ? ACCENT_HOVER : ACCENT,
        color: "#fff",
        border: "none",
        borderRadius: 12,
        padding: "16px 32px",
        fontSize: 18,
        fontWeight: 600,
        fontFamily: "inherit",
        minHeight: 56,
        cursor: submitting ? "wait" : "pointer",
        opacity: submitting ? 0.85 : 1,
        boxShadow: hover && !submitting ? "0 0 0 4px rgba(79,110,247,0.25)" : "0 0 0 0 rgba(79,110,247,0)",
        transition: "background 120ms ease, box-shadow 120ms ease",
        outlineColor: "rgba(79,110,247,0.4)",
      }}
    >
      {label}
    </button>
  );
}
