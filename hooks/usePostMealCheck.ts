"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export type Timepoint = "30min" | "1h" | "90min" | "2h" | "3h";

export type PendingMeal = {
  id: string;
  meal_time: string;
  name: string;
  timepoint: Timepoint;
  label: string;
};

type TimepointCfg = {
  key: Timepoint;
  column: "glucose_30min" | "glucose_1h" | "glucose_90min" | "glucose_2h" | "glucose_3h";
  label: string;
  minMinutes: number;
  maxMinutes: number;
};

const TIMEPOINT_CONFIG: TimepointCfg[] = [
  { key: "30min", column: "glucose_30min", label: "30 Minuten", minMinutes:  25, maxMinutes:  50 },
  { key: "1h",    column: "glucose_1h",    label: "1 Stunde",   minMinutes:  55, maxMinutes:  80 },
  { key: "90min", column: "glucose_90min", label: "90 Minuten", minMinutes:  85, maxMinutes: 110 },
  { key: "2h",    column: "glucose_2h",    label: "2 Stunden",  minMinutes: 115, maxMinutes: 150 },
  { key: "3h",    column: "glucose_3h",    label: "3 Stunden",  minMinutes: 175, maxMinutes: 210 },
];

type MealRow = {
  id: string;
  meal_time: string | null;
  created_at: string;
  input_text: string | null;
  glucose_30min: number | null;
  glucose_1h: number | null;
  glucose_90min: number | null;
  glucose_2h: number | null;
  glucose_3h: number | null;
};

function deriveName(text: string | null): string {
  if (!text) return "deine letzte Mahlzeit";
  const trimmed = text.trim();
  if (!trimmed) return "deine letzte Mahlzeit";
  const firstLine = trimmed.split(/\r?\n/)[0];
  return firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
}

/**
 * Polls Supabase every 60s (and on window focus) for the user's recent
 * meals and surfaces the *first* matching open timepoint:
 *   - meal is between minMinutes and maxMinutes old
 *   - the corresponding glucose_* column is still null
 *
 * Returns one PendingMeal at a time; if the user dismisses or fills it
 * the next tick will pick up the next due timepoint (across the same or
 * a different meal). Window covers up to 3.5h post-meal; older meals
 * are ignored.
 *
 * Uses meal_time when set (the wall-clock moment the meal was eaten),
 * falling back to created_at for legacy rows that don't have it.
 */
export function usePostMealCheck() {
  const [pendingMeal, setPendingMeal] = useState<PendingMeal | null>(null);

  const checkForPendingMeals = useCallback(async () => {
    if (!supabase) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setPendingMeal(null);
      return;
    }

    // Window = max maxMinutes of any timepoint, with a small slack so a
    // meal that just crossed into the 3h window still shows up before
    // its upper bound.
    const windowStart = new Date(Date.now() - 220 * 60_000).toISOString();

    const { data: meals, error } = await supabase
      .from("meals")
      .select("id, meal_time, created_at, input_text, glucose_30min, glucose_1h, glucose_90min, glucose_2h, glucose_3h")
      .eq("user_id", user.id)
      .or(`meal_time.gte.${windowStart},and(meal_time.is.null,created_at.gte.${windowStart})`)
      .order("meal_time", { ascending: false, nullsFirst: false })
      .limit(8);

    if (error || !meals || meals.length === 0) {
      setPendingMeal(null);
      return;
    }

    const now = Date.now();

    for (const meal of meals as MealRow[]) {
      const anchor = meal.meal_time ?? meal.created_at;
      if (!anchor) continue;
      const mealMs = new Date(anchor).getTime();
      if (!Number.isFinite(mealMs)) continue;
      const minutesSince = (now - mealMs) / 60_000;

      for (const tp of TIMEPOINT_CONFIG) {
        if (
          minutesSince >= tp.minMinutes &&
          minutesSince <= tp.maxMinutes &&
          meal[tp.column] === null
        ) {
          setPendingMeal({
            id: meal.id,
            meal_time: anchor,
            name: deriveName(meal.input_text),
            timepoint: tp.key,
            label: tp.label,
          });
          return;
        }
      }
    }

    setPendingMeal(null);
  }, []);

  useEffect(() => {
    checkForPendingMeals();
    const interval = setInterval(checkForPendingMeals, 60_000);
    const onFocus  = () => checkForPendingMeals();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }
    return () => {
      clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [checkForPendingMeals]);

  const dismiss = useCallback(() => setPendingMeal(null), []);

  return { pendingMeal, dismiss, refetch: checkForPendingMeals };
}
