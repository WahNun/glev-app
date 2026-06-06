-- Team-Zugänge für /glev-ops/*.
-- Jeder Eintrag ist ein Teammitglied mit eigenem Login.
-- Der Master-Admin via ADMIN_EMAIL + ADMIN_API_SECRET env vars bleibt
-- vollständig unabhängig und braucht keinen Eintrag hier.
CREATE TABLE IF NOT EXISTS public.glev_ops_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  role            text NOT NULL DEFAULT 'marketer' CHECK (role IN ('admin', 'marketer')),
  name            text,
  must_change_pw  boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

ALTER TABLE public.glev_ops_users ENABLE ROW LEVEL SECURITY;

-- Nur Service-Role darf lesen/schreiben (Admin-Server-Actions).
-- Kein direkter User-Zugriff nötig.
CREATE POLICY "service_role_only" ON public.glev_ops_users
  USING (false) WITH CHECK (false);
