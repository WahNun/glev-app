# Diagnose: Macro-Rechner Regression + DB-Anzapfung-Status
**Datum:** 2026-06-19  
**Commit-Stand:** bc2f11f1  
**Beobachtet:** 2026-06-18 Abend, iPhone

---

## A) Git-Log-Commits (letzte 48h, betroffene Dateien)

| Hash | Message | Verdacht |
|------|---------|---------|
| `c025e11a` | feat(ai): source-specific nutrition badge | Modifiziert `aggregate.ts` (topLevelSource-Logik). Kein Breaking Change im Aggregator selbst, aber `nutritionSource` wird ab hier NICHT mehr in den `meal_prep` SSE-Frame propagiert. |
| `5d1287b0` | feat(glev-ai): plan-gate Smart-tier | Modifiziert `chat/route.ts` (checkChatFlag). Kein Impact auf meal_prep Frame. |
| `8696e425` | fix(ai): persist mini-preview until save | Modifiziert `lib/useGlevAI.ts` (+65/-22). Ändert Chip-State-Machine (pending → engine_opened → confirmed). **Verdächtig:** ändert wie `mealPrep` im Queue gespeichert und aus ihm rausgeschrieben wird. |
| `93dbfdcb` | fix(ai): require fiber_grams | Ändert AI-Instructions zu fiber — kein Impact auf Aggregator. |

**Remote-Commits die nicht analysiert wurden:**  
`5856818d chore(ios): build 14 + marketing 1.0.2 in pbxproj` — nur iOS, kein Impact.

---

## B) Tool-Call-Flow Sequenz

```
User: "Pizza Margherita"
  │
  ▼
Mistral → tool: log_meal_entry {
    input_text: "Pizza Margherita",
    carbs_grams: 70,          ← REQUIRED, immer gesetzt
    protein_grams: 12,         ← OPTIONAL, Mistral lässt oft weg
    fat_grams: 8,              ← OPTIONAL, Mistral lässt oft weg
    fiber_grams: 2,            ← OPTIONAL mit explizitem Hinweis
    items: [{ name: "Pizza Margherita", grams: 300 }]  ← REQUIRED
}
  │
  ▼
toolLogMealEntry() — lib/ai/glevTools.ts:1531
  ├── protein = args.protein_grams ?? null   ← null wenn Mistral weglässt
  ├── fat     = args.fat_grams    ?? null
  ├── fiber   = args.fiber_grams  ?? null
  ├── rawItems = args.items (gefiltert auf grams > 0)
  │
  ├── runAggregator()
  │     ├── getCachedUserHistory() → Map (user history)
  │     ├── aggregateNutrition(parsedItems, { userHistory })
  │     │     ├── resolveItem("Pizza Margherita")
  │     │     │     ├── user history lookup → miss
  │     │     │     ├── Promise.any([OFF, USDA]) → hit oder miss
  │     │     │     └── GPT estimate fallback → oder ZERO (unknown)
  │     │     └── returns { totals: { carbs, protein, fat, fiber }, nutritionSource }
  │     └── returns ParsedFood[]   ← ODER undefined bei Exception
  │
  ├── IF resolvedItems:
  │     resolvedProtein = totals.protein    ← ÜBERSCHREIBT null
  │     resolvedFat     = totals.fat
  │     resolvedFiber   = totals.fiber
  │   ELSE:
  │     resolvedProtein = protein           ← BLEIBT null (AI arg)
  │     resolvedFat     = fat              ← BLEIBT null
  │     resolvedFiber   = fiber            ← BLEIBT null
  │
  ├── mealParams = { carbs_grams: resolvedCarbs, protein_grams: resolvedProtein, ... }
  └── createPendingAction() → PendingActionEnvelope { payload: mealParams }
  │
  ▼
chat/route.ts isPendingActionEnvelope branch
  ├── p = result.pending_action.payload
  ├── meal_prep SSE frame = {
  │     carbs:   p.carbs_grams,   ← number (immer, Mistral required)
  │     protein: p.protein_grams, ← null wenn Aggregator fehlschlug
  │     fat:     p.fat_grams,     ← null
  │     fiber:   p.fiber_grams,   ← null
  │     // KEIN nutritionSource   ← LÜCKE!
  │   }
  └── send(meal_prep SSE frame)
  │
  ▼
useGlevAI.ts (Client)
  ├── parsed.meal_prep → pendingMealQueueRef
  ├── mealPrep = parsed.meal_prep = { carbs, protein:null, fat:null, fiber:null }
  └── sessionStorage.setItem("glev_pending_meal", JSON.stringify(mealPrep))
  │
  ▼
engine/page.tsx (sessionStorage Reader, Zeile 663-708)
  ├── mp.carbs   = 70  → setCarbs("70")       ✓
  ├── mp.protein = null → typeof null !== "number" → setProtein() NICHT aufgerufen → bleibt ""
  ├── mp.fat     = null → setFat() NICHT aufgerufen → bleibt ""
  ├── mp.fiber   = null → setFiber() NICHT aufgerufen → bleibt ""
  └── nutritionSource NIRGENDS gesetzt → bleibt null → Badge versteckt
       (oder stale "estimated" von vorheriger Session)
```

---

## C) DB-Anzapfung Status-Check

### Pipeline-Reihenfolge in `aggregate.ts`

```
resolveItem(item):
  1. User History (in-memory Map, per getCachedUserHistory)
  2. Promise.any([OFF, USDA])  — 1.5s timeout pro Lookup
  3. estimateItemNutrition (GPT)  — kann THROW
  4. categoryDefaultFor(item)  — deterministisch, kein Netz
  5. fallback: { ZERO, source: "unknown" }  — nie throw
```

### Status (nicht live-testbar von hier, Hypothesen)

| Stage | Status | Basis |
|-------|--------|-------|
| User History | Wahrscheinlich aktiv | `getCachedUserHistory` mit `.catch(() => new Map())` gesichert |
| Open Food Facts | Unbekannt — timeout-anfällig | `lookupOpenFoodFacts` hat 3s timeout |
| USDA | Unbekannt — timeout-anfällig | `lookupUSDA` hat 3s timeout |
| GPT Estimate | Unbekannt | `estimateItemNutrition` throws auf Fehler, aber catch vorhanden |
| Category Default | Aktiv (deterministisch) | kein Netz, statisches Mapping |

**Kritische Beobachtung:** `runAggregator` in `glevTools.ts` hat einen globalen `try/catch`:
```typescript
} catch (aggErr) {
  console.error(`[meal_prep] aggregator error (fallback to Mistral macros):`, aggErr);
  return undefined;  // ← falls alles fehlschlägt: resolvedProtein bleibt null
}
```
Wenn dieser Zweig getriggert wird, sind protein/fat/fiber garantiert null (sofern Mistral sie nicht explizit liefert).

### topLevelSource()-Logik (c025e11a)

```typescript
// Reihenfolge ist korrekt — kein Logikfehler gefunden:
if (some "unknown") → "unknown"
if (some estimated AND some db-like) → "mixed"
if (all estimated) → "estimated"
if (all user_history/user_confirmed) → "user_history"
if (all open_food_facts) → "open_food_facts"
if (all usda) → "usda"
else → "database"
```

Kein Bug im Aggregator selbst. Die Quelle wird korrekt berechnet — nur nie weitergegeben.

---

## D) Source-Badge Render-Pfad

### Voice-Pfad (`/api/parse-food`) — FUNKTIONIERT
```
/api/parse-food/route.ts:98  →  nutritionSource: aggregated.nutritionSource  ✓
engine/page.tsx:1569          →  setNutritionSource(ns)  ✓
Layout.tsx:978                →  {sourceHdr.source && <Badge />}
```

### AI-Chat-Pfad (`meal_prep` SSE Frame) — LÜCKE
```
meal_prep Frame: { carbs, protein, fat, fiber }  ← KEIN nutritionSource
engine/page.tsx sessionStorage Reader (663-708)   ← LIEST nutritionSource NICHT
→ nutritionSource BLEIBT null → Badge versteckt
```

**Warum zeigt Badge trotzdem "KI-Schätzung"?**  
Entweder:
1. Der Aggregator läuft, aber OFF + USDA + GPT schlagen alle fehl → Category-Default mit `source: "estimated"` → `nutritionSource = "estimated"` — dieser Wert kommt aber nur über `/api/parse-food` in den State, nicht über die Chat-Route. Wenn der User vorher die Voice-Funktion genutzt hat und `nutritionSource` auf "estimated" stand, bleibt es stehen bis `setNutritionSource(null)` aufgerufen wird.
2. Alternativ: die Badge "KI-Schätzung" kommt vom voice-Pfad und wird nur nicht durch den AI-Chat-Pfad gecleart.

**Kernlücke:** In BEIDEN Fällen fehlt die Source-Propagation im Chat-Pfad. Fix: `nutritionSource` aus `agg` in `mealParams` einbauen und durch `meal_prep` Frame + sessionStorage Reader durchleiten.

---

## E) Test-Run — Temporäre Console.logs

**3 Diagnose-Punkte wurden in den Code eingebaut:**

### TP1 — Nach Aggregator-Call (`lib/ai/glevTools.ts` ~Zeile 1654)
```
[DIAGNOSE-TP1] agg.nutritionSource=X totals={carbs:X,protein:X,...} items=[...]
```
**Erwartung bei Bug (Aggregator schlägt fehl):** Zeile erscheint NICHT im Log (Exception im catch, runAggregator returned undefined)  
**Erwartung bei Bug (Aggregator läuft, aber GPT Fallback):** `nutritionSource=estimated items=[{p:5,f:3,src:"estimated"}]`  
**Erwartung wenn alles OK:** `nutritionSource=open_food_facts items=[{p:12,f:8,src:"open_food_facts"}]`

### TP2 — mealParams vor createPendingAction (`lib/ai/glevTools.ts` ~Zeile 1744)
```
[DIAGNOSE-TP2] mealParams: carbs=70 protein=null fat=null fiber=null items_count=1
```
**Wenn protein=null hier erscheint** → Aggregator hat null geliefert (Bug bestätigt)  
**Wenn protein=12 erscheint** → Aggregator hat gearbeitet, Bug liegt woanders (sessionStorage oder render)

### TP3 — meal_prep SSE Frame (`app/api/ai/chat/route.ts` ~Zeile 985)
```
[DIAGNOSE-TP3] meal_prep frame: carbs=70 protein=null fat=null fiber=null items_count=1
```
**Wenn protein=null** → Lücke im SSE Frame bestätigt → Engine-Form bekommt null

**So testen:**
1. `vercel logs` oder Vercel Dashboard → Functions → `/api/ai/chat`
2. Im AI-Chat: "Pizza Margherita" eingeben
3. Die drei `[DIAGNOSE-TP*]` Zeilen im Log suchen
4. Werte mit obigen Erwartungen vergleichen

---

## F) Findings-Zusammenfassung

### Bug 1: Protein/Fat/Fiber fehlen in Mini-Preview

**Hypothese A (wahrscheinlichster):** Aggregator wirft intern eine Exception (z.B. Timeout in OFF/USDA + GPT-Rate-Limit) → `catch(aggErr)` in `runAggregator` greift → returns `undefined` → `resolvedProtein/Fat/Fiber` bleiben als `null` (Mistral liefert optionale Felder nicht). Carbs erscheinen weil `carbs_grams` required ist.

**Hypothese B:** Aggregator läuft, liefert protein/fat/fiber korrekt → aber ein Bug in `8696e425` (lib/useGlevAI.ts +65/-22) hat die Art verändert, wie `mealPrep` aus dem Queue gelesen oder in sessionStorage geschrieben wird.

**Bestätigung:** `[DIAGNOSE-TP2]` im Vercel Log. Wenn `protein=null` → Hypothese A. Wenn `protein=12` → Hypothese B.

### Bug 2: Source-Badge immer "KI-Schätzung"

**Ursache BESTÄTIGT (Codebasis):** `nutritionSource` wird aus `aggregateNutrition()` korrekt berechnet (in `glevTools.ts`), aber in `mealParams` NICHT gespeichert und daher NICHT im `meal_prep` SSE Frame mitgeschickt. Engine-Page liest `nutritionSource` NICHT aus sessionStorage.

Gap existiert seit immer — war auf dem Voice-Pfad nie ein Problem, weil `/api/parse-food` das korrekt propagiert. Auf dem AI-Chat-Pfad war source-Badge entweder hidden (null) oder zeigte stale Voice-Wert.

---

## G) Fix-Strategie

**Fix-Reihenfolge:**

### Fix 1: Source-Propagation (BESTÄTIGT nötig, unabhängig von TP-Logs)

1. `lib/ai/glevTools.ts` — `mealParams` um `nutritionSource` erweitern:
   ```typescript
   // In runAggregator: agg.nutritionSource herausgeben
   // In mealParams: nutritionSource: resolvedNutritionSource
   ```

2. `app/api/ai/chat/route.ts` — `meal_prep` Frame um `nutritionSource` erweitern:
   ```typescript
   nutritionSource: typeof p.nutritionSource === "string" ? p.nutritionSource : undefined,
   ```

3. `lib/useGlevAI.ts` — `SseFrame.meal_prep` Typ um `nutritionSource` erweitern

4. `app/(protected)/engine/page.tsx` — sessionStorage Reader: `nutritionSource` aus `mp` lesen + `setNutritionSource()`

### Fix 2: Protein/Fat/Fiber (abhängig von TP-Log-Output)

**Wenn Hypothese A (Aggregator wirft):**
- Vercel Logs auf `[meal_prep] aggregator error` prüfen → konkrete Exception identifizieren
- Wahrscheinlich: OFF/USDA timeouts → Timeout von 1.5s auf 3s erhöhen, oder Retry
- Alternativ: category-default vorziehen, bevor GPT gecalled wird

**Wenn Hypothese B (useGlevAI.ts 8696e425):**
- `git diff 619461d8..8696e425 -- lib/useGlevAI.ts` analysieren
- Spezifisch: wie `mealPrep` Queue Item gebaut wird und ob protein/fat/fiber korrekt gespeichert werden

### Dateien für Fix-Sprint

| Datei | Change |
|-------|--------|
| `lib/ai/glevTools.ts` | `mealParams` um `nutritionSource: agg.nutritionSource` erweitern; DIAGNOSE-Logs entfernen |
| `app/api/ai/chat/route.ts` | `meal_prep` Frame um `nutritionSource` erweitern; DIAGNOSE-Log entfernen |
| `lib/useGlevAI.ts` | `SseFrame.meal_prep` Typ erweitern |
| `app/(protected)/engine/page.tsx` | sessionStorage Reader: `nutritionSource` lesen + `setNutritionSource()` aufrufen |

**Conditional (nach TP-Log-Output):**

| Datei | Change |
|-------|--------|
| `lib/nutrition/openFoodFacts.ts` | Timeout erhöhen (wenn Hypothese A: API-Timeout) |
| `lib/nutrition/usda.ts` | Timeout erhöhen |
| `lib/useGlevAI.ts` | mealPrep Queue-Logik überprüfen (wenn Hypothese B) |
