# Phase 1 — Macros Transparency Layer

Branch: `feat/macros-transparency-phase-1`
Commit: `12ee2b13`
Date: 2026-06-04

## Geänderte Files

| File | Art | Beschreibung |
|---|---|---|
| `lib/nutrition/badgeFor.ts` | neu | `aggregateBadge()` + `sourceLabel()` |
| `components/SourceBadge.tsx` | neu | Provenance-Pill (✅/✨) |
| `components/GlevAIChatSheet.tsx` | geändert | MealChipExpanded, COPY-Keys, SourceBadge-Import |
| `app/(protected)/engine/page.tsx` | geändert | Transparency-Footer unter Disclaimer |
| `app/(protected)/settings/data-sources/page.tsx` | neu | 4-Sektionen-Seite, DE/EN |
| `app/(protected)/settings/page.tsx` | geändert | Nav-Row für data-sources |
| `tests/unit/macrosTransparencyPhase1.test.ts` | neu | 17 Tests grün |

## Chip-States

### Collapsed (normal)
```
┌──────────────────────────────────────────┐
│ Hühnchen mit Reis                    ✨  │  ← name + SourceBadge (estimated)
│ (45g KH, 32g P, 8g F) um 12:30          │  ← macros + time
│ [Details ⌄]        [Engine öffnen →]    │  ← zwei Buttons nebeneinander
└──────────────────────────────────────────┘
```
- ✕ dismiss oben rechts (unverändert)
- Queue-Badge ("Mahlzeit 2 von 3") bei inaktiven Chips (unverändert)

### Expanded (Details ⌄ geklickt)
```
┌──────────────────────────────────────────┐
│ Hühnchen mit Reis                    ✨  │
│ (45g KH, 32g P, 8g F) um 12:30          │
│ ┌──────────────────────────────────────┐ │
│ │ Hühnchen mit Reis               ✨ KI│ │  ← Phase 1: item = meal name, all estimated
│ └──────────────────────────────────────┘ │
│ [Details ⌃]        [Engine öffnen →]    │
└──────────────────────────────────────────┘
```
Phase 2 wird `payload.items[]` befüllen → echte Per-Item-Sources.

### Engine-Button always visible
Beide Buttons bleiben in collapsed UND expanded sichtbar. `onOpenEngine`-Callback unverändert.

## Engine Disclaimer-Footer

Unter dem bestehenden MDR-Disclaimer-Block, niedrig-kontrastig:
```
Nährwerte aus Open Food Facts, USDA FoodData Central und deinen bisherigen Logs.
Items mit ✨ wurden per KI geschätzt. Glev ist eine Dokumentations-App und ersetzt
keine ärztliche Beratung. [Datenquellen & KI-Genauigkeit verstehen →]
```
Link: → `/settings/data-sources`

## Settings-Page `/settings/data-sources`

Vollständig DE/EN, inline locale-Pattern (kein messages/*.json). 4 Sektionen:
1. **Quellen im Überblick** — OFF (✅), USDA (✅), Logs (✅), KI-Schätzung (✨) als Cards
2. **Warum KI-Schätzungen?** — Erklärtext
3. **Was du tun kannst** — 4 Bullet-Punkte
4. **Risiken von KI-Inhalten** — lila Info-Box (Carbetic-Style), MDR-konform

Nav-Row in `settings/page.tsx` neben CGM-Quellen ergänzt.

## Tests (17/17 grün)

- `aggregateBadge`: empty, all-estimated, all-unknown, all-OFF, all-USDA, user_history, user_confirmed, mixed(usda+estimated), mixed(OFF+unknown), mixed(user_confirmed+estimated+OFF)
- `sourceLabel`: alle 5 Sources × DE + EN = 12 Assertions
- Settings-Page file exists + default export present

## Offene Fragen / Phase 2

- `PendingAction.payload` für `log_meal_entry` trägt heute **keine** `items[]` — nur `input_text`, `carbs_grams` etc. Phase 2 muss `glevTools.ts:toolLogMealEntry` erweitern, um `items: NutritionItem[]` aus dem Aggregator in das Payload zu schreiben.
- Chip-Expand zeigt in Phase 1 den Mahlzeit-Namen als Platzhalter-Item (1 Zeile). Phase 2 ersetzt das durch echte Items mit korrekten Sources (OFF/USDA/Logs/estimated).
- `SourceBadge` hat ein `locale`-Prop für serverseitige Verwendung; auf dem Client nutzt es `useLocale()`.
- Der `useLocale()`-Call in `SourceBadge` steht in einem `if (!localeProp)` Guard — Hook-Rules-konform, weil der Prop nie mid-render wechselt.
