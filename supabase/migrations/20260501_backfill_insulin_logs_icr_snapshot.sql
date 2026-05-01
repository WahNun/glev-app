-- Backfill the per-row ICR snapshot on `insulin_logs.icr_g_per_ie_at_log`
-- (added by 20260430_add_insulin_logs_icr_snapshot.sql) for entries that
-- were inserted BEFORE the snapshot column existed.
--
-- Why this is needed
-- ------------------
-- The snapshot column is only populated for rows inserted after the new
-- write path landed. Pre-existing rows stay NULL, and the CSV / PDF
-- export code (lib/export.ts → insulinToCSV) falls back to the user's
-- *current* `user_settings.icr_g_per_unit` for any NULL row. For users
-- who have changed their ICR over time, that fallback is exactly the
-- wrong thing the per-row snapshot was introduced to prevent — it
-- silently switches ratios mid-export.
--
-- This one-shot backfill copies each user's CURRENT
-- `user_settings.icr_g_per_unit` into all of their NULL `insulin_logs`
-- rows, giving every export a single consistent ratio per user. It is
-- a "best-effort current ICR" not a true historic capture: for users
-- whose ICR has actually changed in the past, we have no way to
-- reconstruct what the ratio was at injection time. But pinning every
-- pre-snapshot row to the current value is strictly better than the
-- mid-export-switch behaviour of leaving them NULL, and going forward
-- new rows carry their genuine snapshot from `insertInsulinLog`
-- (lib/insulin.ts).
--
-- Idempotency
-- -----------
--   * `WHERE il.icr_g_per_ie_at_log IS NULL` means a re-run only
--     touches rows that are still NULL. Once a row has any non-NULL
--     value (whether from this backfill OR from a real insert-time
--     snapshot), this migration leaves it alone — so re-running never
--     overwrites a genuine historic capture.
--   * `us.icr_g_per_unit > 0` skips users who never configured an
--     ICR (NULL setting), so we don't write `0` or other garbage as
--     a "snapshot".
--
-- Ordering
-- --------
-- This migration MUST be applied AFTER 20260430_add_insulin_logs_icr_snapshot.sql.
-- If the column is missing the UPDATE will hard-fail with `column
-- "icr_g_per_ie_at_log" of relation "insulin_logs" does not exist`,
-- which is the correct, loud failure mode — applying the column
-- migration first then re-running this one performs the backfill.

UPDATE insulin_logs il
   SET icr_g_per_ie_at_log = us.icr_g_per_unit
  FROM user_settings us
 WHERE il.user_id = us.user_id
   AND il.icr_g_per_ie_at_log IS NULL
   AND us.icr_g_per_unit IS NOT NULL
   AND us.icr_g_per_unit > 0;
