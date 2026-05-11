/**
 * Personal-info fields collected during onboarding and editable from
 * Settings. Lives on `profiles` (sex / birth_year / height_cm /
 * weight_kg). See migration `20260511_add_profile_personal_info.sql`.
 *
 * `sex` gates the cycle-logging surfaces:
 *   - 'female' / 'diverse' → cycle-logging Settings row + QuickAddMenu
 *     item are visible; user opts in via the existing toggle.
 *   - 'male'   → both surfaces are fully hidden.
 *   - null     → predates onboarding (or skipped) → treated as "not
 *     male" so existing users don't lose access.
 *
 * Read/write helpers mirror `cyclePrefs.ts` shape: graceful empty
 * fallbacks on signed-out / network error, throws on save so callers
 * can surface inline errors. We also broadcast a window event after a
 * successful save so already-mounted consumers (Settings, QuickAdd)
 * can react without a page reload.
 */

import { supabase } from "./supabase";

export type Sex = "female" | "male" | "diverse";

export type UserProfile = {
  sex: Sex | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
};

export const EMPTY_USER_PROFILE: UserProfile = {
  sex: null,
  birthYear: null,
  heightCm: null,
  weightKg: null,
};

/** Window event broadcast after a successful save. Consumers like
 *  QuickAddMenu listen so the cycle entry appears/disappears the
 *  moment the user changes their sex in Settings. */
export const USER_PROFILE_CHANGED_EVENT = "glev:user-profile-changed";

/** True when the cycle-logging surfaces should be visible at all
 *  (independent of the per-user opt-in toggle). False ONLY for
 *  explicit male sex; null/unset is treated as visible. */
export function cycleSurfacesAvailable(sex: Sex | null | undefined): boolean {
  return sex !== "male";
}

export async function fetchUserProfile(): Promise<UserProfile> {
  if (!supabase) return EMPTY_USER_PROFILE;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return EMPTY_USER_PROFILE;

  const { data, error } = await supabase
    .from("profiles")
    .select("sex, birth_year, height_cm, weight_kg")
    .eq("user_id", user.id)
    .maybeSingle();

  // 42703 = undefined_column → migration hasn't run yet. Surface as
  // empty profile so the rest of the app keeps working.
  if (error || !data) return EMPTY_USER_PROFILE;

  const sexRaw = data.sex;
  const sex: Sex | null =
    sexRaw === "female" || sexRaw === "male" || sexRaw === "diverse"
      ? sexRaw
      : null;

  return {
    sex,
    birthYear: typeof data.birth_year === "number" ? data.birth_year : null,
    heightCm: typeof data.height_cm === "number" ? data.height_cm : null,
    weightKg:
      typeof data.weight_kg === "number"
        ? data.weight_kg
        : data.weight_kg != null
          ? Number(data.weight_kg)
          : null,
  };
}

/** Save partial updates. Pass only the fields you want to change.
 *  Pass null to clear an optional field. `sex` and `birthYear` are
 *  validated client-side; the DB CHECK constraints are the final gate. */
export async function saveUserProfile(patch: Partial<UserProfile>): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const update: Record<string, unknown> = {};
  if ("sex" in patch) update.sex = patch.sex ?? null;
  if ("birthYear" in patch) update.birth_year = patch.birthYear ?? null;
  if ("heightCm" in patch) update.height_cm = patch.heightCm ?? null;
  if ("weightKg" in patch) update.weight_kg = patch.weightKg ?? null;

  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(USER_PROFILE_CHANGED_EVENT));
  }
}
