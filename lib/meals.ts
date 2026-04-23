import { supabase } from "./supabase";
import { logDebug } from "./debug";

export interface ParsedFood {
  name: string;
  grams: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
}

export interface Meal {
  id: string;
  user_id: string;
  input_text: string;
  parsed_json: ParsedFood[];
  glucose_before: number | null;
  glucose_after: number | null;
  carbs_grams: number | null;
  protein_grams: number | null;
  fat_grams: number | null;
  fiber_grams: number | null;
  calories: number | null;
  insulin_units: number | null;
  meal_type: string | null;
  evaluation: string | null;
  created_at: string;
}

export function computeCalories(carbs: number, protein: number, fat: number): number {
  return Math.round(carbs * 4 + protein * 4 + fat * 9);
}

export interface SaveMealInput {
  inputText: string;
  parsedJson: ParsedFood[];
  glucoseBefore: number | null;
  glucoseAfter: number | null;
  carbsGrams: number;
  proteinGrams: number;
  fatGrams: number;
  fiberGrams: number;
  calories: number;
  insulinUnits: number | null;
  mealType: string | null;
  evaluation: string | null;
}

export function classifyMeal(carbs: number, protein: number, fat: number): string {
  if (carbs >= 45) return "FAST_CARBS";
  if (protein >= 25 && protein > fat && protein > carbs) return "HIGH_PROTEIN";
  if (fat >= 20 && fat > protein && fat > carbs) return "HIGH_FAT";
  return "BALANCED";
}

export function computeEvaluation(carbsGrams: number, insulinUnits: number, glucoseBefore: number | null): string {
  const icr = 15;
  const cf  = 50;
  const target = 110;
  let est = carbsGrams / icr;
  if (glucoseBefore && glucoseBefore > target) est += (glucoseBefore - target) / cf;
  const ratio = insulinUnits / Math.max(est, 0.1);
  if (ratio > 1.35) return "HIGH";
  if (ratio < 0.65) return "LOW";
  return "GOOD";
}

export async function saveMeal(input: SaveMealInput): Promise<Meal> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not authenticated");

  const row: Record<string, unknown> = {
    user_id:        user.id,
    input_text:     input.inputText,
    parsed_json:    input.parsedJson,
    glucose_before: input.glucoseBefore,
    glucose_after:  input.glucoseAfter,
    carbs_grams:    input.carbsGrams,
    protein_grams:  input.proteinGrams ?? null,
    fat_grams:      input.fatGrams ?? null,
    fiber_grams:    input.fiberGrams ?? null,
    calories:       input.calories ?? null,
    insulin_units:  input.insulinUnits,
    meal_type:      input.mealType,
    evaluation:     input.evaluation,
  };

  const { data, error } = await supabase
    .from("meals")
    .insert(row)
    .select()
    .single();

  if (error) {
    if (error.message?.includes("column") && (error.message?.includes("protein_grams") || error.message?.includes("fat_grams") || error.message?.includes("fiber_grams") || error.message?.includes("calories"))) {
      delete row.protein_grams;
      delete row.fat_grams;
      delete row.fiber_grams;
      delete row.calories;
      const { data: d2, error: e2 } = await supabase.from("meals").insert(row).select().single();
      if (e2) throw new Error(e2.message);
      logDebug("MEAL_INSERT", { id: d2.id, carbs: input.carbsGrams, protein: input.proteinGrams, fat: input.fatGrams, fiber: input.fiberGrams, calories: input.calories, insulin: input.insulinUnits, glucose: input.glucoseBefore, mealType: input.mealType, evaluation: input.evaluation, note: "macro columns missing in DB" });
      return d2 as Meal;
    }
    throw new Error(error.message);
  }
  logDebug("MEAL_INSERT", { id: data.id, carbs: input.carbsGrams, protein: input.proteinGrams, fat: input.fatGrams, fiber: input.fiberGrams, calories: input.calories, insulin: input.insulinUnits, glucose: input.glucoseBefore, mealType: input.mealType, evaluation: input.evaluation });
  return data as Meal;
}

export async function deleteMeal(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("meals").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

const FULL_COLS = "id, user_id, input_text, parsed_json, glucose_before, glucose_after, carbs_grams, protein_grams, fat_grams, fiber_grams, calories, insulin_units, meal_type, evaluation, created_at";
const CORE_COLS = "id, user_id, input_text, parsed_json, glucose_before, carbs_grams, insulin_units, meal_type, evaluation, created_at";

export async function fetchMeals(): Promise<Meal[]> {
  if (!supabase) throw new Error("Supabase is not configured");

  let { data, error } = await supabase
    .from("meals")
    .select(FULL_COLS)
    .order("created_at", { ascending: false });

  if (error && error.message?.toLowerCase().includes("does not exist")) {
    const retry = await supabase
      .from("meals")
      .select(CORE_COLS)
      .order("created_at", { ascending: false });
    if (retry.error) throw new Error(retry.error.message);
    data = (retry.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      glucose_after: null,
      protein_grams: null,
      fat_grams: null,
      fiber_grams: null,
      calories: null,
    })) as unknown as typeof data;
    error = null;
  }

  if (error) throw new Error(error.message);
  return (data ?? []) as Meal[];
}

export async function seedMealsIfEmpty(): Promise<void> {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { count } = await supabase
    .from("meals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) > 0) return;

  const now = Date.now();
  const d = 86400000;

  const seeds = [
    { input_text: "Oatmeal with banana and honey", parsed_json: [{name:"Oatmeal",grams:80,carbs:54,protein:5,fat:3,fiber:8},{name:"Banana",grams:120,carbs:27,protein:1,fat:0,fiber:3},{name:"Honey",grams:15,carbs:13,protein:0,fat:0,fiber:0}], glucose_before:98, glucose_after:148, carbs_grams:94, insulin_units:6.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 29*d).toISOString() },
    { input_text: "Scrambled eggs with whole wheat toast", parsed_json: [{name:"Scrambled eggs",grams:150,carbs:2,protein:18,fat:14,fiber:0},{name:"Whole wheat toast",grams:60,carbs:28,protein:5,fat:2,fiber:4}], glucose_before:112, glucose_after:138, carbs_grams:30, insulin_units:2.0, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 28*d + 3*3600000).toISOString() },
    { input_text: "Pancakes with maple syrup", parsed_json: [{name:"Pancakes",grams:200,carbs:70,protein:8,fat:10,fiber:2},{name:"Maple syrup",grams:30,carbs:22,protein:0,fat:0,fiber:0}], glucose_before:105, glucose_after:205, carbs_grams:92, insulin_units:4.0, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 27*d).toISOString() },
    { input_text: "Turkey sandwich with apple", parsed_json: [{name:"Turkey",grams:80,carbs:0,protein:20,fat:3,fiber:0},{name:"Whole wheat bread",grams:60,carbs:28,protein:5,fat:2,fiber:4},{name:"Apple",grams:180,carbs:25,protein:0,fat:0,fiber:4}], glucose_before:118, glucose_after:145, carbs_grams:53, insulin_units:3.5, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 27*d + 4*3600000).toISOString() },
    { input_text: "Grilled chicken with sweet potato and broccoli", parsed_json: [{name:"Grilled chicken",grams:180,carbs:0,protein:42,fat:6,fiber:0},{name:"Sweet potato",grams:150,carbs:35,protein:2,fat:0,fiber:4},{name:"Broccoli",grams:100,carbs:7,protein:3,fat:0,fiber:3}], glucose_before:92, glucose_after:125, carbs_grams:42, insulin_units:3.0, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 26*d + 6*3600000).toISOString() },
    { input_text: "Salmon with quinoa and asparagus", parsed_json: [{name:"Salmon",grams:180,carbs:0,protein:38,fat:16,fiber:0},{name:"Quinoa",grams:100,carbs:20,protein:4,fat:2,fiber:3},{name:"Asparagus",grams:100,carbs:4,protein:3,fat:0,fiber:2}], glucose_before:101, glucose_after:120, carbs_grams:24, insulin_units:1.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 25*d + 6*3600000).toISOString() },
    { input_text: "Pizza 3 slices pepperoni", parsed_json: [{name:"Pizza slice",grams:280,carbs:90,protein:28,fat:24,fiber:3}], glucose_before:132, glucose_after:210, carbs_grams:90, insulin_units:5.0, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 25*d + 6*3600000).toISOString() },
    { input_text: "Greek yogurt with granola and berries", parsed_json: [{name:"Greek yogurt",grams:200,carbs:10,protein:18,fat:0,fiber:0},{name:"Granola",grams:50,carbs:32,protein:5,fat:6,fiber:3},{name:"Mixed berries",grams:100,carbs:12,protein:1,fat:0,fiber:3}], glucose_before:88, glucose_after:130, carbs_grams:54, insulin_units:3.8, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 24*d).toISOString() },
    { input_text: "Chicken rice bowl with vegetables", parsed_json: [{name:"Chicken breast",grams:180,carbs:0,protein:35,fat:5,fiber:0},{name:"White rice",grams:200,carbs:52,protein:4,fat:0,fiber:1},{name:"Mixed vegetables",grams:100,carbs:10,protein:2,fat:1,fiber:4}], glucose_before:115, glucose_after:148, carbs_grams:62, insulin_units:4.0, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 23*d + 4*3600000).toISOString() },
    { input_text: "Avocado toast with poached eggs", parsed_json: [{name:"Sourdough bread",grams:80,carbs:38,protein:6,fat:2,fiber:2},{name:"Avocado",grams:100,carbs:9,protein:2,fat:15,fiber:7},{name:"Poached eggs",grams:100,carbs:1,protein:13,fat:10,fiber:0}], glucose_before:95, glucose_after:118, carbs_grams:48, insulin_units:3.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 22*d).toISOString() },
    { input_text: "Pasta primavera with parmesan", parsed_json: [{name:"Penne pasta",grams:180,carbs:72,protein:12,fat:3,fiber:4},{name:"Mixed vegetables",grams:150,carbs:12,protein:4,fat:2,fiber:5},{name:"Parmesan",grams:20,carbs:0,protein:4,fat:5,fiber:0}], glucose_before:128, glucose_after:198, carbs_grams:84, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 21*d + 6*3600000).toISOString() },
    { input_text: "Steak with mashed potatoes and green beans", parsed_json: [{name:"Ribeye steak",grams:220,carbs:0,protein:48,fat:22,fiber:0},{name:"Mashed potatoes",grams:200,carbs:40,protein:4,fat:8,fiber:3},{name:"Green beans",grams:80,carbs:6,protein:2,fat:0,fiber:3}], glucose_before:108, glucose_after:145, carbs_grams:46, insulin_units:4.0, meal_type:"HIGH_FAT", evaluation:"GOOD", created_at: new Date(now - 21*d + 6*3600000).toISOString() },
    { input_text: "Smoothie banana berries protein powder", parsed_json: [{name:"Banana",grams:120,carbs:27,protein:1,fat:0,fiber:3},{name:"Mixed berries",grams:100,carbs:12,protein:1,fat:0,fiber:3},{name:"Protein powder",grams:30,carbs:3,protein:24,fat:1,fiber:0},{name:"Almond milk",grams:240,carbs:8,protein:2,fat:3,fiber:1}], glucose_before:90, glucose_after:160, carbs_grams:50, insulin_units:2.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 20*d).toISOString() },
    { input_text: "Sushi 10 pieces salmon and tuna", parsed_json: [{name:"Sushi rice",grams:200,carbs:50,protein:4,fat:0,fiber:1},{name:"Salmon",grams:80,carbs:0,protein:16,fat:5,fiber:0},{name:"Tuna",grams:60,carbs:0,protein:14,fat:1,fiber:0}], glucose_before:104, glucose_after:138, carbs_grams:50, insulin_units:3.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 19*d + 6*3600000).toISOString() },
    { input_text: "Chili con carne with cornbread", parsed_json: [{name:"Chili con carne",grams:300,carbs:32,protein:22,fat:10,fiber:8},{name:"Cornbread",grams:80,carbs:30,protein:4,fat:6,fiber:2}], glucose_before:122, glucose_after:178, carbs_grams:62, insulin_units:3.0, meal_type:"BALANCED", evaluation:"LOW", created_at: new Date(now - 18*d + 6*3600000).toISOString() },
    { input_text: "Cheese omelet with hash browns", parsed_json: [{name:"Cheese omelet",grams:200,carbs:2,protein:22,fat:22,fiber:0},{name:"Hash browns",grams:150,carbs:30,protein:3,fat:8,fiber:2}], glucose_before:97, glucose_after:128, carbs_grams:32, insulin_units:2.0, meal_type:"HIGH_FAT", evaluation:"GOOD", created_at: new Date(now - 17*d).toISOString() },
    { input_text: "Chicken Caesar salad with croutons", parsed_json: [{name:"Romaine lettuce",grams:150,carbs:5,protein:2,fat:0,fiber:3},{name:"Grilled chicken",grams:150,carbs:0,protein:30,fat:5,fiber:0},{name:"Caesar dressing",grams:40,carbs:2,protein:1,fat:16,fiber:0},{name:"Croutons",grams:30,carbs:15,protein:2,fat:3,fiber:1}], glucose_before:85, glucose_after:108, carbs_grams:22, insulin_units:1.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 16*d + 4*3600000).toISOString() },
    { input_text: "Beef tacos three corn tortillas", parsed_json: [{name:"Corn tortillas",grams:90,carbs:42,protein:4,fat:3,fiber:4},{name:"Ground beef",grams:120,carbs:0,protein:24,fat:12,fiber:0},{name:"Toppings",grams:60,carbs:6,protein:1,fat:2,fiber:1}], glucose_before:118, glucose_after:148, carbs_grams:48, insulin_units:3.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 15*d + 6*3600000).toISOString() },
    { input_text: "Pho noodle soup with beef", parsed_json: [{name:"Rice noodles",grams:200,carbs:44,protein:4,fat:0,fiber:2},{name:"Beef slices",grams:100,carbs:0,protein:20,fat:6,fiber:0},{name:"Broth and vegetables",grams:400,carbs:8,protein:4,fat:2,fiber:2}], glucose_before:110, glucose_after:162, carbs_grams:52, insulin_units:2.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 14*d + 6*3600000).toISOString() },
    { input_text: "Protein bar and apple", parsed_json: [{name:"Protein bar",grams:60,carbs:28,protein:20,fat:8,fiber:5},{name:"Apple",grams:180,carbs:25,protein:0,fat:0,fiber:4}], glucose_before:78, glucose_after:120, carbs_grams:53, insulin_units:3.0, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 13*d + 3*3600000).toISOString() },
    { input_text: "Cereal with whole milk and sliced banana", parsed_json: [{name:"Corn flakes cereal",grams:60,carbs:48,protein:3,fat:1,fiber:2},{name:"Whole milk",grams:240,carbs:12,protein:8,fat:8,fiber:0},{name:"Banana",grams:100,carbs:23,protein:1,fat:0,fiber:3}], glucose_before:102, glucose_after:188, carbs_grams:83, insulin_units:4.0, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 12*d).toISOString() },
    { input_text: "Stir fry vegetables with tofu and brown rice", parsed_json: [{name:"Tofu",grams:150,carbs:2,protein:16,fat:8,fiber:1},{name:"Mixed vegetables",grams:200,carbs:14,protein:4,fat:2,fiber:6},{name:"Brown rice",grams:180,carbs:38,protein:4,fat:2,fiber:3},{name:"Soy sauce",grams:20,carbs:2,protein:1,fat:0,fiber:0}], glucose_before:115, glucose_after:145, carbs_grams:56, insulin_units:4.0, meal_type:"BALANCED", evaluation:"GOOD", created_at: new Date(now - 11*d + 6*3600000).toISOString() },
    { input_text: "Burger with fries", parsed_json: [{name:"Beef burger",grams:180,carbs:0,protein:28,fat:18,fiber:0},{name:"Burger bun",grams:60,carbs:30,protein:5,fat:3,fiber:2},{name:"French fries",grams:150,carbs:40,protein:3,fat:12,fiber:3}], glucose_before:130, glucose_after:68, carbs_grams:70, insulin_units:7.5, meal_type:"HIGH_FAT", evaluation:"HIGH", created_at: new Date(now - 10*d + 6*3600000).toISOString() },
    { input_text: "Lentil soup with crusty bread", parsed_json: [{name:"Lentil soup",grams:350,carbs:40,protein:18,fat:4,fiber:14},{name:"Crusty bread",grams:80,carbs:40,protein:4,fat:1,fiber:2}], glucose_before:95, glucose_after:142, carbs_grams:80, insulin_units:5.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 9*d + 4*3600000).toISOString() },
    { input_text: "Overnight oats with almond butter and berries", parsed_json: [{name:"Rolled oats",grams:80,carbs:54,protein:6,fat:4,fiber:8},{name:"Almond butter",grams:30,carbs:3,protein:6,fat:16,fiber:2},{name:"Mixed berries",grams:100,carbs:12,protein:1,fat:0,fiber:3},{name:"Almond milk",grams:120,carbs:4,protein:1,fat:2,fiber:0}], glucose_before:88, glucose_after:135, carbs_grams:73, insulin_units:5.0, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 8*d).toISOString() },
    { input_text: "Tuna salad wrap with spinach", parsed_json: [{name:"Canned tuna",grams:150,carbs:0,protein:32,fat:3,fiber:0},{name:"Whole wheat wrap",grams:70,carbs:32,protein:5,fat:4,fiber:4},{name:"Spinach and vegetables",grams:80,carbs:5,protein:2,fat:0,fiber:2},{name:"Mayo",grams:20,carbs:0,protein:0,fat:14,fiber:0}], glucose_before:106, glucose_after:125, carbs_grams:37, insulin_units:2.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 7*d + 4*3600000).toISOString() },
    { input_text: "Roast chicken with roasted vegetables and potatoes", parsed_json: [{name:"Roast chicken",grams:200,carbs:0,protein:44,fat:12,fiber:0},{name:"Roasted potatoes",grams:200,carbs:36,protein:4,fat:6,fiber:4},{name:"Roasted vegetables",grams:150,carbs:14,protein:3,fat:4,fiber:5}], glucose_before:124, glucose_after:158, carbs_grams:50, insulin_units:3.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 6*d + 6*3600000).toISOString() },
    { input_text: "French toast with fruit compote", parsed_json: [{name:"French toast",grams:180,carbs:56,protein:12,fat:10,fiber:2},{name:"Fruit compote",grams:80,carbs:20,protein:0,fat:0,fiber:2}], glucose_before:92, glucose_after:168, carbs_grams:76, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"LOW", created_at: new Date(now - 5*d).toISOString() },
    { input_text: "Shrimp stir fry with jasmine rice", parsed_json: [{name:"Shrimp",grams:150,carbs:0,protein:28,fat:2,fiber:0},{name:"Jasmine rice",grams:200,carbs:52,protein:4,fat:0,fiber:1},{name:"Stir fry vegetables",grams:150,carbs:12,protein:3,fat:2,fiber:4},{name:"Oyster sauce",grams:20,carbs:4,protein:0,fat:0,fiber:0}], glucose_before:99, glucose_after:138, carbs_grams:68, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 4*d + 6*3600000).toISOString() },
    { input_text: "Cheese quesadilla with guacamole", parsed_json: [{name:"Flour tortillas",grams:80,carbs:40,protein:5,fat:4,fiber:2},{name:"Cheddar cheese",grams:60,carbs:0,protein:10,fat:14,fiber:0},{name:"Guacamole",grams:80,carbs:6,protein:1,fat:12,fiber:4}], glucose_before:114, glucose_after:52, carbs_grams:46, insulin_units:6.5, meal_type:"HIGH_FAT", evaluation:"HIGH", created_at: new Date(now - 3*d + 6*3600000).toISOString() },
    { input_text: "Oatmeal with blueberries and walnuts", parsed_json: [{name:"Steel cut oats",grams:80,carbs:50,protein:6,fat:4,fiber:8},{name:"Blueberries",grams:100,carbs:14,protein:1,fat:0,fiber:4},{name:"Walnuts",grams:30,carbs:2,protein:4,fat:18,fiber:2}], glucose_before:96, glucose_after:142, carbs_grams:66, insulin_units:4.5, meal_type:"FAST_CARBS", evaluation:"GOOD", created_at: new Date(now - 2*d).toISOString() },
    { input_text: "Grilled salmon with quinoa and roasted broccoli", parsed_json: [{name:"Grilled salmon",grams:200,carbs:0,protein:40,fat:18,fiber:0},{name:"Quinoa",grams:120,carbs:24,protein:5,fat:2,fiber:3},{name:"Roasted broccoli",grams:150,carbs:11,protein:4,fat:4,fiber:5}], glucose_before:108, glucose_after:130, carbs_grams:35, insulin_units:2.5, meal_type:"HIGH_PROTEIN", evaluation:"GOOD", created_at: new Date(now - 1*d + 6*3600000).toISOString() },
  ];

  await supabase.from("meals").insert(
    seeds.map(s => ({ ...s, user_id: user.id }))
  );
}
