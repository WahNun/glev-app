"use client";

import { useFeatureFlag } from "./featureFlags";
import { usePlan } from "@/hooks/usePlan";

/**
 * Returns whether the current user can access Glev AI.
 *
 * Access is granted when EITHER:
 *   1. Admin has set the ai_voice flag in user_settings.feature_flags
 *      (Friends & Family / individual beta-tester override)
 *   2. User has Glev Smart, Pro, or Plus subscription (plan-gated)
 *
 * Returns null while either check is still loading.
 */
export function useGlevAIAccess(): boolean | null {
  const adminOverride = useFeatureFlag("ai_voice");
  const { canAccess, loading } = usePlan();

  // Admin override takes priority — skip plan check entirely.
  if (adminOverride === true) return true;

  // Either check still loading.
  if (adminOverride === null || loading) return null;

  return canAccess("glev_ai");
}
