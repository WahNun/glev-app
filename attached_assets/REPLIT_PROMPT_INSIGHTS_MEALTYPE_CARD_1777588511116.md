# Fix: Insights — Meal Type Success Rate Card

## Kontext
Im Insights Tab gibt es eine Karte "Meal Type Success Rate" (o.ä.) die Erfolgsquoten pro Mahlzeit-Kategorie zeigt.
Aktuell gibt es 4 Kategorien. Ziel: 5. Kategorie "High Fiber" ergänzen + Layout neu anordnen.

## Schritt 1 — Dateien finden und lesen

Suche nach der Komponente die die Meal-Type-Erfolgsrate anzeigt. Mögliche Dateinamen:
- `MealTypeCard`, `MealTypeSuccessCard`, `InsightsMealType` o.ä. in `components/insights/` oder `app/(protected)/insights/`
- Suche auch nach dem Enum/Konstante für Meal Types — prüfe ob `high_fiber` oder `highFiber` schon im Code existiert

**Lies alle gefundenen Dateien vollständig bevor du etwas änderst.**

---

## Schritt 2 — High Fiber Kategorie ergänzen

Falls `high_fiber` / `highFiber` noch nicht als Meal-Type-Kategorie existiert, an allen relevanten Stellen ergänzen:

**Im Meal-Type Enum / Konstanten-File:**
```ts
export const MEAL_TYPES = {
  fast_carbs: { label: 'Fast Carbs', ... },
  high_protein: { label: 'High Protein', ... },
  high_fat: { label: 'High Fat', ... },
  high_fiber: { label: 'High Fiber', emoji: '🥦', color: '#22D3A0' }, // neu
  balanced: { label: 'Balanced', ... },
} as const;
```

Falls die Kategorie schon existiert aber nur in der Karte fehlt: nur die Karten-Komponente anpassen.

---

## Schritt 3 — Layout der Karte neu anordnen

Das neue Layout der Karte:

```
┌─────────────────┬─────────────────┐
│   Fast Carbs    │   High Protein  │
│   [Chip]        │   [Chip]        │
├─────────────────┼─────────────────┤
│   High Fat      │   High Fiber    │
│   [Chip]        │   [Chip]        │
├─────────────────┴─────────────────┤
│           Balanced                │
│           [Chip — volle Breite]   │
└───────────────────────────────────┘
```

**Implementation — CSS Grid:**

```tsx
<div style={{
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
}}>
  {/* Zeile 1 */}
  <MealTypeChip type="fast_carbs" />
  <MealTypeChip type="high_protein" />

  {/* Zeile 2 */}
  <MealTypeChip type="high_fat" />
  <MealTypeChip type="high_fiber" />

  {/* Zeile 3 — volle Breite */}
  <div style={{ gridColumn: '1 / -1' }}>
    <MealTypeChip type="balanced" />
  </div>
</div>
```

Falls die Chips keine eigene Komponente haben, den Inline-Stil des "Balanced"-Containers mit `gridColumn: '1 / -1'` versehen. Die anderen vier bleiben im 2-Spalten-Grid.

---

## Was NICHT geändert wird
- Berechnungslogik für Success Rate
- Supabase Schema (kein neues Feld nötig — nur wenn `high_fiber` nicht als Typ in der DB erlaubt ist, dann CHECK constraint prüfen)
- Andere Insight-Karten
- Log-Wizard Meal-Type-Auswahl (separates Feature wenn gewünscht)

## Commit
```
git add -A && git commit -m "feat: add high fiber meal type + restructure insights card layout" && git push origin main
```
