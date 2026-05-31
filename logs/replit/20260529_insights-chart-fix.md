# Insights-Karten: leerer Platz gefüllt + Y-Achsen-Gitter

## Was geändert wurde

### Sparkline-Komponente (Zeile ~5084)
- `showGrid`-Prop hinzugefügt: 3 horizontale Gitterlinien (max/mid/min) mit Y-Achsen-Labels
- Linker Rand (28 viewBox-Einheiten) für Labels reserviert
- Gestrichelte Mittellinie, semi-transparente Linien
- Default-Höhe von 36 auf 80 erhöht

### Card 02 (gmi-a1c)
- `minHeight={CARD_MIN_H}` ergänzt (fehlte als einzige Chart-Karte)
- Sparkline-Höhe 36 → 170, `showGrid` aktiviert

### Card 03 (glucose-trend)
- Sparkline-Höhe 100 → 210, `showGrid` aktiviert

### InsightMicroBars (6 Stellen)
- TIR: 90 → 110
- Hypo-Events: 90 → 150
- Hyper-Events: 90 → 150
- CV-Variabilität: 80 → 130
- Mahlzeit-Bewertung: 80 → 120
- TDD: 80 → 100
