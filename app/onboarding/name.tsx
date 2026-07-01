"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Shell,
  ACCENT,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
} from "./_shared";

export default function NameStep({
  onNext,
  onBack,
  onSkip,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [nameValue, setNameValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canContinue = nameValue.trim().length > 0;

  async function handleNext() {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase!.auth.getUser();
      if (user) {
        await supabase!
          .from("profiles")
          .update({ display_name: nameValue.trim() })
          .eq("user_id", user.id);
      }
    } catch {
      /* silent — non-critical, proceed regardless */
    } finally {
      setSubmitting(false);
    }
    onNext();
  }

  return (
    <Shell
      step={2}
      onNext={handleNext}
      onBack={onBack}
      onSkip={onSkip}
      primaryLabel={submitting ? "Speichern…" : "Weiter"}
      primaryDisabled={!canContinue || submitting}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
          Wie sollen wir dich nennen?
        </h1>
        <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
          Optional — du kannst das jederzeit ändern.
        </p>
      </div>

      <input
        type="text"
        autoFocus
        autoComplete="nickname"
        maxLength={60}
        placeholder="Dein Name oder Spitzname"
        value={nameValue}
        onChange={(e) => setNameValue(e.target.value)}
        style={{
          width: "100%",
          padding: "14px 16px",
          borderRadius: 12,
          border: `1px solid ${BORDER}`,
          background: SURFACE,
          color: TEXT,
          fontSize: 16,
          fontFamily: "inherit",
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      <button
        type="button"
        onClick={onSkip}
        style={{
          background: "transparent",
          border: "none",
          color: TEXT_FAINT,
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
          padding: "4px 0",
          textAlign: "center",
          alignSelf: "center",
        }}
      >
        Überspringen
      </button>
    </Shell>
  );
}
