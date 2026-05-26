"use client";

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export type FeatureFlag = "ai_voice";

/**
 * Liest ein Feature-Flag für den eingeloggten User aus user_settings.feature_flags.
 * Gibt `false` zurück während geladen wird oder wenn der User keinen Zugriff hat.
 *
 * Aktivieren für einen User:
 *   UPDATE user_settings
 *     SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'), '{ai_voice}', 'true')
 *   WHERE user_id = '<uuid>';
 *
 * Aktivieren für alle User auf einmal:
 *   UPDATE user_settings
 *     SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'), '{ai_voice}', 'true');
 *
 * Wieder deaktivieren (alle):
 *   UPDATE user_settings
 *     SET feature_flags = feature_flags - 'ai_voice';
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
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
