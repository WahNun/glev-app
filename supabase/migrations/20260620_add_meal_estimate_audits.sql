-- Macros Correction Audit Layer
-- Tracks the original AI/aggregator estimate vs the final saved macros per meal.
-- Used for Mistral-vs-OpenAI quality A/B and ongoing correction-rate monitoring.

CREATE TABLE meal_estimate_audits (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id               uuid        NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- AI-provided estimate (pre-user-edit)
  ai_estimate_kh_g      numeric,
  ai_estimate_protein_g numeric,
  ai_estimate_fat_g     numeric,
  ai_estimate_fiber_g   numeric,
  -- Which source/model produced the estimate
  ai_source             text,        -- 'openai' | 'pixtral' | 'aggregator' | 'user_history' | 'off' | 'usda' | 'unknown'
  ai_model_id           text,        -- 'gpt-4o-mini' | 'pixtral-12b-2409' | null for DB sources
  ai_request_id         text,        -- nullable provider request ID for cost attribution
  -- Final values persisted to meals (after user edits)
  final_kh_g            numeric,
  final_protein_g       numeric,
  final_fat_g           numeric,
  final_fiber_g         numeric,
  -- Derived: signed % deviation of final vs AI estimate for carbs
  diff_pct_kh           numeric GENERATED ALWAYS AS (
    (final_kh_g - ai_estimate_kh_g) / NULLIF(ai_estimate_kh_g, 0) * 100
  ) STORED,
  -- Derived: true when absolute carb deviation exceeds 5% threshold
  user_corrected        boolean GENERATED ALWAYS AS (
    CASE
      WHEN ai_estimate_kh_g IS NOT NULL AND ai_estimate_kh_g <> 0
      THEN ABS((final_kh_g - ai_estimate_kh_g) / ai_estimate_kh_g * 100) > 5
      ELSE false
    END
  ) STORED,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- RLS: users can read their own audit rows; service role handles writes.
ALTER TABLE meal_estimate_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_estimate_audits_own_select"
  ON meal_estimate_audits FOR SELECT
  USING (auth.uid() = user_id);

-- Indexes for the admin aggregate queries.
CREATE INDEX meal_estimate_audits_user_created_idx
  ON meal_estimate_audits (user_id, created_at DESC);

CREATE INDEX meal_estimate_audits_source_model_idx
  ON meal_estimate_audits (ai_source, ai_model_id, created_at DESC);
