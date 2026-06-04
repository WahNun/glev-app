-- Phase 3: Optimistic UI refinement store.
--
-- When OPTIMISTIC_REFINEMENT=true, toolLogMealEntry emits a meal_prep frame
-- immediately (using Mistral's estimates) and runs aggregateNutrition() in a
-- detached promise. Once the aggregator resolves, it writes the refined
-- per-item sources here. The client polls or subscribes via Realtime to pick
-- up the update and swap ✨→✅ badges without any re-render flicker.
--
-- id            = meal_prep_id echoed from the initial SSE frame (UUID v4).
-- items_refined = NutritionItem[] JSON — same shape as MealPendingPayload.items.
-- status        = 'pending' | 'completed' | 'failed'
-- completed_at  = set when aggregator finishes (success or failure).

CREATE TABLE IF NOT EXISTS meal_prep_refinements (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items_refined JSONB       NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  completed_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users may only read their own refinement rows; writes go through
-- the service-role key (server-side aggregator route).
ALTER TABLE meal_prep_refinements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_refinements"
  ON meal_prep_refinements
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service-role bypass (INSERT/UPDATE come from the aggregator edge function).
-- No explicit service-role policy needed — service-role bypasses RLS by default.

-- Index for fast lookup by (user_id, id) — both columns are in every query.
CREATE INDEX IF NOT EXISTS meal_prep_refinements_user_id_idx
  ON meal_prep_refinements (user_id, id);

-- Enable Supabase Realtime for this table so the client can subscribe
-- to changes via the Realtime channel.
ALTER PUBLICATION supabase_realtime ADD TABLE meal_prep_refinements;
