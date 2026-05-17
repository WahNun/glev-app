-- user_food_history — personalised lookup layer that sits BEFORE the
-- OpenFoodFacts/USDA/GPT pipeline in lib/nutrition/aggregate.ts.
--
-- Goal (Phase B): when the user types an item they've logged before,
-- skip the slow lookup pipeline AND honour any explicit corrections
-- they made in the chat-macros flow ("the banana was 150g, not 120g").
--
-- Two row sources:
--   * 'history'        — auto-recorded from saveMeal() with a running
--                        average of per-100g macros + typical grams.
--                        Each new occurrence blends in via weighted
--                        average (new_val = (old*n + sample)/(n+1)).
--   * 'user_confirmed' — written by the chat-macros correction flow.
--                        Last-wins overwrite, stays sticky against
--                        future 'history' upserts (chat corrections
--                        outrank passive auto-collection).
--
-- The shape mirrors NutritionPer100 from lib/nutrition/types.ts: per-
-- 100g/ml macros + a typical portion size in grams (for liquids ml is
-- stored as g, matching the rest of the pipeline). Storing per-100g
-- not per-portion lets the same row serve a 50g and 200g portion of
-- the same item without losing fidelity.
--
-- Idempotent — safe to re-run via npm run db:migrate.

CREATE TABLE IF NOT EXISTS user_food_history (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- normalize_name(input): trim + lowercase + collapse whitespace +
  -- strip ONE trailing 's' for stems of length >= 4. Computed client-
  -- side (lib/nutrition/userFoodHistory.ts) so the same logic is
  -- shared between writes and lookups. "Banane" / "banane" / "bananen"
  -- all converge to "banane".
  normalized_name  text        NOT NULL,
  display_name     text        NOT NULL,

  -- Per-100g/ml values. Floats (not integers) so the running average
  -- doesn't round-down sub-gram differences after a handful of
  -- samples. Constraints prevent negative and clearly-impossible values
  -- (e.g. 200g of carbs per 100g) — these would point at a
  -- normalisation bug, not a legitimate food.
  typical_grams    numeric(7,2) NOT NULL CHECK (typical_grams  > 0 AND typical_grams  <= 5000),
  carbs_per_100g   numeric(6,2) NOT NULL CHECK (carbs_per_100g   >= 0 AND carbs_per_100g   <= 100),
  protein_per_100g numeric(6,2) NOT NULL CHECK (protein_per_100g >= 0 AND protein_per_100g <= 100),
  fat_per_100g     numeric(6,2) NOT NULL CHECK (fat_per_100g     >= 0 AND fat_per_100g     <= 100),
  fiber_per_100g   numeric(6,2) NOT NULL DEFAULT 0 CHECK (fiber_per_100g >= 0 AND fiber_per_100g <= 100),

  source           text        NOT NULL CHECK (source IN ('history','user_confirmed')),
  occurrences      integer     NOT NULL DEFAULT 1 CHECK (occurrences >= 1),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),

  -- One row per (user, normalized name). The lookup hot path is
  -- (user_id = $1 AND normalized_name = $2), so this unique index
  -- also doubles as the read index.
  UNIQUE (user_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS user_food_history_user_seen_idx
  ON user_food_history (user_id, last_seen_at DESC);

COMMENT ON TABLE user_food_history IS
  'Per-user food memory — caches typical portion and per-100g macros for items the user has logged. Read before OFF/USDA/GPT in the nutrition pipeline (Phase B).';

ALTER TABLE user_food_history ENABLE ROW LEVEL SECURITY;

-- Standard owner-only RLS. The service-role backfill script bypasses
-- RLS via the service key, so no admin override needed here.
DROP POLICY IF EXISTS user_food_history_select_own ON user_food_history;
CREATE POLICY user_food_history_select_own
  ON user_food_history FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_food_history_insert_own ON user_food_history;
CREATE POLICY user_food_history_insert_own
  ON user_food_history FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_food_history_update_own ON user_food_history;
CREATE POLICY user_food_history_update_own
  ON user_food_history FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_food_history_delete_own ON user_food_history;
CREATE POLICY user_food_history_delete_own
  ON user_food_history FOR DELETE
  USING (user_id = auth.uid());
