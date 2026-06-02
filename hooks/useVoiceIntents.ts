"use client";

import { useCallback, useRef } from "react";
import { useVoxtral, type UseVoxtralReturn } from "./useVoxtral";
import { classifyIntent } from "@/lib/ai/intentClassifier";

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

/**
 * useVoiceIntents — wraps useVoxtral with intent classification.
 *
 * When `enabled` is true, the raw transcript is classified and dispatched
 * as the appropriate CustomEvent so the target log sheet can pre-fill its
 * form. The user always sees the pre-filled sheet and must tap "Speichern"
 * before any data is written (compliance gate D-003 — no auto-save).
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
 * Returns the same { isListening, startListening, stopListening } shape
 * as useVoxtral so callers can swap in this hook with zero API changes.
 */
export function useVoiceIntents({
  onFallbackTranscript,
  onPartialTranscript,
  onError,
  enabled,
}: UseVoiceIntentsOptions): UseVoxtralReturn {
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

    let intent;
    try {
      intent = await classifyIntent(text);
    } catch {
      onFallbackRef.current(text);
      return;
    }

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
        // glev:set-macro is the existing event used by the engine macros screen.
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

      case "fallback_chat":
      default:
        onFallbackRef.current(text);
        break;
    }
  }, []);

  return useVoxtral({
    onTranscript: (text) => { void handleTranscript(text); },
    onPartialTranscript,
    onError,
  });
}
