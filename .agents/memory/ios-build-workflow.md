---
name: iOS Build Workflow
description: Lucas baut iOS-Builds immer mit Xcode, nie mit Fastlane
---

**Lucas nutzt immer Xcode direkt** für iOS-Builds (Archive → Distribute → TestFlight).

Niemals Fastlane-Befehle wie `bundle exec fastlane ios beta` vorschlagen.

**Lokaler Mac-Pfad:** `/Users/lucas/Documents/glev-app`

Terminal-Befehle immer mit diesem Pfad angeben, z.B.:
```
cd /Users/lucas/Documents/glev-app
npx cap sync ios
```

**Why:** Persönliche Präferenz — er arbeitet immer mit Xcode, nicht mit Fastlane. Pfad direkt von Lucas mitgeteilt (2026-06-03).
