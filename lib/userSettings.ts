/**
 * User preferences. Currently holds daily macro targets used by the
 * dashboard "Today's Macros" rings; future home for the remaining
 * localStorage-based settings (glucose range, ICR, CF, notification flags).
 *
 * Backed by the `user_settings` Postgres table (one row per auth user,
 * created on first save via upsert). All reads gracefully fall back to
 * DEFAULT_MACRO_TARGETS when no row exists, the user is signed out, or
 * Supabase is unreachable, so the dashboard never breaks for users who
 * haven't customised their goals yet.
 */

import { supabase } from "./supabase";

export interface MacroTargets {
  carbs:   number;
  protein: number;
  fat:     number;
  fiber:   number;
}

export const DEFAULT_MACRO_TARGETS: MacroTargets = {
  carbs:   250,
  protein: 120,
  fat:     80,
  fiber:   30,
};

/**
 * Returns the current user's macro targets, or DEFAULT_MACRO_TARGETS if no
 * row exists / user not signed in / network or RLS error. Safe to call on
 * the client during initial render — never throws.
 */
export async function fetchMacroTargets(): Promise<MacroTargets> {
  if (!supabase) return DEFAULT_MACRO_TARGETS;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_MACRO_TARGETS;

  const { data, error } = await supabase
    .from("user_settings")
    .select("target_carbs_g, target_protein_g, target_fat_g, target_fiber_g")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return DEFAULT_MACRO_TARGETS;
  return {
    carbs:   data.target_carbs_g   ?? DEFAULT_MACRO_TARGETS.carbs,
    protein: data.target_protein_g ?? DEFAULT_MACRO_TARGETS.protein,
    fat:     data.target_fat_g     ?? DEFAULT_MACRO_TARGETS.fat,
    fiber:   data.target_fiber_g   ?? DEFAULT_MACRO_TARGETS.fiber,
  };
}

/**
 * Upserts the macro targets for the signed-in user. Throws on auth or DB
 * error so callers can surface a UI error state.
 */
export async function saveMacroTargets(targets: MacroTargets): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id:          user.id,
      target_carbs_g:   Math.round(targets.carbs),
      target_protein_g: Math.round(targets.protein),
      target_fat_g:     Math.round(targets.fat),
      target_fiber_g:   Math.round(targets.fiber),
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}
