-- ============================================================
-- CGM Fetch Jobs — scheduled glucose lookups per log entry
-- ============================================================
-- One row per scheduled fetch (e.g. "+1h after meal X" → save as bg_1h
-- on meals; "+12h after basal Y" → save as glucose_after_12h on
-- insulin_logs). Processed by /api/cgm-jobs/process which runs on app
-- load and every 5 minutes while the app is open.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS cgm_fetch_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  log_id       uuid NOT NULL,
  log_type     text NOT NULL CHECK (log_type IN ('meal','bolus','basal','exercise')),
  fetch_type   text NOT NULL CHECK (fetch_type IN (
                  'before',          -- at submit
                  'bg_1h','bg_2h',   -- meal post-fetches
                  'after_1h','after_2h',          -- bolus post
                  'after_12h','after_24h',        -- basal post
                  'at_end','exer_after_1h'        -- exercise post
                )),
  fetch_time   timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','fetched','failed','skipped')),
  retry_count  integer NOT NULL DEFAULT 0,
  value_mgdl   numeric(5,1),
  fetched_at   timestamptz,
  error_msg    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cgm_fetch_jobs_user_pending_idx
  ON cgm_fetch_jobs (user_id, status, fetch_time)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS cgm_fetch_jobs_log_idx
  ON cgm_fetch_jobs (log_id);

ALTER TABLE cgm_fetch_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cgm_fetch_jobs_select_own" ON cgm_fetch_jobs;
CREATE POLICY "cgm_fetch_jobs_select_own"
  ON cgm_fetch_jobs FOR SELECT
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "cgm_fetch_jobs_insert_own" ON cgm_fetch_jobs;
CREATE POLICY "cgm_fetch_jobs_insert_own"
  ON cgm_fetch_jobs FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "cgm_fetch_jobs_update_own" ON cgm_fetch_jobs;
CREATE POLICY "cgm_fetch_jobs_update_own"
  ON cgm_fetch_jobs FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "cgm_fetch_jobs_delete_own" ON cgm_fetch_jobs;
CREATE POLICY "cgm_fetch_jobs_delete_own"
  ON cgm_fetch_jobs FOR DELETE
  USING (auth.uid()::text = user_id);

-- ============================================================
-- New post-fetch glucose columns on insulin_logs and exercise_logs.
-- (Meals already have bg_1h, bg_2h, glucose_before — no schema change.)
-- ============================================================

ALTER TABLE insulin_logs
  ADD COLUMN IF NOT EXISTS glucose_after_1h    numeric(5,1),
  ADD COLUMN IF NOT EXISTS glucose_after_2h    numeric(5,1),
  ADD COLUMN IF NOT EXISTS glucose_after_12h   numeric(5,1),
  ADD COLUMN IF NOT EXISTS glucose_after_24h   numeric(5,1);

ALTER TABLE exercise_logs
  ADD COLUMN IF NOT EXISTS glucose_at_end      numeric(5,1),
  ADD COLUMN IF NOT EXISTS glucose_after_1h    numeric(5,1);
