// DB-backed integration test for computeAdaptiveICR.
//
// This test inserts real Meal and InsulinLog rows into the Supabase
// test database via the service-role admin client, queries them back,
// and asserts that computeAdaptiveICR produces the expected global ICR.
// It validates the full data pipeline: DB schema → domain types → engine.
//
// Skip condition: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set.
// In CI those secrets exist; in offline environments the test is skipped.

import { test, expect, beforeAll, afterAll } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";

// ── Setup ────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SKIP         = !SUPABASE_URL || !SERVICE_KEY;

let admin: SupabaseClient;
let testUserId: string;

const insertedMealIds: string[]    = [];
const insertedBolusIds: string[]   = [];

// Stable base time for this test run (2 days ago, fully within 90-day window)
const BASE_ISO = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();

function minutesLater(base: string, mins: number): string {
  return new Date(new Date(base).getTime() + mins * 60_000).toISOString();
}

beforeAll(async () => {
  if (SKIP) return;

  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Provision a throw-away test user.
  const { data, error } = await admin.auth.admin.createUser({
    email: `icr-db-test-${Date.now()}@glev.test`,
    password: "Test_1234!_icr",
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  testUserId = data.user.id;
});

afterAll(async () => {
  if (SKIP || !admin) return;

  // Clean up boluses first (FK → meals).
  if (insertedBolusIds.length) {
    await admin.from("insulin_logs").delete().in("id", insertedBolusIds);
  }
  if (insertedMealIds.length) {
    await admin.from("meals").delete().in("id", insertedMealIds);
  }
  if (testUserId) {
    await admin.auth.admin.deleteUser(testUserId);
  }
});

// ── Helper: insert a FINAL meal and return its DB row ────────────────

async function insertFinalMeal(overrides: {
  carbs_grams: number;
  insulin_units: number;
  meal_time?: string;
  created_at?: string;
  evaluation?: string;
}): Promise<Meal> {
  const mealTime  = overrides.meal_time  ?? BASE_ISO;
  const createdAt = overrides.created_at ?? mealTime;
  // bg_2h_at = mealTime + 120 min → lifecycle resolves state="final".
  const bg2hAt    = minutesLater(mealTime, 120);

  const row = {
    user_id:       testUserId,
    input_text:    "test meal",
    parsed_json:   [],
    carbs_grams:   overrides.carbs_grams,
    protein_grams: 10,
    fat_grams:     5,
    fiber_grams:   2,
    insulin_units: overrides.insulin_units,
    meal_type:     "BALANCED",
    evaluation:    overrides.evaluation ?? "GOOD",
    glucose_before: 100,
    glucose_after:  120,
    glucose_2h:     120,
    bg_2h_at:       bg2hAt,
    outcome_state:  "final",
    meal_time:      mealTime,
    created_at:     createdAt,
  };

  const { data, error } = await admin.from("meals").insert(row).select("*").single();
  if (error) throw new Error(`insertFinalMeal: ${error.message}`);
  insertedMealIds.push((data as { id: string }).id);
  return data as Meal;
}

// ── Helper: insert a bolus log ────────────────────────────────────────

async function insertBolus(overrides: {
  units: number;
  created_at?: string;
  related_entry_id?: string | null;
}): Promise<InsulinLog> {
  const row = {
    user_id:          testUserId,
    insulin_type:     "bolus",
    insulin_name:     "Novorapid",
    units:            overrides.units,
    cgm_glucose_at_log: null,
    notes:            null,
    related_entry_id: overrides.related_entry_id ?? null,
    created_at:       overrides.created_at ?? BASE_ISO,
  };

  const { data, error } = await admin.from("insulin_logs").insert(row).select("*").single();
  if (error) throw new Error(`insertBolus: ${error.message}`);
  insertedBolusIds.push((data as { id: string }).id);
  return data as InsulinLog;
}

// ── DB integration test ───────────────────────────────────────────────

test("DB: computeAdaptiveICR with real Supabase rows yields expected ICR", async () => {
  if (SKIP) {
    console.log("[skip] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return;
  }

  // Insert test data:
  //   Meal A: 60g carbs, explicit bolus 5u → ICR 12  (GOOD)
  //   Meal B: 80g carbs, time-window bolus +10min 8u → ICR 10  (GOOD)
  //   Meal C: 45g carbs, insulin_units=3, no bolus → ICR 15  (GOOD)
  //   Meal D: 50g carbs, insulin_units=0, no bolus → excluded
  //
  // Expected sample size: 3 (A, B, C). Paired: 2 (A explicit, B time-window).
  // Avg ICR (all GOOD weight 1.0): (12 + 10 + 15) / 3 = 37 / 3 ≈ 12.333…

  const mealA = await insertFinalMeal({ carbs_grams: 60, insulin_units: 0, meal_time: BASE_ISO });
  const mealB = await insertFinalMeal({ carbs_grams: 80, insulin_units: 0, meal_time: minutesLater(BASE_ISO, 60) });
  const mealC = await insertFinalMeal({ carbs_grams: 45, insulin_units: 3, meal_time: minutesLater(BASE_ISO, 120) });
  const mealD = await insertFinalMeal({ carbs_grams: 50, insulin_units: 0, meal_time: minutesLater(BASE_ISO, 180) });

  const bolusA = await insertBolus({
    units: 5,
    created_at: BASE_ISO,
    related_entry_id: mealA.id,            // explicit pair
  });
  const bolusB = await insertBolus({
    units: 8,
    created_at: minutesLater(BASE_ISO, 70), // +10 min after mealB at offset 60 min
  });

  // Confirm the rows were written to the DB — query them back via admin.
  const { data: mealRows } = await admin
    .from("meals")
    .select("*")
    .in("id", [mealA.id, mealB.id, mealC.id, mealD.id])
    .order("created_at", { ascending: true });

  const { data: bolusRows } = await admin
    .from("insulin_logs")
    .select("*")
    .in("id", [bolusA.id, bolusB.id]);

  expect(mealRows).toHaveLength(4);
  expect(bolusRows).toHaveLength(2);

  // Run computeAdaptiveICR on the real DB rows (cast to domain types).
  const result = computeAdaptiveICR(
    mealRows as Meal[],
    bolusRows as InsulinLog[],
  );

  expect(result.sampleSize).toBe(3);                   // D excluded (no insulin)
  expect(result.pairedCount).toBe(2);                  // A (explicit) + B (time-window)
  expect(result.pairedExplicitCount).toBe(1);
  expect(result.pairedTimeWindowCount).toBe(1);
  expect(result.global).toBeCloseTo(37 / 3, 4);        // (12 + 10 + 15) / 3 ≈ 12.333
});
