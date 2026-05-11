-- Admin user management (Stage 1-3): manual plan overrides, soft-delete,
-- created-by-admin marker, and an audit log for every admin action.
--
-- Idempotent (safe to re-run via scripts/apply-migration.mjs).
--
-- Design notes:
--   * `manual_plan_override` takes precedence over `plan` /
--     `subscription_status` (which are written by the Stripe webhooks).
--     This lets us grant Pro / Beta to friends-and-family WITHOUT going
--     through Stripe, while keeping Stripe's source-of-truth for paying
--     customers untouched. Effective plan = computeEffectivePlan() in
--     lib/admin/effectivePlan.ts.
--   * `deleted_at` enables soft-delete (Stage 2). Hard-delete (Stage 3)
--     uses supabaseAdmin.auth.admin.deleteUser() which cascades.
--   * `created_by_admin` flags users we created manually so paying-user
--     analytics aren't polluted by friends-and-family.
--   * The pre-existing `profiles_no_role_change_trg` trigger blocks
--     `role` UPDATEs from EVERY caller including service_role, so
--     /admin/users couldn't grant admin rights. We replace its body with
--     a version that ALLOWS service_role (= our admin actions, which
--     run as service_role via SUPABASE_SERVICE_ROLE_KEY) but still
--     blocks the regular `authenticated` RLS path.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS manual_plan_override text
    CHECK (manual_plan_override IS NULL OR manual_plan_override IN ('free', 'beta', 'pro'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS manual_plan_note text;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS manual_plan_set_at timestamptz;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS created_by_admin boolean NOT NULL DEFAULT false;

-- Replace the role-change trigger so service_role (= admin actions) can
-- legitimately grant/revoke admin rights, while regular users still
-- can't escalate themselves via the update_self RLS policy.
CREATE OR REPLACE FUNCTION public.profiles_no_role_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- service_role is our admin context; allow.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- Regular path: keep role immutable.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role change not allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_no_role_change_trg ON profiles;
CREATE TRIGGER profiles_no_role_change_trg
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_no_role_change();

-- Audit log: every admin action writes one row. Operator identity is
-- captured as a SHA-256 prefix of the cookie token (the cookie value is
-- the ADMIN_API_SECRET itself), so even with full DB access we never
-- store the secret in plaintext.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  action            text NOT NULL,
  target_user_id    uuid,
  target_email      text,
  before_state      jsonb,
  after_state       jsonb,
  note              text,
  admin_token_hash  text NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_audit_log_target_user_idx
  ON admin_audit_log (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log (created_at DESC);
