STATUS: DONE
LAST_DONE: Mobile-Bottom-Nav-Redesign — 4 sichtbare Tabs (Dashboard, Glev FAB elevated center, History, Settings) statt 5 gleich breiter. Glev = 56 px Kreis #4F6EF7, schwebt 20 px über der Bar, öffnet GlevActionSheet (Mahlzeit loggen → /log; Weiteres expandiert inline → Glukose /engine, Insulin /log, Exercise /log). History = neue Route /history mit Pill-Sub-Tabs [Insights] [Einträge], rendert die existierenden Page-Komponenten direkt ohne sie anzufassen. Desktop-Sidebar unverändert, alle bestehenden Pages unangetastet. Neu: components/GlevActionSheet.tsx, app/(protected)/history/page.tsx; geändert: components/Layout.tsx.
NEXT: Mobile testen — Glev-FAB tap → Sheet, Weiteres expandiert, Overlay/Esc/× schließt; History-Tab → /history, Sub-Tab-Wechsel rendert Insights/Entries.
QUESTION:
TIMESTAMP: 00:23
