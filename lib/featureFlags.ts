"use client";

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export type FeatureFlag = "ai_voice" | "voice_intent_routing";

/**
 * Email address that is allowed to use the ai_voice feature.
 *
 * Glev AI (Mistral chat, AI settings page, AI FAB) is under active
 * development and not yet ready for general users. Restricting it to
 * this email keeps the feature invisible to everyone else while Lucas
 * builds it out — exactly the same pattern as PlanSimulator's
 * NEXT_PUBLIC_ADMIN_EMAIL guard.
 */
const AI_OWNER_EMAIL = "lucas@wahnon-connect.com";

/**
 * Liest ein Feature-Flag für den eingeloggten User aus user_settings.feature_flags.
 * Gibt `null` zurück während geladen wird, `false` wenn kein Zugriff.
 *
 * Aktivieren für einen User (Datenbank-Ebene, wirkt nur wenn Email-Guard passt):
 *   UPDATE user_settings
 *     SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'), '{ai_voice}', 'true')
 *   WHERE user_id = '<uuid>';
 *
 * Wieder deaktivieren (alle):
 *   UPDATE user_settings
 *     SET feature_flags = feature_flags - 'ai_voice';
 *
 * Returns the value of a feature flag for the currently logged-in user.
 *
 * In automated tests (Playwright) you can skip the async Supabase lookup by
 * injecting a synchronous override before page load:
 *
 *   await context.addInitScript(() => {
 *     (window as any).__GLEV_FEATURE_FLAGS__ = { ai_voice: true };
 *   });
 *
 * When the override object is present and contains the requested flag, the
 * hook returns that value immediately (no network round-trip). This keeps
 * production code clean while making tests deterministic.
 */
export function useFeatureFlag(flag: FeatureFlag): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    const overrides = (window as unknown as Record<string, unknown>).__GLEV_FEATURE_FLAGS__;
    if (overrides !== null && typeof overrides === "object" && flag in (overrides as object)) {
      return (overrides as Record<string, boolean>)[flag] ?? null;
    }
    return null;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const overrides = (window as unknown as Record<string, unknown>).__GLEV_FEATURE_FLAGS__;
      if (overrides !== null && typeof overrides === "object" && flag in (overrides as object)) {
        return;
      }
    }

    if (!supabase) { setEnabled(false); return; }
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      if (!user) { setEnabled(false); return; }

      // ai_voice is restricted to the owner email while in development.
      // voice_intent_routing has no email guard — it's enabled per-user
      // via the feature_flags JSONB column in user_settings.
      if (flag === "ai_voice" && user.email !== AI_OWNER_EMAIL) {
        setEnabled(false);
        return;
      }

      supabase!
        .from("user_settings")
        .select("feature_flags")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          const flags = data?.feature_flags;
          setEnabled(typeof flags === "object" && flags !== null && flags[flag] === true);
        });
    });

    return () => { cancelled = true; };
  }, [flag]);

  return enabled;
}
