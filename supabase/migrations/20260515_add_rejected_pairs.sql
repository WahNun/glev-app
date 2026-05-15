-- rejected_pairs — sticky "Nein, war anders" dismissals from the
-- ICR-relink panel on /insights (RelinkSourceLine). When a heuristic
-- ±30-min time-window pair is wrong AND the user explicitly says so,
-- we remember the (meal, bolus) pair so the panel never offers it
-- again on later visits. Without this table the dismissal lived only
-- in component state and reappeared on every reload (called out in
-- the dismissedIds inline comment).
--
-- The pair is the dedupe key, NOT just the bolus_id, because a bolus
-- could legitimately be re-suggested for a *different* meal in the
-- ±30-min window — only the rejected combination is poisoned.
--
-- Idempotent (safe to re-run via npm run db:migrate).

CREATE TABLE IF NOT EXISTS rejected_pairs (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_id     uuid        NOT NULL REFERENCES meals(id)         ON DELETE CASCADE,
  bolus_id    uuid        NOT NULL REFERENCES insulin_logs(id)  ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, meal_id, bolus_id)
);

COMMENT ON TABLE rejected_pairs IS 'Sticky dismissals of heuristic meal/bolus pair suggestions on /insights (Lucas-spec 2026-05-15).';

-- Per-user lookup is the hot path — the engine + UI both filter the
-- ±30-min pairs through `WHERE user_id = $1`. The PK already starts
-- with user_id so an extra index isn't strictly required, but adding
-- one explicitly keeps query plans stable if the PK ordering changes.
CREATE INDEX IF NOT EXISTS rejected_pairs_user_idx
  ON rejected_pairs (user_id, created_at DESC);

ALTER TABLE rejected_pairs ENABLE ROW LEVEL SECURITY;

-- Standard owner-only RLS — one policy per verb so we can tweak
-- individually later (e.g. add an admin override for support work).
DROP POLICY IF EXISTS rejected_pairs_select_own ON rejected_pairs;
CREATE POLICY rejected_pairs_select_own
  ON rejected_pairs FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS rejected_pairs_insert_own ON rejected_pairs;
CREATE POLICY rejected_pairs_insert_own
  ON rejected_pairs FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS rejected_pairs_delete_own ON rejected_pairs;
CREATE POLICY rejected_pairs_delete_own
  ON rejected_pairs FOR DELETE
  USING (user_id = auth.uid());
