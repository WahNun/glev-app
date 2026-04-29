# Glev — Agent Status

## Last completed task
**Floating Post-Meal Banner → dezenter Badge auf Mahlzeit-Karte im Verlauf**

### Was geändert wurde
- **Entfernt**: `<PostMealPrompt />` mount aus `app/(protected)/layout.tsx`
  + zugehöriger Import. Der globale Floating-Banner ploppt nicht mehr
  ungefragt auf.
- **Komponenten stehen lassen** (für ggf. spätere Wiederverwendung,
  per User-Spec): `components/PostMealPrompt.tsx`,
  `hooks/usePostMealCheck.ts`. Keine aktiven Imports mehr.
- **Neu**: `components/PendingGlucoseStrip.tsx`
  - Rendert `null` außer wenn:
    1. Mahlzeit ist 25–210 min alt (irgendein Timepoint-Fenster aktiv)
    2. Passendes `glucose_<tp>` Feld ist noch null
  - Kollabiert: kleiner Badge-Button "● BG nach <Label> eintragen"
  - Klick → inline Input mit z.B.-130-Placeholder + Speichern + ×
  - Validierung 20–600 mg/dL, Inline-Error
  - Tickt alle 30s neu (Window-Übergang ohne Refresh)
  - PATCH an existierende API `/api/meals/[id]/glucose`
  - `onSaved(patch)` callback patched parent-state lokal → Strip
    verschwindet sofort, ohne refetch
- **`app/(protected)/entries/page.tsx`**:
  - Import `PendingGlucoseStrip` hinzu
  - `<PendingGlucoseStrip meal={m} onSaved={...setMeals(...)} />`
    eingefügt direkt unter dem `entry-row` Container und VOR dem
    Card/Expand-Header → strip sitzt oben auf der Karte, nur wenn
    relevant
- **`lib/meals.ts`**:
  - 5 neue Felder + jeweils `_at` zum `Meal` Interface
    (`glucose_30min`, `glucose_1h`, `glucose_90min`, `glucose_2h`,
    `glucose_3h`) — DB-Spalten existierten schon (gestern angelegt),
    nur TS war noch nicht synchron
  - `FULL_COLS` SELECT erweitert um die 10 neuen Spalten, damit
    `fetchMeals()` sie auch liefert

### Verifiziert
- `/history` → 200
- `PATCH /api/meals/<uuid>/glucose` (unauth) → 401
- `npx tsc --noEmit` → clean
- Workflow restart sauber, kein Compile-Error

### Noch offen vom letzten Turn
- **Engine-Header-Toggle entfernen + Tabs static**: User hatte das
  davor angefragt; ich hatte gelesen aber noch nicht editiert, dann
  kam die neue Banner→Badge-Anfrage. Der Toggle (kleine Pille in der
  Mobile-Header-Zeile mit dem aktuellen Tab + Chevron) ist noch da,
  und die in-page Tab-Toggle in `engine/page.tsx` auch. → Nächster
  Task wenn der User dran erinnert.

## Vorherige Tasks
- Post-Meal Multi-Timepoint Migration (5 neue glucose_* Spalten,
  Variante B parallel zu bg_1h/bg_2h, applied gestern auf
  zalpwyhlijbjyspjzbvn).
- Mobile Glev-Bottom-Tab → /engine (statt /log).
- /pro CTA → direkter Stripe Payment Link.
- GlevActionSheet ersetzt durch Header-`+` (`QuickAddMenu`).

## Offen
- **Engine-Header-Toggle** entfernen, Tabs static im Screen
  (siehe oben — User-Wunsch aus dem vorherigen Turn).
- **Cleanup `bg_1h` / `bg_2h`** → in `glucose_1h` / `glucose_2h`
  migrieren, alte Spalten droppen (low-prio).
- **Performance Dashboard/History** — A+D+E erste Welle (90-Tage-
  Limit auf `fetchMeals`, Suspense-Boundary, `useMemo`).
- **`lib/meals.ts`** — kein Limit auf `fetchMeals`, lädt alle Meals
  des Users.
