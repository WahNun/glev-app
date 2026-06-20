# Phase 3 — Optimistic UI + Caching + Mistral System-Prompt

Branch: `feat/macros-phase-3-optimistic`
Commit: `f5c3cfde`
Date: 2026-06-04

## Geänderte Files

| File | Art | Beschreibung |
|---|---|---|
| `lib/ai/glevChatPrompt.ts` | geändert | items[]-Instruktion imperativ, 3 Beispiele |
| `lib/ai/glevTools.ts` | geändert | items[] required, Two-Phase-Logik, userHistoryCache |
| `lib/nutrition/userHistoryCache.ts` | neu | 5-min In-Memory-LRU-Cache pro userId |
| `lib/nutrition/aggregate.ts` | geändert | Promise.any Race statt sequentiellem Await |
| `lib/nutrition/openFoodFacts.ts` | geändert | Timeout 2500ms → 1500ms |
| `lib/nutrition/usda.ts` | geändert | Timeout 2500ms → 1500ms |
| `components/GlevAIChatSheet.tsx` | geändert | Realtime-Subscribe, Fade-Transition, MealPendingPayload-Typen |
| `app/api/ai/confirm-action/route.ts` | geändert | parsed_json aus items[], classifyMeal() |
| `supabase/migrations/20260604_meal_prep_refinements.sql` | neu | Refinement-Tabelle mit RLS + Realtime |
| `.env.example` | geändert | OPTIMISTIC_REFINEMENT dokumentiert |
| `tests/unit/macrosTransparencyPhase3.test.ts` | neu | 19 Tests |

## Performance-Baseline vor/nach Phase 3

### Vor Phase 3 (Phase 2, synchronous)
- Mistral → items[] → Aggregator (OFF/USDA parallel, 2.5s timeout) → pending_action
- User sieht Chip: **~1.5–4s** nach Mistral-Response (bei OFF-Miss bis 2.5s Timeout)
- Bei beiden DBs miss: ~5s wegen 2× 2.5s sequentieller Wartezeit (Promise.any war schon in Phase 2, timeout war 2.5s)

### Nach Phase 3 (OPTIMISTIC_REFINEMENT=true)
- Mistral → pending_action (sofort, mit estimated-Items) → User sieht Chip: **~0ms** (Mistral-Latenz only)
- Aggregator läuft im Hintergrund: Promise.any-Race, 1.5s Timeout
- Badge-Swap via Realtime: **~1.5–2s** nach Chip-Erscheinen (unsichtbar für User, nur Badge ändert sich)
- userHistoryCache: Wiederholte Mahlzeiten (gleiche Session): **<1ms** für History-Lookup

### Erwartete p50/p95 (geschätzt)
| Metrik | Phase 2 | Phase 3 (optimistic) |
|---|---|---|
| Chip sichtbar nach Mistral | +1.5–4s | +0ms (sofort) |
| Badge korrekt | mit Chip | ~1.5s nach Chip |
| DB-Hit (user history) | ~50ms | <1ms (cached) |
| OFF/USDA-Timeout (miss) | 2500ms | 1500ms |

## Beispiel Aggregator-Log

```
[meal_prep] id=abc-123 aggregator: 3 items, 2 db-hits, 1 estimates, 1243ms
```

## Vercel-Setup

### Phase 2 (bereits gesetzt)
```
MACRO_AGGREGATOR_V2 = true
```

### Phase 3 (neu setzen um Optimistic Flow zu aktivieren)
```
OPTIMISTIC_REFINEMENT = true
```

**Pfad:** Vercel Dashboard → glev-app → Settings → Environment Variables
- Key: `OPTIMISTIC_REFINEMENT`
- Value: `true`
- Environments: Production (+ Preview optional)
- Redeploy nötig

**Achtung:** `OPTIMISTIC_REFINEMENT=true` braucht `MACRO_AGGREGATOR_V2=true` (sonst läuft kein Aggregator, Realtime-Row bleibt auf 'pending' hängen).

### Supabase Migration ausführen
Die `meal_prep_refinements`-Tabelle wird durch den nächsten Push auf main automatisch per GitHub Action angewendet (migrations-auto-apply). Alternativ manuell:
```bash
supabase db push --project-ref zalpwyhlijbjyspjzbvn
```

## Realtime-Setup-Anweisung (Supabase)

Die Migration führt `ALTER PUBLICATION supabase_realtime ADD TABLE meal_prep_refinements` aus. Damit ist Realtime automatisch aktiviert. Keine manuelle Aktion nötig — Supabase Realtime ist bereits im Projekt konfiguriert (es nutzt denselben `@supabase/supabase-js`-Client wie die App).

## Vercel KV / Upstash

**Nicht implementiert / nicht nötig.** Der bestehende `lib/nutrition/cache.ts` (In-Memory LRU, 24h TTL) deckt OFF/USDA-Hits innerhalb einer Warm-Lambda-Instance ab. Für Cross-Instance-Caching (mehrere parallele Vercel-Functions) würde Upstash Redis ~2-3ms Latenz hinzufügen — mit 1.5s-Timeout ist das irrelevant. Wenn später skaliert wird: `@upstash/redis` einbinden und `cacheGet`/`cacheSet` in `lib/nutrition/cache.ts` auf Redis-Calls umstellen (Drop-in, gleiche Interface).

## Test-Output

```
Phase 1: 17 passed
Phase 2: 11 passed
Phase 3: 19 passed
Total: 47 passed
```

## Offene Punkte / Phase 4

1. **Observability-Dashboard** (`glev-ops/metrics`): p50/p95/p99 pro Phase. Die Logs existieren (`[meal_prep] id=… aggregator: N items, X db-hits, Tms`) — sie müssen nur aggregiert werden (z.B. Logtail + Grafana oder Vercel Log Drains).
2. **invalidateUserHistory nach saveMeal**: Wenn der User eine Mahlzeit speichert, sollte `invalidateUserHistory(userId)` aufgerufen werden damit der nächste Chat-Eintrag aktualisierte History bekommt. Aktuell veraltert der Cache nach 5 Minuten.
3. **Engine-Page Subscribe**: Die Engine-Seite liest `parsedItems` aus sessionStorage — wenn der User gleichzeitig in der Engine ist während die Refinement läuft, wird der Banner nicht live aktualisiert. Für Phase 4: dieselbe Realtime-Subscription auch in engine/page.tsx einbauen.
4. **Mistral-Validierung**: Die mandatory `items[]` (required=[]) erhöht die Chance, dass Mistral es liefert — aber Mistral v2 ignoriert manchmal `required`. Monitoring über die Aggregator-Logs (wenn `0 items` geloggt wird, hat Mistral nicht geliefert).
