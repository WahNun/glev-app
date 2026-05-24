-- AI Pending Actions (Phase 3, Task 2 — WRITE-Tools UI-Confirmation-Gate)
--
-- Schreibende Glev-AI-Tools (log_meal_entry, log_bolus_entry,
-- log_fingerstick, add_appointment) führen den eigentlichen Insert NICHT
-- direkt aus. Stattdessen legen sie eine Pending-Action-Zeile mit den
-- vom Modell vorgeschlagenen Parametern an und schicken den Token zurück
-- an die UI. Der Nutzer bestätigt manuell per Button → POST
-- /api/ai/confirm-action {token} führt den Write dann gegen die echten
-- Tabellen (meals/insulin_logs/fingerstick_readings/appointments) aus.
--
-- TTL: 5 Min. Ältere Zeilen werden vom Endpoint abgelehnt (410 Gone),
-- damit ein Bestätigungs-Klick aus einer abgelaufenen Bubble nicht
-- versehentlich eine veraltete Aktion triggert.
--
-- `used_at` (idempotent guard): wir markieren die Zeile beim ersten
-- Confirm und lehnen den zweiten Klick als 409 ab, damit ein
-- versehentlicher Doppelklick keinen Doppel-Insert erzeugt.
--
-- RLS analog zu ai_user_memory: select/insert/update/delete jeweils nur
-- für die eigene user_id. Das reicht, weil sowohl der Tool-Executor in
-- /api/ai/chat als auch der Confirm-Endpoint mit dem authed Supabase-
-- Client des Nutzers laufen (keine service-role nötig).

CREATE TABLE IF NOT EXISTS public.ai_pending_actions (
  token       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN (
                            'log_meal_entry',
                            'log_bolus_entry',
                            'log_fingerstick',
                            'add_appointment'
                          )),
  params      jsonb       NOT NULL,
  summary     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE INDEX IF NOT EXISTS ai_pending_actions_user_created_idx
  ON public.ai_pending_actions (user_id, created_at DESC);

ALTER TABLE public.ai_pending_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_pending_actions_select_own" ON public.ai_pending_actions;
CREATE POLICY "ai_pending_actions_select_own"
  ON public.ai_pending_actions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_pending_actions_insert_own" ON public.ai_pending_actions;
CREATE POLICY "ai_pending_actions_insert_own"
  ON public.ai_pending_actions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_pending_actions_update_own" ON public.ai_pending_actions;
CREATE POLICY "ai_pending_actions_update_own"
  ON public.ai_pending_actions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_pending_actions_delete_own" ON public.ai_pending_actions;
CREATE POLICY "ai_pending_actions_delete_own"
  ON public.ai_pending_actions FOR DELETE
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
