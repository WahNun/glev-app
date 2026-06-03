---
name: Mistral voxtral TTS style control
description: Wie Style/Ton bei voxtral-mini-tts-2603 funktioniert — und was NICHT geht
---

# Mistral voxtral-mini-tts-2603 — Style Control

**Von Mistral Support bestätigt 2026-06-03.**

## Was NICHT funktioniert
- Text-Prepend als Stilanweisung (`"Sprich warm, ruhig..."` vor dem eigentlichen Text)
- Kein API-Feld `speaking_style`, `system_prompt`, `voice_instructions`
- Kein Delimiter wie `<style>...</style>` oder Klammern
- **Alles im `input`-Feld wird wörtlich vorgelesen — ohne Ausnahme**

## Was funktioniert
- **`ref_audio`** (base64 MP3/WAV) — "voice-as-an-instruction": Ton, Rhythmus, Emotion folgen dem Sample
- **`voice_id`** — wählt eine vortrainierte Stimme (z. B. "Jane")
- Style = ausschließlich über das Audio-Sample steuern

## API-Felder (alle erlaubten)
`model`, `input`, `response_format`, `ref_audio` ODER `voice_id`
→ Kein `speed`-Feld (gibt 422 "Extra inputs are not permitted")

**Why:** Jeder Versuch, Text-Instruktionen einzubauen, führt dazu dass der Nutzer die Instruktionen vorgelesen bekommt. Nie wieder probieren.

**How to apply:** Bei Style-Wünschen immer → ref_audio-Sample verbessern, nie Text-Prefix.
