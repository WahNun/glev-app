-- History-aware ICR backfill for insulin_logs.icr_g_per_ie_at_log
-- -------------------------------------------------------------------
-- Context
-- -------
-- Migration 20260501_backfill_insulin_logs_icr_snapshot.sql applied a
-- "best-effort current ICR" to all NULL rows — pinning pre-existing
-- entries to whatever the user's ratio was at migration time.
-- Now that `user_settings_history` records every ICR change, we can
-- reconstruct the ratio that was actually active at log creation time
-- for rows that STILL have no snapshot (icr_g_per_ie_at_log IS NULL).
--
-- Why only NULL rows are targeted
-- --------------------------------
-- `insulin_logs.created_at` is user-editable (lib/insulin.ts accepts
-- an explicit `at` parameter for backdated entries, and the PATCH
-- handler allows updating created_at). This means a row with a genuine
-- insert-time snapshot from lib/insulin.ts could have any created_at
-- value, including dates before the snapshot feature was deployed.
-- There is no reliable provenance marker in the current schema that
-- distinguishes "value written by lib/insulin.ts at insert time" from
-- "value written by the earlier best-effort backfill migration".
-- Therefore we target ONLY rows where icr_g_per_ie_at_log IS NULL:
--
--   •  A NULL value was never set by lib/insulin.ts (which always
--      writes a non-NULL value for bolus rows when the user has an ICR)
--      OR the user had no ICR configured at insert time (which is also
--      a genuine NULL). Either way, there is no genuine snapshot to
--      protect, and writing a history-derived value is safe.
--
--   •  Non-NULL rows are left untouched regardless of their created_at.
--      This is conservative: some of those rows may carry a wrong
--      "current ICR at backfill time" value from the earlier migration.
--      Correcting those would require a provenance column (e.g.
--      icr_source = 'backfill' | 'insert_time') that does not currently
--      exist. Adding such a column and a follow-up correction is a
--      separate task.
--
-- Historical lookup strategy (COALESCE)
-- --------------------------------------
-- For a log at time T, the active ICR is resolved as:
--
--   1. Primary:  latest `icr_new` with changed_at <= T
--                → "what the ICR was set TO at or before log time"
--
--   2. Fallback: `icr_old` from the earliest history row with
--                changed_at > T
--                → "what the ICR was BEFORE the first recorded change
--                   after log time". Handles logs that predate all
--                   recorded changes.
--
-- If both sub-queries return NULL (no history for this user, or no
-- surrounding history rows), the outer IS NOT NULL guard prevents the
-- UPDATE — we leave the row NULL rather than write a guess.
--
-- Backdated-log correctness
-- -------------------------
-- For a backdated log with created_at = 2025-01-15 (months in the past)
-- inserted today:
--
--   • The primary sub-query finds the ICR that was in effect on 2025-01-15.
--   • If 2025-01-15 predates all history, the fallback returns icr_old
--     from the earliest change — the ratio that was active before any
--     recorded change, which is the best proxy for 2025-01-15.
--   • In both cases the result is more accurate than "today's ICR".
--
-- Idempotency
-- -----------
-- WHERE icr_g_per_ie_at_log IS NULL means re-running is a no-op once
-- every NULL row that has resolvable history has been filled in. Any
-- NULL rows that remain after the first run have no resolvable history
-- row (user never changed ICR or IS NULL guard fired) — re-running
-- produces zero additional updates for those rows.
--
-- Ordering
-- --------
-- Must be applied AFTER:
--   20260528_add_user_settings_history.sql  (creates the history table)
--   20260501_backfill_insulin_logs_icr_snapshot.sql  (earlier backfill)

UPDATE insulin_logs il
   SET icr_g_per_ie_at_log = COALESCE(
         -- 1. Primary: latest ICR active at or before log creation time.
         (SELECT h1.icr_new
            FROM user_settings_history h1
           WHERE h1.user_id    = il.user_id
             AND h1.changed_at <= il.created_at
             AND h1.icr_new IS NOT NULL
             AND h1.icr_new > 0
           ORDER BY h1.changed_at DESC
           LIMIT 1),
         -- 2. Fallback: log predates all recorded changes.
         --    icr_old from the earliest history row = the ICR that was
         --    active BEFORE the user's first ever recorded change.
         (SELECT h2.icr_old
            FROM user_settings_history h2
           WHERE h2.user_id    = il.user_id
             AND h2.changed_at > il.created_at
             AND h2.icr_old IS NOT NULL
             AND h2.icr_old > 0
           ORDER BY h2.changed_at ASC
           LIMIT 1)
       )
 WHERE
   -- Exclusively target NULL rows — the only category where we can be
   -- certain no genuine insert-time snapshot exists.
   il.icr_g_per_ie_at_log IS NULL
   -- Only bolus entries carry an ICR snapshot; basal stays NULL.
   AND il.insulin_type = 'bolus'
   -- Skip users who have no history rows at all — we cannot reconstruct
   -- their past ratio and leave the row NULL (its current state).
   AND EXISTS (
         SELECT 1
           FROM user_settings_history h3
          WHERE h3.user_id = il.user_id
          LIMIT 1
       )
   -- Write only when the COALESCE lookup returns a concrete value.
   -- Avoids replacing NULL with NULL (a no-op) but also prevents
   -- writing a NULL that would evict a row from future re-runs.
   AND COALESCE(
         (SELECT h4.icr_new
            FROM user_settings_history h4
           WHERE h4.user_id    = il.user_id
             AND h4.changed_at <= il.created_at
             AND h4.icr_new IS NOT NULL
             AND h4.icr_new > 0
           ORDER BY h4.changed_at DESC
           LIMIT 1),
         (SELECT h5.icr_old
            FROM user_settings_history h5
           WHERE h5.user_id    = il.user_id
             AND h5.changed_at > il.created_at
             AND h5.icr_old IS NOT NULL
             AND h5.icr_old > 0
           ORDER BY h5.changed_at ASC
           LIMIT 1)
       ) IS NOT NULL;
