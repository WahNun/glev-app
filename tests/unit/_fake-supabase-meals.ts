// Side-effect-only module: installs a configurable fake Supabase client on
// `globalThis._supabase` BEFORE `lib/supabase.ts` runs its singleton
// initialiser. Import this module as the very first import in any test file
// that calls `saveMeal` so the real Supabase client is never constructed.
//
// Covered table interactions inside `saveMeal`:
//   auth.getUser()                          — auth guard
//   from("meals").insert().select().single() — main row insert
//   from(other).*                           — userFoodHistory fire-and-forget
//                                             (swallowed by its own catch; we
//                                             return no-op responses so it
//                                             doesn't throw before catching)

export const FAKE_MEAL_ID = "meal-fake-id-001";
export const FAKE_USER_ID = "test-user-id";

let storedMealRow: Record<string, unknown> = {
  id: FAKE_MEAL_ID,
  user_id: FAKE_USER_ID,
  input_text: "Test meal",
  parsed_json: [],
  glucose_before: null,
  glucose_after: null,
  carbs_grams: 60,
  protein_grams: null,
  fat_grams: null,
  fiber_grams: null,
  calories: null,
  insulin_units: 4,
  meal_type: "BALANCED",
  evaluation: null,
  related_meal_id: null,
  pre_meal_trend: null,
  created_at: new Date().toISOString(),
  outcome_state: null,
  meal_time: null,
  min_bg_180: null,
  max_bg_180: null,
  time_to_peak_min: null,
  auc_180: null,
  had_hypo_window: null,
  min_bg_60_180: null,
  bg_1h: null,
  bg_1h_at: null,
  bg_2h: null,
  bg_2h_at: null,
  glucose_30min: null,
  glucose_30min_at: null,
  glucose_1h: null,
  glucose_1h_at: null,
  glucose_90min: null,
  glucose_90min_at: null,
  glucose_2h: null,
  glucose_2h_at: null,
  glucose_3h: null,
  glucose_3h_at: null,
};

export function setStoredMealRow(row: Partial<typeof storedMealRow>) {
  storedMealRow = { ...storedMealRow, ...row };
}

export function resetStoredMealRow() {
  storedMealRow = {
    ...storedMealRow,
    id: FAKE_MEAL_ID,
    user_id: FAKE_USER_ID,
    insulin_units: 4,
    meal_time: null,
    created_at: new Date().toISOString(),
  };
}

const noOpBuilder = {
  select(..._args: unknown[]) { return noOpBuilder; },
  insert(..._args: unknown[]) { return noOpBuilder; },
  update(..._args: unknown[]) { return noOpBuilder; },
  upsert(..._args: unknown[]) { return noOpBuilder; },
  eq(..._args: unknown[]) { return noOpBuilder; },
  maybeSingle: async () => ({ data: null, error: null }),
  single: async () => ({ data: null, error: null }),
  async then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
    return resolve({ data: [], error: null });
  },
};

const fakeClient = {
  auth: {
    async getUser() {
      return { data: { user: { id: FAKE_USER_ID } }, error: null };
    },
  },
  from(table: string) {
    if (table === "meals") {
      return {
        insert(_row: unknown) {
          return {
            select(_cols?: string) {
              return {
                async single() {
                  return { data: { ...storedMealRow }, error: null };
                },
              };
            },
          };
        },
        update(_patch: unknown) {
          return noOpBuilder;
        },
        select(_cols?: string) {
          return noOpBuilder;
        },
      };
    }
    // All other tables (user_food_history, user_settings, etc.) get a no-op
    // builder so the fire-and-forget branches complete silently.
    return noOpBuilder;
  },
};

(globalThis as { _supabase?: unknown })._supabase = fakeClient;
