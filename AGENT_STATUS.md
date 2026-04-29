# Glev — Agent Status

## Last completed task
**Engine-Tab-Dropdown komplett raus, Tabs immer sichtbar**

Der Toggle (sowohl die in-page Pille mit "Engine ⌄" als auch die kleine
Header-Pille oben rechts neben Live + User-Icon) ist weg. Die 4 Tabs
(Engine / Insulin / Übung / Glukose) rendern jetzt als statische Pill-
Reihe ganz oben im Page-Body, genau wie auf Desktop.

### Was geändert wurde
- **`app/(protected)/engine/page.tsx`**:
  - Import `useEngineHeader` weg
  - `engineHdr / tabsExpanded / setTabsExpanded` State weg
  - 2× `useEffect` weg (Header-Activation + activeLabel-Sync)
  - Dropdown-Button + `tabsExpanded && ...` Conditional weg
  - Tabs-Row rendert jetzt unconditional, marginBottom statisch 16
- **`components/Layout.tsx`**:
  - Import `EngineHeaderProvider, useEngineHeader` weg
  - `Layout` + `LayoutInner` zu einer Funktion zusammengefasst
    (Provider-Wrap + 2. Funktion sind nicht mehr nötig)
  - `engineHdr` Variable weg
  - Cleanup-`useEffect` für Pathname-basiertes Reset weg
  - Header-Toggle-Button-Block weg (33 Zeilen, der ganze
    `engineHdr.visible && (<button>...</button>)` Block)
- **`lib/engineHeaderContext.tsx`**: gelöscht (kein Importer mehr)

### Verifiziert
- `rg "engineHeaderContext|useEngineHeader|EngineHeaderProvider|tabsExpanded|setTabsExpanded|engineHdr"` → leer
- `/engine` → 307 (Auth-Redirect, Route lebt)
- Project-Code tsc clean
  (`.next/dev/types/validator.ts` Race-Errors sind Next-16-Dev-
  Auto-Gen-Noise während der Regeneration, nicht in unserem Code)
- Workflow restart sauber

## Vorherige Tasks
- Floating Post-Meal Banner → dezenter Inline-Badge auf Mahlzeit-Karte
  via `components/PendingGlucoseStrip.tsx` (montiert in entries/page.tsx)
- Post-Meal Multi-Timepoint Migration (5 neue glucose_* Spalten,
  Variante B parallel zu bg_1h/bg_2h, applied 2026-04-29 auf
  zalpwyhlijbjyspjzbvn)
- Mobile Glev-Bottom-Tab → /engine
- /pro CTA → direkter Stripe Payment Link
- GlevActionSheet ersetzt durch Header-`+` (`QuickAddMenu`)

## Offen
- **Cleanup `bg_1h` / `bg_2h`** → in `glucose_1h` / `glucose_2h`
  migrieren, alte Spalten droppen (low-prio)
- **Performance Dashboard/History** — A+D+E erste Welle (90-Tage-
  Limit auf `fetchMeals`, Suspense-Boundary, `useMemo`)
- **`lib/meals.ts` `fetchMeals` ohne Limit** — lädt alle Meals des
  Users in einem Request
