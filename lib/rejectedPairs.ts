/**
 * lib/rejectedPairs.ts — sticky "Nein, war anders" dismissals from the
 * ICR-relink panel (RelinkSourceLine on /insights).
 *
 * When the user rejects a heuristic ±30-min time-window pair, we
 * persist the (meal_id, bolus_id) tuple in the `rejected_pairs` table
 * (see supabase/migrations/20260515_add_rejected_pairs.sql) so the
 * panel never re-offers that same combination on future loads.
 *
 * Keying on the pair (not just bolus_id) lets a bolus still be
 * suggested for a *different* meal in the ±30-min window if the
 * heuristic finds one — only the explicitly-rejected combination is
 * poisoned.
 */

import { supabase } from "./supabase";

export type RejectedPairKey = `${string}|${string}`;

export function pairKey(mealId: string, bolusId: string): RejectedPairKey {
  return `${mealId}|${bolusId}`;
}

/** Fetch all sticky dismissals for the signed-in user. Returns an
 *  empty Set on auth/db error so callers can fail open (worst case:
 *  the user sees a row they already dismissed and re-dismisses it). */
export async function fetchRejectedPairs(): Promise<Set<RejectedPairKey>> {
  const out = new Set<RejectedPairKey>();
  if (!supabase) return out;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return out;
  const { data, error } = await supabase
    .from("rejected_pairs")
    .select("meal_id, bolus_id")
    .eq("user_id", user.id);
  if (error || !data) return out;
  for (const row of data) {
    if (typeof row.meal_id === "string" && typeof row.bolus_id === "string") {
      out.add(pairKey(row.meal_id, row.bolus_id));
    }
  }
  return out;
}

/** Persist a dismissal. Idempotent — duplicate inserts are absorbed
 *  by the (user_id, meal_id, bolus_id) primary key via upsert with
 *  `ignoreDuplicates`. Throws so the caller can roll back its
 *  optimistic UI state if the write fails. */
export async function addRejectedPair(mealId: string, bolusId: string): Promise<void> {
  if (!supabase) throw new Error("supabase-not-configured");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not-authenticated");
  const { error } = await supabase
    .from("rejected_pairs")
    .upsert(
      { user_id: user.id, meal_id: mealId, bolus_id: bolusId },
      { onConflict: "user_id,meal_id,bolus_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}
