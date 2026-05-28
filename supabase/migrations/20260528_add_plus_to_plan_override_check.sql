-- manual_plan_override CHECK-Constraint um 'plus' erweitern.
-- Die ursprüngliche Spalte (20260510_add_admin_user_management.sql) wurde
-- mit CHECK ('free','beta','pro') angelegt — 'plus' fehlte. Postgres
-- lehnt UPDATE/INSERT mit manual_plan_override='plus' mit einem
-- check_violation-Fehler ab, was im Admin-Panel "Something went wrong"
-- produziert.

-- Postgres erlaubt kein direktes ALTER der inline-CHECK-Constraint; wir
-- müssen sie droppen und neu anlegen.
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_manual_plan_override_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_manual_plan_override_check
    CHECK (manual_plan_override IS NULL OR manual_plan_override IN ('free', 'beta', 'pro', 'plus'));
