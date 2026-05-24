-- AI User Memory (Task #663)
-- Persistente Key/Value-Beobachtungen, die der Glev-Chat-Agent über das
-- Diabetes-Verhalten des Nutzers sammeln darf (z. B.
-- "pizza_reaction" → "BZ steigt nach Pizza um ~4 mmol/L nach 90 Min").
-- Wird beim Start jeder Chat-Session in den System-Prompt injiziert,
-- damit der Agent sich zwischen Sessions an persönliche Muster
-- erinnern kann.
--
-- Scope: rein additive Migration. Tabelle existiert vorher nicht.
-- PK ist `(user_id, key)` — Upsert auf gleichen Key überschreibt den
-- alten Value, ohne Doppel-Zeilen zu erzeugen.
--
-- RLS analog zu anderen user-scoped AI-Tabellen (z. B. den
-- meal_timeline_checks-Policies in 20260523_ai_function_calling_schema.sql,
-- nur mit `auth.uid() = user_id` direkt statt `auth.uid()::text = user_id`,
-- weil hier user_id als uuid typisiert ist — passt zu `profiles.user_id`).
--
-- FK auf `profiles(user_id)` ON DELETE CASCADE: wird ein Profil
-- gelöscht, verschwinden auch die Memory-Zeilen. Bewusst KEIN FK auf
-- `auth.users` direkt, weil `profiles` in diesem Projekt der einzige
-- offizielle User-Anchor ist (siehe Kommentar in 20260427_add_junction_user_id.sql).

CREATE TABLE IF NOT EXISTS public.ai_user_memory (
  user_id    uuid        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  key        text        NOT NULL,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS ai_user_memory_user_updated_idx
  ON public.ai_user_memory (user_id, updated_at DESC);

ALTER TABLE public.ai_user_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_user_memory_select_own" ON public.ai_user_memory;
CREATE POLICY "ai_user_memory_select_own"
  ON public.ai_user_memory FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_user_memory_insert_own" ON public.ai_user_memory;
CREATE POLICY "ai_user_memory_insert_own"
  ON public.ai_user_memory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_user_memory_update_own" ON public.ai_user_memory;
CREATE POLICY "ai_user_memory_update_own"
  ON public.ai_user_memory FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_user_memory_delete_own" ON public.ai_user_memory;
CREATE POLICY "ai_user_memory_delete_own"
  ON public.ai_user_memory FOR DELETE
  USING (auth.uid() = user_id);

-- Schema-Cache neu laden, damit PostgREST die neue Tabelle sofort sieht.
NOTIFY pgrst, 'reload schema';
