---
name: Sound Assets Policy
description: Welche WAV-Dateien für Glev-Notifications erwünscht sind — und welche explizit NICHT.
---

Nur diese 3 Alarm-WAVs sind erwünscht:
- `glev_low_alarm.wav` — Hypo
- `glev_high_alarm.wav` — Hyper
- `glev_elevated.wav` — Erhöhter BZ

**Explizit NICHT:** `glev_pre_check.wav` und `glev_post_check.wav` — Lucas will keine Töne bei Pre/Post-Bolus-Erinnerungen. Diese Dateien dürfen nicht generiert, hochgeladen oder ins App-Bundle aufgenommen werden.

**Why:** Lucas hat das am 2026-06-04 explizit so entschieden.

**How to apply:** Bei jedem generate-sound-assets.mjs-Lauf, Bucket-Upload oder pull-sound-assets.mjs-Lauf sicherstellen dass pre_check/post_check nicht enthalten sind.
