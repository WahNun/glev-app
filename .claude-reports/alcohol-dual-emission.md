# Alkohol Dual-Emission

Branch: `feat/alcohol-dual-emission`
Commit: `42d0afa7`
Date: 2026-06-04

## Geänderte Files (12)

| File | Art | Beschreibung |
|---|---|---|
| `supabase/migrations/20260604_influence_meal_linkage.sql` | neu | `source_meal_id` FK + `alcohol_g` in `influence_logs` |
| `lib/meals.ts` | geändert | `ParsedFood.alcohol_g?: number` |
| `lib/useGlevAI.ts` | geändert | `MealPendingPayload.total_alcohol_g + linked_influence_token`, neuer `InfluencePrepPayload` Type |
| `lib/ai/glevTools.ts` | geändert | items[]-Schema mit `alcohol_g`, `DualPendingActionEnvelope`, Dual-Emission-Logic in `toolLogMealEntry` |
| `lib/ai/glevChatPrompt.ts` | geändert | ALKOHOL-Sektion mit Richtwerten und Hinweis auf automatischen Dual-Emit |
| `lib/engine/evaluation.ts` | geändert | `linkedAlcoholG` Input-Feld, `[alcohol_extended_window]` Reason-Tag |
| `app/api/ai/chat/route.ts` | geändert | `isDualPendingActionEnvelope` Handler, beide SSE-Frames emittieren |
| `app/api/ai/confirm-action/route.ts` | geändert | `source_meal_token` → `source_meal_id` Lookup-Logik, `alcohol_g` speichern |
| `app/(protected)/engine/page.tsx` | geändert | Alkohol-Info-Box im BolusExplainerSheet |
| `components/InfluencePrepChip.tsx` | neu | Amber-Chip mit ⇄ Symbol, bestätig-/dismissbar |
| `components/GlevAIChatSheet.tsx` | geändert | Rendert `InfluencePrepChip` für Dual-Emission, ⇄-Badge auf MealChip |
| `tests/unit/alcoholDualEmission.test.ts` | neu | 16 Tests |

## Flow: „Bockwurst und Bier" → zwei Chips

```
User: "Bockwurst und ein 0.5l Bier"
  ↓
Mistral liefert items[]:
  [{name:'Bockwurst', grams:150, carbs:1, protein:12, fat:14},
   {name:'Bier 0.5l', grams:500, carbs:15, protein:1, fat:0, alcohol_g:20}]
  ↓
toolLogMealEntry:
  totalAlcoholG = 20g > 0 → Dual-Emission
  → INSERT ai_pending_actions (log_meal_entry) → token A
  → INSERT ai_pending_actions (log_influence_entry) → token B
  → return DualPendingActionEnvelope { dual_pending_actions: [A, B] }
  ↓
chat/route.ts:
  → SSE: meal_prep {carbs:16, protein:13, fat:14}
  → SSE: pending_action A (meal) — mit ⇄ 20g Alk Badge
  → SSE: pending_action B (alcohol influence)
  ↓
UI:
  ┌─────────────────────────────────────────┐
  │ Bockwurst und Bier  ⇄ 20g Alk  ✨ KI   │  ← MealChipExpanded
  │ (16g KH, 13g P, 14g F)                  │
  │ [Details ⌄]     [Engine öffnen →]       │
  └─────────────────────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ ⇄ Einflussfaktor: Alkohol               │  ← InfluencePrepChip
  │ 20g Alkohol · aus Mahlzeit: Bockwurst…  │
  │ ⇄ 6–8h Hypo-Monitoring aktiviert        │
  │ [Verwerfen]  [Speichern]                 │
  └─────────────────────────────────────────┘
```

## Doppel-Counting-Schutz

- `alcohol_g` wird **niemals** zu `carbs` addiert
- KH aus Bier (≈15g für 0.5l) fließen NUR über den Meal-Pfad
- Alkohol-Gramm fließen NUR über den Influence-Pfad
- Mistral wird explizit angewiesen, beides separat zu liefern

## Linkage-Resolution beim Save

Wenn User **Influence-Chip bestätigt**:
1. `confirm-action` liest `source_meal_token` aus Payload
2. Lookup `ai_pending_actions.params` für diesen Token → `input_text + logged_at`
3. Suche `meals` in ±5-Minuten-Window mit passendem `input_text`
4. Wenn gefunden: `influence_logs.source_meal_id = meal.id`
5. Wenn noch nicht gespeichert: `source_meal_id = NULL` (Standalone-Influence)

## Tests (16/16 grün)

- ParsedFood backward-compat
- DualPendingActionEnvelope Type Guard
- Tool-Schema: `alcohol_g` in items
- System-Prompt: ALKOHOL-Sektion
- MealPendingPayload: `total_alcohol_g` + `linked_influence_token`
- InfluencePrepPayload: korrekte Shape
- confirm-action: `source_meal_token` anerkannt
- evaluation.ts: `linkedAlcoholG` + `alcohol_extended_window`
- Migration: `source_meal_id` + `alcohol_g`
- InfluencePrepChip: Komponente vorhanden
- Double-Counting-Guard: `totalAlcoholG` ≠ `carbs`

## Offene Fragen an Lucas

**1. Bolus-Calc-Info-Box: quantitativ oder nur qualitativ?**
Die Box zeigt derzeit: „empfohlen: KH-Bolus um 10–30% reduzieren (je nach Menge und persönlicher Reaktion)". 
- **Option A (qualitativ, aktuell):** Nur Beobachtungshinweis, keine Zahl. MDR-sicherer.
- **Option B (quantitativ):** Berechneter Vorschlag z.B. „−15% Bolus" basierend auf `alcohol_g`. Braucht mehr klinische Validierung.

Empfehlung: **Option A behalten** — Alkohol-Reaktion ist hochindividuell, ein fixer Prozentsatz könnte gefährlich sein.

**2. Verlängertes Hypo-Window auch für Standalone-Influences?**
Aktuell greift `linkedAlcoholG` nur wenn die Influence mit einer Mahlzeit verknüpft ist. Wenn User nur „0.5l Bier" als Standalone-Influence loggt (ohne Meal), wird das Window **nicht** verlängert.
- **Option A (aktuell):** Nur bei verlinkten Mahlzeiten.
- **Option B:** Auch bei Standalone-Alcohol-Influences das Window verlängern — würde `lifecycle.ts` brauchen, das `influence_logs` in den letzten 8h abfragt.

Empfehlung: Option B für vollständigen Schutz, aber separat implementieren (eigene Lifecycle-Task).
