# Fix Report — Header AI-Chips auf /glev-ai Fullscreen-Page

**Datum:** 2026-06-12
**Task:** Kein Asana-Task (direkt aus User-Feedback)

## Problem
Auf der `/glev-ai`-Seite fehlten im Header: AIStateChip ("BEREIT"/"ANALYSIERT" mit Spinner),
Reset-Button (↻) und Speaker-Button (🔊). Stattdessen zeigte der Header die CGM-Pill.

Root cause: Alle Header-Bedingungen prüften nur `glevAi.sheetOpen`. Auf `/glev-ai` ist der
Chat eine Fullscreen-Page — kein Sheet. `sheetOpen` bleibt dort immer `false`.

## Lösung
`components/Layout.tsx`: alle 5 relevanten Header-Bedingungen um
`|| pathname.startsWith("/glev-ai")` erweitert:

1. `zIndex` (1102 wenn AI aktiv)
2. `transform`/`opacity`/`pointerEvents` (kein Header-Slide-away wenn AI offen)
3. "AI"-Span neben GlevLockup
4. `gap`-Wert im rechten Button-Container
5. Hauptbedingung für AIStateChip + Reset + Speaker-Block

Close-X-Button: auf `/glev-ai` → `router.back()` statt `glevAi.closeSheet()`
(closeSheet() wäre No-op da Sheet nicht geöffnet ist).

## Geänderte Dateien
- `components/Layout.tsx` — 5 Stellen erweitert

## Tests
Dev-Server läuft, keine neuen Compile-Fehler.
