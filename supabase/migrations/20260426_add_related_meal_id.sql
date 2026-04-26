-- Tag correction boluses to their parent meal so the engine can later
-- distinguish "primary meal dose" from "after-the-fact correction" when
-- learning ICR. Self-referential FK; ON DELETE SET NULL preserves
-- correction rows when the parent meal is removed.
ALTER TABLE meals ADD COLUMN IF NOT EXISTS related_meal_id uuid REFERENCES meals(id) ON DELETE SET NULL;
