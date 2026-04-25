-- Optional link from a Bolus log to the meal it was dosed for. Set by the
-- user via the "Zu Mahlzeit verknüpfen" dropdown in the Bolus log dialog
-- (components/EngineLogTab.tsx → InsulinForm). Engine ICR pairing prefers
-- this explicit link over the time-window heuristic — see
-- lib/engine/pairing.ts. ON DELETE SET NULL keeps the bolus log itself if
-- the linked meal is deleted; the bolus simply loses its tag.
-- Idempotent (safe to re-run).

ALTER TABLE insulin_logs
  ADD COLUMN IF NOT EXISTS related_entry_id uuid REFERENCES meals(id) ON DELETE SET NULL;

-- Partial index — most rows are NULL (basal entries + un-tagged boluses);
-- only the linked rows are looked up by the engine when computing
-- meal-bolus pairs, so a partial index keeps it small and fast.
CREATE INDEX IF NOT EXISTS insulin_logs_related_entry_idx
  ON insulin_logs (related_entry_id)
  WHERE related_entry_id IS NOT NULL;
