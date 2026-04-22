import { supabase } from "./supabase";

export interface ParsedFood { name: string; grams: number; }

export interface Meal {
  id: string;
  user_id: string;
  input_text: string;
  parsed_json: ParsedFood[];
  created_at: string;
}

export async function saveMeal(inputText: string, parsedJson: ParsedFood[]): Promise<Meal> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("meals")
    .insert({ user_id: user.id, input_text: inputText, parsed_json: parsedJson })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Meal;
}

export async function fetchMeals(): Promise<Meal[]> {
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase
    .from("meals")
    .select("id, user_id, input_text, parsed_json, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Meal[];
}
