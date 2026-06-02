"use client";

import { useCallback, useRef, useState } from "react";
import { useVoxtral, type UseVoxtralReturn } from "./useVoxtral";
import { classifyIntent, type IntentEnvelope } from "@/lib/ai/intentClassifier";

export interface UseVoiceIntentsOptions {
  /**
   * Called when the intent is `fallback_chat`, or when `enabled` is false.
   * Wires directly to the existing Glev AI chat pipeline.
   */
  onFallbackTranscript: (text: string) => void;
  /** Called with in-progress partial text while the user speaks. */
  onPartialTranscript?: (text: string) => void;
  onError?: (err: string) => void;
  /**
   * Whether voice_intent_routing is active. When false the hook behaves
   * identically to calling useVoxtral directly — no classifier network call,
   * every transcript goes straight to onFallbackTranscript.
   */
  enabled: boolean;
}

export interface UseVoiceIntentsReturn extends UseVoxtralReturn {
  /**
   * A classified write-intent that is waiting for the user to confirm or
   * dismiss. Null when no intent is pending.
   */
  pendingIntent: IntentEnvelope | null;
  /** Dispatch the pending intent's CustomEvent and clear the pending state. */
  confirmPendingIntent: () => void;
  /**
   * Discard the pending intent and fall back to the normal chat pipeline
   * with the original transcript so the user can rephrase.
   */
  dismissPendingIntent: () => void;
}

/** Intents that require explicit user confirmation before firing. */
const WRITE_INTENTS = new Set([
  "log_bolus",
  "log_meal",
  "log_exercise",
  "log_symptom",
  "edit_macro",
]);

/** Dispatch a classified intent as the appropriate CustomEvent. */
function dispatchIntent(intent: IntentEnvelope): void {
  switch (intent.type) {
    case "log_bolus":
      window.dispatchEvent(
        new CustomEvent("glev:open-bolus-log", { detail: intent.payload }),
      );
      break;

    case "log_meal":
      window.dispatchEvent(
        new CustomEvent("glev:open-meal-log", { detail: intent.payload }),
      );
      break;

    case "log_exercise":
      window.dispatchEvent(
        new CustomEvent("glev:open-exercise-log", { detail: intent.payload }),
      );
      break;

    case "log_symptom":
      window.dispatchEvent(
        new CustomEvent("glev:open-symptom-log", { detail: intent.payload }),
      );
      break;

    case "edit_macro":
      window.dispatchEvent(
        new CustomEvent("glev:set-macro", { detail: intent.payload }),
      );
      break;

    case "navigate":
      window.dispatchEvent(
        new CustomEvent("glev:intent-navigate", {
          detail: { screen: intent.payload.screen },
        }),
      );
      break;

    default:
      break;
  }
}

/**
 * useVoiceIntents — wraps useVoxtral with intent classification.
 *
 * When `enabled` is true, the raw transcript is classified. Write intents
 * (log_bolus, log_meal, log_exercise, log_symptom, edit_macro) are held as
 * `pendingIntent` so the host component can show a confirmation chip before
 * any form is opened. Navigate intents and fallback_chat are dispatched/
 * forwarded immediately without a confirmation step.
 *
 * The user always taps "Speichern" in the target form before data is written
 * (compliance gate D-003 — no auto-save). The confirmation chip is an
 * additional safety checkpoint that lets the user correct mis-classifications
 * before the form even opens.
 *
 * Intent → CustomEvent mapping:
 *   log_bolus    → glev:open-bolus-log   { detail: BolusPayload }
 *   log_meal     → glev:open-meal-log    { detail: MealPayload }
 *   log_exercise → glev:open-exercise-log{ detail: ExercisePayload }
 *   log_symptom  → glev:open-symptom-log { detail: SymptomPayload }
 *   edit_macro   → glev:set-macro        { detail: EditMacroPayload } (existing)
 *   navigate     → glev:intent-navigate  { detail: { screen } }
 *   fallback_chat→ onFallbackTranscript(text)
 *
 * Returns the `UseVoxtralReturn` shape extended with `pendingIntent`,
 * `confirmPendingIntent`, and `dismissPendingIntent` so callers can
 * render a confirmation chip.
 */
export function useVoiceIntents({
  onFallbackTranscript,
  onPartialTranscript,
  onError,
  enabled,
}: UseVoiceIntentsOptions): UseVoiceIntentsReturn {
  const [pendingIntent, setPendingIntent] = useState<IntentEnvelope | null>(null);

  // Keep the original transcript so dismissal can fall back to chat.
  const pendingTranscriptRef = useRef<string>("");

  // Stable refs so the async classify callback always sees the latest values
  // without needing to be recreated on every render.
  const onFallbackRef = useRef(onFallbackTranscript);
  onFallbackRef.current = onFallbackTranscript;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const handleTranscript = useCallback(async (text: string) => {
    if (!enabledRef.current) {
      onFallbackRef.current(text);
      return;
    }

    let intent: IntentEnvelope;
    try {
      intent = await classifyIntent(text);
    } catch {
      onFallbackRef.current(text);
      return;
    }

    if (intent.type === "fallback_chat") {
      onFallbackRef.current(text);
      return;
    }

    // Navigate intents are side-effect-free (no data written), dispatch
    // immediately without a confirmation step.
    if (intent.type === "navigate") {
      dispatchIntent(intent);
      return;
    }

    if (WRITE_INTENTS.has(intent.type)) {
      // Hold the intent for explicit user confirmation.
      pendingTranscriptRef.current = text;
      setPendingIntent(intent);
      return;
    }

    // Unknown future intent types — dispatch immediately.
    dispatchIntent(intent);
  }, []);

  const confirmPendingIntent = useCallback(() => {
    setPendingIntent((current) => {
      if (current) dispatchIntent(current);
      return null;
    });
  }, []);

  const dismissPendingIntent = useCallback(() => {
    setPendingIntent((current) => {
      if (current) {
        onFallbackRef.current(pendingTranscriptRef.current);
      }
      return null;
    });
  }, []);

  const voxtralReturn = useVoxtral({
    onTranscript: (text) => { void handleTranscript(text); },
    onPartialTranscript,
    onError,
  });

  return {
    ...voxtralReturn,
    pendingIntent,
    confirmPendingIntent,
    dismissPendingIntent,
  };
}
