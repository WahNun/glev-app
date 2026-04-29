# Glev — Agent Status

## Last completed task
**Post-Meal Multi-Timepoint Glucose Prompts (30min / 1h / 90min / 2h / 3h)**

### Was geändert wurde
- **Migration** `supabase/migrations/20260429_add_meal_glucose_timepoints.sql`
  (applied via `npm run db:migrate` to project `zalpwyhlijbjyspjzbvn`):
  - 5 neue int4 Spalten auf `meals`: `glucose_30min`, `glucose_1h`,
    `glucose_90min`, `glucose_2h`, `glucose_3h`
  - + jeweils `_at` timestamptz: `glucose_30min_at`, …
  - Idempotent (`ADD COLUMN IF NOT EXISTS`)
- **Hook** `hooks/usePostMealCheck.ts`:
  - Pollt alle 60s + on window focus
  - Fenster 0–220min nach Mahlzeit (deckt alle 5 Timepoints + Slack)
  - Zeigt jeweils EIN PendingMeal: Erstes Timepoint dessen
    `glucose_<tp>` noch null ist und Zeit-Window aktiv ist
  - Verwendet existierenden `supabase` Singleton aus `@/lib/supabase`
    (kein deprecated `createClientComponentClient`)
- **Komponente** `components/PostMealPrompt.tsx`:
  - Floating Banner unten zentriert, max-width 480px
  - Mobile: `bottom: env(safe-area-inset-bottom) + 80px` über Bottom-Nav
  - Desktop: `bottom: 24px`
  - Number-Input + „Speichern" Button + „Später eingeben" + ×
  - Validierung 20–600 mg/dL, Inline-Error-Display
  - Schickt PATCH mit Authorization-Header (Bearer access_token)
- **API** `app/api/meals/[id]/glucose/route.ts`:
  - PATCH-Route, Auth via existierendem `authedClient`
    (cross-import aus `app/api/insulin/_helpers.ts`)
  - Body `{ timepoint: '30min'|'1h'|'90min'|'2h'|'3h', value: number }`
  - Validiert timepoint + value (20–600), schreibt `glucose_<tp>` +
    `glucose_<tp>_at`, scoped auf user_id
  - Rückgabe: `{ ok: true, column, timepoint, value }`
- **Mount** `app/(protected)/layout.tsx`:
  - `<PostMealPrompt />` global im protected-Layout
  - Erscheint NICHT auf /, /beta, /pro, /legal (außerhalb protected
    route group)

### Verifiziert
- Migration: `✓ Applied 20260429_add_meal_glucose_timepoints.sql`
- `/engine` → 307 (Auth-Redirect, normal)
- `PATCH /api/meals/<uuid>/glucose` (unauth) → 401
- `npx tsc --noEmit` → clean, kein Output
- Browser-Console: nur Fast-Refresh „done", keine Errors

### Schema-Konflikt akzeptiert (Variante B)
- Existierende `bg_1h` / `bg_2h` (+ `_at`) bleiben unverändert
  parallel bestehen → wird in einem späteren Cleanup-Task migriert
  (Daten umkopieren, alte Spalten droppen).

## Vorherige Tasks
- Mobile Glev-Bottom-Tab → /engine (statt /log).
- /pro CTA → direkter Stripe Payment Link
  (`https://buy.stripe.com/bJe4gzfLK1OUezHfzebfO01`).
- GlevActionSheet ersetzt durch Header-`+` (`QuickAddMenu`) +
  Glev-Tap → /engine. Sheet komplett gelöscht.

## Offen
- **Cleanup `bg_1h` / `bg_2h`** → in `glucose_1h` / `glucose_2h`
  migrieren, alte Spalten droppen (low-prio, sobald Doppel-Storage
  stört).
- **Performance Dashboard/History** — A+D+E erste Welle
  (90-Tage-Limit auf `fetchMeals`, Suspense-Boundary, `useMemo`).
- **`lib/meals.ts`** — kein Limit auf `fetchMeals`, lädt alle Meals
  des Users → Bottleneck bei Power-Usern.
