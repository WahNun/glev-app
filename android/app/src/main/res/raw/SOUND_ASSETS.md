# Sound Assets — android/app/src/main/res/raw/

Place WAV sound files here before building a release APK/AAB.
The files are gitignored as binary assets; copy them from the design
assets repository or generate them before each native build.

| Filename              | Purpose                          | Urgency |
|-----------------------|----------------------------------|---------|
| `glev_pre_check.wav`  | Pre-bolus meal-timeline reminder | Low     |
| `glev_post_check.wav` | Post-bolus meal-timeline check   | Low     |
| `glev_low_alarm.wav`  | Low-glucose alarm                | **High**|

## glev_low_alarm.wav requirements

- **Duration**: 3–4 seconds
- **Format**: WAV, 44.1 kHz, 16-bit mono
- **Tone**: Doppelter Beep 880 Hz + 1046 Hz alternierend (6 Wiederholungen)
- **Volume**: Peaks at −3 dBFS (will be further controlled by OS alarm volume)

## Pre-Build-Schritt (erforderlich vor jedem nativen Android/iOS-Build)

```sh
# Schritt 1: Sound-Assets aus Supabase Storage herunterladen
node scripts/pull-sound-assets.mjs

# Das Script legt die Dateien automatisch ab in:
#   android/app/src/main/res/raw/
#   ios/App/App/
```

> **Env-Variablen benötigt:** `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
> (aus `.env.local` — selbe Werte wie für die App).

Falls noch keine Dateien im Bucket sind, zuerst generieren und hochladen:

```sh
node scripts/generate-sound-assets.mjs --upload
```

## Sound-Assets verwalten

Im Admin-Panel unter `/glev-ops/sound-assets`:
- Status-Übersicht (hochgeladen / fehlt noch)
- Upload neuer WAV-Dateien (ersetzt bestehende)
- Web-Audio-Preview (Play-Button)
- Download

## Android Notification Channel

Der `hypo_alarm`-Kanal ist in `MainActivity.java` mit `IMPORTANCE_HIGH`
und dem Sound `glev_low_alarm` registriert (Android 8+, API 26+).
Der Kanal referenziert die Raw-Resource `/res/raw/glev_low_alarm.wav` —
die Datei **muss im APK/AAB enthalten sein**, sonst fällt Android auf den
Standard-Benachrichtigungston zurück.

## iOS

Für iOS `glev_low_alarm.wav` in Xcode → Targets → Glev → Build Phases →
„Copy Bundle Resources" aufnehmen. Das Script `pull-sound-assets.mjs` legt
die Datei bereits in `ios/App/App/` ab; Xcode muss sie nur noch kennen.
`@capacitor/local-notifications` findet sie automatisch über den Dateinamen
(`sound: "glev_low_alarm.wav"`).
