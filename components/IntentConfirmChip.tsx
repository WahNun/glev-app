"use client";

import { useEffect, useRef } from "react";
import type { IntentEnvelope } from "@/lib/ai/intentClassifier";

const ACCENT = "#8b5cf6";
const AUTO_DISMISS_MS = 3000;

/** Human-readable summary of a classified intent. */
function intentLabel(intent: IntentEnvelope): string {
  switch (intent.type) {
    case "log_bolus": {
      const { units, insulin_name } = intent.payload;
      const name = insulin_name ? ` · ${insulin_name}` : "";
      return `Bolus: ${units} E${name}`;
    }
    case "log_meal": {
      const text = intent.payload.input_text ?? "";
      return `Mahlzeit: ${text.length > 32 ? `${text.slice(0, 32)}…` : text}`;
    }
    case "log_exercise": {
      const parts: string[] = [];
      if (intent.payload.exercise_type) parts.push(intent.payload.exercise_type);
      if (intent.payload.duration_minutes) parts.push(`${intent.payload.duration_minutes} min`);
      return `Training${parts.length ? `: ${parts.join(" · ")}` : ""}`;
    }
    case "log_symptom": {
      const syms = intent.payload.symptom_types ?? [];
      return `Symptom${syms.length ? `: ${syms.join(", ")}` : ""}`;
    }
    case "edit_macro": {
      const fieldLabels: Record<string, string> = {
        carbs: "KH",
        protein: "Protein",
        fat: "Fett",
        calories: "kcal",
      };
      const label = fieldLabels[intent.payload.field] ?? intent.payload.field;
      return `Makro: ${label} = ${intent.payload.value}`;
    }
    default:
      return "Verstanden";
  }
}

interface Props {
  intent: IntentEnvelope;
  /** Confirm: fire the intent's CustomEvent and close the chip. */
  onConfirm: () => void;
  /**
   * Change: discard the intent, fall back to chat so the user can rephrase,
   * and close the chip.
   */
  onDismiss: () => void;
}

/**
 * IntentConfirmChip — a compact confirmation bar that appears after the voice
 * assistant classifies a write intent.
 *
 * It shows what was understood ("Bolus: 2 E") and gives the user two actions:
 *   ✓ Confirm — fires the intent's CustomEvent (opens the pre-filled log sheet)
 *   ✎ Change  — discards the intent and re-routes the transcript to chat
 *
 * After AUTO_DISMISS_MS the chip auto-dismisses via `onDismiss`, so an
 * incorrect mis-classification never silently blocks the UI.
 */
export default function IntentConfirmChip({ intent, onConfirm, onDismiss }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  // Intentionally not listing onDismiss — we only want this to run once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleConfirm = () => {
    clearTimer();
    onConfirm();
  };

  const handleDismiss = () => {
    clearTimer();
    onDismiss();
  };

  return (
    <>
      <style>{`
        @keyframes intentChipSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes intentChipProgress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
      <div
        role="status"
        aria-live="polite"
        aria-label={`Verstanden: ${intentLabel(intent)}. Bestätigen oder ändern?`}
        style={{
          flexShrink: 0,
          margin: "0 12px 6px",
          borderRadius: 12,
          background: "var(--surface-soft)",
          border: `1px solid ${ACCENT}55`,
          overflow: "hidden",
          animation: "intentChipSlideIn 0.2s ease",
        }}
      >
        {/* Progress bar — shrinks over AUTO_DISMISS_MS */}
        <div
          aria-hidden="true"
          style={{
            height: 2,
            background: `${ACCENT}88`,
            animation: `intentChipProgress ${AUTO_DISMISS_MS}ms linear forwards`,
          }}
        />

        {/* Content row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
          }}
        >
          {/* Ear / understood icon */}
          <span aria-hidden="true" style={{ fontSize: 14, flexShrink: 0 }}>
            🎙
          </span>

          {/* Label */}
          <span
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-strong)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {intentLabel(intent)}
          </span>

          {/* Change button */}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Ändern — Zurück zum Chat"
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 10px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface-alt)",
              color: "var(--text-body)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ✎ Ändern
          </button>

          {/* Confirm button */}
          <button
            type="button"
            onClick={handleConfirm}
            aria-label="Bestätigen"
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 10px",
              borderRadius: 8,
              border: "none",
              background: ACCENT,
              color: "var(--on-accent)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ✓ OK
          </button>
        </div>
      </div>
    </>
  );
}
