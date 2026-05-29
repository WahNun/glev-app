# Dashboard Layout Changes (ad-hoc)

## Änderungen

### 1. Adapt-Score-Gate-Reorder
- `usePlan` Hook importiert in `app/(protected)/dashboard/page.tsx`
- `const controlScoreGated = !canAccess("control_score")` in `DashboardPage`
- Wenn gated: Control-Cluster zeigt nur `rate-triplet` (Triplette an erster Stelle)
- Gated `control-score` wandert in den Insulin-Cluster zwischen `iob` und `iob-history`
- Wenn freigeschaltet: klassische Reihenfolge [adapt-score, rate-triplet]

### 2. Triplette-Chip-Overlap-Fix
- Chip-Padding auf `clamp(8px,2.5vw,12px)` für alle Seiten
- Großer Zahlenwert: `fontSize: "clamp(22px,5.5vw,30px)"` (auf 375px → 22px)
- Sub-Label: `clamp(9px,2.5vw,11px)`
- Label-Truncation via `overflow:hidden; textOverflow:ellipsis; whiteSpace:nowrap`

### 3. Glucose-Trend ins Metabolic-Cluster verschoben
- `glucose-trend`-Card aus Glucose-Cluster (war allein) entfernt
- Als dritte Karte im Metabolic-Cluster eingefügt (macros → outcome → trend)
- TrendChart-Funktion + alle Imports bleiben erhalten
