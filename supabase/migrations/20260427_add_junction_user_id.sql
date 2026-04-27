-- Junction (formerly Vital) CGM integration — LibreView via Abbott.
--
-- The existing LibreLink-Up direct integration (lib/cgm/llu) is unchanged
-- and continues to coexist; this migration adds an independent path through
-- Junction Link that lets users connect their LibreView account through
-- Junction's hosted UI instead of typing LLU credentials.
--
-- The `profiles` table ALREADY EXISTS in this project with shape:
--   user_id      uuid PRIMARY KEY  (= auth.uid(), no cast needed)
--   role         text NOT NULL
--   display_name text NULL
--   created_at   timestamptz NOT NULL
--   updated_at   timestamptz NOT NULL
-- with RLS enabled (select_self / update_self / select_linked_patients) and
-- a `profiles_no_role_change_trg` trigger. Profile rows are auto-created on
-- auth.users insert (verified — 6 users, 6 profiles).
--
-- This migration is purely additive: two new nullable columns and a sparse
-- partial index. We deliberately DO NOT touch the existing PK type, RLS
-- policies, or triggers — keeps the migration idempotent and risk-free.
--
-- Two new columns:
--   junction_user_id  — UUID returned from Junction POST /v2/user/. Used as
--                       the path param on every subsequent Junction call.
--                       NULL until the user clicks "LibreView verbinden".
--   cgm_connected     — true once a glucose pull succeeds via Junction.
--                       Today set on first successful /api/cgm/glucose
--                       reading; webhook-driven set is a follow-up task.
--
-- Idempotent (safe to re-run via scripts/apply-migration.mjs).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS junction_user_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cgm_connected    boolean NOT NULL DEFAULT false;

-- Sparse partial index — most rows will be NULL until users connect their
-- CGM, so a partial index keeps the index size proportional to connected
-- users rather than total users. Useful for webhook lookups by Junction id.
CREATE INDEX IF NOT EXISTS profiles_junction_user_id_idx
  ON profiles (junction_user_id)
  WHERE junction_user_id IS NOT NULL;
