import { supabase } from "./supabase";

export interface ParsedFood { name: string; grams: number; }

export interface Meal {
  id: string;
  user_id: string;
  input_text: string;
  parsed_json: ParsedFood[];
  glucose_before: number | null;
  carbs_grams: number | null;
  insulin_units: number | null;
  evaluation: string | null;
  created_at: string;
}

export interface SaveMealInput {
  inputText: string;
  parsedJson: ParsedFood[];
  glucoseBefore: number | null;
  carbsGrams: number;
  insulinUnits: number | null;
  evaluation: string | null;
}

export async function saveMeal(input: SaveMealInput): Promise<Meal> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("meals")
    .insert({
      user_id: user.id,
      input_text: input.inputText,
      parsed_json: input.parsedJson,
      glucose_before: input.glucoseBefore,
      carbs_grams: input.carbsGrams,
      insulin_units: input.insulinUnits,
      evaluation: input.evaluation,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Meal;
}

export async function fetchMeals(): Promise<Meal[]> {
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase
    .from("meals")
    .select("id, user_id, input_text, parsed_json, glucose_before, carbs_grams, insulin_units, evaluation, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Meal[];
}
