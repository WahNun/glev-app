-- Carb-unit display preference (DACH-Diabetologen rechnen häufig in BE/KE).
-- Werte: 'g'  → Gramm Kohlenhydrate (international, Default)
--        'BE' → Broteinheit, 1 BE = 12g KH (DE/AT)
--        'KE' → Kohlenhydrateinheit, 1 KE = 10g KH (CH)
--
-- Speicherung der Mahlzeiten bleibt IMMER in Gramm (meals.carbs_grams).
-- Diese Spalte beeinflusst nur Anzeige + Eingabe-Konvertierung im UI.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS carb_unit text NOT NULL DEFAULT 'g'
    CHECK (carb_unit IN ('g', 'BE', 'KE'));
