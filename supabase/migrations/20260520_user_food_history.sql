-- ============================================================
-- Phase B: add size_modifier to user_food_history
-- ============================================================
-- MANUAL APPLY REQUIRED — do not run automatically.
-- Apply via Supabase Dashboard → SQL Editor, or via the CLI:
--   supabase db push  (requires a linked project)
--
-- This file is self-contained: all CREATE/ALTER statements use
-- IF NOT EXISTS / IF EXISTS guards so re-running is safe.
--
-- Phase A (20260517_add_user_food_history.sql) must be applied
-- first — it creates the table itself.
-- ============================================================

-- 1. Add the nullable size_modifier column.
--    NULL  = plain unmodified portion ("Banane").
--    Non-null = size adjective ("klein", "groß", "halb", …).
ALTER TABLE user_food_history
  ADD COLUMN IF NOT EXISTS size_modifier text;

-- 2. Drop the Phase-A unique constraint so we can replace it with
--    the COALESCE-based index below.
--    The constraint was created via the inline UNIQUE(user_id, normalized_name)
--    clause, so Postgres auto-names it "<table>_<cols>_key".
ALTER TABLE user_food_history
  DROP CONSTRAINT IF EXISTS user_food_history_user_id_normalized_name_key;

-- 3. New unique index: COALESCE maps NULL → '' so that
--    (user1, 'banane', NULL) and (user1, 'banane', 'groß') occupy
--    separate rows while two writes with the same non-NULL modifier
--    still conflict and resolve via upsert.
--    This replaces the old single-column uniqueness guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS user_food_history_name_modifier_uniq
  ON user_food_history (user_id, normalized_name, COALESCE(size_modifier, ''));

-- 4. Lookup index — speeds up the per-user batch read in
--    lookupUserFoodHistory (SELECT … WHERE user_id = $1 AND normalized_name = ANY($2)).
--    Idempotent: CREATE INDEX IF NOT EXISTS is safe to re-run.
CREATE INDEX IF NOT EXISTS user_food_history_lookup_idx
  ON user_food_history (user_id, normalized_name);

-- 5. RLS — enable and create per-user isolation policies.
--    All guards use IF NOT EXISTS / DO blocks so this script is
--    safe to re-apply without duplicating policies.
ALTER TABLE user_food_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- SELECT: users see only their own rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_food_history'
      AND policyname = 'user_food_history_select'
  ) THEN
    CREATE POLICY user_food_history_select
      ON user_food_history FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- INSERT: users may only insert rows for themselves.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_food_history'
      AND policyname = 'user_food_history_insert'
  ) THEN
    CREATE POLICY user_food_history_insert
      ON user_food_history FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  -- UPDATE: users may only update their own rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_food_history'
      AND policyname = 'user_food_history_update'
  ) THEN
    CREATE POLICY user_food_history_update
      ON user_food_history FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  -- DELETE: users may only delete their own rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_food_history'
      AND policyname = 'user_food_history_delete'
  ) THEN
    CREATE POLICY user_food_history_delete
      ON user_food_history FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END;
$$;

-- 6. Document the column semantics.
COMMENT ON COLUMN user_food_history.size_modifier IS
  'Size adjective extracted from the logged food name (klein/groß/halb/doppelt/…). '
  'NULL = no modifier (plain portion). Rows differing only in this column store '
  'the user''s typical portion for each size variant separately.';
