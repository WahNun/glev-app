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
 * Returns null only while the plan check is loading. The admin-override
 * feature flag is NOT awaited — if it is still resolving it is treated as
 * false so a slow Supabase session cannot permanently block the settings
 * screen. When the flag later resolves to true the hook re-renders and
 * grants access immediately.
 */
export function useGlevAIAccess(): boolean | null {
  const adminOverride = useFeatureFlag("ai_voice");
  const { canAccess, loading } = usePlan();

  // Admin override takes priority — skip plan check entirely.
  if (adminOverride === true) return true;

  // Block only while the plan fetch is in flight; usePlan already falls
  // back to "free" on network errors so loading is always temporary.
  if (loading) return null;

  return canAccess("glev_ai");
}
